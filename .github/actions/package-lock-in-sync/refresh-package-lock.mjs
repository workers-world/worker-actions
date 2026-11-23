#!/usr/bin/env node
/**
 * Full npm install refresh of package-lock.json (GitHub Packages + root deps).
 * Requires NODE_AUTH_TOKEN for @workers-world/* specs.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { npmCiUsesLegacyPeerDeps } from "./npm-ci-legacy-peer-deps.mjs";
import { reformatPackageLockFile } from "./reformat-package-lock.mjs";
import {
  ensureNpmrcForGithubPackages,
  listWorkersWorldNpmPackageDeps,
  lockHasFileLinkToWorkersWorldPackages,
  readJson,
  shallowLockInSync,
  validateWorkersWorldNpmSpecs,
} from "./github-packages-lock.mjs";

function main() {
  if (!fs.existsSync("package.json")) {
    console.error("无 package.json");
    process.exit(1);
  }
  const pkg = readJson("package.json");
  const validated = validateWorkersWorldNpmSpecs(pkg);
  if (!validated.ok) {
    console.error(validated.message);
    process.exit(1);
  }
  const ww = listWorkersWorldNpmPackageDeps(pkg);
  if (ww.length > 0) {
    if (!process.env.NODE_AUTH_TOKEN) {
      console.error("刷新 lock 需要 NODE_AUTH_TOKEN（GHA_TOKEN / read:packages）");
      process.exit(1);
    }
    ensureNpmrcForGithubPackages();
  }

  for (const { packageName } of ww) {
    const mod = `node_modules/@workers-world/${packageName}`;
    if (fs.existsSync(mod)) {
      fs.rmSync(mod, { recursive: true, force: true });
    }
  }
  if (fs.existsSync("package-lock.json")) {
    const lockText = fs.readFileSync("package-lock.json", "utf8");
    if (lockHasFileLinkToWorkersWorldPackages(lockText, ww)) {
      console.log("移除 file: link 残留 lock，重新生成");
      fs.unlinkSync("package-lock.json");
    }
  }

  const args = ["install", "--no-fund", "--no-audit", "--ignore-scripts"];
  if (npmCiUsesLegacyPeerDeps()) {
    args.push("--legacy-peer-deps");
    console.log("caller 启用 legacy-peer-deps，npm install 将带上 --legacy-peer-deps");
  }
  const summary =
    ww.length === 0
      ? "按 package.json 全量刷新 lock"
      : `按 package.json 全量刷新 lock（含 ${ww.map((d) => `${d.packageName}@${d.version}`).join(", ")}）`;
  console.log(summary);

  const r = spawnSync("npm", args, {
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }

  reformatPackageLockFile();
  const nodeModules = "node_modules";
  if (fs.existsSync(nodeModules)) {
    fs.rmSync(nodeModules, { recursive: true, force: true });
  }

  if (!fs.existsSync("package-lock.json")) {
    console.error("npm install 未生成 package-lock.json");
    process.exit(1);
  }
  const lockText = fs.readFileSync("package-lock.json", "utf8");
  const lock = readJson("package-lock.json");
  if (!shallowLockInSync(pkg, lockText, lock)) {
    if (ww.length > 0) {
      console.error(
        "::error::package-lock 未解析到 package.json 中的 @workers-world 依赖。请确认 Packages 已发布且 GHA_TOKEN/read 权限正常。",
      );
    } else {
      console.error(
        "::error::刷新后 package-lock 根依赖仍与 package.json 不一致。",
      );
    }
    process.exit(1);
  }
}

main();
