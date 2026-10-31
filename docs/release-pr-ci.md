# Release PR 发布模型（dev_* → master）

日常 push 到**纯 destin** 分支 `dev_X_Y_Z`（仅数字三段，正则 `^dev_[0-9]+_[0-9]+_[0-9]+$`），由 bot 维护 **ready** Release PR；门禁全绿后 **自动 merge** 到 `master`（触发 Cloudflare Builds）。带后缀的 `dev_*` 轨（如 `dev_00_17_00_pgreq251_verify`、`*_touch_id`）**不会**触发 `ensure-release-pr`，也不会走 Release→`master` 的 PR 门禁 / auto-merge。需要延后合入时可 **Convert to draft** 或 caller 传 `create_draft_release_pr: true`。

完整流程图（含 `worker-ci` job 依赖、leaf 步骤、全局调用关系）见 [actions-workflows.md](./actions-workflows.md)（尤其 §3 / §4）。

## 流程（`actions/v0.2.0+` 成本策略）

```mermaid
flowchart LR
  push[push dev_*] --> syncLock[sync-lock 非 bot]
  push --> ensure[ensure-release-pr ready]
  push --> syncWf[Sync default branch 若需]
  ensure --> releasePR[standing Release PR]
  releasePR --> prCi[PR: verify 门禁]
  releasePR --> gate[verify + 可选 qodana/AI review]
  gate -->|全绿| merge[auto-merge]
  merge --> master[master → CF Builds]
```

| 事件 | 运行的 job |
|------|------------|
| `push` → `dev_*`（非 bot） | `sync-lock`（若启用，任意 `dev_*` 前缀）；**纯 destin** push 另跑 `ensure-release-pr`（默认 **ready**）；**Sync default branch**（仅当默认分支 ≠ 当前 ref） |
| `push` → `dev_*`（`github-actions[bot]`） | **跳过** push 侧 job；lock 提交 **synchronize** Release PR 时会跑 **verify**（lock 已在 tip 同步） |
| `pull_request` → `master`（head=纯 destin `dev_X_Y_Z`，非 draft） | **verify**（唯一全量门禁）；可选 `workflow-lint`（`skip_workflow_lint: false`）；可选 qodana / AI review（非门禁）；**auto-merge**（门禁绿） |
| `pull_request`（仍 draft） | verify / lint / 可选扫描；**不** auto-merge（`require_non_draft_pr` 默认 true） |
| `ready_for_review` | 非 draft 后与上相同 + **auto-merge**（门禁绿） |

**不再**在每次 push 上跑 verify / workflow-lint / qodana / AI review（`verify_on_push: true` 可恢复旧快反馈）。

### Runner 调度（self-hosted）

Leaf workflow 的 `runs-on`：公开 caller 固定 `ubuntu-latest`；私有 caller 且 Org Variable **`GHA_RUNNER`** 非空则用该 label，否则 `ubuntu-latest`。

## Org 可复用 workflow

| Workflow | 作用 |
|----------|------|
| [worker-ci.yml](../.github/workflows/worker-ci.yml) | **业务仓 CI 门面**（唯一入口；`ci.yml` 只调这一次；内嵌下列 leaf） |
| [worker-ensure-release-pr.yml](../.github/workflows/worker-ensure-release-pr.yml) | push **纯 destin** 时创建 Release PR（`create_draft_release_pr` 默认 **false**，创建即 ready）；`worker-ci` 内 `pure-destin-gate` job 统一判定 `release_track` |

**开 PR 前的 master 同步（`worker-ensure-release-pr`）**：若 compare 显示当前 `dev_*` **已包含** `master`（`behind_by = 0`），跳过，不产生额外 commit/push，随后按原逻辑创建或复用 open Release PR。若 dev **落后** `master`，workflow 会先把 `master` merge 进 dev 并 push（经 bundle 内 `sync-master-into-release-branch` composite，**须**全路径 pin `@actions/v*`，勿 `uses: ./.github/actions/…`，见 [actions-releases.md](./actions-releases.md)）；merge **无冲突** 时继续开/维护 Release PR（push 触发的下一次 run 因已包含 master 而不再 merge，避免循环）。

merge **有冲突** 时：

