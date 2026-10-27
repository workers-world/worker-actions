#!/usr/bin/env node
/**
 * Consumer pin bump (org fanout via worker-consumer-actions-bump.yml matrix).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDispositionCommentBody,
  buildPhase2PrBody,
  compareActionsTags,
  FLEET_LABEL_READY,
  FLEET_LABEL_SUPERSEDED,
  maxOuterWorkflowPinTag,
  parseBumpTitleTag,
} from "./fleet-pin-gate.mjs";
import { rewriteWorkflowPinTree } from "./rewrite-workflow-pins.mjs";

const WORKER_ACTIONS_REPO =
  process.env.WORKER_ACTIONS_REPO || "workers-world/worker-actions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HEAD_BRANCH = "chore/bump-worker-actions-pins";
export const PR_TITLE_PREFIX = "chore: bump worker-actions pins to ";

/** @param {string} repo owner/name */
export function buildAuthenticatedRepoUrl(repo, ghToken) {
  return `https://x-access-token:${ghToken}@github.com/${repo}.git`;
}

/** @param {string} text @param {string[]} secrets */
function redactSecrets(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret && out.includes(secret)) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

function formatCmdFailure(cmd, args, status, err, secretsToRedact = []) {
  const cmdLine = redactSecrets([cmd, ...args].join(" "), secretsToRedact);
  const errText = redactSecrets((err || "").trim(), secretsToRedact);
  return `${cmdLine} failed (${status}): ${errText}`;
}

