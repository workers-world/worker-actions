/**
 * Classify dev_* push diffs for worker-ci admission (#213 / rev1#130 同类).
 * When only "noise" paths change, skip worker-verify (sync-lock) on push — Release PR 门禁仍跑全量 verify。
 *
 * Env:
 *   EVENT_BEFORE — github.event.before
 *   EVENT_SHA    — github.sha
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

/** @param {string} before @param {string} sha */
export function listChangedFiles(before, sha) {
  const zero = /^0+$/;
  if (!before || zero.test(before)) {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', sha], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', before, sha], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @param {string[]} files */
export function shouldSkipPackagesJobsOnPush(files) {
  if (files.length === 0) return true;
  return files.every(isNoisePath);
}

function main() {
  const before = process.env.EVENT_BEFORE ?? '';
  const sha = process.env.EVENT_SHA ?? process.env.GITHUB_SHA ?? 'HEAD';
  const files = listChangedFiles(before, sha);
  const skip = shouldSkipPackagesJobsOnPush(files);
  const out = process.env.GITHUB_OUTPUT;
  const line = `skip_packages_jobs=${skip ? 'true' : 'false'}`;
  if (out) {
    fs.appendFileSync(out, `${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
  const summary = skip
    ? `push admission: skip worker-verify on push (${files.length} file(s), noise-only)`
    : `push admission: run worker-verify on push (${files.length} file(s))`;
  console.log(`::notice::${summary}`);
  if (files.length > 0 && files.length <= 30) {
    console.log(`::notice::changed: ${files.join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main();
}