- **仅** `package.json` / lockfile（`package-lock.json`、`npm-shrinkwrap.json`、`pnpm-lock.yaml`、`yarn.lock`，含子目录路径）冲突：自动 `git checkout --ours`（**destin / dev** 侧 pin）并完成 merge；若 lock 与 destin `package.json` 仍不一致，按与 **sync-lock** 相同的路径全量 `npm install` 刷新 lock（`legacy-peer-deps` 与 `package-lock-in-sync` 一致），再 push。workflow 输出 `::notice::` 说明已 auto-resolve。
- **任一** 其它路径冲突：**fail-closed**（`merge --abort`）；若已有 open Release PR 则转为 draft 并留言冲突文件（文案说明 package/lock-only 已自动处理）；否则 **fail job** 且 **不** 创建带冲突的 Release PR。
| [worker-release-auto-merge.yml](../.github/workflows/worker-release-auto-merge.yml) | 非 draft + 门禁通过后 merge PR |
| [ai-pr-review.yml](../.github/workflows/ai-pr-review.yml) | 自建 AI PR review；`skip_ai_review: true` 时门面 **不调用**；**非 merge 门禁** |
| [worker-notify-release-pr-blocked.yml](../.github/workflows/worker-notify-release-pr-blocked.yml) | 未能 auto-merge 时邮件通知（仅非 draft） |
| [worker-sync-default-dev-branch.yml](../.github/workflows/worker-sync-default-dev-branch.yml) | push 最高 `dev_*` 时将 GitHub 默认分支设为该 dev |

legacy：[worker-promote.yml](../.github/workflows/worker-promote.yml) / [worker-promote-gated.yml](../.github/workflows/worker-promote-gated.yml) — **已改为开 Release PR + `gh pr merge`**（禁止直推 master）；日常业务仓仍应走 `worker-ci`，勿再单独挂 promote。

## 默认分支策略（主分支 = 开发中）

各 **Worker 业务仓** GitHub **Default branch** = 数值最高的 `dev_XX_YY_ZZ`（纯数字三段，不含 `dev_00_02_00_touch_id` 等后缀轨）。`master` 仍为 Release PR base 与 CF Builds 发布轨，**不必**是默认分支。

| 分支 | 角色 | 是否默认 |
|------|------|----------|
| 最高 `dev_*` | 日常开发、clone 展示 | **是** |
| `master` | Release PR base、CF Builds | 否 |
| `workers-world/worker-actions` | 可复用 workflow 源 | **保持 `master` 默认** |

`sync-default-branch` 使用 **独立 workflow** [templates/sync-default-branch.yml](../templates/sync-default-branch.yml)，与 `ci.yml` 无 `needs` 依赖。caller 在 **默认分支已是当前 `dev_*`** 或 **lock-bot push** 时 **不起 runner**。

## 前置条件（必配）

### 1. Org Secret `GHA_TOKEN`

创建/merge Release PR **不能**依赖默认 `GITHUB_TOKEN`（多数 Org 开启「禁止 Actions 创建/批准 PR」）。

| 项 | 要求 |
|----|------|
| 类型 | classic PAT |
| 权限 | `repo`（含 PR 读写）+ `read:packages`（npm 拉 SDK） |
| 配置位置 | GitHub Org **workers-world** → Secrets → `GHA_TOKEN` |
| Caller | `secrets: inherit`（推荐），或显式映射 `worker-ci` 的 `workflow_call.secrets` 全集（zizmor `secrets-inherit` / medium）；**勿**向未声明的 secret 名传值。公开仓须 pin **`@actions/v0.2.12`**（合 master 发 tag 后），否则 Org `GHA_RUNNER` 仍可能经旧嵌套 pin 落到 self-hosted；`actions/v0.2.7` 曾缺 `workflow_call.secrets`，`v0.2.8+` 已恢复 |

> 旧名 `GH_DEPS_TOKEN` 已废弃；Org 中请改名或新建同名 Secret（PAT 值不变）。

与 [worker-verify 403 排查](../README.md) 用的是**同一个** Secret。

### 2. Org：阻断邮件（`NOTIFY_*`）

`notify-blocked` 经 `action-notify-email` 调通知 HTTP API（可选）。**仅非 draft PR** 发信。caller job 须授予 **只读** 权限以拉取 Annotations：

```yaml
permissions:
  actions: read
  checks: read
  contents: read
  pull-requests: read
```

`notify-blocked` 发信前会查询 PR 是否仍为 open（已 merged/closed 则跳过「需人工」邮件）。

