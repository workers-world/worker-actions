#!/usr/bin/env node
/**
 * Rewrite package-lock.json with 4-space JSON indent after npm install.
 * npm defaults to 2-space; several worker repos gate first-level lock indent at 4.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_LOCK_INDENT = 4;

export function packageLockJsonPath(cwd = process.cwd()) {
  return path.join(cwd, "package-lock.json");
}

/** @returns {boolean} true when file was rewritten */
export function reformatPackageLockFile(
  cwd = process.cwd(),
  lockPath = packageLockJsonPath(cwd),
) {
  if (!fs.existsSync(lockPath)) {
    throw new Error(`missing ${path.basename(lockPath)}`);
  }
  const lockText = fs.readFileSync(lockPath, "utf8");
  const lock = JSON.parse(lockText);
  const formatted = `${JSON.stringify(lock, null, PACKAGE_LOCK_INDENT)}\n`;
  if (formatted === lockText) {
    return false;
  }
  fs.writeFileSync(lockPath, formatted, "utf8");
  return true;
}

/**
 * First property line indent (spaces after `{`), for style-gate unit checks.
 */
export function firstLevelPropertyIndent(lockText) {
  for (const line of lockText.split("\n")) {
    const m = line.match(/^(\s+)"/);
    if (m) {
      return m[1].length;
    }
  }
  return null;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const cwd = process.argv[2] && process.argv[2] !== "--"
    ? path.resolve(process.argv[2])
    : process.cwd();
  reformatPackageLockFile(cwd);
}
