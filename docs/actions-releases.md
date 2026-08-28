# Actions Bundle 发布（workers-world/worker-actions）

Worker 仓通过 **semver tag** 引用可复用 workflow，**禁止** `@master`。

发版链 Mermaid（`release-actions-bundle`）见 [actions-workflows.md §6](./actions-workflows.md#6-bundle-发版链)。

| 项 | 约定 |
|----|------|
| Tag 格式 | `actions/vX.Y.Z`（与业务 `v*` Release 区分） |
| 当前版本 | 见 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml) |
| Caller 示例 | `uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.1.0` |
| 跨仓嵌套（门面 / leaf 对业务仓暴露） | **reusable workflow 与 composite action 一律全路径** `workers-world/worker-actions/.github/…@actions/vX.Y.Z`。跨仓 `workflow_call` 时 `$/`/`./` 会解析到 **业务仓**（workflow：`workflow was not found`；composite：`Can't find 'action.yml' under …/counter-worker/.github/actions/…`）。 |
| 同仓例外 | 本仓 smoke / dogfood、或 **先 checkout** `workers-world/worker-actions` 再 `uses: ./.gha-actions-bundle/...`（如 OCR）仍可用相对路径。 |

## 为何不用 `@master`

`@master` 在共享仓被误改或攻陷时，全 Org Worker 行为会无感知漂移，且 `secrets: inherit` 会把 Secret 暴露给可变 workflow。固定 tag 后，升级需显式 bump。


## 坑：跨仓时 `$/` / `./` 嵌套（workflow **与** composite）

业务仓 `uses: …/worker-ci.yml@actions/vX.Y.Z` 时，bundle **内部**若再写：

| 写法 | 实际解析到 | 典型报错 |
|------|------------|----------|
| `uses: $/.github/workflows/….yml` 或 `./.github/workflows/…` | **caller 业务仓** | `workflow was not found` |
| `uses: ./.github/actions/package-lock-in-sync` | **caller 业务仓** | `Can't find 'action.yml' under …/<worker>/.github/actions/…` |

（历史：`v0.4.35` 在 `worker-sync-packages-lock` / `worker-verify` 用相对路径引用 composite → counter-worker sync-lock 红。）

**结论**：对业务仓暴露的 reusable workflow 内，嵌套 **workflow 与 composite** 都必须写全路径并 pin **与本 bundle 同版本** tag：

```yaml
uses: workers-world/worker-actions/.github/actions/package-lock-in-sync@actions/vX.Y.Z
uses: workers-world/worker-actions/.github/workflows/worker-sync-packages-lock.yml@actions/vX.Y.Z
```

`$/` / `./` **仅**用于：同仓 smoke / dogfood；或已 `actions/checkout` 把 bundle 拉进 workspace 后的本地 `uses:`（如 OCR）。

## 两层版本（外层 pin vs 内层嵌套）

| 层 | 谁写 | 例子 | 作用 |
|----|------|------|------|
| **外层** | 业务仓 / templates | `worker-ci.yml@actions/v0.4.8` | 选定整份 bundle 入口 |
| **内层** | bundle 内 workflow | `worker-ci` → `open-code-review.yml@actions/v0.4.8` | 叶子 workflow / composite 实际版本 |

**外层升了、内层没升 = 仍跑旧叶子。**  
例如 tag `actions/v0.4.4` 内容里嵌套仍写 `@actions/v0.4.3` 时，业务仓即便 pin `v0.4.4`，OCR/notify 等仍解析到 `v0.4.3`。

`manifest/actions-bundle.yaml` 只是「当前推荐 tag」说明书，**不参与** GHA 解析；真正生效的是 YAML 里的 `uses: …@tag`。

## 方案 B：tag 先存在，再手工 bump 消费者（推荐）

**原则**：业务仓 `uses: …@actions/vX.Y.Z` 里的 tag **必须已在 GitHub 上存在**；不要在 `release-actions-bundle` 打 tag **之前** 把各仓 pin 升到「即将打的版本」，否则会出现 codeload 404 / `workflow was not found` 窗口期。

