#!/usr/bin/env node
/**
 * Paths that may be auto-resolved with `git checkout --ours` during master → dev_* merge.
 * Match by basename (supports nested package.json / lock paths).
 */
const PACKAGE_MANIFEST_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

export function isPackageManifestConflictPath(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/').trim();
  if (!normalized) return false;
  const base = normalized.split('/').pop() ?? '';
  return PACKAGE_MANIFEST_BASENAMES.has(base);
}

export function conflictsArePackageManifestOnly(paths) {
  const list = paths.filter((p) => String(p).trim());
  if (list.length === 0) return false;
  return list.every(isPackageManifestConflictPath);
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

function main(argv) {
  const mode = argv[0];
  if (mode === '--check') {
    const files = argv.slice(1);
    process.exit(conflictsArePackageManifestOnly(files) ? 0 : 1);
  }
  console.error('usage: allowlist.mjs --check <path...>');
  process.exit(2);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main(process.argv.slice(2));
}
