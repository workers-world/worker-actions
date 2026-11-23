#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureNpmrcForGithubPackages,
  listWorkersWorldNpmPackageDeps,
  lockMatchesWorkersWorldPackages,
  rootDepsInSync,
  shallowLockInSync,
} from "../.github/actions/package-lock-in-sync/github-packages-lock.mjs";

test("listWorkersWorldNpmPackageDeps discovers all root npm:@workers-world/* specs", () => {
  const pkg = {
    dependencies: {
      framework_sdk_cli: "npm:@workers-world/framework_sdk_cli@0.2.12",
      chanfana: "^1.0.0",
    },
    devDependencies: {
      framework_sdk_worker: "npm:@workers-world/framework_sdk_worker@9.0.0",
    },
  };
  const deps = listWorkersWorldNpmPackageDeps(pkg);
  assert.equal(deps.length, 2);
  assert.deepEqual(deps.map((d) => d.packageName).sort(), [
    "framework_sdk_cli",
    "framework_sdk_worker",
  ]);
});

test("lockMatchesWorkersWorldPackages uses package name from spec not hardcoded list", () => {
  const lockOk =
    '{"packages":{"npm.pkg.github.com/framework_sdk_cli/0.2.12/tarball":{}}}';
  const lockBad =
    '{"packages":{"npm.pkg.github.com/framework_sdk_cli/0.2.11/tarball":{}}}';
  const ww = [
    {
      key: "framework_sdk_cli",
      spec: "npm:@workers-world/framework_sdk_cli@0.2.12",
      packageName: "framework_sdk_cli",
      version: "0.2.12",
    },
  ];
  assert.equal(lockMatchesWorkersWorldPackages(lockOk, ww), true);
  assert.equal(lockMatchesWorkersWorldPackages(lockBad, ww), false);
});

test("shallowLockInSync combines root deps and github packages paths", () => {
  const dep = "npm:@workers-world/framework_sdk_worker@1.0.0";
  const pkg = { dependencies: { framework_sdk_worker: dep } };
  const lock = {
    packages: {
      "": { dependencies: { framework_sdk_worker: dep } },
    },
  };
  const lockText =
    'npm.pkg.github.com/framework_sdk_worker/1.0.0/tarball';
  assert.equal(shallowLockInSync(pkg, lockText, lock), true);
  assert.equal(
    shallowLockInSync(
      pkg,
      "npm.pkg.github.com/framework_sdk_worker/0.9.0/tarball",
      lock,
    ),
    false,
  );
  assert.equal(rootDepsInSync(pkg, lock), true);
});

test("ensureNpmrcForGithubPackages writes ${NODE_AUTH_TOKEN} placeholder, never the token value", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmrc-ensure-"));
  ensureNpmrcForGithubPackages(dir);
  const rc = fs.readFileSync(path.join(dir, ".npmrc"), "utf8");
  assert.ok(rc.includes("@workers-world:registry=https://npm.pkg.github.com"));
  assert.ok(rc.includes("//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}"));
  assert.ok(!/github_pat_|ghp_/.test(rc));
});

test("ensureNpmrcForGithubPackages is idempotent when auth line already present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmrc-ensure-"));
  fs.writeFileSync(
    path.join(dir, ".npmrc"),
    "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n",
  );
  ensureNpmrcForGithubPackages(dir);
  const rc = fs.readFileSync(path.join(dir, ".npmrc"), "utf8");
  assert.equal(rc.split("_authToken").length - 1, 1);
});
