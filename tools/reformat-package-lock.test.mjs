#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_LOCK_INDENT,
  firstLevelPropertyIndent,
  reformatPackageLockFile,
} from "../.github/actions/package-lock-in-sync/reformat-package-lock.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(
  scriptDir,
  "../.github/actions/package-lock-in-sync/reformat-package-lock.mjs",
);

test("reformatPackageLockFile uses 4-space first-level indent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-reformat-"));
  const lockPath = path.join(dir, "package-lock.json");
  const lock = {
    name: "w",
    lockfileVersion: 3,
    packages: { "": { name: "w" } },
  };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  assert.equal(firstLevelPropertyIndent(fs.readFileSync(lockPath, "utf8")), 2);

  assert.equal(reformatPackageLockFile(dir), true);
  const out = fs.readFileSync(lockPath, "utf8");
  assert.equal(firstLevelPropertyIndent(out), PACKAGE_LOCK_INDENT);
  assert.equal(out, `${JSON.stringify(lock, null, PACKAGE_LOCK_INDENT)}\n`);
});

test("reformatPackageLockFile is no-op when already 4-space", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-reformat-"));
  const lockPath = path.join(dir, "package-lock.json");
  const lock = { lockfileVersion: 3, packages: {} };
  const text = `${JSON.stringify(lock, null, PACKAGE_LOCK_INDENT)}\n`;
  fs.writeFileSync(lockPath, text);
  assert.equal(reformatPackageLockFile(dir), false);
  assert.equal(fs.readFileSync(lockPath, "utf8"), text);
});

test("CLI reformat-package-lock.mjs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-reformat-cli-"));
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, '{ "lockfileVersion": 3, "packages": {} }\n');
  const { status } = spawnSync(process.execPath, [script, dir], {
    encoding: "utf8",
  });
  assert.equal(status, 0);
  assert.equal(firstLevelPropertyIndent(fs.readFileSync(lockPath, "utf8")), 4);
});
