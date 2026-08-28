#!/usr/bin/env node
/**
 * 拉取当前 workflow run 的 check-run annotations（对应 GHA Annotations 面板）。
 * 输出纯文本到 stdout；若设置 GITHUB_OUTPUT 则写入 annotations 多行 output。
 * 失败时 fail-open（仍输出说明行，exit 0），避免阻断邮件主流程。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || '';
const runId = process.env.GITHUB_RUN_ID;
const MAX_ANNOTATION_CONCURRENCY = 8;

const LEVEL_ORDER = { failure: 0, warning: 1, notice: 2 };
const LEVEL_LABEL = { failure: 'ERROR', warning: 'WARNING', notice: 'NOTICE' };
const MAX_CHARS = 12000;

function writeOutput(text) {
  try {
    process.stdout.write(text);
    const outFile = process.env.GITHUB_OUTPUT;
    if (!outFile) return;
    const delim = `annotations_${crypto.randomUUID()}`;
    fs.appendFileSync(outFile, `annotations<<${delim}\n${text}${delim}\n`);
  } catch (err) {
    process.stderr.write(`(writeOutput failed: ${err.message})\n`);
  }
}

async function gh(path) {
  const url = `https://api.github.com${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text();
        // 5xx / 429 重试；4xx 不重试
        if ((res.status >= 500 || res.status === 429) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new Error(`${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } catch (err) {
      const retriable = err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ECONNRESET|ETIMEDOUT/.test(err.message || '');
      if (attempt < 3 && retriable) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function paginate(path, listKey) {
  const out = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await gh(`${path}${sep}per_page=100&page=${page}`);
    const chunk = listKey ? data[listKey] ?? [] : Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < 100) break;
    page += 1;
  }
  return out;
}

/** 简单并发池：最多 limit 个 in-flight */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(limit, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function formatEntry(job, level, message, title) {
  const label = LEVEL_LABEL[level] || String(level || 'NOTICE').toUpperCase();
  const body = title && !message.startsWith(title) ? `${title}: ${message}` : message || title || '(无消息)';
  return `[${job}] ${label}\n${body}\n`;
}

async function main() {
  // 校验 owner/repo 格式，防异常环境变量静默产生错误请求
  const repoMatch = repository.match(/^([^/]+)\/([^/]+)$/);
  if (!repoMatch) {
    writeOutput(`(跳过 annotations：GITHUB_REPOSITORY 格式异常: ${repository}\n)`);
    return;
  }
  const [owner, repo] = repoMatch.slice(1);

  if (!token || !owner || !repo || !runId) {
    writeOutput('(跳过 annotations：缺少 GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_RUN_ID)\n');
    return;
  }

  try {
    const run = await gh(`/repos/${owner}/${repo}/actions/runs/${runId}`);
    const suiteId = run.check_suite_id;
    if (!suiteId) {
      writeOutput('(本 run 无 check_suite_id，无法拉取 annotations)\n');
      return;
    }

    // allSettled：任一请求失败不丢弃另一路结果（fail-open 降级）
    const [checkRunsRes, jobsRes] = await Promise.allSettled([
      paginate(`/repos/${owner}/${repo}/check-suites/${suiteId}/check-runs`, 'check_runs'),
      paginate(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, 'jobs'),
    ]);
    const checkRuns = checkRunsRes.status === 'fulfilled' ? checkRunsRes.value : [];
    const jobs = jobsRes.status === 'fulfilled' ? jobsRes.value : [];
    if (checkRunsRes.status === 'rejected') {
      process.stderr.write(`(check-runs 拉取失败: ${checkRunsRes.reason?.message})\n`);
    }
    if (jobsRes.status === 'rejected') {
      process.stderr.write(`(jobs 拉取失败: ${jobsRes.reason?.message})\n`);
    }

    const entries = [];
    const seen = new Set();
    let annFetchFailed = 0;

    // 限并发拉取各 check-run 的 annotations，避免矩阵 workflow 瞬间打出大量请求触发 429
    const completed = checkRuns.filter((cr) => cr.status === 'completed');
    const annResults = await mapPool(completed, MAX_ANNOTATION_CONCURRENCY, async (cr) => {
      try {
        const anns = await paginate(`/repos/${owner}/${repo}/check-runs/${cr.id}/annotations`, null);
        return { cr, anns, ok: true };
      } catch {
        return { cr, anns: [], ok: false };
      }
    });
    for (const { cr, anns, ok } of annResults) {
      if (!ok) annFetchFailed += 1;
      const jobLabel = cr.name || 'check';
      for (const a of anns) {
        const message = (a.message || a.raw_details || '').trim();
        const title = (a.title || '').trim();
        const key = `${jobLabel}|${a.annotation_level}|${title}|${message}`;
        if (!message && !title) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          job: jobLabel,
          level: a.annotation_level || 'notice',
          message,
          title,
        });
      }
    }

    for (const job of jobs) {
      if (job.conclusion !== 'failure') continue;
      for (const step of job.steps ?? []) {
        if (step.conclusion !== 'failure') continue;
        const message = `Step "${step.name}" failed`;
        const key = `${job.name}|failure|${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ job: job.name, level: 'failure', message, title: '' });
      }
    }

    entries.sort((a, b) => {
      const la = LEVEL_ORDER[a.level] ?? 9;
      const lb = LEVEL_ORDER[b.level] ?? 9;
      if (la !== lb) return la - lb;
      return a.job.localeCompare(b.job);
    });

    if (!entries.length) {
      const note = annFetchFailed
        ? `(本 run 无 workflow annotations；${annFetchFailed} 个 check-run annotations 拉取失败已降级)\n`
        : '(本 run 无 workflow annotations)\n';
      writeOutput(note);
      return;
    }

    let text = '';
    if (annFetchFailed) {
      text += `(提示：${annFetchFailed} 个 check-run annotations 拉取失败，内容可能不完整)\n\n`;
    }
    for (const e of entries) {
      const block = formatEntry(e.job, e.level, e.message, e.title);
      if (text.length + block.length > MAX_CHARS) {
        text += '…(annotations 过多已截断)\n';
        break;
      }
      text += `${block}\n`;
    }
    writeOutput(text.trimEnd() + '\n');
  } catch (err) {
    writeOutput(`(拉取 annotations 失败: ${err.message})\n`);
  }
}

main().catch((err) => {
  writeOutput(`(拉取 annotations 未捕获异常: ${err.message})\n`);
  process.exitCode = 0;
});
