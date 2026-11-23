#!/usr/bin/env node
/**
 * debounce_flush job：从 artifact 上下文 + 最新 PR_STATE 调用 release-pr-blocked-notify-step。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ctxPath = process.env.FLUSH_CTX_FILE ?? '.notify-flush-context.json';

let ctx;
try {
  ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
} catch (err) {
  process.stderr.write(`debounce-flush-notify-step: cannot read ${ctxPath}: ${err.message}\n`);
  process.exit(1);
}

const env = { ...process.env };
env.REPO = String(ctx.repo ?? '');
env.PR_NUMBER = String(ctx.prNumber ?? '');
env.HEAD_REF = String(ctx.headRef ?? '');
env.PR_URL = String(ctx.prUrl ?? '');
env.VERIFY = String(ctx.verify ?? '');
env.QODANA = String(ctx.qodana ?? '');
env.MERGE = String(ctx.merge ?? '');
env.RUN_URL = String(ctx.runUrl ?? '');
env.ANNOTATIONS = String(ctx.annotations ?? '');
env.PR_STATE = String(process.env.PR_STATE ?? '');
env.DEBOUNCE_FIRST_SEEN_AT = String(ctx.debounceFirstSeenAtMs ?? '');

const cooldownPath = path.resolve(process.cwd(), '.notify-cooldown-ts');
if (fs.existsSync(cooldownPath)) {
  env.COOLDOWN_SENT_AT = fs.readFileSync(cooldownPath, 'utf8').replace(/\s/g, '');
} else {
  env.COOLDOWN_SENT_AT = '';
}

const notifyStep = path.resolve(process.cwd(), '.ww-gha/tools/release-pr-blocked-notify-step.mjs');
if (!fs.existsSync(notifyStep)) {
  process.stderr.write('debounce-flush-notify-step: release-pr-blocked-notify-step.mjs missing\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [notifyStep], {
  env,
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