function run(cmd, args, opts = {}) {
  const { secretsToRedact = [], ...spawnOpts } = opts;
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOpts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(formatCmdFailure(cmd, args, r.status, err, secretsToRedact));
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

/** @returns {string | null} latest actions/v* tag on worker-actions */
export function fetchLatestPublishedActionsTag() {
  /** @type {{ name: string }[]} */
  const tags = [];
  let page = 1;
  for (;;) {
    // IMPORTANT: do not use `gh api -f` here — fields force POST, and
    // POST /repos/.../tags returns 404. Query string keeps GET list semantics.
    const batch = ghJson([
      `repos/${WORKER_ACTIONS_REPO}/tags?per_page=100&page=${page}`,
    ]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const t of batch) {
      if (t?.name?.startsWith("actions/v")) tags.push(t);
    }
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  if (tags.length === 0) return null;
  tags.sort((a, b) => compareActionsTags(a.name, b.name));
  return tags[tags.length - 1].name;
}

/**
 * @param {string} repo
 * @param {string} name
 * @param {string} color
 * @param {string} description
 */
function ensureRepoLabel(repo, name, color, description) {
  const listed = JSON.parse(
    gh(["label", "list", "--repo", repo, "--limit", "100", "--json", "name"]),
  );
  if (listed.some((l) => l.name === name)) return;
  gh([
    "label",
    "create",
    name,
    "--repo",
    repo,
    "--color",
    color,
    "--description",
    description,
  ]);
}

/**
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} body
 */
function closeBumpPrWithDisposition(repo, prNumber, body) {
  ensureRepoLabel(
    repo,
    FLEET_LABEL_SUPERSEDED,
    "ededed",
    "Fleet pin bump superseded or obsolete (Gate P2)",
  );
  gh([
    "pr",
    "comment",
    prNumber.toString(),
    "--repo",
    repo,
    "--body",
    body,
  ]);
  gh([
    "pr",
    "edit",
    prNumber.toString(),
    "--repo",
    repo,
    "--add-label",
    FLEET_LABEL_SUPERSEDED,
  ]);
  gh(["pr", "close", prNumber.toString(), "--repo", repo]);
}

/**
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} body
 */
function applyFleetReadyAutoMerge(repo, prNumber, body) {
  ensureRepoLabel(
    repo,
    FLEET_LABEL_READY,
    "0e8a16",
    "Fleet pin bump ready for auto-merge when checks green (Gate P2)",
  );
  gh([
    "pr",
    "edit",
    prNumber.toString(),
    "--repo",
    repo,
    "--body",
    body,
    "--add-label",
    FLEET_LABEL_READY,
  ]);
  gh([
    "pr",
    "merge",
    prNumber.toString(),
    "--repo",
    repo,
    "--auto",
    "--squash",
  ]);
}

/** @returns {string | null} first line stdout, or null if empty / missing ref */
function runOptional(cmd, args, opts = {}) {
  const { secretsToRedact = [], ...spawnOpts } = opts;
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOpts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(formatCmdFailure(cmd, args, r.status, err, secretsToRedact));
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
export function resolveRemoteHeadSha(pushUrl, headBranch, secretsToRedact = []) {
  const out = runOptional(
    "git",
    ["ls-remote", pushUrl, `refs/heads/${headBranch}`],
    { secretsToRedact },
  );
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
    // Must be a single argv with "=". Separate "--force-with-lease" + "ref:sha"
    // makes git treat "ref:sha" as a refspec and the push URL as another refspec
    // (error: src refspec https://x-access-token does not match any).
    return [`--force-with-lease=refs/heads/${headBranch}:${remoteHeadSha}`];
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
    // Private consumers need an authenticated clone URL (public repos work either way).
    const authUrl = buildAuthenticatedRepoUrl(repo, ghToken);
    const gitSecrets = [ghToken];
    run(
      "git",
      ["clone", "--depth", "1", "--branch", defaultBranch, authUrl, tmp],
      { secretsToRedact: gitSecrets },
    );

    const workflowsDir = path.join(tmp, ".github", "workflows");
    const maxDestinPin = maxOuterWorkflowPinTag(workflowsDir);

    const listOpenBumpPrs = () =>
      JSON.parse(
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
      ).filter((p) => (p.title || "").startsWith(PR_TITLE_PREFIX.trim()));

    /** @param {typeof bumpPrs} bumpPrs */
    const closeForeignHeadBumpPrs = (bumpPrs) => {
      for (const pr of bumpPrs) {
        if (pr.headRefName === headBranch) continue;
        const body = buildDispositionCommentBody({
          disposition: "foreign_head",
          targetTag: tagName,
          headBranch,
        });
        closeBumpPrWithDisposition(repo, pr.number, body);
        notice(`Closed foreign-head bump PR #${pr.number} on ${repo}`);
      }
    };

    /** @param {typeof bumpPrs} bumpPrs */
    const closeSupersededCanonicalBumpPrs = (bumpPrs) => {
      for (const pr of bumpPrs) {
        if (pr.headRefName !== headBranch) continue;
        const prTag = parseBumpTitleTag(pr.title);
        if (prTag && compareActionsTags(prTag, tagName) < 0) {
          const body = buildDispositionCommentBody({
            disposition: "superseded",
            targetTag: tagName,
            prTitleTag: prTag,
          });
          closeBumpPrWithDisposition(repo, pr.number, body);
          notice(`Closed superseded bump PR #${pr.number} (${prTag} < ${tagName})`);
        }
      }
    };

    if (maxDestinPin && compareActionsTags(tagName, maxDestinPin) < 0) {
      const bumpPrs = listOpenBumpPrs();
      for (const pr of bumpPrs) {
        const prTag = parseBumpTitleTag(pr.title);
        const body = buildDispositionCommentBody({
          disposition: "obsolete_downgrade",
          targetTag: tagName,
          prTitleTag: prTag || undefined,
          maxDestinPin,
        });
        closeBumpPrWithDisposition(repo, pr.number, body);
      }
      const msg = `Skip ${repo}: fanout target ${tagName} is below destin max outer pin ${maxDestinPin} (would downgrade)`;
      warning(msg);
      appendSummary([`### Skip: ${repo}`, "", msg]);
      return {
        status: "skipped",
        reason: "would_downgrade_destin",
        maxDestinPin,
        defaultBranch,
      };
    }

    const { files, totalReplacements } = rewriteWorkflowPinTree(workflowsDir, tagName);

    if (totalReplacements === 0) {
      const bumpPrs = listOpenBumpPrs();
      closeForeignHeadBumpPrs(bumpPrs);
      closeSupersededCanonicalBumpPrs(listOpenBumpPrs());
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

    closeForeignHeadBumpPrs(listOpenBumpPrs());
    const ourPr = listOpenBumpPrs().find((p) => p.headRefName === headBranch);

    const latestPublished = fetchLatestPublishedActionsTag();
    if (latestPublished && compareActionsTags(tagName, latestPublished) < 0) {
      const msg = `Skip ${repo}: TARGET_TAG ${tagName} is older than latest published ${latestPublished}`;
      warning(msg);
      appendSummary([`### Skip: ${repo}`, "", msg]);
      return {
        status: "skipped",
        reason: "target_older_than_latest_tag",
        latestPublished,
        defaultBranch,
      };
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
    const pushUrl = buildAuthenticatedRepoUrl(repo, ghToken);
    const remoteHeadSha = resolveRemoteHeadSha(pushUrl, headBranch, gitSecrets);
    const pushLeaseFlags = buildBotHeadPushLeaseFlags(headBranch, remoteHeadSha);
    run(
      "git",
      ["-C", tmp, "push", ...pushLeaseFlags, pushUrl, `${headBranch}:${headBranch}`],
      { secretsToRedact: gitSecrets },
    );

    const prTitle = `${PR_TITLE_PREFIX}${tagName}`;
    const fileRelPaths = files.map((f) => path.relative(tmp, f));
    const prBody = buildPhase2PrBody({
      tagName,
      fileRelPaths,
      totalReplacements,
    });

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

    applyFleetReadyAutoMerge(repo, prNumber, prBody);
    notice(`Gate P2: enabled auto-merge (squash) + ${FLEET_LABEL_READY} on PR #${prNumber}`);

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
  const repo = process.env.CONSUMER_REPO;
  if (!repo) {
    console.error("CONSUMER_REPO env required (set per matrix job)");
    process.exit(1);
  }
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
