/**
 * Pure dev branch names: dev_X_Y_Z numeric only.
 * SSOT for Workers: `framework_sdk_worker/git/dev-track` (`PURE_DEV_BRANCH_RE` / `isPureDevBranch`).
 * This Actions copy stays in sync for Node without pulling the Worker SDK.
 */
export const PURE_DEV_BRANCH_RE = /^dev_[0-9]+_[0-9]+_[0-9]+$/;

/** @param {string | null | undefined} name */
export function isPureDevBranch(name) {
  return typeof name === 'string' && PURE_DEV_BRANCH_RE.test(name);
}

/** Bash `=~` pattern (same semantics as PURE_DEV_BRANCH_RE). Keep in sync with worker-ci gate. */
export const PURE_DEV_BRANCH_BASH_RE = '^dev_[0-9]+_[0-9]+_[0-9]+$';
