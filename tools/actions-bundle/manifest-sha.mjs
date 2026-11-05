/**
 * Helpers for manifest/actions-bundle.yaml sha vs annotated tag peel.
 * A commit cannot embed its own object id; release backfill must set sha to
 * `git rev-list -n 1 <tag>` in a commit *after* the tagged tree (WW-451 / #205).
 *
 * Also rejects “published” claims when the tag is gone or sha is unreachable
 * (#293 / ephemeral tag race after destin pin-align).
 */

/**
 * @param {string} text
 * @returns {{ current: string | null, sha: string | null, released_at: string | null }}
 */
export function parseActionsBundleManifest(text) {
  let current = null;
  let sha = null;
  let released_at = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const cur = line.match(/^current:\s*(\S+)\s*$/);
    if (cur) current = cur[1];
    const sh = line.match(/^sha:\s*"?([0-9a-fA-F]*)"?\s*$/);
    if (sh) sha = sh[1] || "";
    const rel = line.match(/^released_at:\s*"?([^"]*)"?\s*$/);
    if (rel) released_at = (rel[1] || "").trim() || null;
  }
  return { current, sha, released_at };
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

/**
 * Full workflow-lint decision for manifest current/sha/released_at vs local git facts.
 *
 * @param {{ current: string | null, sha: string | null, released_at?: string | null }} manifest
 * @param {{
 *   tagPresent: boolean,
 *   peelCommit?: string | null,
 *   shaReachable?: boolean | null,
 * }} ctx
 * @returns {{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason: string,
 *   expected?: string,
 *   actual?: string,
 * }}
 */
export function checkManifestReleaseConsistency(manifest, ctx) {
  if (!manifest?.current) {
    return { ok: false, reason: "missing current" };
  }
  if (manifest.sha == null || manifest.sha === "") {
    return { ok: false, reason: "missing sha" };
  }

  const claimsPublished = Boolean(
    manifest.released_at && String(manifest.released_at).trim(),
  );
  const tagPresent = Boolean(ctx?.tagPresent);
  const shaReachable = ctx?.shaReachable;

  if (!tagPresent) {
    // #293: current + released_at claim a published release; missing tag must fail
    // (destin pin-align race: tag briefly existed then deleted).
    if (claimsPublished) {
      if (shaReachable === false) {
        return {
          ok: false,
          reason: "unreleased_tag_unreachable_sha",
          actual: manifest.sha,
        };
      }
      return { ok: false, reason: "unreleased_tag" };
    }
    return { ok: true, skipped: true, reason: "tag_absent" };
  }

  const peel = checkManifestShaAgainstPeel(manifest, ctx?.peelCommit ?? null);
  if (!peel.ok) {
    return peel;
  }

  // Tag present and peel matched (or peel unknown). Still flag unreachable sha
  // when the caller explicitly probed the object store.
  if (shaReachable === false) {
    return {
      ok: false,
      reason: "unreachable_sha",
      actual: manifest.sha,
    };
  }

  return { ok: true, reason: "ok" };
}
