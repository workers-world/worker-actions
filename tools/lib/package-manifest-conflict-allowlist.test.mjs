#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conflictsArePackageManifestOnly,
  isPackageManifestConflictPath,
} from '../../.github/actions/sync-master-into-release-branch/allowlist.mjs';

test('isPackageManifestConflictPath matches basenames at repo root and nested', () => {
  assert.equal(isPackageManifestConflictPath('package.json'), true);
  assert.equal(isPackageManifestConflictPath('package-lock.json'), true);
  assert.equal(isPackageManifestConflictPath('apps/worker/package.json'), true);
  assert.equal(isPackageManifestConflictPath('pnpm-lock.yaml'), true);
  assert.equal(isPackageManifestConflictPath('yarn.lock'), true);
  assert.equal(isPackageManifestConflictPath('src/index.ts'), false);
  assert.equal(isPackageManifestConflictPath('.github/workflows/ci.yml'), false);
});

test('conflictsArePackageManifestOnly', () => {
  assert.equal(
    conflictsArePackageManifestOnly(['package.json', 'package-lock.json']),
    true,
  );
  assert.equal(
    conflictsArePackageManifestOnly(['package.json', 'wrangler.toml']),
    false,
  );
  assert.equal(conflictsArePackageManifestOnly([]), false);
});
