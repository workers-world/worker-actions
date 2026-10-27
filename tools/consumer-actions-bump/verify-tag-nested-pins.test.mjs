#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectNestedPinVersions,
  verifyNestedPinsAlignedToTag,
  verifyTagTreeNestedPins,
} from "./verify-tag-nested-pins.mjs";

test("verifyNestedPinsAlignedToTag passes when all pins match target", () => {
  const r = verifyNestedPinsAlignedToTag("actions/v1.0.0", [
    "@actions/v1.0.0",
  ]);
  assert.equal(r.ok, true);
});

test("verifyNestedPinsAlignedToTag fails on lagging nested pin", () => {
  const r = verifyNestedPinsAlignedToTag("actions/v1.0.1", [
    "@actions/v1.0.0",
    "@actions/v1.0.1",
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.misaligned, ["@actions/v1.0.0"]);
    assert.equal(r.expected, "@actions/v1.0.1");
  }
});

test("collectNestedPinVersions scans bundle pin globs under tag tree root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tag-tree-"));
  const wf = path.join(root, ".github", "workflows");
  fs.mkdirSync(wf, { recursive: true });
  fs.writeFileSync(
    path.join(wf, "ci.yml"),
    "uses: workers-world/worker-actions/.github/workflows/x.yml@actions/v2.0.0\n",
  );
  const pins = collectNestedPinVersions(root);
  assert.deepEqual(pins, ["@actions/v2.0.0"]);
  const gate = verifyTagTreeNestedPins(root, "actions/v2.0.0");
  assert.equal(gate.ok, true);
});
