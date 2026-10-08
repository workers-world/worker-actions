/**
 * Rewrite outer worker-actions bundle pins in consumer .github/workflows only.
 * Does not touch composite internals or non-workflow paths (WW-150 / #101).
 */
import fs from "node:fs";
import path from "node:path";

/** @type {RegExp} */
export const WORKFLOW_OUTER_PIN_RE =
  /(workers-world\/worker-actions\/[^\s'"#]+@)actions\/v\d+\.\d+\.\d+/g;

/**
 * @param {string} content
 * @param {string} targetTag e.g. actions/v0.2.26 (no leading @)
 * @returns {{ content: string, replacements: number }}
 */
export function rewriteWorkflowPinContent(content, targetTag) {
  if (!/^actions\/v\d+\.\d+\.\d+$/.test(targetTag)) {
    throw new Error(`Invalid targetTag: ${targetTag}`);
  }
  let replacements = 0;
  const next = content.replace(WORKFLOW_OUTER_PIN_RE, (_match, prefix) => {
    replacements += 1;
    return `${prefix}${targetTag}`;
  });
  return { content: next, replacements };
}

/**
 * @param {string} workflowsDir absolute or relative path to .github/workflows
 * @param {string} targetTag
 * @returns {{ files: string[], totalReplacements: number }}
 */
export function rewriteWorkflowPinTree(workflowsDir, targetTag) {
  if (!fs.existsSync(workflowsDir)) {
    return { files: [], totalReplacements: 0 };
  }
  /** @type {string[]} */
  const changed = [];
  let totalReplacements = 0;

  /** @param {string} dir */
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(yml|yaml)$/i.test(ent.name)) continue;
      const before = fs.readFileSync(full, "utf8");
      const { content: after, replacements } = rewriteWorkflowPinContent(
        before,
        targetTag,
      );
      if (replacements > 0 && after !== before) {
        fs.writeFileSync(full, after);
        changed.push(full);
        totalReplacements += replacements;
      }
    }
  }

  walk(workflowsDir);
  return { files: changed, totalReplacements };
}
