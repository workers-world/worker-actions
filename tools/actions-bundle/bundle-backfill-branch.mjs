/**
 * Branch head for release-actions-bundle Phase B backfill (must match nested-pins-lib.sh).
 */
export function bundleBackfillBranchName(tag) {
  if (typeof tag !== "string" || !tag.startsWith("actions/v")) {
    throw new Error(`Expected actions/vX.Y.Z tag, got: ${tag}`);
  }
  const ver = tag.slice("actions/v".length);
  return `chore/actions-bundle-${ver}`;
}