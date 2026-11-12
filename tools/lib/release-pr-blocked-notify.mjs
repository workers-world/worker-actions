/**
 * Release PR 阻断通知：原因分类、PR 状态跳过、冷却窗口（WW-258 MVP A）。
 */

/** 首次「需人工处理」邮件前等待窗口：留给 auto-merge 竞态自愈（默认 15 分钟）。 */
export const DEBOUNCE_MS = 15 * 60 * 1000;

export const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const REASON_CLASS = {
  RUNNER_LOST: 'runner_lost_communication',
  VERIFY: 'verify_failure',
  QODANA: 'qodana_failure',
  MERGE: 'merge_failure',
  MERGE_SKIPPED: 'merge_skipped',
  MERGE_HEAD_STALE: 'merge_head_stale_wait_push',
  POST_MERGE_MERGE_REF_GONE: 'post_merge_merge_ref_gone',
  OTHER: 'other',
};

const RUNNER_LOST_RE = /self-hosted runner lost communication/i;
const MERGE_REF_GONE_RE = /couldn't find remote ref refs\/pull\/\d+\/merge/i;
/** release-auto-merge TOCTOU：head 已前移，本 run 不得 merge，等待新 push 重跑。 */
const MERGE_HEAD_STALE_RE =
  /head 已变为[\s\S]*本 run 验证的是[\s\S]*拒绝 merge[\s\S]*等待新 push/i;

export function hasRunnerLostCommunication(annotations) {
  return RUNNER_LOST_RE.test(String(annotations ?? ''));
}

/** 统计 annotations 文本中 runner lost 出现次数（用于 ≥2 次仍通知）。 */
export function countRunnerLostInAnnotations(annotations) {
  const text = String(annotations ?? '');
  const matches = text.match(/self-hosted runner lost communication/gi);
  return matches ? matches.length : 0;
}

export function shouldSkipNotifyForPrState(state) {
  const s = String(state ?? '').trim().toUpperCase();
  return s === 'MERGED' || s === 'CLOSED';
}

/** workflow-lint checkout 在 PR 合入后仍引用已删除的 refs/pull/N/merge 时的典型 annotation。 */
export function isPostMergeMergeRefGoneInAnnotations(annotations) {
  return MERGE_REF_GONE_RE.test(String(annotations ?? ''));
}

/**
 * PR 已 merged/closed，且失败形态仅为 merge ref 消失、其它门禁未 failure → 降噪（#150 / WW-328）。
 */
export function shouldSuppressPostMergeMergeRefGoneNotify({
  prState,
  verify,
  qodana,
  merge,
  annotations,
}) {
  if (!shouldSkipNotifyForPrState(prState)) return false;
  if (!isPostMergeMergeRefGoneInAnnotations(annotations)) return false;
  if (verify === 'failure' || qodana === 'failure' || merge === 'failure') {
    return false;
  }
  return true;
}

export function isWithinNotifyCooldown(lastSentAtMs, nowMs = Date.now()) {
  if (lastSentAtMs == null || !Number.isFinite(Number(lastSentAtMs))) {
    return false;
  }
  return nowMs - Number(lastSentAtMs) < COOLDOWN_MS;
}

export function notifyCooldownCacheKey(repo, prNumber, reasonClass) {
  const r = String(repo ?? '').trim();
  const pr = String(prNumber ?? '').trim();
  const cls = String(reasonClass ?? REASON_CLASS.OTHER).trim();
  return `release-pr-blocked-${r}-${pr}-${cls}`;
}

export function notifyDebounceCacheKey(repo, prNumber) {
  const r = String(repo ?? '').trim();
  const pr = String(prNumber ?? '').trim();
  return `release-pr-blocked-debounce-${r}-${pr}`;
}

export function isMergeHeadStaleInAnnotations(annotations) {
  return MERGE_HEAD_STALE_RE.test(String(annotations ?? ''));
}

/**
 * PR head 相对本 run 已变：非人工介入，等待 synchronize 触发的新 run。
 */
export function shouldSuppressMergeHeadStaleNotify({ annotations }) {
  return isMergeHeadStaleInAnnotations(annotations);
}

/**
 * @returns {{ elapsed: boolean, persistFirstSeenAtMs: number | null }}
 *   persistFirstSeenAtMs：仅当 cache 为空、需首次写入时为 nowMs。
 */
export function evaluateNotifyDebounce(firstBlockedSeenAtMs, nowMs = Date.now()) {
  const parsed = parseCooldownTimestamp(firstBlockedSeenAtMs);
  if (parsed == null) {
    return { elapsed: false, persistFirstSeenAtMs: nowMs };
  }
  const elapsed = nowMs - parsed >= DEBOUNCE_MS;
  return { elapsed, persistFirstSeenAtMs: null };
}

