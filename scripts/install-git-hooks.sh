#!/usr/bin/env bash
# 将 workers-world/worker-actions 的共享 git hooks 安装到当前仓库或全局。
#
# 用法（在任意 Worker 仓根目录）：
#   bash ../workers-world-dot-github/scripts/install-git-hooks.sh
#   bash ../workers-world-dot-github/scripts/install-git-hooks.sh --global
#
# 跳过单次 commit：WORKERS_SKIP_PRE_COMMIT=1 git commit ...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "${SCRIPT_DIR}/../tools/git-hooks" && pwd)"
HOOK_SRC="${HOOKS_DIR}/pre-commit"

if [[ ! -f "${HOOK_SRC}" ]]; then
    echo "error: missing ${HOOK_SRC}" >&2
    exit 1
fi

chmod +x "${HOOK_SRC}"

MODE="${1:-}"

if [[ "${MODE}" == "--global" ]]; then
    git config --global core.hooksPath "${HOOKS_DIR}"
    echo "已设置全局 core.hooksPath=${HOOKS_DIR}"
    echo "所有 git 仓库 commit 时都会执行 pre-commit（非 Worker 仓会自动跳过）。"
    exit 0
fi

if [[ -n "${MODE}" && "${MODE}" != "--repo" ]]; then
    echo "usage: $0 [--global|--repo]" >&2
    exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "error: 请在 git 仓库内运行，或使用 --global" >&2
    exit 1
}

HOOK_DST="${REPO_ROOT}/.git/hooks/pre-commit"
mkdir -p "$(dirname "${HOOK_DST}")"
ln -sf "${HOOK_SRC}" "${HOOK_DST}"
chmod +x "${HOOK_DST}"

echo "已安装 pre-commit → ${HOOK_DST}"
echo "源：${HOOK_SRC}"
