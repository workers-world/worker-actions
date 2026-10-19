#!/usr/bin/env bash
# Realign package-lock.json with package.json (destin pins). Same strategy as worker-sync-packages-lock.
set -euo pipefail

if ! grep -q 'framework_sdk_worker' package.json 2>/dev/null; then
  echo "package.json 无 framework_sdk_worker，跳过 lock 刷新"
  exit 0
fi

if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "::error::刷新 lock 需要 NODE_AUTH_TOKEN（GHA_TOKEN / read:packages）"
  exit 1
fi

action_root="${1:?action_path required}"
lock_check_script="${action_root}/../package-lock-in-sync/lock-matches-package-json.mjs"
legacy_script="${action_root}/../package-lock-in-sync/npm-ci-legacy-peer-deps.mjs"

export LOCK_CHECK_SKIP_DRY_RUN=1
if node "$lock_check_script"; then
  echo "lock 已与 package.json 同步，无需刷新"
  exit 0
fi
code=$?
if [ "$code" -eq 2 ]; then
  echo "无 Node lock 门禁，跳过"
  exit 0
fi

WANT_VER="$(node -e '
  const s = require("./package.json").dependencies?.framework_sdk_worker || "";
  const m = String(s).match(/@([0-9]+\.[0-9]+\.[0-9]+)/);
  if (!m) {
    console.error("package.json 中 framework_sdk_worker 须为 npm:@workers-world/framework_sdk_worker@X.Y.Z");
    process.exit(1);
  }
  process.stdout.write(m[1]);
')"

lock_matches_version() {
  [[ -f package-lock.json ]] \
    && grep -q 'npm.pkg.github.com' package-lock.json \
    && ! grep -q '"\.\./framework_sdk_worker"' package-lock.json \
    && grep -q "framework_sdk_worker/${WANT_VER}/" package-lock.json
}

root_deps_in_sync() {
  [[ -f package-lock.json ]] || return 1
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    const root = lock.packages?.[""] || {};
    function same(a, b) {
      const aa = a || {};
      const bb = b || {};
      const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
      for (const k of keys) {
        if (String(aa[k] ?? "") !== String(bb[k] ?? "")) process.exit(1);
      }
    }
    same(pkg.dependencies, root.dependencies);
    same(pkg.devDependencies, root.devDependencies);
  '
}

if [[ ! -f .npmrc ]] || ! grep -q 'npm.pkg.github.com' .npmrc; then
  {
    echo '@workers-world:registry=https://npm.pkg.github.com'
    echo '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
  } >> .npmrc
fi
rm -rf node_modules/framework_sdk_worker
if [[ -f package-lock.json ]] && grep -q '"\.\./framework_sdk_worker"' package-lock.json; then
  echo "移除 file: link 残留 lock，重新生成"
  rm -f package-lock.json
fi
NPM_COMMON_ARGS=(--no-fund --no-audit)
legacy_peer_deps="$(node "$legacy_script")"
if [ "$legacy_peer_deps" = "true" ]; then
  NPM_COMMON_ARGS+=(--legacy-peer-deps)
  echo "caller 启用 legacy-peer-deps，npm install 将带上 --legacy-peer-deps"
fi
echo "按 destin package.json 全量刷新 lock → framework_sdk_worker@${WANT_VER}"
npm install "${NPM_COMMON_ARGS[@]}"
rm -rf node_modules
if ! lock_matches_version; then
  echo "::error::package-lock 未解析到 @workers-world/framework_sdk_worker@${WANT_VER}。"
  exit 1
fi
if ! root_deps_in_sync; then
  echo "::error::刷新后 package-lock 根依赖仍与 package.json 不一致。"
  exit 1
fi

git add package-lock.json .npmrc 2>/dev/null || git add package-lock.json
if ! git diff --cached --quiet; then
  git commit -m "chore: realign package-lock after master merge (destin pins)"
fi
