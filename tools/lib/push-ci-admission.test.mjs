import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  listChangedFiles,
  shouldSkipPackagesJobsOnPush,
} from './push-ci-admission.mjs';

test('shouldSkipPackagesJobsOnPush skips lock-only and workflow pin pushes', () => {
  assert.equal(
    shouldSkipPackagesJobsOnPush(['package-lock.json']),
    true,
  );
  assert.equal(
    shouldSkipPackagesJobsOnPush(['.github/workflows/ci.yml']),
    true,
  );
  assert.equal(
    shouldSkipPackagesJobsOnPush(['package-lock.json', '.github/workflows/ci.yml']),
    true,
  );
  assert.equal(
    shouldSkipPackagesJobsOnPush(['docs/foo.md', 'README.md']),
    true,
  );
});

test('shouldSkipPackagesJobsOnPush runs verify path when package.json or src changes', () => {
  assert.equal(shouldSkipPackagesJobsOnPush(['package.json']), false);
  assert.equal(shouldSkipPackagesJobsOnPush(['src/index.ts']), false);
  assert.equal(
    shouldSkipPackagesJobsOnPush(['package-lock.json', 'package.json']),
    false,
  );
  assert.equal(shouldSkipPackagesJobsOnPush([]), false);
});

test('listChangedFiles with zero before uses commit tree (new destin first push)', () => {
  const sha = process.env.GITHUB_SHA ?? 'HEAD';
  const files = listChangedFiles(
    '0000000000000000000000000000000000000000',
    sha,
  );
  assert.ok(files.length > 0, 'expected non-empty paths from diff-tree at tip');
});

test('zero before on package.json-only tip commit does not skip (#282)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-ci-adm-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.1"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'bump fsw pin'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  const moduleUrl = new URL('./push-ci-admission.mjs', import.meta.url).href;
  const out = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { listChangedFiles, shouldSkipPackagesJobsOnPush } from ${JSON.stringify(moduleUrl)};
const zero = '0000000000000000000000000000000000000000';
const files = listChangedFiles(zero, ${JSON.stringify(sha)});
if (!files.includes('package.json')) throw new Error('missing package.json: ' + files);
if (shouldSkipPackagesJobsOnPush(files)) throw new Error('should not skip');
process.stdout.write('ok');`,
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.equal(out.trim(), 'ok');
});
