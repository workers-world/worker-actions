import assert from "node:assert/strict";
import test from "node:test";
import { bundleBackfillBranchName } from "./bundle-backfill-branch.mjs";

test("bundle backfill branch name matches release-actions-bundle convention", () => {
  assert.equal(bundleBackfillBranchName("actions/v0.2.71"), "chore/actions-bundle-0.2.71");
  assert.equal(bundleBackfillBranchName("actions/v1.0.0"), "chore/actions-bundle-1.0.0");
});

test("rejects non-tag input", () => {
  assert.throws(() => bundleBackfillBranchName("v0.2.71"), /actions\/v/);
});