#!/usr/bin/env node
/**
 * #221 Round 16：主路径轮询 Cloudflare Workers Builds API（commit + worker tag）；
 * 未配置 CF / 空结果 / 暂态错误时回退 GitHub Check（cloudflare-workers-and-pages）。
 * 自适应 poll：2s → 5s → 10s → cap（默认 20s）；首轮立即查询；fail-closed 超时。
 */

import { pathToFileURL } from 'node:url';

const CF_APP_SLUG = 'cloudflare-workers-and-pages';

/** 首轮查询后的 sleep 序列（秒）；其后每次 sleep 使用 cap（--poll-seconds，默认 20）。 */
const ADAPTIVE_POLL_STEPS_SEC = [2, 5, 10];

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

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

/** @param {{ cfAccountId?: string, cfWorkerTag?: string, cfApiToken?: string }} opts */
export function cfApiConfigured(opts) {
  return Boolean(
    String(opts.cfAccountId ?? '').trim() &&
      String(opts.cfWorkerTag ?? '').trim() &&
      String(opts.cfApiToken ?? '').trim(),
  );
}

/** @param {string} headSha @param {string | undefined} commitHash */
export function commitHashMatches(headSha, commitHash) {
  const want = String(headSha ?? '')
    .trim()
    .toLowerCase();
  const got = String(commitHash ?? '')
    .trim()
    .toLowerCase();
  if (!want || !got) return false;
  return got === want || got.startsWith(want) || want.startsWith(got);
}

/**
 * @param {Array<Record<string, unknown>>} builds
 * @param {string} headSha
 */
export function pickBuildForCommit(builds, headSha) {
  const matched = builds.filter((b) => {
    const meta = /** @type {Record<string, unknown>} */ (b.build_trigger_metadata ?? {});
    const hash = meta.commit_hash ?? meta.commitHash;
    return commitHashMatches(headSha, String(hash ?? ''));
  });
  if (!matched.length) return null;
  matched.sort((a, b) => {
    const ta = Date.parse(String(a.created_on ?? '')) || 0;
    const tb = Date.parse(String(b.created_on ?? '')) || 0;
    return tb - ta;
  });
  return matched[0];
}

/**
 * @param {Record<string, unknown> | null | undefined} build
 * @returns {'pending' | 'success' | 'failure' | 'none'}
 */
export function classifyCfBuild(build) {
  if (!build) return 'none';
  const status = String(build.status ?? '');
  if (status !== 'stopped') return 'pending';
  const outcome = String(build.build_outcome ?? '');
  if (outcome === 'success' || outcome === 'skipped') return 'success';
  if (outcome === 'fail' || outcome === 'cancelled' || outcome === 'terminated') {
    return 'failure';
  }
  return 'pending';
}

export function summarizeCfBuild(build) {
  if (!build) return '(none)';
  return `${build.build_uuid}:${build.status}/${build.build_outcome ?? 'pending'}`;
}

/**
 * @param {Array<{ status: string, conclusion?: string | null }>} matched
 * @returns {'pending' | 'success' | 'failure' | 'none'}
 */
export function classifyGithubChecks(matched) {
  if (!matched.length) return 'none';
  const failed = matched.filter(
    (cr) =>
      cr.status === 'completed' &&
      cr.conclusion !== 'success' &&
      cr.conclusion !== 'skipped',
  );
  if (failed.length) return 'failure';
  const pending = matched.filter((cr) => cr.status !== 'completed');
  if (pending.length) return 'pending';
  return 'success';
}

export function summarizeGithubChecks(runs) {
  return runs.map((cr) => `${cr.name}:${cr.status}/${cr.conclusion ?? 'pending'}`).join('; ');
}

