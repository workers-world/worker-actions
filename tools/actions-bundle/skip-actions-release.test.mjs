import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipActionsRelease } from "./skip-actions-release.mjs";

test("skips when squash subject contains [skip actions-release]", () => {
  assert.equal(
    shouldSkipActionsRelease(
      "chore: actions bundle actions/v0.2.65 (pins + manifest) [skip actions-release]\n\n* detail",
    ),
    true,
  );
});

test("does not skip real release squash whose body embeds historical skip tokens", () => {
  assert.equal(
    shouldSkipActionsRelease(
      "release: destin → master (#284)\n\n* chore: release actions bundle actions/v0.2.64 — align pins [skip actions-release]\n* fix: something else",
    ),
    false,
  );
});

test("skips merge commit when PR title line contains [skip actions-release] (#294)", () => {
  // Exact shape from merge of workers-world/worker-actions#287 (run 41400140290)
  const msg =
    "Merge pull request #287 from workers-world/chore/actions-bundle-0.2.65\n" +
    "\n" +
    "chore: actions bundle actions/v0.2.65 (pins + manifest) [skip actions-release]";
  assert.equal(shouldSkipActionsRelease(msg), true);
});

test("does not skip merge commit when PR title lacks skip token", () => {
  assert.equal(
    shouldSkipActionsRelease(
      "Merge pull request #284 from workers-world/dev_00_03_00\n\nrelease: destin → master",
    ),
    false,
  );
});

test("does not treat non-merge body lines as skip even if they contain the token", () => {
  assert.equal(
    shouldSkipActionsRelease(
      "feat: touch workflows\n\nsome note with [skip actions-release] in body only",
    ),
    false,
  );
});

test("empty / missing message does not skip", () => {
  assert.equal(shouldSkipActionsRelease(""), false);
  assert.equal(shouldSkipActionsRelease(undefined), false);
});
