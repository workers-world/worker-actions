#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { npmCiUsesLegacyPeerDeps } from "../.github/actions/package-lock-in-sync/npm-ci-legacy-peer-deps.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(
  scriptDir,
  "../.github/actions/package-lock-in-sync/npm-ci-legacy-peer-deps.mjs",
);

test("false without .npmrc or env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-legacy-"));
  assert.equal(npmCiUsesLegacyPeerDeps(dir), false);
});

test("true when .npmrc has legacy-peer-deps=true", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-legacy-"));
  fs.writeFileSync(path.join(dir, ".npmrc"), "legacy-peer-deps=true\n");
  assert.equal(npmCiUsesLegacyPeerDeps(dir), true);
});

test("false when legacy-peer-deps=false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-legacy-"));
  fs.writeFileSync(path.join(dir, ".npmrc"), "legacy-peer-deps=false\n");
  assert.equal(npmCiUsesLegacyPeerDeps(dir), false);
});

test("CLI prints true/false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-legacy-"));
  fs.writeFileSync(path.join(dir, ".npmrc"), "legacy-peer-deps=true\n");
  const r = spawnSync(process.execPath, [cli], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "true");
});

test("npm_config_legacy_peer_deps env wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-legacy-"));
  const prev = process.env.npm_config_legacy_peer_deps;
  process.env.npm_config_legacy_peer_deps = "true";
  try {
    assert.equal(npmCiUsesLegacyPeerDeps(dir), true);
  } finally {
    if (prev === undefined) delete process.env.npm_config_legacy_peer_deps;
    else process.env.npm_config_legacy_peer_deps = prev;
  }
});