| 阶段 | 谁做 | 说明 |
|------|------|------|
| 1. 开发 bundle | 本仓 `dev_*` | 内层嵌套 pin 与 **本 PR 目标版本** 对齐；跨仓 reusable 用全路径 `@actions/v…` |
| 2. 合入 master | CI auto-merge | 改动了 `.github/workflows/**` 或 actions 时触发发版 |
| 3. 打 tag | `release-actions-bundle` | patch+1 → `actions/vX.Y.Z` push 到远端（权威制品） |
| 4. bump 消费者 | **各业务仓** | tag 存在后，在需要升级的仓内 bump 外层 `@actions/v…` 并走 Release PR |

**开发期验证**（tag 尚未打出时）可临时 pin：

- `@<commit-sha>`（bundle 仓该 commit）
- 或 `@dev_XX_YY_ZZ`（bundle 开发分支）

**不要**在发版 PR 里预写「下一版 tag」到各消费者——等 tag 打出后再逐仓 bump pin。

（历史坑：先 bump `v0.4.21`、tag 未 push → 全 Org CI 红；内层 `$/` 解析到业务仓 → `ensure-gh-cli` 404。）

## 发布流程（尽量少本地操作）

### 本仓（workers-world/worker-actions）合入 master

1. 在 `dev_*` 开发 → **`git push`**
2. [`ci.yml`](../.github/workflows/ci.yml) 自动：`ensure-release-pr` → **workflow-lint** 全绿后 **`release-auto-merge`**（本仓无 verify/qodana；OCR 当前 skip，merge 在 **push run** 完成，不必等 PR synchronize run）
3. **勿再网页手工 Merge**（除非 auto-merge 失败）

### Actions bundle tag → 各仓 bump pin

1. 上一步合入 `master` 且改动了 `.github/workflows/**` 或 `.github/actions/**` 时，[`release-actions-bundle.yml`](../.github/workflows/release-actions-bundle.yml) **自动**：
   - 取最新 `actions/v*` → **patch +1**
   - 打 tag 并 push
   - 开 PR 回填 `manifest/actions-bundle.yaml`（master 禁止直推；commit 含 `[skip actions-release]`）
2. tag 推送成功后，在需要升级的 **各业务仓** 手工 bump `@actions/v…` 并走 Release PR（无 org 级自动 bump bot）。

**嵌套 reusable workflow / composite action（跨仓暴露路径）**：一律全路径 `@actions/vX.Y.Z`（与本 bundle 同版本）。  
本仓 dogfood `ci.yml` / `smoke-dollar-self` 仍可用 `./` 或 `$/` 验证同仓相对路径。

**手动发版**（minor/major 或指定版本）：Actions → **Release actions bundle** → Run workflow，填写 `version`（如 `0.5.0`）；留空则同样 auto patch+1。

**无需**本地 `git tag` / 手工合 destin→master / 在 tag 存在前改业务仓 pin。

验证 `$/`：Actions → **Smoke dollar-self** → Run workflow（须 github.com runner ≥ 2.336.0）。

## master ↔ `dev_*`：何时合、何时别合

本仓 CI 触发（见 [`ci.yml`](../.github/workflows/ci.yml)）：

| 事件 | 结果 |
|------|------|
| **push** 到 `dev_*` | `ensure-release-pr`（开/更新 Release PR） |
| 已有 **`dev_* → master` Release PR** 收到新 commit（`synchronize`） | 再跑 OCR（及后续 auto-merge） |

因此：**把 master 合进正在发版的 `dev_*`（无论本地 merge 再 push，还是另开 PR base=`dev_*`）都会再跑一轮流水线**，用 PR 合并不省 OCR。

