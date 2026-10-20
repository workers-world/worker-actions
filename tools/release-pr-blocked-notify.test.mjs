#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReleasePrBlockedEmail } from './build-release-pr-blocked-email.mjs';
import {
  COOLDOWN_MS,
  REASON_CLASS,
  buildBlockedReasons,
  isPostMergeMergeRefGoneInAnnotations,
  isWithinNotifyCooldown,
  shouldSendBlockedNotify,
  shouldSkipNotifyForPrState,
} from './lib/release-pr-blocked-notify.mjs';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/release-pr-blocked',
);

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

test('merged PR skips notify', () => {
  const d = shouldSendBlockedNotify({
    prState: 'MERGED',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: '',
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'pr_not_open');
});

test('detects post-merge merge ref gone in annotations', () => {
  const ann =
    "couldn't find remote ref refs/pull/181/merge\nfatal: git fetch failed";
  assert.equal(isPostMergeMergeRefGoneInAnnotations(ann), true);
});

test('merged PR with merge-ref-only flake skips as post_merge_merge_ref_gone', () => {
  const ann =
    "[workflow-lint] ::error::couldn't find remote ref refs/pull/181/merge";
  const d = shouldSendBlockedNotify({
    prState: 'MERGED',
    verify: 'success',
    qodana: 'success',
    merge: 'skipped',
    annotations: ann,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'post_merge_merge_ref_gone');
  assert.equal(d.reasonClass, REASON_CLASS.POST_MERGE_MERGE_REF_GONE);
});

test('open PR with merge ref checkout failure still sends', () => {
  const ann = "couldn't find remote ref refs/pull/42/merge";
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'success',
    qodana: 'success',
    merge: 'skipped',
    annotations: ann,
  });
  assert.equal(d.send, true);
});

test('closed PR skips notify', () => {
  assert.equal(shouldSkipNotifyForPrState('closed'), true);
});

test('runner-lost wording does not mention SDK 依赖', () => {
  const ann = readFixture('runner-lost-annotations.txt');
  const { reasons, reasonClass } = buildBlockedReasons({
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: ann,
  });
  assert.equal(reasonClass, REASON_CLASS.RUNNER_LOST);
  const joined = reasons.join('\n');
  assert.match(joined, /runner lost communication/i);
  assert.doesNotMatch(joined, /检查 dev_\* push \/ 测试 \/ SDK 依赖/);
  assert.doesNotMatch(joined, /可能冲突/);
});

test('open PR with real verify failure still sends', () => {
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: '[verify] ERROR\nnpm test failed: assertion error\n',
  });
  assert.equal(d.send, true);
  assert.equal(d.reasonClass, REASON_CLASS.VERIFY);
  assert.match(d.reasons.join('\n'), /SDK 依赖/);
});

test('6h cooldown suppresses repeat same class', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const sentAt = now - COOLDOWN_MS + 60_000;
  assert.equal(isWithinNotifyCooldown(sentAt, now), true);

  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    annotations: 'unit test failed',
    lastCooldownSentAtMs: sentAt,
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'cooldown');
});

test('cooldown expired allows send again', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const sentAt = now - COOLDOWN_MS - 1;
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    annotations: 'unit test failed',
    lastCooldownSentAtMs: sentAt,
    nowMs: now,
  });
  assert.equal(d.send, true);
});

test('runner-lost twice on open PR still sends', () => {
  const ann = readFixture('runner-lost-twice-annotations.txt');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: ann,
  });
  assert.equal(d.send, true);
  assert.equal(d.reasonClass, REASON_CLASS.RUNNER_LOST);
});

test('buildReleasePrBlockedEmail includes reasons in body', () => {
  const { body } = buildReleasePrBlockedEmail({
    repo: 'workers-world/example',
    prNumber: '42',
    headRef: 'dev_00_02_00',
    prUrl: 'https://github.com/w/e/pull/42',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    runUrl: 'https://github.com/w/e/actions/runs/1',
    reasons: ['verify 失败：检查 dev_* push / 测试 / SDK 依赖'],
    annotations: '',
  });
  assert.match(body, /需要人工介入/);
  assert.match(body, /SDK 依赖/);
});
