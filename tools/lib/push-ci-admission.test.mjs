import assert from 'node:assert/strict';
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
  assert.equal(shouldSkipPackagesJobsOnPush([]), true);
});
