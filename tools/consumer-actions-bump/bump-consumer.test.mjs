#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAuthenticatedRepoUrl,
  buildBotHeadPushLeaseFlags,
  HEAD_BRANCH,
} from "./bump-consumer.mjs";
import {
  buildDispositionCommentBody,
  buildPhase2PrBody,
  compareActionsTags,
  maxOuterWorkflowPinTag,
  parseBumpTitleTag,
} from "./fleet-pin-gate.mjs";

test("buildBotHeadPushLeaseFlags: explicit lease when remote bot head exists", () => {
  const flags = buildBotHeadPushLeaseFlags(HEAD_BRANCH, "abc123deadbeef");
  assert.deepEqual(flags, [
    `--force-with-lease=refs/heads/${HEAD_BRANCH}:abc123deadbeef`,
  ]);
});

test("buildBotHeadPushLeaseFlags: plain push when remote bot head absent", () => {
  assert.deepEqual(buildBotHeadPushLeaseFlags(HEAD_BRANCH, null), []);
  assert.deepEqual(buildBotHeadPushLeaseFlags(HEAD_BRANCH, undefined), []);
});

test("compareActionsTags orders semver tags", () => {
  assert.equal(compareActionsTags("actions/v0.2.10", "actions/v0.2.9"), 1);
  assert.equal(compareActionsTags("actions/v0.2.9", "actions/v0.2.10"), -1);
  assert.equal(compareActionsTags("actions/v1.0.0", "actions/v1.0.0"), 0);
});

test("parseBumpTitleTag extracts actions tag from bump PR title", () => {
  assert.equal(
    parseBumpTitleTag("chore: bump worker-actions pins to actions/v0.2.43"),
    "actions/v0.2.43",
  );
  assert.equal(parseBumpTitleTag("chore: something else"), null);
});

test("buildPhase2PrBody documents Phase 2 auto-merge", () => {
  const body = buildPhase2PrBody({
    tagName: "actions/v0.2.43",
    fileRelPaths: [".github/workflows/ci.yml"],
    totalReplacements: 3,
  });
  assert.match(body, /Phase 2/);
  assert.match(body, /auto-merge \(squash\)/);
  assert.doesNotMatch(body, /No auto-merge/);
});

test("buildDispositionCommentBody includes disposition superseded", () => {
  const body = buildDispositionCommentBody({
    disposition: "superseded",
    targetTag: "actions/v0.2.43",
    prTitleTag: "actions/v0.2.33",
  });
  assert.match(body, /disposition: superseded/);
});

test("maxOuterWorkflowPinTag finds highest outer pin on default branch workflows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outer-pin-"));
  const wf = path.join(root, ".github", "workflows");
  fs.mkdirSync(wf, { recursive: true });
  fs.writeFileSync(
    path.join(wf, "a.yml"),
    "uses: workers-world/worker-actions/.github/workflows/a.yml@actions/v0.2.40\n",
  );
  fs.writeFileSync(
    path.join(wf, "b.yml"),
    "uses: workers-world/worker-actions/.github/workflows/b.yml@actions/v0.2.41\n",
  );
  assert.equal(maxOuterWorkflowPinTag(wf), "actions/v0.2.41");
});

test("buildAuthenticatedRepoUrl: x-access-token embed (private consumer clone/push)", () => {
  const url = buildAuthenticatedRepoUrl("workers-world/browser_run", "fake-app-token");
  assert.equal(
    url,
    "https://x-access-token:fake-app-token@github.com/workers-world/browser_run.git",
  );
  assert.doesNotMatch(url, /^https:\/\/github\.com\//);
});
