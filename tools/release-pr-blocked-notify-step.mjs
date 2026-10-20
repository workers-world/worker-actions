#!/usr/bin/env node
/**
 * GHA：PR 状态 / 冷却 / 原因分类 → 是否发信 + 邮件 outputs（WW-258）。
 * 环境变量：REPO, PR_NUMBER, HEAD_REF, PR_URL, VERIFY, QODANA, MERGE, RUN_URL,
 *   ANNOTATIONS, PR_STATE, COOLDOWN_SENT_AT（可选，毫秒时间戳）
 */
import { appendFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { buildReleasePrBlockedEmail } from './build-release-pr-blocked-email.mjs';
import {
  buildBlockedReasons,
  notifyCooldownCacheKey,
  parseCooldownTimestamp,
  shouldSendBlockedNotify,
} from './lib/release-pr-blocked-notify.mjs';

function env(name) {
  return (process.env[name] ?? '').trim();
}

function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  const delim = `${name}_${crypto.randomUUID()}`;
  appendFileSync(out, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function main() {
  const repo = env('REPO');
  const prNumber = env('PR_NUMBER');
  const headRef = env('HEAD_REF');
  const prUrl = env('PR_URL');
  const verify = env('VERIFY');
  const qodana = env('QODANA');
  const merge = env('MERGE');
  const runUrl = env('RUN_URL');
  const annotations = process.env.ANNOTATIONS ?? '';
  const prState = env('PR_STATE');
  const lastCooldownSentAtMs = parseCooldownTimestamp(process.env.COOLDOWN_SENT_AT);

  const preflightOnly = env('REASON_CLASS_ONLY') === 'true';
  if (preflightOnly) {
    const built = buildBlockedReasons({ verify, qodana, merge, annotations });
    writeOutput('reason_class', built.reasonClass);
    return;
  }

  const decision = shouldSendBlockedNotify({
    prState,
    verify,
    qodana,
    merge,
    annotations,
    lastCooldownSentAtMs,
  });

  writeOutput('send_notify', decision.send ? 'true' : 'false');
  writeOutput('skip_reason', decision.skipReason || '');
  writeOutput('reason_class', decision.reasonClass);
  writeOutput(
    'cooldown_cache_key',
    notifyCooldownCacheKey(repo, prNumber, decision.reasonClass),
  );

  if (!decision.send) {
    return;
  }

  const { subject, body, html } = buildReleasePrBlockedEmail({
    repo,
    prNumber,
    headRef,
    prUrl,
    verify,
    qodana,
    merge,
    runUrl,
    reasons: decision.reasons,
    annotations,
  });

  writeOutput('subject', subject);
  writeOutput('body', body);
  writeOutput('html', html);
}

main();
