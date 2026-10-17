#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthenticatedRepoUrl,
  buildBotHeadPushLeaseFlags,
  HEAD_BRANCH,
} from "./bump-consumer.mjs";

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

test("buildAuthenticatedRepoUrl: x-access-token embed (private consumer clone/push)", () => {
  const url = buildAuthenticatedRepoUrl("workers-world/browser_run", "fake-app-token");
  assert.equal(
    url,
    "https://x-access-token:fake-app-token@github.com/workers-world/browser_run.git",
  );
  assert.doesNotMatch(url, /^https:\/\/github\.com\//);
});
