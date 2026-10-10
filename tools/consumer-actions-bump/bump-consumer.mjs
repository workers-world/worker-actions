#!/usr/bin/env node
/**
 * Pilot consumer pin bump (workers-world/mok1). Invoked from worker-consumer-actions-bump.yml.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteWorkflowPinTree } from "./rewrite-workflow-pins.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HEAD_BRANCH = "chore/bump-worker-actions-pins";
export const PR_TITLE_PREFIX = "chore: bump worker-actions pins to ";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${err}`);
  }
  return (r.stdout || "").trim();
}

function ghJson(args) {
  const out = run("gh", ["api", ...args]);
  return JSON.parse(out || "null");
}

function gh(args, env) {
  return run("gh", args, { env: { ...process.env, ...env } });
}

/** @returns {string | null} first line stdout, or null if empty / missing ref */
function runOptional(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${err}`);
  }
  const out = (r.stdout || "").trim();
  return out || null;
}

/**
 * Shallow clone only has default branch; leftover bot branch may still exist on remote
 * (delete_branch_on_merge=false) without a remote-tracking ref → bare --force-with-lease rejects with "stale info".
 *
 * @param {string} pushUrl authenticated clone/push URL
 * @param {string} headBranch bot-owned head only
 * @returns {string | null} remote tip SHA, or null if branch absent
 */
export function resolveRemoteHeadSha(pushUrl, headBranch) {
  const out = runOptional("git", ["ls-remote", pushUrl, `refs/heads/${headBranch}`]);
  if (!out) return null;
  const line = out.split("\n").find((l) => l.trim())?.trim();
  if (!line) return null;
  const sha = line.split(/\s+/)[0];
  return sha || null;
}

/**
 * @param {string} headBranch
 * @param {string | null} remoteHeadSha from {@link resolveRemoteHeadSha}
 * @returns {string[]} git push options before `<repository> <refspec>`
 */
export function buildBotHeadPushLeaseFlags(headBranch, remoteHeadSha) {
  if (remoteHeadSha) {
    return [
      "--force-with-lease",
      `refs/heads/${headBranch}:${remoteHeadSha}`,
    ];
  }
  return [];
}

function notice(msg) {
  console.log(`::notice title=consumer-actions-bump::${msg.replace(/\n/g, " ")}`);
}

function warning(msg) {
  console.log(`::warning title=consumer-actions-bump::${msg.replace(/\n/g, " ")}`);
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

/**
 * @param {string} repo owner/name
 * @param {string} tagName actions/vX.Y.Z
 */
export async function bumpConsumerRepo(repo, tagName, options = {}) {
  const {
    dryRun = false,
    ghToken = process.env.GH_TOKEN,
    headBranch = HEAD_BRANCH,
  } = options;

  if (!ghToken) throw new Error("GH_TOKEN required");
  if (!/^actions\/v\d+\.\d+\.\d+$/.test(tagName)) {
    throw new Error(`Invalid tag: ${tagName}`);
  }

  process.env.GH_TOKEN = ghToken;

  const meta = ghJson([`repos/${repo}`, "--jq", "{default_branch:.default_branch}"]);
  const defaultBranch = meta.default_branch;
  if (!defaultBranch) throw new Error(`Could not resolve default branch for ${repo}`);

  if (!/^dev_/.test(defaultBranch)) {
    const msg = `Skip ${repo}: default branch \`${defaultBranch}\` is not dev_* (WW-150)`;
    warning(msg);
    appendSummary([`### Skip: ${repo}`, "", msg]);
    return { status: "skipped", reason: "default_branch_not_dev", defaultBranch };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "consumer-bump-"));
  try {
    run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      defaultBranch,
      `https://github.com/${repo}.git`,
      tmp,
    ]);

    const workflowsDir = path.join(tmp, ".github", "workflows");
    const { files, totalReplacements } = rewriteWorkflowPinTree(workflowsDir, tagName);

    if (totalReplacements === 0) {
      const msg = `No worker-actions @actions/v* pins under .github/workflows in ${repo}`;
      notice(msg);
      appendSummary([`### ${repo}`, "", msg]);
      return { status: "noop", defaultBranch };
    }

    if (dryRun) {
      notice(`Dry run: would bump ${totalReplacements} pin(s) in ${files.length} file(s) on ${defaultBranch}`);
      appendSummary([
        `### Dry run: ${repo}`,
        "",
        `- Tag: \`${tagName}\``,
        `- Files: ${files.map((f) => `\`${path.relative(tmp, f)}\``).join(", ")}`,
        `- Replacements: ${totalReplacements}`,
      ]);
      return { status: "dry_run", files, totalReplacements, defaultBranch };
    }

    const openPrs = JSON.parse(
      gh([
        "pr",
        "list",
        "--repo",
        repo,
        "--base",
        defaultBranch,
        "--state",
        "open",
        "--json",
        "number,title,headRefName",
      ]),
    );

    const bumpPrs = openPrs.filter((p) =>
      (p.title || "").startsWith(PR_TITLE_PREFIX.trim()),
    );
    const ourPr = bumpPrs.find((p) => p.headRefName === headBranch);
    const foreignBumpPr = bumpPrs.find((p) => p.headRefName !== headBranch);

    if (foreignBumpPr && !ourPr) {
      const msg = `Skip ${repo}: open bump PR #${foreignBumpPr.number} uses head \`${foreignBumpPr.headRefName}\` (not \`${headBranch}\`). Not force-updating foreign head (WW-150).`;
      warning(msg);
      gh([
        "pr",
        "comment",
        foreignBumpPr.number.toString(),
        "--repo",
        repo,
        "--body",
        `<!-- consumer-actions-bump bot -->
**Auto bump skipped** for tag \`${tagName}\`: this open PR uses head branch \`${foreignBumpPr.headRefName}\`, while the bot only force-updates \`${headBranch}\`. Close or merge this PR, or move commits to \`${headBranch}\`, then re-run **worker-consumer-actions-bump** (or push a new \`actions/v*\` tag).

${msg}`,
      ]);
      appendSummary([`### Skip: ${repo}`, "", msg]);
      return { status: "skipped", reason: "foreign_bump_pr", pr: foreignBumpPr.number };
    }

    run("git", ["-C", tmp, "config", "user.name", "github-actions[bot]"]);
    run("git", ["-C", tmp, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    run("git", ["-C", tmp, "checkout", "-B", headBranch]);
    run("git", ["-C", tmp, "add", ".github/workflows"]);
    run("git", [
      "-C",
      tmp,
      "commit",
      "-m",
      `${PR_TITLE_PREFIX}${tagName}`,
    ]);

    // Prefer x-access-token URL (same as release-actions-bundle Phase B).
    // Plain https + http.extraHeader bearer failed on ubuntu-latest with:
    //   fatal: could not read Username for 'https://github.com'
    const pushUrl = `https://x-access-token:${ghToken}@github.com/${repo}.git`;
    const remoteHeadSha = resolveRemoteHeadSha(pushUrl, headBranch);
    const pushLeaseFlags = buildBotHeadPushLeaseFlags(headBranch, remoteHeadSha);
    run("git", [
      "-C",
      tmp,
      "push",
      ...pushLeaseFlags,
      pushUrl,
      `${headBranch}:${headBranch}`,
    ]);

    const prTitle = `${PR_TITLE_PREFIX}${tagName}`;
    const prBody = `## Worker-actions pin bump (pilot)

- **Tag**: \`${tagName}\`
- **Scope**: \`.github/workflows/**\` outer \`workers-world/worker-actions/...@actions/v*\` only
- **Files**: ${files.map((f) => `\`${path.relative(tmp, f)}\``).join(", ")}
- **Replacements**: ${totalReplacements}

