# 本地 Git Hooks（Biome pre-commit）

CI 在 `worker-verify` 中执行 `npm run check`（Biome + `tsc`）。本地 pre-commit 在暂存区含 TS/JS 时先跑 **`npm run lint`**（与 CI 的 Biome 段一致），失败则拒绝 commit。

## 安装

在 Worker 仓根目录（与 `workers-world-dot-github` 同级 checkout 时）：

```bash
bash ../workers-world-dot-github/scripts/install-git-hooks.sh
```

对本机所有 git 仓库生效（非 Worker 仓无 `package.json` / Biome 时会自动跳过）：

```bash
bash /path/to/workers-world-dot-github/scripts/install-git-hooks.sh --global
```

## 跳过单次 commit

```bash
WORKERS_SKIP_PRE_COMMIT=1 git commit -m "..."
```

## 实现位置

- Hook：`tools/git-hooks/pre-commit`
- 安装脚本：`scripts/install-git-hooks.sh`

可选环境变量：`WORKERS_BIOME_VERSION`（默认 `2.5.1`，仅无 `npm run lint` 且存在 `biome.json` 时用于 `biome check --staged`）。
