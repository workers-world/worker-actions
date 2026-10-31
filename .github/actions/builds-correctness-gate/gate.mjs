#!/usr/bin/env node
/**
 * #221 Round 7–17：等待 PR head commit 上 Cloudflare Workers Builds GitHub Check 完成。
 * R9 曾改为 5s 固定轮询（E2E 回归）；R10 回滚为默认 cap 20s、首轮立即查询。
 * R11：首轮立即查询后自适应间隔 2s → 5s → 10s → cap（默认 20s；--poll-seconds 仅作 cap）。
 * R13：更紧 1s 起自适应（E2E 回归）；R14 回滚 R13 poll，恢复 R11 的 2s→5s→10s→cap。
 * R16：CF Builds API 主路径（E2E 回归）；R17 回滚 R16，恢复 GitHub Check Runs 主路径。
 */

import { pathToFileURL } from 'node:url';

const CF_APP_SLUG = 'cloudflare-workers-and-pages';

/** 首轮查询后的 sleep 序列（秒）；其后每次 sleep 使用 cap（--poll-seconds，默认 20）。 */
const ADAPTIVE_POLL_STEPS_SEC = [2, 5, 10];

/**
 * @param {number} capSeconds --poll-seconds（上限）
 * @param {number} afterFirstPollIndex 0 = 第一次 sleep（紧接首轮立即查询之后）
 */
export function adaptivePollSeconds(capSeconds, afterFirstPollIndex) {
  const cap = Number(capSeconds);
  const safeCap = Number.isFinite(cap) && cap > 0 ? cap : 20;
  const idx = Number(afterFirstPollIndex);
  if (Number.isFinite(idx) && idx >= 0 && idx < ADAPTIVE_POLL_STEPS_SEC.length) {
    return Math.min(ADAPTIVE_POLL_STEPS_SEC[idx], safeCap);
  }
  return safeCap;
}

function matchesContext(name, checkContext) {
  if (!checkContext.trim()) return true;
  const want = checkContext.trim();
  return name === want || name.includes(want);
}

function filterBuildsChecks(runs, checkContext) {
  return runs.filter((cr) => {
    const slug = cr.app?.slug ?? '';
    if (slug !== CF_APP_SLUG) return false;
    return matchesContext(cr.name ?? '', checkContext);
  });
}

export { CF_APP_SLUG, filterBuildsChecks, matchesContext };

function parseArgs(argv) {
  const opts = {
    owner: '',
    repo: '',
    headSha: '',
    checkContext: '',
    timeoutSeconds: 45 * 60,
    pollSeconds: 20,
    token: process.env.GITHUB_TOKEN || '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--owner') opts.owner = argv[++i] ?? '';
    else if (arg === '--repo') opts.repo = argv[++i] ?? '';
    else if (arg === '--head-sha') opts.headSha = argv[++i] ?? '';
    else if (arg === '--check-context') opts.checkContext = argv[++i] ?? '';
    else if (arg === '--timeout-seconds') opts.timeoutSeconds = Number(argv[++i]);
    else if (arg === '--poll-seconds') opts.pollSeconds = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: gate.mjs --owner O --repo R --head-sha SHA [--check-context NAME] [--timeout-seconds N] [--poll-seconds CAP]',
      );
      process.exit(0);
    }
  }
  if (!opts.owner || !opts.repo || !opts.headSha) {
    console.error('::error::builds-correctness-gate 缺少 --owner / --repo / --head-sha');
    process.exit(2);
  }
  if (!opts.token) {
    console.error('::error::GITHUB_TOKEN 未设置，无法查询 check runs');
    process.exit(2);
  }
  return opts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghGet(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function listCheckRuns(owner, repo, headSha, token) {
  const runs = [];
  let page = 1;
  for (;;) {
    const data = await ghGet(
      `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100&page=${page}`,
      token,
    );
    runs.push(...(data.check_runs ?? []));
    if (!data.check_runs?.length || runs.length >= (data.total_count ?? runs.length)) {
      break;
    }
    page += 1;
    if (page > 20) break;
  }
  return runs;
}

function summarize(runs) {
  return runs.map((cr) => `${cr.name}:${cr.status}/${cr.conclusion ?? 'pending'}`).join('; ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  let lastNotice = 0;
  let polls = 0;

  while (Date.now() < deadline) {
    if (polls > 0) {
      const waitSec = adaptivePollSeconds(opts.pollSeconds, polls - 1);
      await sleep(waitSec * 1000);
    }
    polls += 1;

    const all = await listCheckRuns(opts.owner, opts.repo, opts.headSha, opts.token);
    const matched = filterBuildsChecks(all, opts.checkContext);

    if (matched.length === 0) {
      if (Date.now() - lastNotice > 120_000) {
        console.log(
          `::notice::等待 Cloudflare Workers Builds check（app=${CF_APP_SLUG}` +
            `${opts.checkContext ? `, context≈${opts.checkContext}` : ''}）…`,
        );
        lastNotice = Date.now();
      }
    } else {
      const pending = matched.filter((cr) => cr.status !== 'completed');
      const failed = matched.filter(
        (cr) =>
          cr.status === 'completed' &&
          cr.conclusion !== 'success' &&
          cr.conclusion !== 'skipped',
      );

      if (failed.length) {
        console.error(
          `::error::Workers Builds check 未通过：${summarize(failed)}。请在 PR Checks 面板查看 Details。`,
        );
        process.exit(1);
      }

      if (pending.length === 0) {
        console.log(`::notice::Workers Builds 正确性门禁通过（${summarize(matched)}）`);
        process.exit(0);
      }

      if (Date.now() - lastNotice > 60_000) {
        console.log(`::notice::Builds check 进行中：${summarize(matched)}`);
        lastNotice = Date.now();
      }
    }
  }

  console.error(
    '::error::等待 Workers Builds check 超时（fail-closed）。' +
      '请确认：1) Cloudflare Dashboard 已启用 Preview builds；' +
      '2) Build command 含 npm run check / npm test（见 docs/workers-builds-correctness-gate.md）；' +
      '3) monorepo 时 worker-ci with.builds_check_context 与 GitHub required check 名一致。',
  );
  process.exit(1);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
