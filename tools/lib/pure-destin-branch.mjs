/**
 * Pure destin branch names: dev_X_Y_Z with numeric segments only (no suffix tracks).
 * Used by worker-ci / ensure-release-pr to avoid accidental Release→master on verify branches.
 *
 * GitHub Actions expression language has no `matches()` (only contains/startsWith/endsWith/…).
 * Regex gating must use a shell/Node step (see worker-ci `pure-destin-gate`) and expose a boolean.
 */
export const PURE_DESTIN_BRANCH_RE = /^dev_[0-9]+_[0-9]+_[0-9]+$/;

/** @param {string | null | undefined} name */
export function isPureDestinBranch(name) {
  return typeof name === 'string' && PURE_DESTIN_BRANCH_RE.test(name);
}

/** Bash `=~` pattern (same semantics as PURE_DESTIN_BRANCH_RE). Keep in sync with worker-ci gate. */
export const PURE_DESTIN_BRANCH_BASH_RE = '^dev_[0-9]+_[0-9]+_[0-9]+$';
