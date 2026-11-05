/**
 * Classify dev_* push diffs for worker-ci admission (#213 / rev1#130 同类).
 * When only "noise" paths change, skip worker-verify (sync-lock) on push — Release PR 门禁仍跑全量 verify。
 *
 * Env:
 *   EVENT_BEFORE     — github.event.before
 *   EVENT_SHA        — github.sha
 *   DEFAULT_BRANCH   — github.event.repository.default_branch（zero-before 时与 tip 求 merge-base；#297）
 *   EVENT_COMMIT_IDS — space-separated github.event.commits.*.id (optional; #296)
 * Writes GITHUB_OUTPUT: skip_packages_jobs=true|false
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} p */
function isNoisePath(p) {
  if (!p || p === '') return false;
  if (p === 'package-lock.json' || p === '.npmrc') return true;
  if (p.startsWith('.github/workflows/')) return true;
  if (p.startsWith('docs/')) return true;
  if (p.endsWith('.md')) return true;
  if (p === 'README' || p.startsWith('README.')) return true;
  if (p.startsWith('.github/dependabot')) return true;
  if (p === 'manifest/actions-bundle.yaml') return true;
  return false;
}

/** @param {string | undefined | null} before */
export function isNewRefBefore(before) {
  return !before || /^0+$/.test(before);
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: opts.cwd,
  });
}

/** @param {string} text */
function splitNames(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Tip commit vs its first parent (or empty tree with --root). */
/** @param {string} sha @param {{ cwd?: string }} [opts] */
function listFilesInCommit(sha, opts = {}) {
  return splitNames(
    git(
      ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMRT', sha],
      opts,
    ),
  );
}

/** @param {string[]} shas @param {{ cwd?: string }} [opts] */
function listFilesAcrossCommits(shas, opts = {}) {
  const files = new Set();
  for (const sha of shas) {
    if (!sha) continue;
    for (const f of listFilesInCommit(sha, opts)) files.add(f);
  }
  return [...files];
}

/**
 * Resolve a local/remote ref for the repo default branch (fetch if needed).
 * @param {string} defaultBranch
 * @param {{ cwd?: string }} [opts]
 * @returns {string | null}
 */
export function resolveDefaultBranchRef(defaultBranch, opts = {}) {
  if (!defaultBranch) return null;
  const candidates = [
    defaultBranch,
    `refs/heads/${defaultBranch}`,
    `origin/${defaultBranch}`,
    `refs/remotes/origin/${defaultBranch}`,
  ];
  for (const ref of candidates) {
    try {
      return git(['rev-parse', '--verify', `${ref}^{commit}`], opts).trim();
    } catch {
      // try next
    }
  }
  // Full history needed so merge-base can walk default tip back to the fork
  // point when default has moved ahead of the new ref's branch point.
  try {
    git(['fetch', '--no-tags', 'origin', defaultBranch], opts);
    return git(['rev-parse', '--verify', `origin/${defaultBranch}^{commit}`], opts).trim();
  } catch {
    return null;
  }
}

/**
 * Paths introduced on `sha` since diverging from `baseSha` (merge-base…tip).
 * @param {string} baseSha
 * @param {string} sha
 * @param {{ cwd?: string }} [opts]
 */
export function listFilesSinceMergeBase(baseSha, sha, opts = {}) {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', baseSha, sha], opts).trim();
  } catch {
    return null;
  }
  if (!mergeBase) return null;
  return splitNames(
    git(['diff', '--name-only', '--diff-filter=ACMRT', mergeBase, sha], opts),
  );
}

/**
 * New-ref first push: prefer full changeset vs default-branch merge-base (#297);
 * union github.event.commits when provided (#296); fall back to tip-only (#282).
 * @param {string} sha
 * @param {string} [defaultBranch]
 * @param {{ cwd?: string, pushCommitIds?: string[] }} [opts]
 */
export function listFilesForNewRef(sha, defaultBranch = '', opts = {}) {
  const pushCommitIds = opts.pushCommitIds ?? [];
  const fromCommits =
    pushCommitIds.length > 0
      ? listFilesAcrossCommits([...new Set([...pushCommitIds, sha].filter(Boolean))], opts)
      : null;

  const baseSha = resolveDefaultBranchRef(defaultBranch, opts);
  if (baseSha) {
    const sinceBase = listFilesSinceMergeBase(baseSha, sha, opts);
    if (sinceBase != null) {
      if (fromCommits) return [...new Set([...sinceBase, ...fromCommits])];
      return sinceBase;
    }
  }
  if (fromCommits) return fromCommits;
  return listFilesInCommit(sha, opts);
}

/**
 * @param {string} before
 * @param {string} sha
 * @param {string | string[]} [defaultBranchOrCommitIds] default branch name (#297), or push commit ids (#296)
 * @param {{ cwd?: string, pushCommitIds?: string[] }} [opts]
 */
export function listChangedFiles(before, sha, defaultBranchOrCommitIds = '', opts = {}) {
  /** @type {string} */
  let defaultBranch = '';
  /** @type {string[]} */
  let pushCommitIds = opts.pushCommitIds ?? [];
  if (Array.isArray(defaultBranchOrCommitIds)) {
    pushCommitIds = defaultBranchOrCommitIds;
  } else {
    defaultBranch = defaultBranchOrCommitIds || '';
  }

  if (isNewRefBefore(before)) {
    // New ref first push: tip-only diff-tree misses earlier commits (#296 / #297).
    return listFilesForNewRef(sha, defaultBranch, { ...opts, pushCommitIds });
  }
  return splitNames(
    git(['diff', '--name-only', '--diff-filter=ACMRT', before, sha], opts),
  );
}

/**
 * @param {string[]} files
 * @param {{ newRef?: boolean }} [opts]
 */
export function shouldSkipPackagesJobsOnPush(files, opts = {}) {
  // New-ref first push: never skip when listing may be incomplete (#296).
  // Empty list must not skip (#282). With a full merge-base listing (#297),
  // callers omit newRef and may still skip noise-only ranges.
  if (opts.newRef) return false;
  if (files.length === 0) return false;
  return files.every(isNoisePath);
}

/** @param {string | undefined} raw */
function parseCommitIds(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .trim()
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const before = process.env.EVENT_BEFORE ?? '';
  const sha = process.env.EVENT_SHA ?? process.env.GITHUB_SHA ?? 'HEAD';
  const defaultBranch = process.env.DEFAULT_BRANCH ?? '';
  const pushCommitIds = parseCommitIds(process.env.EVENT_COMMIT_IDS);
  const newRef = isNewRefBefore(before);
  const files = listChangedFiles(before, sha, defaultBranch || '', { pushCommitIds });
  // Prefer #297 merge-base listing for skip when DEFAULT_BRANCH is set.
  // When it is missing, tip/event.commits may be incomplete — apply #296 never-skip.
  const skip = shouldSkipPackagesJobsOnPush(files, {
    newRef: newRef && !defaultBranch,
  });
  const out = process.env.GITHUB_OUTPUT;
  const line = `skip_packages_jobs=${skip ? 'true' : 'false'}`;
  if (out) {
    fs.appendFileSync(out, `${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
  const summary = skip
    ? `push admission: skip worker-verify on push (${files.length} file(s), noise-only)`
    : `push admission: run worker-verify on push (${files.length} file(s)${newRef ? ', new-ref' : ''})`;
  console.log(`::notice::${summary}`);
  if (files.length > 0 && files.length <= 30) {
    console.log(`::notice::changed: ${files.join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main();
}
