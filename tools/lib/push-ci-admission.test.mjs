import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isNewRefBefore,
  listChangedFiles,
  listFilesForNewRef,
  shouldSkipPackagesJobsOnPush,
} from './push-ci-admission.mjs';

const ZERO = '0000000000000000000000000000000000000000';

/** @param {string} dir @param {string[]} args */
function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** @returns {string} temp repo path with main + user config */
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'push-ci-adm-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'test']);
  return dir;
}

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

test('new-ref before never skips even when tip file list is noise-only (#296)', () => {
  assert.equal(isNewRefBefore(ZERO), true);
  assert.equal(isNewRefBefore(''), true);
  assert.equal(isNewRefBefore('abc'), false);
  assert.equal(
    shouldSkipPackagesJobsOnPush(['docs/x.md'], { newRef: true }),
    false,
  );
  assert.equal(
    shouldSkipPackagesJobsOnPush(['docs/x.md'], { newRef: false }),
    true,
  );
});

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
  assert.ok(files.length > 0, 'expected non-empty paths from new-ref listing');
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
  const dir = initRepo();
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'dev_00_99_02']);
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.1"}\n');
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-m', 'bump fsw pin']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  const files = listChangedFiles(
    '0000000000000000000000000000000000000000',
    sha,
    'main',
    { cwd: dir },
  );
  assert.ok(files.includes('package.json'), `missing package.json: ${files}`);
  assert.equal(shouldSkipPackagesJobsOnPush(files), false);
});

test('zero before covers full new-ref changeset when tip is noise-only (#297)', () => {
  const dir = initRepo();
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git(dir, ['add', 'package.json', 'README.md']);
  git(dir, ['commit', '-m', 'base on default']);

  // New destin: earlier commit bumps package.json; tip only touches docs (noise).
  git(dir, ['checkout', '-b', 'dev_00_99_00']);
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.1"}\n');
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-m', 'bump package']);
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'note.md'), 'noise tip\n');
  git(dir, ['add', 'docs/note.md']);
  git(dir, ['commit', '-m', 'docs only tip']);

  const sha = git(dir, ['rev-parse', 'HEAD']);
  const tipOnly = listFilesForNewRef(sha, '', { cwd: dir });
  assert.deepEqual(
    tipOnly,
    ['docs/note.md'],
    'tip-only fallback without default branch must see only noise',
  );
  assert.equal(
    shouldSkipPackagesJobsOnPush(tipOnly),
    true,
    'precondition: tip-only would incorrectly skip',
  );

  const files = listChangedFiles(
    '0000000000000000000000000000000000000000',
    sha,
    'main',
    { cwd: dir },
  );
  assert.ok(files.includes('package.json'), `expected package.json in ${files}`);
  assert.ok(files.includes('docs/note.md'), `expected docs/note.md in ${files}`);
  assert.equal(
    shouldSkipPackagesJobsOnPush(files),
    false,
    'merge-base range must not skip when earlier commit touched package.json',
  );
});

test('zero before noise-only range vs default still skips', () => {
  const dir = initRepo();
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-m', 'base']);

  git(dir, ['checkout', '-b', 'dev_00_99_01']);
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'a.md'), 'a\n');
  git(dir, ['add', 'docs/a.md']);
  git(dir, ['commit', '-m', 'docs']);
  writeFileSync(join(dir, 'README.md'), 'r\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'readme tip']);

  const sha = git(dir, ['rev-parse', 'HEAD']);
  const files = listChangedFiles(
    '0000000000000000000000000000000000000000',
    sha,
    'main',
    { cwd: dir },
  );
  assert.deepEqual(files.sort(), ['README.md', 'docs/a.md']);
  assert.equal(shouldSkipPackagesJobsOnPush(files), true);
});

test('zero before multi-commit push includes non-tip package.json (#296)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-ci-adm-mc-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.1"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'bump'], { cwd: dir });
  const bumpSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'x.md'), 'x\n');
  execFileSync('git', ['add', 'docs/x.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'docs'], { cwd: dir });
  const tipSha = execFileSync('git', ['rev-parse', 'HEAD'], {
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
const zero = ${JSON.stringify(ZERO)};
const tip = ${JSON.stringify(tipSha)};
const bump = ${JSON.stringify(bumpSha)};
const tipOnly = listChangedFiles(zero, tip);
if (tipOnly.length !== 1 || tipOnly[0] !== 'docs/x.md') {
  throw new Error('tip-only should be docs/x.md, got: ' + tipOnly);
}
if (!shouldSkipPackagesJobsOnPush(tipOnly)) {
  throw new Error('tip-only noise would incorrectly skip without newRef guard');
}
const files = listChangedFiles(zero, tip, [bump, tip]);
if (!files.includes('package.json')) throw new Error('missing package.json: ' + files);
if (!files.includes('docs/x.md')) throw new Error('missing docs/x.md: ' + files);
if (shouldSkipPackagesJobsOnPush(files)) throw new Error('full list should not skip');
if (shouldSkipPackagesJobsOnPush(tipOnly, { newRef: true })) {
  throw new Error('newRef must not skip on tip-only noise');
}
process.stdout.write('ok');`,
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.equal(out.trim(), 'ok');
});
