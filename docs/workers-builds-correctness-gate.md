# Workers Builds 正确性门禁（#221 Round 7–16）

Release PR 路径上，**GHA `worker-verify` 仍跑 `npm run check` ∥ `npm test`**（**R13** 回滚 R12）；Cloudflare Workers Builds preview build command 与 **`builds-correctness-gate`** 仍为 Release PR 双保险。**`npm ci` 与 node_modules cache 仍在 GHA 硬门禁**（#221 R9 回滚 R8）。GHA 仍保留 **sync-lock heal** 与 gate（fail-closed，首轮立即查询；**R16** 主路径 **Cloudflare Builds API**，回退 GitHub Check；自适应 **2s→5s→10s→cap 20s**）。

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
     # Worker external_script_id（Dashboard / Builds API，非 Worker 显示名）：
     # builds_worker_tag: "dd7160bb9cef458093557736f4b9e75b"
     # monorepo / 多 Worker 时与 PR Checks 名一致（GitHub 回退路径）：
     # builds_check_context: "Cloudflare Workers and Pages: your-script-name"
   secrets: inherit   # 或显式映射 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID（见下）
   ```

3. **GitHub Secrets（R16 CF API 主路径，推荐）**

   | Secret | 用途 |
   |--------|------|
   | `CLOUDFLARE_API_TOKEN` | Bearer token；权限至少 **Workers CI Read**（`Workers CI Write` 亦可） |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

   与 `worker-ci` input **`builds_worker_tag`**（Worker **`external_script_id`**）一并传入 composite action。Gate 轮询：

   `GET /accounts/{account_id}/builds/workers/{external_script_id}/builds`

   在结果中匹配 `build_trigger_metadata.commit_hash` 与 PR **head SHA**；`status=stopped` 且 `build_outcome=success` 即通过。未配置上述三项、API 暂态失败或空鉴权时，**回退**轮询 GitHub App check（`cloudflare-workers-and-pages`），行为与 R11 相同（2s→5s→10s→cap 20s，首轮立即查询）。

4. **Branch protection（推荐 fail-closed）**  
   在 `master` 上除 GHA `verify` 外，将 **Cloudflare Workers Builds** 对应 GitHub Check 设为 required（名称见 PR → Checks）。  
   `worker-ci` 的 **`builds-correctness-gate`** job 与 branch protection 双保险；**auto-merge 在 verify + builds-gate + qodana（若启用）均 success 后**才执行。

## GHA 仍做什么

| 步骤 | Release PR（`correctness_on_builds: true`） |
|------|---------------------------------------------|
| sync-lock heal + lock 门禁 | ✓ |
| verify setup-node / 物化 SDK / `npm ci` | ✓（#221 R9 回滚 R8；GHA 硬门禁） |
| verify node_modules cache restore/save | ✓（#221 R6；**R13** 回滚 R12 跳过） |
| verify check∥test | ✓（**R13** 回滚 R12；Builds 仍并行） |
| builds-correctness-gate | ✓（**R16**：CF Builds API 主路径 + GitHub 回退；2s 起自适应 poll） |

## 试点仓差异

| 仓 | verify runner | gate runner | 备注 |
|----|---------------|-------------|------|
| **mok1**（公开） | verify：`ubuntu-latest` | `builds-correctness-gate`：`ubuntu-latest` | 配 CF preview + build command + `CLOUDFLARE_*` + `builds_worker_tag` |
| **sch1**（私有自托管） | verify：`GHA_RUNNER` | gate 仍托管（CF/GitHub API 轮询） | 同上；若无法用 UI 设 required check，依赖 **`builds-correctness-gate` fail-closed** 挡 merge |

## Required checks 尚未可配时

部分试点仓尚未在 GitHub 上创建「required checks」规则对象：**仍须**开启 `correctness_on_builds: true`，由 `builds-correctness-gate` 在 auto-merge 前断言 Builds 绿或缺失 → job 失败 → **不 merge**。待规则可配时，再把同名 Check 设为 required 以对齐人工 merge 路径。

## 验收

- Build command 故意失败 → PR Checks 红 + `builds-correctness-gate` 失败 → **无** auto-merge。
- Build 绿 + verify 绿 → auto-merge 可继续（其它 job 亦须 success）。

## 相关文件

- [.github/workflows/worker-ci.yml](../.github/workflows/worker-ci.yml) — `builds-correctness-gate` job
- [.github/workflows/worker-verify.yml](../.github/workflows/worker-verify.yml) — `correctness_on_builds` 仍跑 GHA check∥test 与 node_modules cache（R13 回滚 R12）
- [.github/actions/builds-correctness-gate/](../.github/actions/builds-correctness-gate/) — CF Builds API + GitHub Check 回退

Issue：[workers-world/worker-actions#221](https://github.com/workers-world/worker-actions/issues/221)（Round 16：CF Builds API 主路径）。
