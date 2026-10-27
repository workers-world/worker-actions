/**
 * Gate P2 helpers: semver, outer pin scan, PR disposition copy, fleet labels.
 */
import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_OUTER_PIN_RE } from "./rewrite-workflow-pins.mjs";

const PR_TITLE_PREFIX = "chore: bump worker-actions pins to ";

export const FLEET_LABEL_READY = "fleet:ready";
export const FLEET_LABEL_SUPERSEDED = "fleet:superseded";

const ACTIONS_TAG_RE = /^actions\/v(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {string} tag actions/vM.m.p
 * @returns {[number, number, number] | null}
 */
export function parseActionsTag(tag) {
  const m = ACTIONS_TAG_RE.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * @param {string} a actions/v*
 * @param {string} b actions/v*
 * @returns {number} -1 | 0 | 1
 */
export function compareActionsTags(a, b) {
  const pa = parseActionsTag(a);
  const pb = parseActionsTag(b);
  if (!pa || !pb) throw new Error(`compareActionsTags: invalid tag(s) ${a} vs ${b}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * @param {string} title PR title
 * @returns {string | null} actions/vX.Y.Z from bump title
 */
export function parseBumpTitleTag(title) {
  const prefix = PR_TITLE_PREFIX.trim();
  if (!(title || "").startsWith(prefix)) return null;
  const rest = title.slice(prefix.length).trim();
  return ACTIONS_TAG_RE.test(rest) ? rest : null;
}

/**
 * @param {string} workflowsDir absolute path to .github/workflows
 * @returns {string | null} max actions/v* tag among outer worker-actions pins
 */
export function maxOuterWorkflowPinTag(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) return null;

  /** @type {string | null} */
  let max = null;

  /** @param {string} dir */
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(yml|yaml)$/i.test(ent.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const m of text.matchAll(WORKFLOW_OUTER_PIN_RE)) {
        const fullMatch = m[0];
        const tagMatch = fullMatch.match(/@(actions\/v\d+\.\d+\.\d+)/);
        if (!tagMatch) continue;
        const tag = tagMatch[1];
        if (!max || compareActionsTags(tag, max) > 0) {
          max = tag;
        }
      }
    }
  }

  walk(workflowsDir);
  return max;
}

/**
 * @param {object} opts
 * @param {string} opts.tagName
 * @param {string[]} opts.fileRelPaths paths relative to consumer clone root
 * @param {number} opts.totalReplacements
 */
export function buildPhase2PrBody({ tagName, fileRelPaths, totalReplacements }) {
  const files = fileRelPaths.map((f) => `\`${f}\``).join(", ");
  return `## Worker-actions pin bump

- **Tag**: \`${tagName}\`
- **Scope**: \`.github/workflows/**\` outer \`workers-world/worker-actions/...@actions/v*\` only
- **Files**: ${files || "—"}
- **Replacements**: ${totalReplacements}

Lockfile / \`package.json\` 不在范围；合入后走现有 sync-lock。

> Opened by [\`worker-consumer-actions-bump\`](https://github.com/workers-world/worker-actions) (WW-150 org fanout / fleet Gate P2). **Phase 2:** \`fleet:ready\` + GitHub **auto-merge (squash)** when required checks are green.
`;
}

/**
 * @param {object} opts
 * @param {"foreign_head" | "obsolete_downgrade" | "superseded"} opts.disposition
 * @param {string} opts.targetTag bump run target
 * @param {string} [opts.prTitleTag] tag parsed from superseded PR title
 * @param {string} [opts.maxDestinPin] max outer pin on destin tip
 * @param {string} [opts.headBranch] bot canonical head
 */
export function buildDispositionCommentBody({
  disposition,
  targetTag,
  prTitleTag,
  maxDestinPin,
  headBranch = "chore/bump-worker-actions-pins",
}) {
  const lines = [
    "<!-- consumer-actions-bump bot -->",
    `**disposition: ${disposition === "foreign_head" ? "superseded" : disposition}**`,
    "",
  ];

  if (disposition === "foreign_head") {
    lines.push(
      `Closed: open bump PR used a non-canonical head branch. The bot only maintains \`${headBranch}\`.`,
      `Latest fanout target: \`${targetTag}\`. Re-run **Consumer actions pin bump** after merging or closing manual bump branches.`,
    );
  } else if (disposition === "obsolete_downgrade") {
    lines.push(
      `Closed: PR targeted \`${prTitleTag || "unknown"}\` but destin default branch already pins \`${maxDestinPin}\` (would downgrade).`,
      `Current fanout target: \`${targetTag}\`.`,
    );
  } else {
    lines.push(
      `Closed: superseded by newer \`actions/v*\` fanout (PR title tag \`${prTitleTag || "unknown"}\` < run target \`${targetTag}\`).`,
      "Destin already at or above this pin on many consumers; see org bump workflow for the canonical PR on `chore/bump-worker-actions-pins`.",
    );
  }

  return lines.join("\n");
}
