#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  rewriteWorkflowPinContent,
  rewriteWorkflowPinTree,
} from "./rewrite-workflow-pins.mjs";

test("rewrites workers-world/worker-actions workflow pins only", () => {
  const yaml = `
jobs:
  a:
    uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.2.24
  b:
    uses: workers-world/worker-actions/.github/actions/foo@actions/v0.2.10
  c:
    uses: actions/checkout@v4
`;
  const { content, replacements } = rewriteWorkflowPinContent(
    yaml,
    "actions/v0.2.26",
  );
  assert.equal(replacements, 2);
  assert.match(content, /@actions\/v0\.2\.26/g);
  assert.doesNotMatch(content, /@actions\/v0\.2\.24/);
  assert.doesNotMatch(content, /@actions\/v0\.2\.10/);
  assert.equal((content.match(/@actions\/v0\.2\.26/g) || []).length, 2);
});

test("bumps multiple versions to same target", () => {
  const yaml =
    "uses: workers-world/worker-actions/.github/workflows/a.yml@actions/v0.1.0\n" +
    "uses: workers-world/worker-actions/.github/workflows/b.yml@actions/v0.9.9\n";
  const { content, replacements } = rewriteWorkflowPinContent(
    yaml,
    "actions/v1.0.0",
  );
  assert.equal(replacements, 2);
  assert.equal(
    content,
    "uses: workers-world/worker-actions/.github/workflows/a.yml@actions/v1.0.0\n" +
      "uses: workers-world/worker-actions/.github/workflows/b.yml@actions/v1.0.0\n",
  );
});

test("does not rewrite non worker-actions uses", () => {
  const yaml =
    "uses: workers-world/other/.github/workflows/x.yml@actions/v0.2.0\n";
  const { replacements } = rewriteWorkflowPinContent(yaml, "actions/v0.2.26");
  assert.equal(replacements, 0);
});

test("rewriteWorkflowPinTree only touches .github/workflows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pin-tree-"));
  const wf = path.join(root, ".github", "workflows");
  const act = path.join(root, ".github", "actions", "x");
  fs.mkdirSync(wf, { recursive: true });
  fs.mkdirSync(act, { recursive: true });
  fs.writeFileSync(
    path.join(wf, "ci.yml"),
    "uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.2.0\n",
  );
  fs.writeFileSync(
    path.join(act, "action.yml"),
    "uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.2.0\n",
  );

  const { files, totalReplacements } = rewriteWorkflowPinTree(
    wf,
    "actions/v0.2.1",
  );
  assert.equal(totalReplacements, 1);
  assert.equal(files.length, 1);
  const actionYml = fs.readFileSync(path.join(act, "action.yml"), "utf8");
  assert.match(actionYml, /@actions\/v0\.2\.0/);
});
