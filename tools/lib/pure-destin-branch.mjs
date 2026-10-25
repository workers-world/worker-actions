/**
 * Pure destin branch names: dev_X_Y_Z with numeric segments only (no suffix tracks).
 * Used by worker-ci / ensure-release-pr to avoid accidental Release→master on verify branches.
 */
export const PURE_DESTIN_BRANCH_RE = /^dev_[0-9]+_[0-9]+_[0-9]+$/;

/** @param {string | null | undefined} name */
export function isPureDestinBranch(name) {
  return typeof name === 'string' && PURE_DESTIN_BRANCH_RE.test(name);
}

/** Bash-compatible pattern (same semantics as PURE_DESTIN_BRANCH_RE). */
export const PURE_DESTIN_BRANCH_BASH_RE = '^dev_[0-9]+_[0-9]+_[0-9]+$';

/** GitHub Actions `matches()` pattern (RE2; same semantics). */
export const PURE_DESTIN_BRANCH_GHA_RE = '^dev_[0-9]+_[0-9]+_[0-9]+$';
