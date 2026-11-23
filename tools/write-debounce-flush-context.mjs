#!/usr/bin/env node
/**
 * 将 debounce flush 所需上下文写入 JSON（供 upload-artifact）。
 */
import fs from 'node:fs';

function env(name) {
  return (process.env[name] ?? '').trim();
}

const ctx = {
  debounceFirstSeenAtMs: env('DEBOUNCE_FIRST_SEEN_MS'),
  reasonClass: env('REASON_CLASS'),
  repo: env('REPO'),
  prNumber: env('PR_NUMBER'),
  headRef: env('HEAD_REF'),
  prUrl: env('PR_URL'),
  verify: env('VERIFY'),
  qodana: env('QODANA'),
  merge: env('MERGE'),
  runUrl: env('RUN_URL'),
  annotations: process.env.ANNOTATIONS ?? '',
};

if (!ctx.debounceFirstSeenAtMs) {
  process.stderr.write('write-debounce-flush-context: DEBOUNCE_FIRST_SEEN_MS required\n');
  process.exit(1);
}

fs.writeFileSync('.notify-flush-context.json', JSON.stringify(ctx));
