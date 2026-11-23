#!/usr/bin/env bash
# Realign package-lock.json with package.json (destin pins). Same strategy as worker-sync-packages-lock.
set -euo pipefail

if [[ ! -f package.json ]]; then
  echo "无 package.json，跳过 lock 刷新"
  exit 0
fi

if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "::error::刷新 lock 需要 NODE_AUTH_TOKEN（GHA_TOKEN / read:packages）"
  exit 1
fi

action_root="${1:?action_path required}"
lock_check_script="${action_root}/../package-lock-in-sync/lock-matches-package-json.mjs"
refresh_script="${action_root}/../package-lock-in-sync/refresh-package-lock.mjs"

export LOCK_CHECK_SKIP_DRY_RUN=1
if node "$lock_check_script"; then
  echo "lock 已与 package.json 同步，无需刷新"
  exit 0
fi
code=$?
if [ "$code" -eq 2 ]; then
  echo "无 Node lock 门禁（无 package.json / 无 lock），跳过"
  exit 0
fi

node "$refresh_script"

git add package-lock.json .npmrc 2>/dev/null || git add package-lock.json
if ! git diff --cached --quiet; then
  git commit -m "chore: realign package-lock after master merge (destin pins)"
fi
