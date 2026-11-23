#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReleasePrBlockedEmail } from './build-release-pr-blocked-email.mjs';
import {
  COOLDOWN_MS,
  DEBOUNCE_MS,
  REASON_CLASS,
  buildBlockedReasons,
  debounceFlushWaitMs,
  evaluateNotifyDebounce,
  isMergeHeadStaleInAnnotations,
  notifyCooldownCacheKey,
  notifyDebounceCacheKey,
  shouldScheduleDebounceFlush,
  isPostMergeMergeRefGoneInAnnotations,
  isWithinNotifyCooldown,
  shouldSendBlockedNotify,
  shouldSkipNotifyForPrState,
} from './lib/release-pr-blocked-notify.mjs';

/** 测试用：模拟 debounce 窗口已过后才允许首发信。 */
function debounceElapsedNow(nowMs = Date.now()) {
  return nowMs - DEBOUNCE_MS - 1;
}

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
  const now = Date.parse('2026-11-11T15:30:00Z');
  const ann = "couldn't find remote ref refs/pull/42/merge";
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'success',
    qodana: 'success',
    merge: 'skipped',
    annotations: ann,
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
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
  const now = Date.parse('2026-11-11T15:30:00Z');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: '[verify] ERROR\nnpm test failed: assertion error\n',
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
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
    firstBlockedSeenAtMs: debounceElapsedNow(now),
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
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
  });
  assert.equal(d.send, true);
});

test('runner-lost twice on open PR still sends', () => {
  const now = Date.parse('2026-11-11T15:30:00Z');
  const ann = readFixture('runner-lost-twice-annotations.txt');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: ann,
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
  });
  assert.equal(d.send, true);
  assert.equal(d.reasonClass, REASON_CLASS.RUNNER_LOST);
});

test('first blocked run debounces before first email', () => {
  const now = Date.parse('2026-11-11T15:30:00Z');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    annotations: 'lockfile indent AssertionError',
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'debounce_pending');
  assert.equal(d.saveDebounceAtMs, now);
  assert.equal(d.debounceFirstSeenAtMs, now);
  assert.equal(shouldScheduleDebounceFlush(d), true);
});

test('still within debounce window does not send', () => {
  const now = Date.parse('2026-11-11T15:30:00Z');
  const firstSeen = now - 10 * 60 * 1000;
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    annotations: 'lockfile indent AssertionError',
    firstBlockedSeenAtMs: firstSeen,
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'debounce_pending');
  assert.equal(d.saveDebounceAtMs, null);
  assert.equal(d.debounceFirstSeenAtMs, firstSeen);
  assert.equal(shouldScheduleDebounceFlush(d), true);
});

test('after debounce elapsed still-blocked verify failure sends once', () => {
  const now = Date.parse('2026-11-11T15:30:00Z');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'failure',
    annotations: 'sch1 #322 lockfile indent AssertionError',
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
  });
  assert.equal(d.send, true);
  assert.equal(d.reasonClass, REASON_CLASS.VERIFY);
});

test('merged during debounce window skips without send', () => {
  const now = Date.parse('2026-11-11T15:34:00Z');
  const d = shouldSendBlockedNotify({
    prState: 'MERGED',
    verify: 'success',
    qodana: 'success',
    merge: 'failure',
    annotations: 'some failure',
    firstBlockedSeenAtMs: now - 5 * 60 * 1000,
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'pr_not_open');
});

test('merge head stale annotation skips notify (deploy-tracker #421)', () => {
  const ann =
    '::error::PR #421 head 已变为 1d02fd22abc（本 run 验证的是 cf7229e8def），拒绝 merge；等待新 push 触发的 run 重跑门禁。';
  assert.equal(isMergeHeadStaleInAnnotations(ann), true);
  const now = Date.parse('2026-11-11T15:30:00Z');
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'success',
    qodana: 'success',
    merge: 'failure',
    annotations: ann,
    firstBlockedSeenAtMs: debounceElapsedNow(now),
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'merge_head_stale_wait_push');
  assert.equal(d.reasonClass, REASON_CLASS.MERGE_HEAD_STALE);
});

test('evaluateNotifyDebounce records first seen when cache empty', () => {
  const now = 1_700_000_000_000;
  const r = evaluateNotifyDebounce(null, now);
  assert.equal(r.elapsed, false);
  assert.equal(r.persistFirstSeenAtMs, now);
  assert.equal(r.firstSeenAtMs, now);
});

test('shouldScheduleDebounceFlush on any debounce_pending (incl. re-entry after cancel)', () => {
  assert.equal(
    shouldScheduleDebounceFlush({
      skipReason: 'debounce_pending',
      saveDebounceAtMs: 1_700_000_000_000,
    }),
    true,
  );
  // cache 已存在、无新 firstSeen：仍须 schedule，否则 cancel-in-progress 杀旧 flush 后会静默丢信
  assert.equal(
    shouldScheduleDebounceFlush({
      skipReason: 'debounce_pending',
      saveDebounceAtMs: null,
    }),
    true,
  );
  assert.equal(
    shouldScheduleDebounceFlush({
      skipReason: 'cooldown',
      saveDebounceAtMs: 1_700_000_000_000,
    }),
    false,
  );
});

test('in-window re-entry exposes debounceFirstSeenAtMs for flush reschedule', () => {
  const now = 1_700_000_000_000;
  const first = now - 5 * 60 * 1000;
  const d = shouldSendBlockedNotify({
    prState: 'OPEN',
    verify: 'failure',
    qodana: 'success',
    merge: 'skipped',
    annotations: '',
    lastCooldownSentAtMs: null,
    firstBlockedSeenAtMs: first,
    nowMs: now,
  });
  assert.equal(d.send, false);
  assert.equal(d.skipReason, 'debounce_pending');
  assert.equal(d.saveDebounceAtMs, null);
  assert.equal(d.debounceFirstSeenAtMs, first);
  assert.equal(shouldScheduleDebounceFlush(d), true);
});

test('debounceFlushWaitMs returns remaining wait', () => {
  const first = 1_700_000_000_000;
  assert.equal(debounceFlushWaitMs(first, first + 5 * 60 * 1000), DEBOUNCE_MS - 5 * 60 * 1000);
  assert.equal(debounceFlushWaitMs(first, first + DEBOUNCE_MS), 0);
});

test('evaluateNotifyDebounce elapsed after DEBOUNCE_MS', () => {
  const now = 1_700_000_000_000;
  const first = now - DEBOUNCE_MS;
  const r = evaluateNotifyDebounce(first, now);
  assert.equal(r.elapsed, true);
  assert.equal(r.persistFirstSeenAtMs, null);
  assert.equal(r.firstSeenAtMs, first);
});

test('notify cache key helpers match workflow key shapes', () => {
  assert.equal(
    notifyDebounceCacheKey('workers-world/worker-actions', '309'),
    'notify-debounce-workers-world/worker-actions-309',
  );
  assert.equal(
    notifyCooldownCacheKey('workers-world/worker-actions', '309', 'verify_failure'),
    'notify-workers-world/worker-actions-309-verify_failure',
  );
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
