import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { shouldSkipPackagesJobsOnPush } from './push-ci-admission.mjs';

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

/**
 * Isolated git fixture for listChangedFiles (must not use ambient GITHUB_SHA/HEAD:
 * PR checkouts often lack the merge ref, and merge tips make bare diff-tree empty — #295).
 * @param {string} prefix
 * @returns {string} temp repo path
 */
function initFixtureRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  return dir;
}

/** @param {string} dir @param {string} sha @param {string} expression */
function runAdmissionInRepo(dir, sha, expression) {
  const moduleUrl = new URL('./push-ci-admission.mjs', import.meta.url).href;
  return execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { listChangedFiles, shouldSkipPackagesJobsOnPush } from ${JSON.stringify(moduleUrl)};
const zero = '0000000000000000000000000000000000000000';
const sha = ${JSON.stringify(sha)};
${expression}`,
    ],
    { cwd: dir, encoding: 'utf8' },
  );
}

test('listChangedFiles with zero before uses tip commit paths (hermetic; #295)', () => {
  const dir = initFixtureRepo('push-ci-adm-zero-');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  const out = runAdmissionInRepo(
    dir,
    sha,
    `const files = listChangedFiles(zero, sha);
if (!files.includes('README.md')) throw new Error('missing README.md: ' + files);
process.stdout.write(JSON.stringify(files));`,
  );
  const files = JSON.parse(out.trim());
  assert.ok(files.length > 0, 'expected non-empty paths from diff-tree at tip');
  assert.ok(files.includes('README.md'));
});

test('zero before on merge tip does not throw and does not skip (#295)', () => {
  const dir = initFixtureRepo('push-ci-adm-merge-');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: dir });
  execFileSync('git', ['checkout', '-b', 'side'], { cwd: dir });
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  execFileSync('git', ['add', 'b.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'side'], { cwd: dir });
  execFileSync('git', ['checkout', 'main'], { cwd: dir });
  writeFileSync(join(dir, 'c.txt'), 'c\n');
  execFileSync('git', ['add', 'c.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'main'], { cwd: dir });
  execFileSync('git', ['merge', '--no-ff', '-m', 'merge', 'side'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', sha], {
    cwd: dir,
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/);
  assert.ok(parents.length >= 3, 'expected a merge commit with two parents');
  // Bare diff-tree on a merge (no -m/-c) may emit nothing; admission must still not skip.
  const out = runAdmissionInRepo(
    dir,
    sha,
    `const files = listChangedFiles(zero, sha);
if (shouldSkipPackagesJobsOnPush(files)) throw new Error('should not skip on merge tip: ' + files);
process.stdout.write('ok');`,
  );
  assert.equal(out.trim(), 'ok');
});

test('zero before on package.json-only tip commit does not skip (#282)', () => {
  const dir = initFixtureRepo('push-ci-adm-');
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
  const out = runAdmissionInRepo(
    dir,
    sha,
    `const files = listChangedFiles(zero, sha);
if (!files.includes('package.json')) throw new Error('missing package.json: ' + files);
if (shouldSkipPackagesJobsOnPush(files)) throw new Error('should not skip');
process.stdout.write('ok');`,
  );
  assert.equal(out.trim(), 'ok');
});
