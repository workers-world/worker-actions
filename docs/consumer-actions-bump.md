# 消费者 actions/v* 自动 bump（WW-150 / #101）

**Org 扇出**：新 **annotated** `actions/v*` tag 后，从 deploy-tracker **consumers API** 拉取 `upgradable` 消费者列表，对每个仓 **开 PR、不自动合**。单仓调试仍可用 `CONSUMER_REPO` / dispatch `consumer_repo` 覆盖。

## 触发

| 来源 | 行为 |
|------|------|
| **`create`**（`ref_type=tag` 且 `actions/v*`） | 主路径；**仅 annotated tag**（`git ref` 的 `object.type=tag`）。轻量 tag → `::notice` 跳过 |
| **`workflow_dispatch`** | 手动指定已有 `actions/vX.Y.Z` + 可选单仓 / `dry_run` |
| **`release published`** | **不监听**（避免与现有 Release 流双开 PR） |

Kill switch：仓库或 Org Variable **`ACTIONS_AUTO_BUMP=false`** 时整个 workflow 不跑。

## 消费者列表（deploy-tracker / WW-151）

默认在 **prepare** job 调用：

```http
GET {CONSUMERS_API_BASE}/v1/consumers?dep={CONSUMERS_DEP}&status={CONSUMERS_STATUS}
Authorization: Bearer {RULES_ADMIN_TOKEN}
```

| 配置 | 默认 | 说明 |
|------|------|------|
| **CONSUMERS_API_BASE** | `https://deploy.mailworld.uk` | Org **Variable**（可选；脚本与 workflow 内置相同默认） |
| **CONSUMERS_DEP** | `worker-actions` | Org Variable（Phase 2 deploy-tracker 登记该 dep 后生效） |
| **CONSUMERS_STATUS** | `upgradable` | Org Variable；也可改为 `current` / `all` 做试验 |
| **RULES_ADMIN_TOKEN** | — | Org **Secret**；与 registry rules admin **同一 token**，仅 `Authorization: Bearer` |

API 返回 **0** 个仓时 workflow **失败**，并提示检查 Phase 2 `dep=worker-actions` 与上述 secrets。

**单仓 / 试点覆盖**（跳过 API）：

- `workflow_dispatch` → `consumer_repo` = `workers-world/<name>`
- 或 Org Variable **`CONSUMER_REPO`**（`create` 事件路径）

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

本 workflow 在 **worker-actions** 内 mint token，**每个消费者 matrix job** 收窄到该仓：

- `owner: workers-world`
- `repositories: <repo short name>`
- `permission-contents: write`、`permission-pull-requests: write`、`permission-workflows: write`

消费者仓 **clone / push / ls-remote** 使用同一 release-bot token 的 `https://x-access-token:…@github.com/owner/repo.git` URL（与 `release-actions-bundle` Phase B 一致）。未鉴权的 `https://github.com/…` 在私有仓会失败：`fatal: could not read Username for 'https://github.com'`（见 [run 38872965691](https://github.com/workers-world/worker-actions/actions/runs/38872965691)）。git 命令失败日志中会脱敏 token。

**Ops 清单**

- [ ] App 已安装到 **所有** 需自动 bump 的消费者仓，且具备 Contents + Pull requests + **Workflows** 写
- [ ] 各消费者仓 Settings → Actions → General：**Allow GitHub Actions to create and approve pull requests**
- [ ] worker-actions 仓可读 `RELEASE_BOT_*`（与 `release-actions-bundle` 相同）
- [ ] **`RULES_ADMIN_TOKEN`** Secret +（可选）**`CONSUMERS_API_BASE`** Variable 已配置
- [ ] deploy-tracker Phase 2 已提供 `dep=worker-actions` 的 upgradable 列表（否则 fanout 会报空列表错误）
- [ ] 未设置 `ACTIONS_AUTO_BUMP=false`（除非刻意关闭）

## 回滚

- 关闭 bot 开的 bump PR，或手动 pin 回退到旧 `@actions/v*`。
- 抑制自动 bump：设 `ACTIONS_AUTO_BUMP=false`。
- 临时只跑单仓：设 `CONSUMER_REPO` 或 dispatch `consumer_repo`。
- 不影响 `release-actions-bundle` Phase B 回填本仓 manifest。

## 验收（calendar）

相对 [WW-148 / #93 基线](release-pipeline-baseline-2026-10.md)：

- **tag → bump PR 可用** calendar **p50 降 ≥50%**，或 **绝对 p50 ≤ 60s**（满足其一即可 Done）。
- **tag → 消费者 CI 绿**为观察项，**不阻塞**本实现 PR 合入。

测量方式：与 [`tools/release-pipeline-benchmark/analyze.mjs`](../tools/release-pipeline-benchmark/analyze.mjs) 相同——在 tag 时间之后搜索消费者仓 commit message 含该 tag 的首个 commit 时间差；自动 bump 后 commit subject 为 `chore: bump worker-actions pins to actions/vX.Y.Z`。

## 验证

### A. workflow_dispatch（推荐）

1. Actions → **Consumer actions pin bump** → Run workflow。
2. `tag`：填**已存在**的 tag，如 `actions/v0.2.25`。
3. 单仓：`consumer_repo` = `workers-world/mok1`；全量 fanout：**留空** `consumer_repo`（需 API + secrets）。
4. 首次可先 `dry_run: true`，看各 job summary 中拟改文件列表。
5. `dry_run: false` 再跑 → 各消费者应出现或更新 PR（base = default `dev_*`，head = `chore/bump-worker-actions-pins`）。

### B. 真实 annotated tag

1. 正常走 `release-actions-bundle` 打出新 `actions/v*`（annotated）。
2. `create` 事件触发 **prepare** → 解析 consumers API → **matrix bump** jobs（与 `gh-release-on-tag` 的 `push` tag **并行**；互不订阅 `release published`）。

## 实现位置

- Workflow：[`.github/workflows/worker-consumer-actions-bump.yml`](../.github/workflows/worker-consumer-actions-bump.yml)
- 脚本：[`tools/consumer-actions-bump/`](../tools/consumer-actions-bump/)（`fetch-consumers.mjs` + `bump-consumer.mjs`）

## 相关

- [actions-releases.md](./actions-releases.md) — bundle tag 与消费者 pin 策略
- [github-app-token-migration.md](./github-app-token-migration.md) — release-bot App
- GitHub [#101](https://github.com/workers-world/worker-actions/issues/101) · Linear [WW-150](https://linear.app/drone01/issue/WW-150)
