/**
 * GitHub REST（只读）；优先 GITHUB_TOKEN，否则 gh auth token。
 */
import { execSync } from 'node:child_process';

const API_VERSION = '2022-11-28';

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('需要 GITHUB_TOKEN 或已登录的 gh CLI');
  }
}

let _token;
function token() {
  if (!_token) _token = resolveToken();
  return _token;
}

async function ghFetch(path, { method = 'GET' } = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      const body = await res.text();
      const err = new Error(`${path} → HTTP 404: ${body.slice(0, 120)}`);
      err.status = 404;
      throw err;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 500 * attempt)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error(`ghFetch exhausted retries: ${path}`);
}

export async function paginate(path, listKey, { perPage = 100, maxPages = 10 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await ghFetch(`${path}${sep}per_page=${perPage}&page=${page}`);
    const chunk = listKey ? data[listKey] ?? [] : Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return out;
}

export async function getWorkflowId(repo, workflowFile) {
  const data = await ghFetch(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`);
  return data.id;
}

export async function listWorkflowRuns(
  repo,
  workflowFile,
  { branch, status, event, conclusion, limit = 30 } = {},
) {
  const workflowId = await getWorkflowId(repo, workflowFile);
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (status) params.set('status', status);
  if (event) params.set('event', event);
  params.set('per_page', String(Math.min(limit * 2, 100)));
  const runs = await paginate(
    `/repos/${repo}/actions/workflows/${workflowId}/runs?${params}`,
    'workflow_runs',
    { maxPages: Math.ceil((limit * 2) / 100) || 1 },
  );
  let out = runs;
  if (conclusion) {
    out = out.filter((r) => r.conclusion === conclusion);
  }
  return out.slice(0, limit);
}

export async function getRunJobs(repo, runId) {
  return paginate(`/repos/${repo}/actions/runs/${runId}/jobs`, 'jobs', { maxPages: 5 });
}

export async function listTags(repo, prefix, limit = 15) {
  const refs = await paginate(`/repos/${repo}/git/matching-refs/tags/${encodeURIComponent(prefix)}`, null, {
    maxPages: 2,
  });
  const tags = refs
    .map((r) => r.ref.replace(/^refs\/tags\//, ''))
    .filter((t) => t.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return tags.slice(-limit);
}

export async function getCommitDate(repo, ref) {
  const data = await ghFetch(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  return data.commit?.committer?.date || data.commit?.author?.date || null;
}

/** 在 default 分支上找 subject/body 含 needle 的最近 commits */
export async function searchCommits(repo, needle, { since, limit = 5 } = {}) {
  const q = [`repo:${repo}`, `"${needle}"`];
  const data = await ghFetch(
    `/search/commits?q=${encodeURIComponent(q.join(' '))}&sort=committer-date&order=desc&per_page=${Math.min(limit, 20)}`,
  ).catch(() => ({ items: [] }));
  let items = data.items ?? [];
  if (since) {
    const t0 = Date.parse(since);
    items = items.filter((c) => {
      const d = c.commit?.committer?.date || c.commit?.author?.date;
      return d && Date.parse(d) >= t0;
    });
  }
  return items.slice(0, limit);
}

export { ghFetch };
