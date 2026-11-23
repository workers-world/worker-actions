/**
 * Adaptive GitHub Packages / lock shallow-sync helpers (no hardcoded package names).
 */
import fs from "node:fs";

const WW_NPM_SPEC_RE =
  /^npm:@workers-world\/([^@]+)@([0-9]+\.[0-9]+\.[0-9]+)$/;

/** @typedef {{ key: string, spec: string, packageName: string, version: string }} WorkersWorldDep */

/**
 * @param {Record<string, unknown>} pkg
 * @returns {WorkersWorldDep[]}
 */
export function listWorkersWorldNpmPackageDeps(pkg) {
  /** @type {WorkersWorldDep[]} */
  const out = [];
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section] ?? {};
    for (const [key, spec] of Object.entries(deps)) {
      const s = String(spec ?? "");
      if (!s.includes("@workers-world/")) continue;
      const m = s.match(WW_NPM_SPEC_RE);
      if (m) {
        out.push({
          key,
          spec: s,
          packageName: m[1],
          version: m[2],
        });
      }
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} pkg
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateWorkersWorldNpmSpecs(pkg) {
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section] ?? {};
    for (const [key, spec] of Object.entries(deps)) {
      const s = String(spec ?? "");
      if (!s.includes("@workers-world/")) continue;
      if (!WW_NPM_SPEC_RE.test(s)) {
        return {
          ok: false,
          message: `package.json 中 ${key} 须为 npm:@workers-world/<name>@${"X.Y.Z"}，当前: ${s}`,
        };
      }
    }
  }
  return { ok: true };
}

export function rootDepsInSync(pkg, lock) {
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

/**
 * Lock must resolve @workers-world packages from GitHub Packages at pinned versions (not file:).
 * @param {string} lockText
 * @param {WorkersWorldDep[]} wwDeps
 */
export function lockMatchesWorkersWorldPackages(lockText, wwDeps) {
  if (wwDeps.length === 0) return true;
  if (!lockText.includes("npm.pkg.github.com")) return false;
  for (const { packageName, version } of wwDeps) {
    if (
      lockText.includes(`"../${packageName}"`) ||
      lockText.includes(`"file:../${packageName}"`)
    ) {
      return false;
    }
    if (!lockText.includes(`${packageName}/${version}/`)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Record<string, unknown>} pkg
 * @param {string} lockText
 * @param {Record<string, unknown>} lock
 */
export function shallowLockInSync(pkg, lockText, lock) {
  const ww = listWorkersWorldNpmPackageDeps(pkg);
  return (
    rootDepsInSync(pkg, lock) &&
    lockMatchesWorkersWorldPackages(lockText, ww)
  );
}

/**
 * @param {string} lockText
 * @param {WorkersWorldDep[]} wwDeps
 */
export function lockHasFileLinkToWorkersWorldPackages(lockText, wwDeps) {
  for (const { packageName } of wwDeps) {
    if (
      lockText.includes(`"../${packageName}"`) ||
      lockText.includes(`"file:../${packageName}"`)
    ) {
      return true;
    }
  }
  return false;
}

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}