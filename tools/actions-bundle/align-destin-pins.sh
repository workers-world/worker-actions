#!/usr/bin/env bash
# Align destin (default dev_*) nested @actions/v* pins to latest published tag when behind workflow-lint rules.
# WW-303 / worker-actions#144
set -euo pipefail

REPO="${REPO:?REPO required}"
DESTIN_BRANCH="${DESTIN_BRANCH:?DESTIN_BRANCH required}"
DRY_RUN="${DRY_RUN:-false}"
WORKFLOW_PUSH_GH_TOKEN="${WORKFLOW_PUSH_GH_TOKEN:-}"
ALIGN_BRANCH="${ALIGN_BRANCH:-chore/destin-align-nested-pins}"
ISSUE_REF="${ISSUE_REF:-workers-world/worker-actions#144 · Linear WW-303}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=tools/actions-bundle/nested-pins-lib.sh
source "${ROOT}/tools/actions-bundle/nested-pins-lib.sh"

cd "$ROOT"

git fetch origin "$DESTIN_BRANCH" --tags

latest="$(latest_actions_tag)"
if [ -z "$latest" ]; then
  echo "No actions/v* tags; nothing to align"
  exit 0
fi

WT="$(mktemp -d)"
cleanup() {
  git worktree remove -f "$WT" 2>/dev/null || rm -rf "$WT"
}
trap cleanup EXIT

git worktree add -f "$WT" "origin/${DESTIN_BRANCH}"
cd "$WT"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if destin_pins_lint_aligned "$latest"; then
  echo "Destin ${DESTIN_BRANCH} inner pins already satisfy workflow-lint; no-op"
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

COMMIT_MSG="chore: align destin nested pins to ${latest} (WW-303)"
git commit -m "$COMMIT_MSG"

if [ "$DRY_RUN" = "true" ]; then
  echo "dry_run: would push ${ALIGN_BRANCH} and open PR → ${DESTIN_BRANCH}"
  git diff "origin/${DESTIN_BRANCH}"..HEAD --stat
  exit 0
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
existing="$(gh pr list --repo "$REPO" --head "$ALIGN_BRANCH" --base "$DESTIN_BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -n "$existing" ]; then
  echo "Updated existing align PR #${existing} (${ALIGN_BRANCH} → ${DESTIN_BRANCH})"
else
  gh pr create --repo "$REPO" \
    --base "$DESTIN_BRANCH" \
    --head "$ALIGN_BRANCH" \
    --title "chore: align destin nested pins to ${latest} (WW-303)" \
    --body "$(cat <<EOF
## Destin nested pin auto-align

- **Target tag**: \`${latest}\`（与 workflow-lint 要求的「最新已发布 tag」一致）
- **Base branch**: \`${DESTIN_BRANCH}\`（destin；**不会**自动合入 \`master\`）
- **Tracking**: ${ISSUE_REF}

本 PR 由 [\`worker-destin-pin-align.yml\`](../blob/${DESTIN_BRANCH}/.github/workflows/worker-destin-pin-align.yml) 在检测到 destin 内层 \`@actions/v*\` 落后于最新 tag 时自动开/更新。

### 范围

与 \`release-actions-bundle\` Phase A 相同：

- \`.github/workflows\`、\`.github/actions\`、\`templates\`、\`docs/templates\`
- \`manifest/actions-bundle.yaml\`（\`current\` / \`sha\` 与目标 tag 对齐）

### 验证

- 合入后 \`workflow-lint\` 内层 pin 检查应通过。
- 手动：Actions → **Destin actions pin align** → \`dry_run: true\` 查看是否 would-change。
EOF
)"
  echo "Opened destin align PR (${ALIGN_BRANCH} → ${DESTIN_BRANCH})"
fi
