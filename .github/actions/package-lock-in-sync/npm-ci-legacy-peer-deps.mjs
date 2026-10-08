#!/usr/bin/env node
/**
 * 是否与下游 npm ci 一致地使用 --legacy-peer-deps（.npmrc 或 npm_config_legacy_peer_deps）。
 * sync-lock 与 lock-matches-package-json dry-run 须共用此逻辑，避免 lock 与 verify/Builds 漂移。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function npmCiUsesLegacyPeerDeps(cwd = process.cwd()) {
  if (process.env.npm_config_legacy_peer_deps === "true") return true;
  const npmrc = path.join(cwd, ".npmrc");
  if (!fs.existsSync(npmrc)) return false;
  const rc = fs.readFileSync(npmrc, "utf8");
  return /^legacy-peer-deps\s*=\s*true\s*$/m.test(rc);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  process.stdout.write(npmCiUsesLegacyPeerDeps() ? "true" : "false");
}
