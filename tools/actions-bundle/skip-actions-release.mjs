import { pathToFileURL } from "node:url";

/**
 * Decide whether release-actions-bundle should skip tagging for a push to master.
 *
 * Gate must NOT scan the full commit body: squash-merge bodies often embed
 * historical `[skip actions-release]` lines from prior backfill commits, which
 * would incorrectly suppress a real release (see docs/actions-releases.md).
 *
 * Cases that DO skip:
 * - Squash subject (line 1) contains `[skip actions-release]`
 * - Merge commit: line 1 is `Merge pull request #N …` and the first non-empty
 *   body line (PR title) contains `[skip actions-release]`
 *   (#294: merge of backfill #287 only put the token on the PR-title line)
 *
 * @param {string} message github.event.head_commit.message
 * @returns {boolean}
 */
export function shouldSkipActionsRelease(message) {
  const text = String(message ?? "");
  const lines = text.split(/\r?\n/);
  const subject = lines[0] ?? "";
  if (subject.includes("[skip actions-release]")) {
    return true;
  }
  if (/^Merge pull request #\d+\b/.test(subject)) {
    const title = lines.slice(1).find((line) => line.trim() !== "");
    if (title?.includes("[skip actions-release]")) {
      return true;
    }
  }
  return false;
}

/**
 * CLI for the gate job.
 * - Reads commit message from env MSG
 * - Writes proceed=true|false to GITHUB_OUTPUT when set
 * - Exit 0 = skip tagging; exit 1 = proceed with tag job
 */
async function cli() {
  const fs = await import("node:fs");
  const skip = shouldSkipActionsRelease(process.env.MSG ?? "");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `proceed=${skip ? "false" : "true"}\n`,
    );
  }
  if (skip) {
    console.log(
      "Skip release: squash subject or merge-commit PR title contains [skip actions-release]",
    );
    process.exit(0);
  }
  console.log("Proceed with release-actions-bundle tag job");
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await cli();
}
