#!/usr/bin/env node
/**
 * SDK package.json pin 改写（纯函数，供 bump-sdk-consumer.mjs 与测试共用）。
 * 消费方 package.json 的 SDK 依赖形如 "framework_sdk_worker": "npm:@workers-world/framework_sdk_worker@0.4.56"。
 */

const NPM_ALIAS_RE =
  /^npm:@workers-world\/(framework_sdk_(?:worker|ui|cli))@(\d+\.\d+\.\d+)$/;

/** @param {string} a @param {string} b @returns {number} -1/0/1 */
export function compareSdkVersions(a, b) {
  const pa = String(a).split(".").map((n) => Number(n) || 0);
  const pb = String(b).split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) {
      return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
    }
  }
  return 0;
}

/**
 * 改写指定 SDK 包的 pin（dependencies / devDependencies / peerDependencies / optionalDependencies）。
 * 只动 alias 值的版本号，不换包名、不动别名键。
 * @param {string} packageJsonText
 * @param {string} packageName framework_sdk_worker | framework_sdk_ui | framework_sdk_cli
 * @param {string} version 纯数字版本（无 v 前缀）
 * @returns {{ content: string, replacements: number, currentVersion: string | null }}
 */
export function rewriteSdkPinContent(packageJsonText, packageName, version) {
  const pkg = JSON.parse(packageJsonText);
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  let currentVersion = null;
  let replacements = 0;
  /** @type {Record<string, Record<string, string>>} */
  const next = {};
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    const patched = { ...deps };
    for (const [name, raw] of Object.entries(deps)) {
      if (typeof raw !== "string") continue;
      const m = NPM_ALIAS_RE.exec(raw.trim());
      if (!m || m[1] !== packageName) continue;
      currentVersion = m[2];
      if (m[2] === version) continue;
      patched[name] = `npm:@workers-world/${packageName}@${version}`;
      replacements += 1;
    }
    next[section] = patched;
  }
  if (replacements === 0) {
    return { content: packageJsonText, replacements, currentVersion };
  }
  const updated = { ...pkg };
  for (const [section, deps] of Object.entries(next)) {
    updated[section] = deps;
  }
  return { content: `${JSON.stringify(updated, null, 2)}\n`, replacements, currentVersion };
}
