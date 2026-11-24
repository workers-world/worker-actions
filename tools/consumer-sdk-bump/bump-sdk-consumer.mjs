#!/usr/bin/env node
/**
 * Consumer SDK pin bump（org fanout via worker-consumer-sdk-bump.yml matrix）。
 * 与 consumer-actions-bump/bump-consumer.mjs 同款骨架，差异：
 *   - 改写 package.json 的 SDK alias pin（rewrite-sdk-pin.mjs）
 *   - lock 用 npm install --package-lock-only 刷新（需 GHA_TOKEN read:packages）
 *   - 只开 PR，不自动合并（SDK bump 会触发业务仓重建/重部署，合并留给波次编排与人）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareSdkVersions, rewriteSdkPinContent } from "./rewrite-sdk-pin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HEAD_BRANCH_PREFIX = "chore/bump-sdk-pin-";
export const PR_TITLE_PREFIX = "chore(deps): bump ";

const SDK_PACKAGES = new Set([
  "framework_sdk_worker",
  "framework_sdk_ui",
  "framework_sdk_cli",
]);

/** @param {string} repo owner/name @param {string} ghToken */
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

function gh(args) {
  return run("gh", args);
}

function ghJson(args) {
  return JSON.parse(run("gh", ["api", ...args]) || "null");
}

function notice(msg) {
  console.log(`::notice title=consumer-sdk-bump::${msg.replace(/\n/g, " ")}`);
}