Org 须已配置：

| 名称 | 类型 | 用途 |
|------|------|------|
| `NOTIFY_WORKER_URL` | Org **Variable** | notify-worker 公网根 URL（非密钥） |
| `NOTIFY_GHA_TOKEN` | Org **Secret** | 与 notify-worker `NOTIFY_GHA_TOKEN` wrangler secret **同值** |

### 3. （可选）仓库 Actions 设置

若坚持用 `GITHUB_TOKEN` 而非 PAT，须在**各业务仓**：

**Settings → Actions → General → Workflow permissions** → 勾选 **Allow GitHub Actions to create and approve pull requests**

**推荐始终使用 `GHA_TOKEN`**。

## 业务仓 `ci.yml` 模板（薄 caller）

见 [templates/ci-release-pr.yml](../templates/ci-release-pr.yml)。业务仓 **只** `uses: worker-ci.yml@actions/vX.Y.Z`（当前见 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml)），**禁止** `@master`。

要点：

1. `pull_request.branches: [master]`；建议 `paths-ignore: ["**/*.md", "docs/**"]`；`concurrency` 取消旧 run
2. 单一 job `release-pr`：permissions 取并集，`secrets: inherit`
3. `with` 只传仓间差异；默认 `promote: false`、`create_draft_release_pr: false`、`verify_on_push: false`、`skip_workflow_lint: true`、`skip_ai_review: true`；**Round 7 模板默认 `correctness_on_builds: true`**（须配 Cloudflare Builds preview，见 [workers-builds-correctness-gate.md](./workers-builds-correctness-gate.md)）
4. 另复制 [templates/sync-default-branch.yml](../templates/sync-default-branch.yml) 为独立 workflow
5. 门禁全绿后 auto-merge → Builds；需 draft 闸门时传 `create_draft_release_pr: true` 或手动 Convert to draft

**Secret 传递**：入口层 `secrets: inherit`（推荐），或显式映射 `worker-ci` `workflow_call.secrets` 全集；`worker-ci` 内部对每个 leaf **显式映射最小集**。

**package-lock 与 sync-lock（WW-171 / PGREQ20261010000003；Release 竞态 #132 / PGREQ20261016000008）**：

- **PR 硬门禁**（feature→`dev_*` 与 Release→`master`）：sync-lock **浅层** lock 对齐 + heal；**干净 `npm ci`** 仅在 verify job（#221 R4 Axis C 删 sync-lock 内重复 dry-run）。heal 后仍浅层不同步 → **fail**；装不上由 verify `npm ci` 硬拦，不得 auto-merge / 合入。
- **Bump 契约（#132）**：提交 **可以只改 `package.json`**（含 SDK 版本）；**不要**求开发者在本地 `npm install` 或同 commit 附带 `package-lock.json`（本地网络常无法读 GitHub Packages）。lock 由 CI **`sync-lock`**（`GHA_TOKEN` / Packages 鉴权）刷新并 bot push。
- **同仓 `pull_request`**：verify 内 **sync-lock heal**（与 push `dev_*` 相同逻辑），再 verify `npm ci` 硬门禁。
- **push `dev_*`**：`sync_packages_lock: true` 时 bot 可按 `package.json` 做 `npm install` 刷新 lock 并提交，**不在 push 上强制干净 `npm ci`**（自托管/网络）；Cloudflare Builds 级校验留在 PR。
- **ensure-release-pr**：`worker-ci` 在 push 上 **等待** `verify`（含 sync-lock）成功后再开/维护 Release PR。verify 成功时 caller 传 `skip_lock_precheck: true`，省略 ensure 内第二次 `package-lock-in-sync`（#221 Round 3 Axis B）。**Preflight**（同 job）：若 `ahead_by=0` 且已包含 `master`（空 Release），或已有 open Release PR 且 `behind_by=0`，则 API-only 短路，跳过 checkout / sync-master（#221 Round 3 Axis D）。
- **Node**：verify / sync-lock / lock 校验路径在 workflow **代码里写死 `node-version: "24"`**（与 CF Builds 默认大版本对齐；不用 Org/repo Actions variable，不做 Node matrix）。
- bot lock push 仍会 synchronize PR 并重跑 verify；bot push **不**跑 push 侧 lint/ensure/sync-default。

