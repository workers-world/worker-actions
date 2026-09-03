#!/usr/bin/env node
/**
 * package.json 与 package-lock.json 是否已同步（SDK GitHub Packages + 根依赖）。
 * exit 0 = 已同步；1 = 未同步；2 = 无 framework_sdk_worker（调用方可跳过）。
 */
import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function wantSdkVersion(pkg) {
  const dep = pkg.dependencies?.framework_sdk_worker ?? "";
  const m = String(dep).match(/@([0-9]+\.[0-9]+\.[0-9]+)/);
  return m ? m[1] : null;
}

function lockMatchesSdkVersion(lock, wantVer) {
  const packages = Object.entries(lock.packages ?? {});

  for (const [, meta] of packages) {
    const resolved = String(meta?.resolved ?? "");
    if (resolved.includes("../framework_sdk_worker")) return false;
  }

  for (const [pkgPath, meta] of packages) {
    if (!pkgPath.includes("framework_sdk_worker")) continue;
    if (String(meta?.version ?? "") !== String(wantVer)) continue;

    const resolved = String(meta?.resolved ?? "");
    try {
      const u = new URL(resolved);
      if (u.hostname === "npm.pkg.github.com") return true;
    } catch {
      // ignore non-URL or malformed resolved values
    }
  }

  return false;
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

function main() {
  if (!fs.existsSync("package.json")) {
    console.error("package.json 不存在");
    process.exit(1);
  }
  const pkg = readJson("package.json");
  if (!String(pkg.dependencies?.framework_sdk_worker ?? "").includes("framework_sdk_worker")) {
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
  const lock = readJson("package-lock.json");
  if (lockMatchesSdkVersion(lock, wantVer) && rootDepsInSync(pkg, lock)) {
    process.exit(0);
  }
  process.exit(1);
}

main();
