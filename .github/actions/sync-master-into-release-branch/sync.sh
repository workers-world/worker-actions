#!/usr/bin/env bash
set -euo pipefail

ACTION_DIR="${1:?action dir}"
RELEASE_BRANCH="${RELEASE_BRANCH:?}"
MASTER_BRANCH="${MASTER_BRANCH:?}"
REPO="${REPO:?}"

if ! [[ "$RELEASE_BRANCH" =~ ^dev_[0-9]+_[0-9]+_[0-9]+$ ]]; then
  echo "Skip sync: release_branch must be pure destin dev_X_Y_Z (numeric segments only)"
  echo "skipped=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

git fetch origin "$MASTER_BRANCH" "$RELEASE_BRANCH"
behind_by="$(gh api "repos/${REPO}/compare/${MASTER_BRANCH}...${RELEASE_BRANCH}" --jq '.behind_by')"
if [ "${behind_by}" = "0" ]; then
  echo "Skip sync: ${RELEASE_BRANCH} already contains ${MASTER_BRANCH}"
  echo "skipped=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout "$RELEASE_BRANCH"
git pull --ff-only origin "$RELEASE_BRANCH"
behind_by="$(gh api "repos/${REPO}/compare/${MASTER_BRANCH}...${RELEASE_BRANCH}" --jq '.behind_by')"
if [ "${behind_by}" = "0" ]; then
  echo "Skip sync: ${RELEASE_BRANCH} already contains ${MASTER_BRANCH} (after fetch)"
  echo "skipped=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

merge_msg="chore: merge ${MASTER_BRANCH} into ${RELEASE_BRANCH} before release PR"
auto_resolved=false

if ! git merge "origin/${MASTER_BRANCH}" -m "$merge_msg"; then
  mapfile -t conflict_files < <(git diff --name-only --diff-filter=U | sort -u)
  allowlist="${ACTION_DIR}/allowlist.mjs"
  if ! node "$allowlist" --check "${conflict_files[@]}"; then
    git merge --abort
    conflict_list=""
    for f in "${conflict_files[@]}"; do
      [ -n "$f" ] || continue
      conflict_list="${conflict_list}"$'\n'"- \`${f}\`"
    done
    comment_body="$(cat <<EOF
## Release PR：无法自动 sync \`${MASTER_BRANCH}\` → \`${RELEASE_BRANCH}\`

\`worker-ensure-release-pr\` 在开 Release PR 前尝试将 \`${MASTER_BRANCH}\` 合并入当前 dev 分支，但存在冲突。

**仅 \`package.json\` / lockfile（package-lock、pnpm-lock、yarn.lock 等）冲突** 时会自动保留 **destin（dev）** 侧 pin 并完成 merge；**其它文件** 冲突须在本分支上人工 merge/rebase \`${MASTER_BRANCH}\` 并解决后 push：

${conflict_list}

解决并 push 后 CI 会重跑本步骤；合并干净后才会创建或继续维护 Release PR。
EOF
)"
    pr_num="$(gh pr list --repo "$REPO" --head "$RELEASE_BRANCH" --base "$MASTER_BRANCH" --state open --json number --jq '.[0].number // empty')"
    if [ -n "$pr_num" ]; then
      is_draft="$(gh pr view "$pr_num" --repo "$REPO" --json isDraft --jq '.isDraft')"
      if [ "$is_draft" != "true" ]; then
        gh pr ready "$pr_num" --undo --repo "$REPO"
      fi
      gh pr comment "$pr_num" --repo "$REPO" --body "$comment_body"
      echo "::error::无法将 ${MASTER_BRANCH} 合并入 ${RELEASE_BRANCH}（冲突文件：${conflict_files[*]:-unknown}）。已将 Release PR #${pr_num} 保持为 draft 并留言；未打开带冲突的 Release PR。"
    else
      echo "::error::无法将 ${MASTER_BRANCH} 合并入 ${RELEASE_BRANCH}（冲突文件：${conflict_files[*]:-unknown}）。无 open Release PR，本 job 失败且未创建 conflicted Release PR。"
    fi
    exit 1
  fi

  for f in "${conflict_files[@]}"; do
    [ -n "$f" ] || continue
    git checkout --ours -- "$f"
    git add "$f"
  done
  git commit --no-edit
  auto_resolved=true
  echo "::notice::package/lock-only merge conflicts auto-resolved keeping destin (${RELEASE_BRANCH}) pins: ${conflict_files[*]}"
fi

if [ "$auto_resolved" = "true" ]; then
  bash "${ACTION_DIR}/regenerate-lock-from-package-json.sh" "$ACTION_DIR"
fi

git push origin "$RELEASE_BRANCH"
echo "Synced ${MASTER_BRANCH} into ${RELEASE_BRANCH} (merge commit pushed)"
{
  echo "skipped=false"
  echo "auto_resolved_package_lock=${auto_resolved}"
} >> "$GITHUB_OUTPUT"