function warning(msg) {
  console.log(`::warning title=consumer-sdk-bump::${msg.replace(/\n/g, " ")}`);
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

/** lock 刷新用 npmrc（token 走 NODE_AUTH_TOKEN env，避免写入文件） */
export function buildNpmrcContent() {
  return [
    "@workers-world:registry=https://npm.pkg.github.com",
    "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}",
    "",
  ].join("\n");
}

/**
 * @param {string} repo owner/name
 * @param {string} packageName framework_sdk_worker | framework_sdk_ui | framework_sdk_cli
 * @param {string} version 纯数字版本（无 v 前缀）
 */
export async function bumpSdkConsumerRepo(repo, packageName, version, options = {}) {
  const { dryRun = false, ghToken = process.env.GH_TOKEN, npmToken = process.env.NODE_AUTH_TOKEN } =
    options;

  if (!ghToken) throw new Error("GH_TOKEN required");
  if (!SDK_PACKAGES.has(packageName)) {
    throw new Error(`Invalid SDK package: ${packageName}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  process.env.GH_TOKEN = ghToken;
  const headBranch = `${HEAD_BRANCH_PREFIX}${packageName}`;
  const gitSecrets = [ghToken, npmToken].filter((s) => Boolean(s));

  const meta = ghJson([`repos/${repo}`, "--jq", "{default_branch:.default_branch}"]);
  const defaultBranch = meta.default_branch;
  if (!defaultBranch) throw new Error(`Could not resolve default branch for ${repo}`);

  if (!/^dev_/.test(defaultBranch)) {
    const msg = `Skip ${repo}: default branch \`${defaultBranch}\` is not dev_*`;
    warning(msg);
    appendSummary([`### Skip: ${repo}`, "", msg]);
    return { status: "skipped", reason: "default_branch_not_dev", defaultBranch };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-bump-"));
  try {
    const authUrl = buildAuthenticatedRepoUrl(repo, ghToken);
    run("git", ["clone", "--depth", "1", "--branch", defaultBranch, authUrl, tmp], {
      secretsToRedact: gitSecrets,
    });

    const pkgPath = path.join(tmp, "package.json");
    if (!fs.existsSync(pkgPath)) {
      const msg = `Skip ${repo}: package.json not found on ${defaultBranch}`;
      warning(msg);
      return { status: "skipped", reason: "no_package_json", defaultBranch };
    }

    const { content, replacements, currentVersion } = rewriteSdkPinContent(
      fs.readFileSync(pkgPath, "utf8"),
      packageName,
      version,
    );

    if (replacements === 0) {
      if (currentVersion && compareSdkVersions(currentVersion, version) > 0) {
        const msg = `Skip ${repo}: pinned ${currentVersion} is newer than target ${version} (would downgrade)`;
        warning(msg);
        appendSummary([`### Skip: ${repo}`, "", msg]);
        return { status: "skipped", reason: "would_downgrade", currentVersion, defaultBranch };
      }
      const msg = `Noop ${repo}: ${packageName} already at ${version}`;
      notice(msg);
      appendSummary([`### Noop: ${repo}`, "", msg]);
      return { status: "noop", currentVersion, defaultBranch };
    }

    if (dryRun) {
      notice(`Dry run: would bump ${packageName} ${currentVersion} → ${version} on ${defaultBranch}`);
      appendSummary([
        `### Dry run: ${repo}`,
        "",
        `- Package: \`${packageName}\``,
        `- ${currentVersion ?? "(none)"} → \`${version}\``,
      ]);
      return { status: "dry_run", currentVersion, version, defaultBranch };
    }

    fs.writeFileSync(pkgPath, content);

    // 刷新 package-lock（GitHub Packages 需 token；无 token 时降级为只提交 package.json）
    const lockPath = path.join(tmp, "package-lock.json");
    let lockUpdated = false;
    if (fs.existsSync(lockPath) && npmToken) {
      fs.writeFileSync(path.join(tmp, ".npmrc"), buildNpmrcContent());
      const r = spawnSync(
        "npm",
        ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
        {
          cwd: tmp,
          encoding: "utf8",
          env: { ...process.env, NODE_AUTH_TOKEN: npmToken },
        },
      );
      if (r.status === 0) {
        lockUpdated = true;
      } else {
        warning(
          redactSecrets(
            `package-lock refresh failed (${r.status}); committing package.json only: ${(r.stderr || "").slice(-200)}`,
            gitSecrets,
          ),
        );
      }
    }

    run("git", ["-C", tmp, "config", "user.name", "github-actions[bot]"]);
    run("git", ["-C", tmp, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    run("git", ["-C", tmp, "checkout", "-B", headBranch]);
    run("git", ["-C", tmp, "add", "-A", "package.json", "package-lock.json"]);

    const prTitle = `${PR_TITLE_PREFIX}${packageName} to v${version}`;
    const existingPrs = JSON.parse(
      gh([
        "pr",
        "list",
        "--repo",
        repo,
        "--base",
        defaultBranch,
        "--head",
        headBranch,
        "--state",
        "open",
        "--json",
        "number,title",
      ]),
    );
    const existing = existingPrs.find((/** @type {{ title: string }} */ p) => p.title === prTitle);

    const commitMsg = existing
      ? `${prTitle} (force-update)`
      : prTitle;
    run("git", ["-C", tmp, "commit", "--allow-empty", "-m", commitMsg]);

    const pushUrl = buildAuthenticatedRepoUrl(repo, ghToken);
    run("git", ["-C", tmp, "push", "--force-with-lease", pushUrl, `${headBranch}:${headBranch}`], {
      secretsToRedact: gitSecrets,
    });

    const prBody = [
      `<!-- consumer-sdk-bump bot -->`,
      ``,
      `## SDK bump`,
      ``,
      `- Package: \`${packageName}\``,
      `- Version: \`${currentVersion ?? "(none)"}\` → \`${version}\``,
      `- Lock 刷新: ${lockUpdated ? "yes" : "no（token 缺失或失败，仅 package.json）"}`,
      ``,
      `由 SDK 发布 fan-out（deploy-tracker → worker-actions）自动创建；`,
      `合并后 CF Builds 会自动重建本仓。`,
      ``,
    ].join("\n");

    let prNumber;
    if (existing) {
      prNumber = existing.number;
      gh(["pr", "edit", prNumber.toString(), "--repo", repo, "--body", prBody]);
      notice(`Updated existing bump PR #${prNumber} on ${repo} → ${version}`);
    } else {
      const created = gh([
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
      notice(`Opened SDK bump PR on ${repo}: ${created}`);
      const list = JSON.parse(
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
      prNumber = Number(list);
    }

    appendSummary([
      `### ${repo}`,
      "",
      `- Package: \`${packageName}\``,
      `- ${currentVersion ?? "(none)"} → \`${version}\``,
      `- PR: #${prNumber}`,
      `- Lock: ${lockUpdated ? "updated" : "not updated"}`,
    ]);

    return {
      status: "opened_or_updated",
      prNumber,
      currentVersion,
      version,
      lockUpdated,
      defaultBranch,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const repo = process.env.CONSUMER_REPO;
  const packageName = process.env.SDK_PACKAGE;
  const version = process.env.SDK_VERSION;
  const dryRun = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";

  if (!repo || !packageName || !version) {
    console.error("CONSUMER_REPO / SDK_PACKAGE / SDK_VERSION env required");
    process.exit(1);
  }

  const result = await bumpSdkConsumerRepo(repo, packageName, version, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
