#!/usr/bin/env node
/**
 * lock-matches-package-json.mjs 单元测试（浅层 + dry-run skip 路径）
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(
  scriptDir,
  "../.github/actions/package-lock-in-sync/lock-matches-package-json.mjs",
);

function runIn(dir, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    env: { ...process.env, LOCK_CHECK_SKIP_DRY_RUN: "1", ...env },
    encoding: "utf8",
  });
}

test("exit 2 when package.json has no framework_sdk_worker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-check-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", dependencies: {} }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  const r = runIn(dir);
  assert.equal(r.status, 2);
});

test("exit 1 when root deps differ from lock packages[\"\"]", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-check-"));
  const pkg = {
    name: "w",
    dependencies: {
      framework_sdk_worker:
        "npm:@workers-world/framework_sdk_worker@1.0.0",
      chanfana: "^1.0.0",
    },
  };
  const lock = {
    name: "w",
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: {
          framework_sdk_worker:
            "npm:@workers-world/framework_sdk_worker@1.0.0",
        },
      },
    },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify(lock, null, 2),
  );
  const lockText = fs.readFileSync(path.join(dir, "package-lock.json"), "utf8");
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    lockText.replace(
      '"packages": {',
      '"note":"npm.pkg.github.com/framework_sdk_worker/1.0.0/tarball","packages": {',
    ),
  );
  const r = runIn(dir);
  assert.equal(r.status, 1);
});

test("exit 1 without NODE_AUTH_TOKEN when dry-run enabled", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-check-"));
  const dep =
    "npm:@workers-world/framework_sdk_worker@1.0.0";
  const pkg = { name: "w", dependencies: { framework_sdk_worker: dep } };
  const lock = {
    name: "w",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { framework_sdk_worker: dep } },
    },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  let lockStr = JSON.stringify(lock, null, 2);
  lockStr = lockStr.replace(
    '"lockfileVersion": 3',
    '"lockfileVersion": 3,\n  "_sdk": "npm.pkg.github.com/framework_sdk_worker/1.0.0/tarball"',
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockStr);
  const r = runIn(dir, { LOCK_CHECK_SKIP_DRY_RUN: "0", NODE_AUTH_TOKEN: "" });
  assert.equal(r.status, 1);
});

test("exit 0 shallow pass with LOCK_CHECK_SKIP_DRY_RUN=1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-check-"));
  const dep =
    "npm:@workers-world/framework_sdk_worker@2.0.0";
  const pkg = { name: "w", dependencies: { framework_sdk_worker: dep } };
  const lock = {
    name: "w",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { framework_sdk_worker: dep } },
    },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  let lockStr = JSON.stringify(lock, null, 2);
  lockStr = lockStr.replace(
    '"lockfileVersion": 3',
    '"lockfileVersion": 3,\n  "_sdk": "npm.pkg.github.com/framework_sdk_worker/2.0.0/tarball"',
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockStr);
  const r = runIn(dir);
  assert.equal(r.status, 0);
});