Lockfile / \`package.json\` 不在范围；合入后走现有 sync-lock。

> Opened by [\`worker-consumer-actions-bump\`](https://github.com/workers-world/worker-actions) (WW-150 / #101). **Phase 1: no auto-merge.**
`;

    let prNumber = ourPr?.number;
    if (prNumber) {
      notice(`Updated existing bump PR #${prNumber} on ${repo} → ${tagName}`);
      gh([
        "pr",
        "comment",
        prNumber.toString(),
        "--repo",
        repo,
        "--body",
        `<!-- consumer-actions-bump bot -->
Force-updated head \`${headBranch}\` to \`${tagName}\` (${totalReplacements} pin replacement(s)).`,
      ]);
      gh(["pr", "edit", prNumber.toString(), "--repo", repo, "--title", prTitle]);
    } else {
      const createdUrl = gh([
        "pr",
        "create",
        "--repo",
        repo,
        "--base",
        defaultBranch,
        "--head",
        headBranch,
        "--title",
        prTitle,
        "--body",
        prBody,
      ]);
      notice(`Opened bump PR on ${repo}: ${createdUrl}`);
      prNumber = Number(
        gh([
          "pr",
          "list",
          "--repo",
          repo,
          "--head",
          headBranch,
          "--base",
          defaultBranch,
          "--state",
          "open",
          "--json",
          "number",
          "--jq",
          ".[0].number",
        ]),
      );
    }

    appendSummary([
      `### ${repo}`,
      "",
      `- Tag: \`${tagName}\``,
      `- Base: \`${defaultBranch}\``,
      `- Head: \`${headBranch}\``,
      `- PR: #${prNumber}`,
      `- Pin replacements: ${totalReplacements}`,
    ]);

    return {
      status: "opened_or_updated",
      prNumber,
      files,
      totalReplacements,
      defaultBranch,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const repo = process.env.CONSUMER_REPO || "workers-world/mok1";
  const tagName = process.env.TARGET_TAG;
  const dryRun = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";

  if (!tagName) {
    console.error("TARGET_TAG env required");
    process.exit(1);
  }

  const result = await bumpConsumerRepo(repo, tagName, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
