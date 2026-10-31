# Workers Builds 正确性门禁（#221 Round 7–8）

Release PR 路径上，把 **`npm run check` ∥ `npm test`** 从 GHA `worker-verify` 迁到 **Cloudflare Workers Builds preview** build command，缩短 GHA verify 墙钟；**`npm ci` 仍在 GHA 硬门禁**（#221 R9 回滚 R8）。GHA 仍保留 **sync-lock heal** 与 **`builds-correctness-gate`**（fail-closed，默认 **20s** 轮询、首轮立即查询；R10 回滚 R9 的 5s）。

## 启用方式（业务仓）

1. **Cloudflare Dashboard** → Worker 项目 → **Settings → Build**：
   - **Production branch**：`master`（不变）
   - **Preview builds**：**启用**（非 production 分支 / PR 触发 preview）
   - **Build command**：在 Workers Builds 自动 `npm ci` 之后执行正确性脚本。Builds 默认 shell 为 `/bin/sh`，并行 + `pipefail` 须包在 `bash -lc` 内，例如 mok1（Biome+tsc / Vitest 分离时）：

     ```bash
     bash -lc 'set -uo pipefail; ec=0; npm run check & p1=$!; npm test & p2=$!; wait "$p1" || ec=1; wait "$p2" || ec=1; exit "$ec"'
     ```

     若 `package.json` 的 `check` 已等同 `test`，可仅 `npm run check`（同样建议 `bash -lc 'set -euo pipefail; npm run check'`）。

   - **Preview command**：保持 `npx wrangler preview`（或项目既有 preview 命令）；Build 红则 check run 失败，**不得** auto-merge。

2. **GitHub `ci.yml`**（见 [templates/ci-release-pr.yml](../templates/ci-release-pr.yml)）：

   ```yaml
   with:
     correctness_on_builds: true
     # monorepo / 多 Worker 时与 PR Checks 名一致：
     # builds_check_context: "Cloudflare Workers and Pages: your-script-name"
   ```

3. **Branch protection（推荐 fail-closed）**  
   在 `master` 上除 GHA `verify` 外，将 **Cloudflare Workers Builds** 对应 GitHub Check 设为 required（名称见 PR → Checks）。  
   `worker-ci` 的 **`builds-correctness-gate`** job 会轮询同一 commit 上的 CF App check（`cloudflare-workers-and-pages`；**20s** 间隔，首轮不 sleep），与 branch protection 双保险；**auto-merge 在 verify + builds-gate + qodana（若启用）均 success 后**才执行。

## GHA 仍做什么

| 步骤 | Release PR（`correctness_on_builds: true`） |
|------|---------------------------------------------|
| sync-lock heal + lock 门禁 | ✓ |
| verify setup-node / 物化 SDK / `npm ci` | ✓（#221 R9 回滚 R8；GHA 硬门禁） |
| verify check∥test | ✗（#221 R7；Builds build command） |
| builds-correctness-gate | ✓（R10：20s poll；R9 曾试 5s 已回滚） |

## 试点仓差异

| 仓 | verify runner | gate runner | 备注 |
|----|---------------|-------------|------|
| **mok1**（公开） | verify：`ubuntu-latest` | `builds-correctness-gate`：`ubuntu-latest` | 须在 CF 配好 preview + build command；公开仓可用 GitHub **required checks** API |
| **sch1**（私有自托管） | verify：`GHA_RUNNER` | gate 仍托管（仅 API 轮询） | 同样须在 CF 配 preview；若无法用 UI 设 required check，依赖 **`builds-correctness-gate` fail-closed** 挡 merge |

## Required checks 尚未可配时

部分试点仓尚未在 GitHub 上创建「required checks」规则对象：**仍须**开启 `correctness_on_builds: true`，由 `builds-correctness-gate` 在 auto-merge 前断言 CF check 已 success；Build 红或缺失 → job 失败 → **不 merge**。待规则可配时，再把同名 Check 设为 required 以对齐人工 merge 路径。

## 验收

- Build command 故意失败 → PR Checks 红 + `builds-correctness-gate` 失败 → **无** auto-merge。
- Build 绿 + verify 绿 → auto-merge 可继续（其它 job 亦须 success）。

## 相关文件

- [.github/workflows/worker-ci.yml](../.github/workflows/worker-ci.yml) — `builds-correctness-gate` job
- [.github/workflows/worker-verify.yml](../.github/workflows/worker-verify.yml) — `correctness_on_builds` 跳过 GHA check∥test（仍跑 npm ci）
- [.github/actions/builds-correctness-gate/](../.github/actions/builds-correctness-gate/) — GitHub Check 轮询

Issue：[workers-world/worker-actions#221](https://github.com/workers-world/worker-actions/issues/221)（Round 7：`check∥test` → Builds；Round 8：GHA `npm ci` → Builds **已回滚**；Round 9：gate poll 5s + 回滚 R8；Round 10：gate poll 回滚 20s + sync-lock 合并 lock 校验）。
