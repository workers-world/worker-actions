#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBotHeadPushLeaseFlags,
  HEAD_BRANCH,
} from "./bump-consumer.mjs";

test("buildBotHeadPushLeaseFlags: explicit lease when remote bot head exists", () => {
  const flags = buildBotHeadPushLeaseFlags(HEAD_BRANCH, "abc123deadbeef");
  assert.deepEqual(flags, [
    "--force-with-lease",
    `refs/heads/${HEAD_BRANCH}:abc123deadbeef`,
  ]);
});

test("buildBotHeadPushLeaseFlags: plain push when remote bot head absent", () => {
  assert.deepEqual(buildBotHeadPushLeaseFlags(HEAD_BRANCH, null), []);
  assert.deepEqual(buildBotHeadPushLeaseFlags(HEAD_BRANCH, undefined), []);
});
