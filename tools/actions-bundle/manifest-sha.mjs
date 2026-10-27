/**
 * Helpers for manifest/actions-bundle.yaml sha vs annotated tag peel.
 * A commit cannot embed its own object id; release backfill must set sha to
 * `git rev-list -n 1 <tag>` in a commit *after* the tagged tree (WW-451 / #205).
 */

/**
 * @param {string} text
 * @returns {{ current: string | null, sha: string | null }}
 */
export function parseActionsBundleManifest(text) {
  let current = null;
  let sha = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const cur = line.match(/^current:\s*(\S+)\s*$/);
    if (cur) current = cur[1];
    const sh = line.match(/^sha:\s*"?([0-9a-fA-F]*)"?\s*$/);
    if (sh) sha = sh[1] || "";
  }
  return { current, sha };
}

/**
 * @param {{ current: string | null, sha: string | null }} manifest
 * @param {string | null | undefined} peelCommit full sha of `git rev-list -n 1 <tag>`
 * @returns {{ ok: true } | { ok: false, reason: string, expected?: string, actual?: string }}
 */
export function checkManifestShaAgainstPeel(manifest, peelCommit) {
  if (!manifest?.current) {
    return { ok: false, reason: "missing current" };
  }
  if (manifest.sha == null || manifest.sha === "") {
    return { ok: false, reason: "missing sha" };
  }
  if (!peelCommit) {
    return { ok: true }; // tag not published yet — lint skips
  }
  if (manifest.sha !== peelCommit) {
    return {
      ok: false,
      reason: "sha_mismatch",
      expected: peelCommit,
      actual: manifest.sha,
    };
  }
  return { ok: true };
}