| 场景 | 是否把 master 合进当前 `dev_*` |
|------|--------------------------------|
| **正在开着的 Release PR**（发版中） | **不要合**。bot 回填的 manifest 可忽略，不影响本轮即将打出的 tag |
| **下一档开发** | **从最新 `origin/master` 切新 `dev_*`**（自然带上 manifest），勿在旧 Release 分支上反复合 |
| 合入被冲突挡住 | 才同步 master，并接受再跑一轮 OCR |

```bash
# 开新一轮（推荐）
git fetch origin
git checkout -b dev_00_06_00 origin/master
```

manifest 自动 bump 合进 master 后：给**下一档分支**用，不是给**当前正在发版的 `dev_*`** 反复合的。

## 遗留 / 应急 promote（禁止直推 master）

`worker-promote.yml` **不再** `git push` 到 master，改为：

1. 若无 open PR：`gh pr create`（`dev_*` → `master`）
2. `gh pr merge --merge`；若被 required checks 阻挡则 `--auto` 并轮询至 MERGED

适用：`action-notify-email` / `framework_sdk_worker` 等尚未完全迁到 `worker-ci` 门禁的仓，以及手动 `workflow_dispatch`。  
**日常 Worker 仍用 `worker-ci`**（ensure-release-pr → OCR → release-auto-merge），不要再开独立 promote 与 OCR 门禁抢跑。

Caller：`permissions: {}` + `secrets: inherit`（须 `GHA_TOKEN`）。

## 升级 Worker

**常规路径**：`release-actions-bundle` 打出新 tag 后，在需要升级的各仓 bump 外层 pin 并走 Release PR。

```bash
# 批量替换（tag 必须已存在）
sed -i '' 's|@actions/v0\.4\.31|@actions/v0.4.33|g' .github/workflows/*.yml
```

新仓接入：在 `ci.yml` 中 `uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/vX.Y.Z` 即可。

共置目录批量核对：meta 根 `./sync-worker-github-configs.sh --check`（权威模板见 `workers-world-dot-github/templates/`；合法 `with:` 定制见 `templates/github/worker-ci-overrides.yaml`）。

业务仓升级时：**优先只 bump** 外层 `worker-ci.yml` / `sync-default-branch.yml` 等入口 pin；leaf 嵌套 pin 由 bundle 内部维护。  
**不要长期停在「外层已升、内层仍旧」的中间 tag**（例如外层 `v0.4.4`、内层仍 `@v0.4.3`）。

## Tag 保护（推荐）

- 禁止 force-move / 删除 `actions/*` tag
- 仅 maintainer 可打 tag（或仅通过 `release-actions-bundle` + PAT）

## 版本历史

| Tag | SHA | 日期 | 摘要 |
|-----|-----|------|------|
| `actions/v0.4.6` | （本 PR 合入后自动 patch+1） | 2026-08-11 | `worker-promote`→PR merge；同仓嵌套改 `$/`；Smoke dollar-self |
| `actions/v0.4.5` | e6df1a5 | 2026-08-11 | 嵌套 pin / templates 与 bundle 同版本；OCR `Checkout base`→`path: base` |
| `actions/v0.4.4` | e8012f0 | 2026-08-11 | PR #54：OCR/AI Gateway/权限与阻断阈值等（嵌套仍指向 v0.4.3，由 v0.4.5 修正） |
| `actions/v0.6.0` | （合入 master 后 workflow_dispatch 指定 `0.6.0`） | 2026-08-07 | `ocr-autofix` + `enable_autofix`；嵌套 pin 同版本（计划中） |
| `actions/v0.1.0` | （合入 master 后 workflow_dispatch 指定 `0.5.0`） | 2026-08-07 | `worker-ci` 一键编排；嵌套 pin 同版本（计划中，实际已由 0.4.x 覆盖） |
| `actions/v0.4.0` | （合入 master 后由 Actions 自动打） | 2026-08-07 | 相对路径嵌套；sync-default / notify permissions；首版 pin |

## 相关

- [actions-workflows.md](./actions-workflows.md)（§6 Bundle 发版链 Mermaid）
- [release-pr-ci.md](./release-pr-ci.md)
- [README.md](../README.md)