function parseArgs(argv) {
  const opts = {
    owner: '',
    repo: '',
    headSha: '',
    checkContext: '',
    timeoutSeconds: 45 * 60,
    pollSeconds: 20,
    token: process.env.GITHUB_TOKEN || '',
    cfAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    cfWorkerTag: process.env.CLOUDFLARE_WORKER_TAG || '',
    cfApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--owner') opts.owner = argv[++i] ?? '';
    else if (arg === '--repo') opts.repo = argv[++i] ?? '';
    else if (arg === '--head-sha') opts.headSha = argv[++i] ?? '';
    else if (arg === '--check-context') opts.checkContext = argv[++i] ?? '';
    else if (arg === '--timeout-seconds') opts.timeoutSeconds = Number(argv[++i]);
    else if (arg === '--poll-seconds') opts.pollSeconds = Number(argv[++i]);
    else if (arg === '--cf-account-id') opts.cfAccountId = argv[++i] ?? '';
    else if (arg === '--cf-worker-tag') opts.cfWorkerTag = argv[++i] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: gate.mjs --owner O --repo R --head-sha SHA [--check-context NAME] ' +
          '[--timeout-seconds N] [--poll-seconds CAP] [--cf-account-id ID] [--cf-worker-tag TAG]',
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

/**
 * @param {string} path
 * @param {string} token
 */
export async function cfApiGet(path, token) {
  const res = await fetch(`${CF_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new CfApiError(`CF API ${path} → ${res.status}: non-JSON body`, res.status, false);
  }
  if (!res.ok) {
    const transient = res.status >= 500 || res.status === 429;
    throw new CfApiError(
      `CF API ${path} → ${res.status}: ${body.slice(0, 500)}`,
      res.status,
      transient,
    );
  }
  if (data.success === false) {
    const transient = false;
    throw new CfApiError(
      `CF API ${path} errors: ${JSON.stringify(data.errors ?? []).slice(0, 500)}`,
      res.status,
      transient,
    );
  }
  return data;
}

export class CfApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {boolean} transient
   */
  constructor(message, status, transient) {
    super(message);
    this.name = 'CfApiError';
    this.status = status;
    this.transient = transient;
  }
}

/**
 * @param {string} accountId
 * @param {string} workerTag external_script_id
 * @param {string} token
 * @param {number} [maxPages]
 */
export async function listCfBuildsForWorker(accountId, workerTag, token, maxPages = 8) {
  const builds = [];
  let page = 1;
  for (;;) {
    const data = await cfApiGet(
      `/accounts/${encodeURIComponent(accountId)}/builds/workers/${encodeURIComponent(workerTag)}/builds?per_page=25&page=${page}`,
      token,
    );
    const batch = Array.isArray(data.result) ? data.result : [];
    builds.push(...batch);
    const info = data.result_info ?? {};
    const totalPages = info.total_pages ?? page;
    if (page >= totalPages || batch.length === 0 || page >= maxPages) {
      break;
    }
    page += 1;
  }
  return builds;
}

/**
 * @param {{ cfAccountId: string, cfWorkerTag: string, cfApiToken: string, headSha: string }} opts
 * @returns {Promise<'pending' | 'success' | 'failure' | 'none'>}
 */
export async function pollCfBuildOnce(opts) {
  const builds = await listCfBuildsForWorker(opts.cfAccountId, opts.cfWorkerTag, opts.cfApiToken);
  const build = pickBuildForCommit(builds, opts.headSha);
  return classifyCfBuild(build);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  let lastNotice = 0;
  let polls = 0;
  let useCfPrimary = cfApiConfigured(opts);
  let cfFallbackLogged = false;

  if (useCfPrimary) {
    console.log(
      '::notice::builds-correctness-gate 主路径 Cloudflare Builds API' +
        `（account=${opts.cfAccountId}, worker_tag=${opts.cfWorkerTag}, head=${opts.headSha.slice(0, 7)}）`,
    );
  } else {
    console.log(
      '::notice::builds-correctness-gate 回退 GitHub Check Runs（未配置 CLOUDFLARE_API_TOKEN + ACCOUNT + WORKER_TAG）',
    );
  }

  while (Date.now() < deadline) {
    if (polls > 0) {
      const waitSec = adaptivePollSeconds(opts.pollSeconds, polls - 1);
      await sleep(waitSec * 1000);
    }
    polls += 1;

    if (useCfPrimary) {
      try {
        const builds = await listCfBuildsForWorker(
          opts.cfAccountId,
          opts.cfWorkerTag,
          opts.cfApiToken,
        );
        const build = pickBuildForCommit(builds, opts.headSha);
        const state = classifyCfBuild(build);

        if (state === 'success') {
          console.log(`::notice::Workers Builds API 门禁通过（${summarizeCfBuild(build)}）`);
          process.exit(0);
        }
        if (state === 'failure') {
          console.error(
            `::error::Workers Builds API 未通过：${summarizeCfBuild(build)}。请在 Cloudflare Builds 日志查看详情。`,
          );
          process.exit(1);
        }

        if (Date.now() - lastNotice > 120_000) {
          console.log(
            `::notice::等待 Cloudflare Builds API（worker_tag=${opts.cfWorkerTag}, commit=${opts.headSha.slice(0, 7)}）…`,
          );
          lastNotice = Date.now();
        }
        continue;
      } catch (err) {
        const cfErr = err instanceof CfApiError ? err : null;
        const transient = cfErr?.transient ?? true;
        if (!cfFallbackLogged) {
          console.log(
            `::warning::Cloudflare Builds API 不可用（${err.message}），回退 GitHub Check Runs`,
          );
          cfFallbackLogged = true;
        }
        useCfPrimary = false;
        if (!transient && cfErr && (cfErr.status === 401 || cfErr.status === 403)) {
          console.log('::notice::CF API 鉴权失败，后续仅使用 GitHub Check 回退路径');
        }
      }
    }

    const all = await listCheckRuns(opts.owner, opts.repo, opts.headSha, opts.token);
    const matched = filterBuildsChecks(all, opts.checkContext);
    const ghState = classifyGithubChecks(matched);

    if (ghState === 'none') {
      if (Date.now() - lastNotice > 120_000) {
        console.log(
          `::notice::等待 Cloudflare Workers Builds check（app=${CF_APP_SLUG}` +
            `${opts.checkContext ? `, context≈${opts.checkContext}` : ''}）…`,
        );
        lastNotice = Date.now();
      }
    } else if (ghState === 'failure') {
      console.error(
        `::error::Workers Builds check 未通过：${summarizeGithubChecks(matched)}。请在 PR Checks 面板查看 Details。`,
      );
      process.exit(1);
    } else if (ghState === 'success') {
      console.log(`::notice::Workers Builds 正确性门禁通过（GitHub Check：${summarizeGithubChecks(matched)}）`);
      process.exit(0);
    } else if (Date.now() - lastNotice > 60_000) {
      console.log(`::notice::Builds check 进行中：${summarizeGithubChecks(matched)}`);
      lastNotice = Date.now();
    }
  }

  console.error(
    '::error::等待 Workers Builds 超时（fail-closed）。' +
      '请确认：1) Cloudflare Dashboard 已启用 Preview builds；' +
      '2) Build command 含 npm run check / npm test（见 docs/workers-builds-correctness-gate.md）；' +
      '3) 业务仓 secrets：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID 与 worker-ci builds_worker_tag（external_script_id）；' +
      '4) monorepo 时 worker-ci with.builds_check_context 与 GitHub required check 名一致。',
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
