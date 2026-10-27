#!/usr/bin/env node
/**
 * Gate P1: every nested @actions/v* under bundle pin globs must equal TARGET_TAG.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Same scan roots as tools/actions-bundle/nested-pins-lib.sh BUNDLE_PIN_GLOBS */
export const TAG_PIN_SCAN_ROOTS = [
  ".github/actions",
  ".github/workflows",
  "templates",
  "docs/templates",
];

/** @type {RegExp} */
export const NESTED_ACTIONS_PIN_RE = /@actions\/v(\d+)\.\d+\.\d+/g;

/**
 * @param {string} root repo root (tag tree checkout)
 * @returns {string[]} unique pins like @actions/v1.2.3
 */
export function collectNestedPinVersions(root) {
  /** @type {Set<string>} */
  const pins = new Set();

  /** @param {string} dir */
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(yml|yaml)$/i.test(ent.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const m of text.matchAll(/@actions\/v\d+\.\d+\.\d+/g)) {
        pins.add(m[0]);
      }
    }
  }

  for (const rel of TAG_PIN_SCAN_ROOTS) {
    walk(path.join(root, rel));
  }

  return [...pins].sort();
}

/**
 * @param {string} targetTag actions/vX.Y.Z
 * @param {string[]} pins unique @actions/v* strings
 * @returns {{ ok: true } | { ok: false, misaligned: string[], expected: string }}
 */
export function verifyNestedPinsAlignedToTag(targetTag, pins) {
  if (!/^actions\/v\d+\.\d+\.\d+$/.test(targetTag)) {
    throw new Error(`Invalid targetTag: ${targetTag}`);
  }
  const expected = `@${targetTag}`;
  const misaligned = pins.filter((p) => p !== expected);
  if (misaligned.length > 0) {
    return { ok: false, misaligned, expected };
  }
  return { ok: true };
}

/**
 * @param {string} root
 * @param {string} targetTag
 */
export function verifyTagTreeNestedPins(root, targetTag) {
  const pins = collectNestedPinVersions(root);
  return verifyNestedPinsAlignedToTag(targetTag, pins);
}

function main() {
  const root = process.env.TAG_TREE_ROOT || ".";
  const targetTag = process.env.TARGET_TAG;
  if (!targetTag) {
    console.error("TARGET_TAG env required");
    process.exit(1);
  }

  const result = verifyTagTreeNestedPins(root, targetTag);
  if (!result.ok) {
    console.error(
      `::error::Gate P1 FAIL: tag ${targetTag} tree has nested pin(s) not aligned to ${result.expected}: ${result.misaligned.join(", ")}`,
    );
    process.exit(1);
  }

  const pins = collectNestedPinVersions(root);
  console.log(
    `::notice title=consumer-actions-bump::Gate P1 PASS: nested @actions/v* aligned to ${targetTag} (${pins.length} unique pin version(s) in tag tree)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