export function parseCooldownTimestamp(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * 从 job 结果 + annotations 生成邮件原因与 reason class。
 * @returns {{ reasons: string[], reasonClass: string, runnerLost: boolean, runnerLostCount: number, suppressNotify: boolean }}
 */
export function buildBlockedReasons({
  verify,
  qodana,
  merge,
  annotations = '',
}) {
  const runnerLost = hasRunnerLostCommunication(annotations);
  const runnerLostCount = countRunnerLostInAnnotations(annotations);
  const reasons = [];

  if (verify === 'failure') {
    if (runnerLost) {
      reasons.push(
        'verify job 失败：self-hosted runner 失联（runner lost communication），属基础设施 flake；请重跑 workflow（非测试回归、非 package 冲突）',
      );
    } else {
      reasons.push('verify 失败：检查 dev_* push / 测试 / SDK 依赖');
    }
  }
  if (qodana === 'failure') {
    reasons.push('Qodana 未通过：查看 PR Checks / SARIF 评论');
  }
  if (merge === 'failure') {
    if (runnerLost) {
      reasons.push(
        'release-auto-merge 失败：日志含 runner lost communication，优先排查 runner/infra 并重跑，勿按 SDK/冲突处理',
      );
    } else {
      reasons.push('release-auto-merge 失败：可能冲突或不可 merge，查看 merge job 日志');
    }
  } else if (
    merge === 'skipped' &&
    (verify === 'success' || verify === 'skipped') &&
    (qodana === 'success' || qodana === 'skipped')
  ) {
    if (verify === 'success' && qodana === 'success') {
      reasons.push(
        '门禁已通过但 release-auto-merge 被跳过（merge=skipped）：常见原因是 PR 仍为 draft（require_non_draft_pr），或 merge job 的 if 未满足；请 Ready for review 后重跑',
      );
    } else {
      reasons.push(
        `release-auto-merge 被跳过（merge=skipped；verify=${verify} qodana=${qodana}）：门禁 job 可能未实际运行（skipped），请检查 job if / 路径过滤，勿仅按 draft 排查`,
      );
    }
  } else if (
    verify === 'success' &&
    qodana === 'success' &&
    merge !== 'success'
  ) {
    reasons.push(`门禁全绿但未 merge（merge=${merge}）：查看 release-auto-merge 日志`);
  }

  if (reasons.length === 0) {
    reasons.push(`未能 auto-merge（verify=${verify} qodana=${qodana} merge=${merge}）`);
  }

  const reasonClass = deriveReasonClass({ verify, qodana, merge, runnerLost });
  const suppressNotify = shouldSuppressRunnerLostOnlyNotify({
    runnerLost,
    runnerLostCount,
    verify,
    qodana,
    merge,
  });

  return { reasons, reasonClass, runnerLost, runnerLostCount, suppressNotify };
}

export function deriveReasonClass({ verify, qodana, merge, runnerLost }) {
  const infraVerifyOnly =
    runnerLost && verify === 'failure' && qodana !== 'failure';
  if (infraVerifyOnly) {
    return REASON_CLASS.RUNNER_LOST;
  }
  if (verify === 'failure') return REASON_CLASS.VERIFY;
  if (qodana === 'failure') return REASON_CLASS.QODANA;
  if (merge === 'failure') {
    return runnerLost ? REASON_CLASS.RUNNER_LOST : REASON_CLASS.MERGE;
  }
  if (merge === 'skipped') return REASON_CLASS.MERGE_SKIPPED;
  return REASON_CLASS.OTHER;
}

/**
 * 仅 runner-lost 且未达重复阈值时抑制通知（PR 仍 open 时降噪）。
 */
export function shouldSuppressRunnerLostOnlyNotify({
  runnerLost,
  runnerLostCount,
  verify,
  qodana,
  merge,
}) {
  if (!runnerLost) return false;
  if (qodana === 'failure') return false;
  if (runnerLostCount >= 2) return false;

  const verifyInfraOnly = verify === 'failure';
  const mergeInfraOnly = merge === 'failure' && verify !== 'failure';
  if (verifyInfraOnly || mergeInfraOnly) {
    return true;
  }
  return false;
}

export function shouldSendBlockedNotify({
  prState,
  verify,
  qodana,
  merge,
  annotations,
  lastCooldownSentAtMs,
  firstBlockedSeenAtMs,
  nowMs = Date.now(),
}) {
  if (shouldSuppressPostMergeMergeRefGoneNotify({
    prState,
    verify,
    qodana,
    merge,
    annotations,
  })) {
    return {
      send: false,
      skipReason: 'post_merge_merge_ref_gone',
      reasonClass: REASON_CLASS.POST_MERGE_MERGE_REF_GONE,
      reasons: [],
      saveDebounceAtMs: null,
    };
  }

  if (shouldSkipNotifyForPrState(prState)) {
    return {
      send: false,
      skipReason: 'pr_not_open',
      reasonClass: REASON_CLASS.OTHER,
      reasons: [],
      saveDebounceAtMs: null,
    };
  }

  if (shouldSuppressMergeHeadStaleNotify({ annotations })) {
    return {
      send: false,
      skipReason: 'merge_head_stale_wait_push',
      reasonClass: REASON_CLASS.MERGE_HEAD_STALE,
      reasons: [],
      saveDebounceAtMs: null,
    };
  }

  const built = buildBlockedReasons({ verify, qodana, merge, annotations });
  if (built.suppressNotify) {
    return {
      send: false,
      skipReason: 'runner_lost_first_infra',
      reasonClass: built.reasonClass,
      reasons: built.reasons,
      saveDebounceAtMs: null,
    };
  }

  const debounce = evaluateNotifyDebounce(firstBlockedSeenAtMs, nowMs);
  if (!debounce.elapsed) {
    return {
      send: false,
      skipReason: 'debounce_pending',
      reasonClass: built.reasonClass,
      reasons: built.reasons,
      saveDebounceAtMs: debounce.persistFirstSeenAtMs,
    };
  }

  if (isWithinNotifyCooldown(lastCooldownSentAtMs, nowMs)) {
    return {
      send: false,
      skipReason: 'cooldown',
      reasonClass: built.reasonClass,
      reasons: built.reasons,
      saveDebounceAtMs: null,
    };
  }

  return {
    send: true,
    skipReason: '',
    reasonClass: built.reasonClass,
    reasons: built.reasons,
    saveDebounceAtMs: null,
  };
}
