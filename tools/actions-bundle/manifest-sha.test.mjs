import assert from "node:assert/strict";
import test from "node:test";
import {
  checkManifestReleaseConsistency,
  checkManifestShaAgainstPeel,
  parseActionsBundleManifest,
} from "./manifest-sha.mjs";

const SAMPLE = `# comment
current: actions/v0.2.43
sha: "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3"
released_at: "2026-10-27"
notes: |
  Auto-released.
`;

test("parseActionsBundleManifest reads current, sha, and released_at", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  assert.equal(m.current, "actions/v0.2.43");
  assert.equal(m.sha, "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3");
  assert.equal(m.released_at, "2026-10-27");
});

test("checkManifestShaAgainstPeel passes when sha equals peel", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  const r = checkManifestShaAgainstPeel(
    m,
    "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3",
  );
  assert.equal(r.ok, true);
});

test("checkManifestShaAgainstPeel fails on #195-style mismatch", () => {
  const m = parseActionsBundleManifest(`current: actions/v0.2.43
sha: "0a4c33bfb1246d438a291612d043ce814fce0112"
`);
  const r = checkManifestShaAgainstPeel(
    m,
    "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3",
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "sha_mismatch");
    assert.equal(r.actual, "0a4c33bfb1246d438a291612d043ce814fce0112");
    assert.equal(r.expected, "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3");
  }
});

test("checkManifestShaAgainstPeel skips when tag peel unknown", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  assert.equal(checkManifestShaAgainstPeel(m, null).ok, true);
  assert.equal(checkManifestShaAgainstPeel(m, undefined).ok, true);
  assert.equal(checkManifestShaAgainstPeel(m, "").ok, true);
});

test("checkManifestReleaseConsistency fails #293-style unreleased tag + unreachable sha", () => {
  const m = parseActionsBundleManifest(`current: actions/v0.2.66
sha: "d9c3519ad1decc29f51a9dd1e19eb6a01f0ff278"
released_at: "2026-11-02"
`);
  const r = checkManifestReleaseConsistency(m, {
    tagPresent: false,
    peelCommit: null,
    shaReachable: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unreleased_tag_unreachable_sha");
  assert.equal(r.actual, "d9c3519ad1decc29f51a9dd1e19eb6a01f0ff278");
});

test("checkManifestReleaseConsistency fails when released_at claims publish but tag missing", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  const r = checkManifestReleaseConsistency(m, {
    tagPresent: false,
    peelCommit: null,
    shaReachable: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unreleased_tag");
});

test("checkManifestReleaseConsistency still skips pre-release lead without released_at", () => {
  const m = parseActionsBundleManifest(`current: actions/v0.2.99
sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
`);
  const r = checkManifestReleaseConsistency(m, {
    tagPresent: false,
    peelCommit: null,
    shaReachable: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "tag_absent");
});

test("checkManifestReleaseConsistency passes when tag peel matches", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  const r = checkManifestReleaseConsistency(m, {
    tagPresent: true,
    peelCommit: "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3",
    shaReachable: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "ok");
});

test("checkManifestReleaseConsistency fails when sha object missing despite tag", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  const r = checkManifestReleaseConsistency(m, {
    tagPresent: true,
    peelCommit: "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3",
    shaReachable: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unreachable_sha");
});