**Transient runner / checkout 重试（#132）**：`checkout-with-transient-retry` composite 对 `actions/checkout` **失败时自动再试一次**（常见于 self-hosted *lost communication*、GnuTLS/网络 flake）。用于 verify / sync-lock / ensure-release-pr / workflow-lint / qodana 等 job；**不**放宽 verify `npm ci` 或测试失败。Bundle 源码内用 `$/` 同仓引用；业务仓 pin 新 tag 后可用 `workers-world/worker-actions/.github/actions/checkout-with-transient-retry@actions/vX.Y.Z`（由 `release-actions-bundle` 与 nested pin 对齐）。

## 成本与空转 job（`v0.2.0`）

| Job | 何时启动 |
|-----|----------|
| workflow-lint | `skip_workflow_lint: false` **且** Release PR（非 bot）；默认 **skipped**（#221 Axis A） |
| verify（npm ci + check∥test） | 仅 PR（或 `verify_on_push: true`）；`correctness_on_builds: true` 时 GHA **仍跑 npm ci** 与 **check∥test**；**R17** 跳过 hosted deps cache（**R13** 回滚 R12 check∥test 跳过）；Builds + gate 仍为 Release PR 双保险 |
| builds-correctness-gate | `correctness_on_builds: true` **且** Release PR → master |
| sync-lock | push `dev_*` + 非 bot；同仓 PR 上 pull_request heal（bump 可不含 lock） |
| ensure-release-pr | push + 非 bot + **纯 destin** `dev_X_Y_Z`；**在 sync-lock 完成后**；空 Release / 已有 PR 时 preflight 短路（#221 R3） |
| qodana | Org `QODANA_ENABLED` / `WORKERS_WORLD_QODANA_ENABLED` 为 true **且** PR；否则 **skipped**（auto-merge 接受 skipped） |
| ai-pr-review | `skip_ai_review: false` + `AI_REVIEW_LLM_TOKEN` 且 PR；否则 **不调用**；失败不阻断 merge |
| sync-default | 默认分支 ≠ 当前 ref，且非 bot |
| ci-summary | 每次 run（估算 hosted job 数） |

## 阻断通知

**何时发信**：非 draft 的 `pull_request` 跑完且 `release-auto-merge` **未** success。draft 期间不发。

## 分支保护（推荐）

在 GitHub 仓库 **Settings → Branches → master**：

- Require pull request before merging（可仅 bot merge）
- 可选 Required checks：`verify`（qodana / ai-pr-review 常为 skipped，勿设为 required，除非 Org 已启用）；**`correctness_on_builds: true` 时**另加 Cloudflare Workers Builds GitHub Check（与 `builds_check_context` 一致），或依赖 `builds-correctness-gate` job fail-closed

## 与 AI PR review

**默认**：`skip_ai_review: true`，门面不调 `ai-pr-review`。试点仓传 `skip_ai_review: false` 并配置 Org `AI_REVIEW_LLM_*`。

alibaba OCR（`open-code-review` / `OCR_LLM_*`）已于 2026-10 移除，见 [ai-review/README.md](./ai-review/README.md)。

## 与 Qodana（成本策略）

**`actions/v0.2.0+`**：Org 未启用时 **job 级不启动**（`skipped`）；`release-auto-merge` 将 `success` **或** `skipped` 视为通过。启用后路径过滤 / 30min 限频仍在 [worker-qodana-scan](./qodana-ci.md) 内部。

兼容：同时认 Org Variable `QODANA_ENABLED` 与 `WORKERS_WORLD_QODANA_ENABLED`。

## 迁移自 push-promote / 旧 draft 默认

1. bump pin 到 `@actions/v0.2.12`（tag 须已存在；公开仓 runner 门控 + 内层嵌套对齐）；仍 pin `@actions/v0.2.6` 时可显式 `create_draft_release_pr: false` 获得相同行为
2. 复制最新 `templates/ci-release-pr.yml` / `sync-default-branch.yml`
3. 既有 **open** Release PR：不会被 ensure 改 draft/ready；新 PR 按新默认创建
4. 需要 draft 闸门：`create_draft_release_pr: true` 或手动 Convert to draft

## 相关

- [actions-workflows.md](./actions-workflows.md)
- [actions-releases.md](./actions-releases.md)
- [qodana-ci.md](./qodana-ci.md)
- [ai-review/README.md](./ai-review/README.md)
