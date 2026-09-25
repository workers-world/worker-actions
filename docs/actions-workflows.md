# Actions 流程图（workers-world/worker-actions）

本页是 Org 可复用 GitHub Actions 的 **可视化索引**：触发条件、job 依赖、跨 workflow 调用与 composite action 落点。文字规范仍以 [release-pr-ci.md](./release-pr-ci.md)、[actions-releases.md](./actions-releases.md) 为准；图内 **不写死** pin 版本号（当前推荐 tag 见 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml)）。

## 目录

1. [总览与图例](#1-总览与图例)
2. [全局调用关系](#2-全局调用关系)
3. [Release PR 端到端](#3-release-pr-端到端)
4. [入口 workflow](#4-入口-workflow)
5. [Leaf workflow 详图](#5-leaf-workflow-详图)
6. [Bundle 发版链](#6-bundle-发版链)
7. [工具 / 验证](#7-工具--验证)
8. [Composite actions 矩阵](#8-composite-actions-矩阵)
9. [Workflow 速查表](#9-workflow-速查表)

---

## 1. 总览与图例

| 符号 / 约定 | 含义 |
|-------------|------|
| 实线箭头 `-->` | `uses:` 调用 reusable workflow，或 `needs` 依赖 |
| `|label|` | 事件或条件（如 `push dev_*`、`PR`、`workflow_run`） |
| 入口 | 可直接被业务仓 / 本仓 / dispatch 触发的 workflow |
| Leaf | 仅 `workflow_call`，由门面或其他 reusable 嵌套调用 |
| 节点 ID | camelCase；不用空格；避免 Mermaid 保留字（如 `end`） |

**两条主轨：**

| 轨 | 入口 | 用途 |
|----|------|------|
| Worker Release PR | `worker-ci.yml`（业务仓）/ `ci.yml`（本仓 dogfood） | `dev_*` → Release PR → 门禁 → auto-merge → `master` |
| Actions Bundle | `release-actions-bundle.yml` + `gh-release-on-tag.yml` | 打 `actions/vX.Y.Z` + GitHub Release 页；各业务仓手工 bump pin |

---

## 2. 全局调用关系

跨 workflow 的 `uses:` / `workflow_run` 边（不含业务仓薄 caller）。

```mermaid
flowchart TB
  subgraph entry [入口]
    WCI[worker-ci.yml]
    CI[ci.yml]
    REL[release-actions-bundle.yml]
    GHR[gh-release-on-tag.yml]
    SYNC[worker-sync-default-dev-branch.yml]
  end

  WCI --> WL[worker-workflow-lint]
  WCI --> WV[worker-verify]
  WCI --> ERP[worker-ensure-release-pr]
  WCI --> QOD[worker-qodana-scan]
  WCI --> OCR[open-code-review]
  WCI --> RAM[worker-release-auto-merge]
  WCI --> NTF[worker-notify-release-pr-blocked]

  CI --> WL

  WV --> SPL[worker-sync-packages-lock]
  WV --> PROM[worker-promote]

  PG[worker-promote-gated] --> PROM
```

来源：[`.github/workflows/`](../.github/workflows/)（尤其 [`worker-ci.yml`](../.github/workflows/worker-ci.yml)、[`ci.yml`](../.github/workflows/ci.yml)）。

`worker-sync-default-dev-branch` 由业务仓 **独立** workflow 调用（与 `ci.yml` 无 `needs`）；verify 失败时仍可同步默认分支。

> 本仓 `ci.yml` 当前仅保留 fork-safe 的 `workflow-lint`（无 secrets）；Release PR / auto-merge / notify 链只在业务仓经 `worker-ci` 挂载。本仓发版（dev → master）由人工开 PR，见 [actions-releases.md](./actions-releases.md)。

---

## 3. Release PR 端到端

业务仓经 `worker-ci` 编排后的 push / PR 双轨（简化并行关系）。

```mermaid
flowchart TB
  subgraph pushEvent [push_dev]
    pushLint[workflow-lint]
    pushVerify[verify]
  end

  subgraph prEvent [pull_request_dev_to_master]
    prLint[workflow-lint]
    prVerify[verify]
    qodana[qodana]
    ocr[ocr]
    merge[release-auto-merge]
    notify[notify-blocked]
  end

  pushLint --> ensurePR[ensure-release-pr]
  ensurePR --> releasePR[Release_PR_open]
  releasePR -.->|synchronize| prEvent

  prLint --> ocr
  prVerify --> merge
  qodana --> merge
  ocr --> merge
  prLint --> merge
  merge -->|failure_or_skipped| notify
```

| 事件 | 运行的 job |
|------|------------|
| `push` → `dev_*` | workflow-lint → ensure-release-pr；verify（含可选 sync-lock）；另有独立 Sync default branch |
| `pull_request` → `master`（head=`dev_*`） | workflow-lint、verify、qodana、ocr → release-auto-merge；失败/绿门未合时 notify-blocked |

文字说明见 [release-pr-ci.md](./release-pr-ci.md)。

---

## 4. 入口 workflow

### 4.1 `worker-ci.yml`（业务仓门面）

唯一推荐入口：业务仓 `ci.yml` 只 `uses` 本文件，勿再展开 leaf。

```mermaid
flowchart TB
  lint[workflow-lint]
  verify[verify]
  ensure[ensure-release-pr]
  qodana[qodana]
  ocr[ocr]
  merge[release-auto-merge]
  notify[notify-blocked]

  lint -->|push_dev_and_success| ensure
  lint -->|PR_and_success| ocr
  lint --> merge
  verify --> merge
  qodana --> merge
  ocr --> merge
  lint --> notify
  verify --> notify
  qodana --> notify
  ocr --> notify
  merge --> notify
```

| Job | needs | 主要触发条件 |
|-----|-------|-------------|
| workflow-lint | — | push `dev_*` 或 Release PR |
| verify | — | 始终（由 nested worker-verify 按事件细分） |
| ensure-release-pr | workflow-lint | push `dev_*` 且 lint success；跳过 deleted |
| qodana | — | 同仓 Release PR（`dev_*` → `master`） |
| ocr | workflow-lint | 同上 + lint success；默认 `skip_ocr: true` |
| release-auto-merge | lint, verify, qodana, ocr | 四门全 success；可选非 draft |
| notify-blocked | 全部 | PR 且 merge 非 success（含四门绿但 merge skipped） |

来源：[`worker-ci.yml`](../.github/workflows/worker-ci.yml)。

### 4.2 `ci.yml`（本仓 dogfood）

本仓无应用代码，且 `ci.yml` 须对所有 PR（含 fork）安全：**仅**跑无 secrets 的 `workflow-lint`。Release PR / auto-merge / notify 链不在本仓挂载——本仓 `dev_*` → `master` 由人工开 PR（见 [actions-releases.md](./actions-releases.md)）。

```mermaid
flowchart LR
  lint[workflow-lint]
```

来源：[`ci.yml`](../.github/workflows/ci.yml)。合入 `master` 且改了 workflows/actions 后由 [Bundle 发版链](#6-bundle-发版链) 打 tag。

### 4.3 业务仓 caller 模板

推荐形态（与 `worker-ci` 注释一致）：单一 job `uses: …/worker-ci.yml@actions/vX.Y.Z`，`secrets: inherit`，`with` 只传仓间差异。

[`docs/templates/ci-release-pr.yml`](./templates/ci-release-pr.yml) 仍为 **展开 leaf** 的历史示例；新仓优先薄壳调 `worker-ci`，避免与门面双轨漂移。Sync default branch 须 **另建** 独立 workflow，勿并入 `ci.yml`。

---

## 5. Leaf workflow 详图

### 5.1 Verify 轨

#### `worker-verify.yml`

```mermaid
flowchart LR
  syncLock[sync-lock_optional] --> verifyJob[verify]
  verifyJob --> promoteJob[promote_optional_legacy]
```

verify 步骤摘要：checkout（PR 用 **head SHA**，非 merge ref）→ 拉取 sync-lock 提交（push）→ PR 轮询等待 lock（可选）→ setup-node → 物化 SDK（可选）→ `npm ci` → `npm run check` → `npm test`（可选）。

| Job | 条件 |
|-----|------|
| sync-lock | `sync_packages_lock` + push `dev_*` → 调 `worker-sync-packages-lock` |
| verify | sync-lock success 或 skipped |
| promote | `promote: true` + push `dev_*` → 调 `worker-promote`（日常 Release PR 仓须 `false`） |

来源：[`worker-verify.yml`](../.github/workflows/worker-verify.yml)。

#### `worker-sync-packages-lock.yml`

```mermaid
flowchart LR
  checkout[checkout_with_PAT] --> refresh[refresh_package-lock] --> commit[commit_and_push]
```

来源：[`worker-sync-packages-lock.yml`](../.github/workflows/worker-sync-packages-lock.yml)。

### 5.2 门禁

#### `worker-workflow-lint.yml`

```mermaid
flowchart LR
  checkout[checkout] --> install[actionlint_shellcheck] --> lint[actionlint]
  lint --> parse[JSON_YAML_parse]
  parse --> pin[forbid_master_pin]
  pin --> hygiene[hygiene_and_secrets_scan]
```

来源：[`worker-workflow-lint.yml`](../.github/workflows/worker-workflow-lint.yml)。

#### `worker-qodana-scan.yml`

```mermaid
flowchart LR
  checkout[checkout_head_sha] --> gate[qodana-scan-gate]
  gate -->|org未启用或skip| skipSum[skip_pass_summary]
  gate -->|shouldScan| validate[validate_qodana_yaml]
  validate --> scan[JetBrains_qodana-action]
  scan --> parse[qodana-parse_composite]
  skipSum --> parse
  parse --> artifact[upload_artifact]
  artifact --> comment[PR_comment]
  comment --> failOnly[qodana-parse_fail_only]
```

来源：[`worker-qodana-scan.yml`](../.github/workflows/worker-qodana-scan.yml)；说明见 [qodana-ci.md](./qodana-ci.md)。

#### `open-code-review.yml`

```mermaid
flowchart TB
  start[workflow_call] --> skipCheck{skip}
  skipCheck -->|true| skipAck[skip-ack_success]
  skipCheck -->|false| review[review]
  review --> preflight[LLM_preflight]
  preflight --> checkoutBundle[checkout_actions_bundle]
  checkoutBundle --> ocrComposite[ocr-pr-review_composite]
  ocrComposite --> blockCheck[block_on_high_severity]
```

来源：[`open-code-review.yml`](../.github/workflows/open-code-review.yml)；说明见 [open-code-review.md](./open-code-review.md)。

### 5.3 Release PR 操作

#### `worker-ensure-release-pr.yml`

```mermaid
flowchart LR
  installGh[ensure_gh] --> createPr[gh_pr_create_if_missing]
```

条件由 caller（`worker-ci` / `ci.yml`）限制为 push `dev_*`。来源：[`worker-ensure-release-pr.yml`](../.github/workflows/worker-ensure-release-pr.yml)。

#### `worker-release-auto-merge.yml`

```mermaid
flowchart LR
  installGh[ensure_gh] --> checkPr[validate_PR_mergeable] --> mergePr[gh_pr_merge]
```

来源：[`worker-release-auto-merge.yml`](../.github/workflows/worker-release-auto-merge.yml)。

#### `worker-notify-release-pr-blocked.yml`

```mermaid
flowchart LR
  checkout[checkout_bundle_tools] --> annotations[gh-run-annotations]
  annotations --> buildMail[build_email]
  buildMail --> send[action-notify-email]
```

来源：[`worker-notify-release-pr-blocked.yml`](../.github/workflows/worker-notify-release-pr-blocked.yml)。

### 5.4 默认分支

#### `worker-sync-default-dev-branch.yml`

```mermaid
flowchart LR
  installGh[ensure_gh] --> scan[scan_remote_dev_branches]
  scan --> decide{push_is_latest_dev}
  decide -->|yes| patch[PATCH_default_branch]
  decide -->|no| skipSync[skip]
```

业务仓独立挂载；本仓（`.github`）保持 `master` 为默认分支。来源：[`worker-sync-default-dev-branch.yml`](../.github/workflows/worker-sync-default-dev-branch.yml)。

### 5.5 遗留 promote

日常业务仓走 `worker-ci`，勿与 OCR 门禁抢跑。

#### `worker-promote.yml`

```mermaid
flowchart LR
  installGh[ensure_gh] --> ensurePr[create_or_reuse_Release_PR]
  ensurePr --> tryMerge[gh_pr_merge]
  tryMerge -->|blocked_by_checks| autoMerge[gh_pr_merge_auto_and_poll]
```

来源：[`worker-promote.yml`](../.github/workflows/worker-promote.yml)。

#### `worker-promote-gated.yml`

```mermaid
flowchart LR
  gate[check_verify_qodana_results] -->|pass| promote[worker-promote]
```

来源：[`worker-promote-gated.yml`](../.github/workflows/worker-promote-gated.yml)。

---

## 6. Bundle 发版链

方案 B：**tag 先存在，再在各业务仓手工 bump pin**。详见 [actions-releases.md](./actions-releases.md)。

```mermaid
sequenceDiagram
  participant Dev as dev_branch
  participant CI as ci_yml
  participant Master as master
  participant Rel as release-actions-bundle
  participant GHR as gh-release-on-tag
  participant Consumers as worker_repos

  Dev->>CI: push
  CI->>Master: Release_PR_auto-merge
  Master->>Rel: push_paths_workflows_or_actions
  Rel->>Rel: tag_actions_vX_Y_Z
  Rel->>GHR: push_tag_event
  GHR->>GHR: create_gh_release
  Rel->>Master: open_manifest_PR_skip_release
  Note over Consumers: 各仓手工 bump @actions/v pin
```

### `gh-release-on-tag.yml`

`push` → `actions/v*` tag 时调用 [`create-gh-release.yml`](../.github/workflows/create-gh-release.yml)（同仓 dogfood）。与 `release-actions-bundle` 解耦。详见 [gh-release.md](./gh-release.md)。

### `release-actions-bundle.yml`

```mermaid
flowchart LR
  trigger[push_master_or_dispatch] --> resolve[resolve_version]
  resolve --> tag[git_tag_actions_v]
  tag --> pushTag[push_tag]
  pushTag --> manifestPr[open_manifest_PR]
```

触发：`push` → `master` 且 paths 含 `.github/workflows/**` 或 `.github/actions/**`；或 `workflow_dispatch`（可指定 `version`）。commit message 含 `[skip actions-release]` 时跳过。

来源：[`release-actions-bundle.yml`](../.github/workflows/release-actions-bundle.yml)。

---

## 7. 工具 / 验证

本仓 `ci.yml` 对 **所有 PR（含 fork）** 跑 [`worker-workflow-lint.yml`](../.github/workflows/worker-workflow-lint.yml)（无 secrets）。Java Maven reusable workflow 在独立仓 [workers-world/java-actions](https://github.com/workers-world/java-actions)。

---

## 8. Composite actions 矩阵

路径：[`.github/actions/`](../.github/actions/)。

```mermaid
flowchart TB
  subgraph composites [composite_actions]
    ghCli[ensure-gh-cli]
    ocrAct[ocr-pr-review]
    qodParse[qodana-parse]
  end

  REL[release-actions-bundle] --> ghCli
  OCR[open-code-review] --> ocrAct
  QOD[worker-qodana-scan] --> qodParse
```

| Composite | 被谁调用 |
|-----------|----------|
| `ensure-gh-cli` | `release-actions-bundle`（部分 leaf 内联安装 gh，未必走此 action） |
| `ocr-pr-review` | `open-code-review` |
| `qodana-parse` | `worker-qodana-scan` |
| `qodana-scan-gate` | `worker-qodana-scan` |

跨仓 reusable 嵌套的 **workflow 与 composite** 均须全路径 `@actions/vX.Y.Z`（`$`/`./` 会解析到 caller 业务仓）；仅同仓 smoke 或先 checkout bundle 后可用相对路径（见 [actions-releases.md](./actions-releases.md)）。

---

## 9. Workflow 速查表

| Workflow | 触发 | 类型 | 上游 | 下游 |
|----------|------|------|------|------|
| `ci.yml` | push `dev_*`；PR → `master`（含 fork） | 本仓入口 | — | workflow-lint（无 secrets；fork-safe） |
| `worker-ci.yml` | `workflow_call` | 业务仓门面 | 业务仓 `ci.yml` | lint, verify, ensure-pr, qodana, OCR, ci-failure-comment, auto-merge, notify |
| `worker-workflow-lint.yml` | `workflow_call` | Leaf | worker-ci / ci | —（actionlint / manifest 格式 / 卫生 / 凭据扫描） |
| `worker-verify.yml` | `workflow_call` | Leaf | worker-ci | sync-packages-lock, promote |
| `worker-sync-packages-lock.yml` | `workflow_call` | Leaf | worker-verify | — |
| `worker-ensure-release-pr.yml` | `workflow_call` | Leaf | worker-ci / ci | — |
| `worker-qodana-scan.yml` | `workflow_call` | Leaf | worker-ci | composite `qodana-parse`, `qodana-scan-gate` |
| `open-code-review.yml` | `workflow_call` | Leaf | worker-ci / ci | composite `ocr-pr-review`；`review_mode` log\|comment |
| `worker-ci-failure-comment.yml` | `workflow_call` | Leaf | worker-ci | PR 门禁失败摘要评论 |
| `worker-outdated-pr-check.yml` | `workflow_call` | Leaf | 业务仓自建 trigger | Outdated PR Check status（72h） |
| `worker-outdated-pr-refresh.yml` | `workflow_call` | Leaf | 业务仓自建 cron | 刷新 outdated status |
| `worker-release-auto-merge.yml` | `workflow_call` | Leaf | worker-ci / ci | — |
| `worker-notify-release-pr-blocked.yml` | `workflow_call` | Leaf | worker-ci / ci | action-notify-email |
| `worker-sync-default-dev-branch.yml` | `workflow_call` | Leaf | 业务仓独立 workflow | — |
| `worker-promote.yml` | `workflow_call` | Leaf / legacy | worker-verify, promote-gated | — |
| `worker-promote-gated.yml` | `workflow_call` | Leaf / legacy | 遗留 caller | worker-promote |
| `release-actions-bundle.yml` | push `master`（paths）；dispatch | 本仓发版 | — | tag + manifest PR |
| `gh-release-on-tag.yml` | push `actions/v*` | 本仓入口 | tag push | create-gh-release |
| `create-gh-release.yml` | `workflow_call` | Leaf（跨仓通用） | gh-release-on-tag / 业务仓 caller | softprops Release |

内层嵌套 pin 与外层入口 pin 须同版本；勿长期「外层已升、内层仍旧」。权威 tag 见 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml)。

## 相关

- [release-pr-ci.md](./release-pr-ci.md) — Release PR 模型与前置 Secret
- [actions-releases.md](./actions-releases.md) — Bundle tag / bump 消费者
- [gh-release.md](./gh-release.md) — GitHub Release 页面（跨仓 `create-gh-release`）
- [open-code-review.md](./open-code-review.md) — OCR
- [qodana-ci.md](./qodana-ci.md) — Qodana
- Java Maven CI：独立仓 [workers-world/java-actions](https://github.com/workers-world/java-actions)
