# 消费者 actions/v* 自动 bump（WW-150 / #101）

Phase 1：**只开 PR、不自动合**；试点仓 **workers-world/mok1**（`workers-world/tal1` 仅作 dispatch 备选验证）。Org 扇出不在本阶段。

## 触发

| 来源 | 行为 |
|------|------|
| **`create`**（`ref_type=tag` 且 `actions/v*`） | 主路径；**仅 annotated tag**（`git ref` 的 `object.type=tag`）。轻量 tag → `::notice` 跳过 |
| **`workflow_dispatch`** | 手动指定已有 `actions/vX.Y.Z` + 可选 `dry_run` |
| **`release published`** | **不监听**（避免与现有 Release 流双开 PR） |

Kill switch：仓库或 Org Variable **`ACTIONS_AUTO_BUMP=false`** 时整个 workflow 不跑。

## 目标分支

- 使用消费者仓 GitHub **default branch** 作为 PR base。
- default **必须**匹配 `dev_*`；否则 **不开 PR**，在 job summary / `::notice` 留下原因。

## 改写范围

- **仅**消费者仓 `.github/workflows/**` 内文件。
- **仅**外层 pin：`workers-world/worker-actions/...@actions/v*`（semver）。
- 同仓多版本 pin **一律**升到新 tag。
- **不**改 composite / action 内 nested pin；**不**改 `package.json` / lock（仍走现有 sync-lock）。

## 已有 bump PR

- Bot 固定 head 分支：`chore/bump-worker-actions-pins`。
- 若已有 open PR 且 head 为该分支 → **force-with-lease** 更新同一 PR。
- 若存在 **其它 head** 的 open bump PR（标题前缀 `chore: bump worker-actions pins to`）→ **跳过**并在该 PR 留言；**不会**关旧开新。

## 鉴权（release-bot）

与 Phase B 相同 App：`RELEASE_BOT_APP_ID`（Org Variable 或 Secret）+ Org Secret `RELEASE_BOT_PRIVATE_KEY`（`workers-world-release-bot`）。

本 workflow 在 **worker-actions** 内 mint token，并显式收窄到试点仓：

- `owner: workers-world`
- `repositories: mok1`（或 dispatch 允许的 `tal1`）
- `permission-contents: write`、`permission-pull-requests: write`

**Ops 清单**

- [ ] App 已安装到 **workers-world/mok1**（及可选 tal1），且具备 Contents + Pull requests 写
- [ ] 消费者仓 Settings → Actions → General：**Allow GitHub Actions to create and approve pull requests**（bot-know D4）
- [ ] worker-actions 仓可读到 `RELEASE_BOT_*`（与 `release-actions-bundle` 相同）
- [ ] 未设置 `ACTIONS_AUTO_BUMP=false`（除非刻意关闭）

## 回滚

- 关闭 bot 开的 bump PR，或手动 pin 回退到旧 `@actions/v*`。
- 抑制自动 bump：设 `ACTIONS_AUTO_BUMP=false`。
- 不影响 `release-actions-bundle` Phase B 回填本仓 manifest。

## 验收（calendar）

相对 [WW-148 / #93 基线](release-pipeline-baseline-2026-10.md)：

- **tag → bump PR 可用** calendar **p50 降 ≥50%**，或 **绝对 p50 ≤ 60s**（满足其一即可 Done）。
- **tag → 消费者 CI 绿**为观察项，**不阻塞**本实现 PR 合入。

测量方式：与 [`tools/release-pipeline-benchmark/analyze.mjs`](../tools/release-pipeline-benchmark/analyze.mjs) 相同——在 tag 时间之后搜索消费者仓 commit message 含该 tag 的首个 commit 时间差；自动 bump 后 commit subject 为 `chore: bump worker-actions pins to actions/vX.Y.Z`。

## mok1 试点验证

### A. workflow_dispatch（推荐）

1. Actions → **Consumer actions pin bump** → Run workflow。
2. `tag`：填**已存在**的 tag，如 `actions/v0.2.25`。
3. 首次可先 `dry_run: true`，看 summary 中拟改文件列表。
4. `dry_run: false` 再跑 → mok1 应出现或更新 PR（base = default `dev_*`，head = `chore/bump-worker-actions-pins`）。

### B. 真实 annotated tag

1. 正常走 `release-actions-bundle` 打出新 `actions/v*`（annotated）。
2. `create` 事件触发本 workflow（与 `gh-release-on-tag` 的 `push` tag **并行**；互不订阅 `release published`）。

## 实现位置

- Workflow：[`.github/workflows/worker-consumer-actions-bump.yml`](../.github/workflows/worker-consumer-actions-bump.yml)
- 脚本：[`tools/consumer-actions-bump/`](../tools/consumer-actions-bump/)

## 相关

- [actions-releases.md](./actions-releases.md) — bundle tag 与消费者 pin 策略
- [github-app-token-migration.md](./github-app-token-migration.md) — release-bot App
- GitHub [#101](https://github.com/workers-world/worker-actions/issues/101) · Linear [WW-150](https://linear.app/drone01/issue/WW-150)
