#!/usr/bin/env bash
# Align dev (default dev_*) nested @actions/v* pins to latest published tag when behind workflow-lint rules.
# WW-303 / worker-actions#144
set -euo pipefail

REPO="${REPO:?REPO required}"
DEV_BRANCH="${DEV_BRANCH:?DEV_BRANCH required}"
DRY_RUN="${DRY_RUN:-false}"
WORKFLOW_PUSH_GH_TOKEN="${WORKFLOW_PUSH_GH_TOKEN:-}"
ALIGN_BRANCH="${ALIGN_BRANCH:-chore/dev-align-nested-pins}"
ISSUE_REF="${ISSUE_REF:-workers-world/worker-actions#144 · Linear WW-303}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=tools/actions-bundle/nested-pins-lib.sh
source "${ROOT}/tools/actions-bundle/nested-pins-lib.sh"

cd "$ROOT"

# --prune-tags：已删除的 ephemeral tag（如误打后删掉的 actions/v*）不得再被当作 latest（#293）
git fetch origin "$DEV_BRANCH" --tags --prune --prune-tags

latest="$(latest_actions_tag)"
if [ -z "$latest" ]; then
  echo "No actions/v* tags; nothing to align"
  exit 0
fi

# Only align to a tag that still exists on origin（#294：勿 pin 已删除/未发布 tag）
if ! remote_actions_tag_exists "$latest"; then
  echo "Latest candidate ${latest} is not on origin; refusing align"
  exit 0
fi

bundle_backfill_branch="$(bundle_backfill_branch_name "$latest")"
if [ -n "$WORKFLOW_PUSH_GH_TOKEN" ] && [ "$DRY_RUN" != "true" ]; then
  export GH_TOKEN="$WORKFLOW_PUSH_GH_TOKEN"
  open_bundle="$(gh pr list --repo "$REPO" --head "$bundle_backfill_branch" --base "$DEV_BRANCH" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)"
  if [ -n "$open_bundle" ]; then
    echo "Skip dev align: release-actions-bundle backfill PR #${open_bundle} already open (${bundle_backfill_branch} → ${DEV_BRANCH})"
    exit 0
  fi
fi

WT="$(mktemp -d)"
cleanup() {
  git worktree remove -f "$WT" 2>/dev/null || rm -rf "$WT"
}
trap cleanup EXIT

git worktree add -f "$WT" "origin/${DEV_BRANCH}"
cd "$WT"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if dev_pins_lint_aligned "$latest"; then
  echo "Dev ${DEV_BRANCH} inner pins already satisfy workflow-lint; no-op"
  exit 0
fi

echo "Aligning nested pins → ${latest}"
git checkout -B "$ALIGN_BRANCH"
rewrite_nested_pins "$latest" "${BUNDLE_PIN_GLOBS[@]}"
update_manifest_for_tag "$latest"

git add "${BUNDLE_PIN_GLOBS[@]}" manifest/actions-bundle.yaml 2>/dev/null || git add "${BUNDLE_PIN_GLOBS[@]}"
if git diff --cached --quiet; then
  echo "No file changes after rewrite; no-op"
  exit 0
fi

COMMIT_MSG="chore: align dev nested pins to ${latest} (WW-303)"
git commit -m "$COMMIT_MSG"

if [ "$DRY_RUN" = "true" ]; then
  echo "dry_run: would push ${ALIGN_BRANCH} and open PR → ${DEV_BRANCH}"
  git diff "origin/${DEV_BRANCH}"..HEAD --stat
  exit 0
fi

# Re-check immediately before push：tag 可能在 align 窗口内被删除（#294 事故链）
if ! remote_actions_tag_exists "$latest"; then
  echo "::error::Target tag ${latest} vanished from origin before push; refusing align PR"
  exit 1
fi

if [ -z "$WORKFLOW_PUSH_GH_TOKEN" ]; then
  echo "::error::Push requires release-bot App token (workflows:write) for .github/workflows changes."
  exit 1
fi

git -C "$ROOT" config --local --unset-all 'http.https://github.com/.extraheader' 2>/dev/null || true
include_if_keys="$(git -C "$ROOT" config --local --name-only -l 2>/dev/null | grep -i '^includeif\.gitdir' || true)"
while IFS= read -r key; do
  [ -n "$key" ] || continue
  git -C "$ROOT" config --local --unset-all "$key" 2>/dev/null || true
done <<< "${include_if_keys}"
git -C "$ROOT" config --local --unset-all credential.helper 2>/dev/null || true
git -C "$ROOT" remote set-url origin "https://x-access-token:${WORKFLOW_PUSH_GH_TOKEN}@github.com/${REPO}.git"

git push -u origin "${ALIGN_BRANCH}" --force-with-lease

export GH_TOKEN="$WORKFLOW_PUSH_GH_TOKEN"
existing="$(gh pr list --repo "$REPO" --head "$ALIGN_BRANCH" --base "$DEV_BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -n "$existing" ]; then
  echo "Updated existing align PR #${existing} (${ALIGN_BRANCH} → ${DEV_BRANCH})"
else
  gh pr create --repo "$REPO" \
    --base "$DEV_BRANCH" \
    --head "$ALIGN_BRANCH" \
    --title "chore: align dev nested pins to ${latest} (WW-303)" \
    --body "$(cat <<EOF
## Dev nested pin auto-align

- **Target tag**: \`${latest}\`（与 workflow-lint 要求的「最新已发布 tag」一致）
- **Base branch**: \`${DEV_BRANCH}\`（dev；**不会**自动合入 \`master\`）
- **Tracking**: ${ISSUE_REF}

本 PR 由 [\`worker-dev-pin-align.yml\`](../blob/${DEV_BRANCH}/.github/workflows/worker-dev-pin-align.yml) 在检测到 dev 内层 \`@actions/v*\` 落后于最新 tag 时自动开/更新。

### 范围

与 \`release-actions-bundle\` Phase A 相同：

- \`.github/workflows\`、\`.github/actions\`、\`templates\`、\`docs/templates\`
- \`manifest/actions-bundle.yaml\`（\`current\` / \`sha\` 与目标 tag 对齐）

若 \`release-actions-bundle\` 已开同 tag 的 \`chore/actions-bundle-*\` 回填 PR，本 workflow **不会**再开第二条对齐 PR。

### 验证

- 合入后 \`workflow-lint\` 内层 pin 检查应通过。
- 手动：Actions → **Dev actions pin align** → \`dry_run: true\` 查看是否 would-change。
EOF
)"
  echo "Opened dev align PR (${ALIGN_BRANCH} → ${DEV_BRANCH})"
fi
