#!/usr/bin/env node
/**
 * package.json 与 package-lock.json 是否已同步（SDK GitHub Packages + 根依赖 + 可安装性）。
 * exit 0 = 已同步；1 = 未同步；2 = 无 framework_sdk_worker（调用方可跳过）。
 *
 * 浅层：SDK lock 路径 + lock packages[""] 与 package.json 根依赖字符串一致。
 * 深层（默认）：浅层通过后执行 npm ci --dry-run，捕获缺失/无效传递依赖（须 NODE_AUTH_TOKEN）。
 * 本地/无 token 轮询：LOCK_CHECK_SKIP_DRY_RUN=1 仅浅层（legacy wait-for-sync）。
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { npmCiUsesLegacyPeerDeps } from "./npm-ci-legacy-peer-deps.mjs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function wantSdkVersion(pkg) {
  const dep = pkg.dependencies?.framework_sdk_worker ?? "";
  const m = String(dep).match(/@([0-9]+\.[0-9]+\.[0-9]+)/);
  return m ? m[1] : null;
}

function lockMatchesSdkVersion(lockText, wantVer) {
  return (
    lockText.includes("npm.pkg.github.com") &&
    !lockText.includes('"../framework_sdk_worker"') &&
    lockText.includes(`framework_sdk_worker/${wantVer}/`)
  );
}

function rootDepsInSync(pkg, lock) {
  const root = lock.packages?.[""] ?? {};
  function same(a, b) {
    const aa = a ?? {};
    const bb = b ?? {};
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      if (String(aa[k] ?? "") !== String(bb[k] ?? "")) return false;
    }
    return true;
  }
  return (
    same(pkg.dependencies, root.dependencies) &&
    same(pkg.devDependencies, root.devDependencies)
  );
}

function shallowInSync(pkg, lockText, lock) {
  const wantVer = wantSdkVersion(pkg);
  if (!wantVer) return false;
  return lockMatchesSdkVersion(lockText, wantVer) && rootDepsInSync(pkg, lock);
}

function ensureNpmrcForGithubPackages() {
  const token = process.env.NODE_AUTH_TOKEN;
  if (!token) return false;
  const line = "//npm.pkg.github.com/:_authToken=";
  if (fs.existsSync(".npmrc")) {
    const rc = fs.readFileSync(".npmrc", "utf8");
    if (rc.includes("npm.pkg.github.com") && rc.includes(line)) return true;
  }
  fs.appendFileSync(
    ".npmrc",
    [
      "",
      "@workers-world:registry=https://npm.pkg.github.com",
      `${line}${token}`,
      "",
    ].join("\n"),
  );
  return true;
}

function lockPassesNpmCiDryRun() {
  if (process.env.LOCK_CHECK_SKIP_DRY_RUN === "1") {
    return true;
  }
  const token = process.env.NODE_AUTH_TOKEN;
  if (!token) {
    console.error(
      "NODE_AUTH_TOKEN 未设置，无法执行 npm ci --dry-run 完整性校验（fail-closed）",
    );
    return false;
  }
  ensureNpmrcForGithubPackages();
  const args = ["ci", "--dry-run", "--no-fund", "--no-audit"];
  if (npmCiUsesLegacyPeerDeps()) {
    args.push("--legacy-peer-deps");
  }
  const r = spawnSync("npm", args, {
    stdio: "inherit",
    env: { ...process.env, NODE_AUTH_TOKEN: token },
  });
  if (r.error) {
    console.error("npm ci --dry-run 启动失败:", r.error.message);
    return false;
  }
  return r.status === 0;
}

function main() {
  if (!fs.existsSync("package.json")) {
    console.error("package.json 不存在");
    process.exit(1);
  }
  const pkg = readJson("package.json");
  if (
    !String(pkg.dependencies?.framework_sdk_worker ?? "").includes(
      "framework_sdk_worker",
    )
  ) {
    process.exit(2);
  }
  const wantVer = wantSdkVersion(pkg);
  if (!wantVer) {
    console.error(
      "package.json 中 framework_sdk_worker 须为 npm:@workers-world/framework_sdk_worker@X.Y.Z",
    );
    process.exit(1);
  }
  if (!fs.existsSync("package-lock.json")) {
    process.exit(1);
  }
  const lockText = fs.readFileSync("package-lock.json", "utf8");
  const lock = readJson("package-lock.json");
  if (!shallowInSync(pkg, lockText, lock)) {
    process.exit(1);
  }
  if (!lockPassesNpmCiDryRun()) {
    console.error(
      "package-lock 浅层与 package.json 一致，但 npm ci --dry-run 失败（传递依赖/lock 完整性）",
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
