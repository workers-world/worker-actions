import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("parseActionsBundleManifest reads current and sha", () => {
  const m = parseActionsBundleManifest(SAMPLE);
  assert.equal(m.current, "actions/v0.2.43");
  assert.equal(m.sha, "3914c7cd95da620e7e4ece24d4bd344e5b90f6f3");
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
