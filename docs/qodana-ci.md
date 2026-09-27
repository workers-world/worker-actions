# Qodana CI（Worker 仓）

各 JS/TS Worker 在 GitHub Actions 中统一跑 Qodana 静态分析，blocking 问题阻断 CI，PR 自动评论摘要。

## 前置条件

1. **Org Variable** `QODANA_ENABLED` = `true` / `1` / `yes`（**opt-in**；未设置或为空则全组织跳过 Docker 扫描，见下节）
2. **Org Secret** `QODANA_TOKEN`（JetBrains Qodana Cloud token）
3. **workers-world/worker-actions** `master` 含：`worker-qodana-scan.yml`、`.github/actions/qodana-parse/`
4. 调用方仓库根目录有 **`qodana.yaml`**（`linter` 主版本须与 workflow 中 `qodana-action@v20**.*` 一致，当前为 `2026.2`；Org 未启用 Qodana 时可无）

## Org 级开关（`QODANA_ENABLED`）

**workers-world** Org → Settings → Secrets and variables → Actions → **Variables**。

| Variable 值 | 行为 |
|-------------|------|
| **未设置** 或 **空** | **`actions/v0.2.0+`**：`worker-ci` **不启动** qodana job（result=`skipped`，auto-merge 接受）；旧 pin 仍可能起 runner 后在 gate 内 skip |
| `true` / `1` / `yes`（大小写不敏感） | 启用 Qodana；再应用路径过滤 / PR 限频（见 §频次优化） |
| 其它非空值（如 `false`） | 视为未启用，不扫描 |

亦兼容 Org Variable 名 **`WORKERS_WORLD_QODANA_ENABLED`**（与 `QODANA_ENABLED` 任一为 true 即启用）。

配置位置与 [`GHA_RUNNER`](./self-hosted-runner.md) 相同；**无需**各业务仓改 `ci.yml` 即可全组织生效（但 bundle 须 pin 到含本逻辑的 `@actions/vX.Y.Z`）。

### Breaking（`actions/v0.2.0+`）

未设置启用 Variable 时 qodana job 为 **`skipped`**（不再 checkout + 评论）。`release-auto-merge` 已改为接受 `skipped`。若 branch protection 把 `qodana` 设为 required check，请改为 optional 或启用 Org Variable。

## 接入步骤（全仓默认模板）

JS/TS Worker 优先采用 [Release PR 模板](./release-pr-ci.md)（`pull_request → master` + auto-merge + OCR）；或沿用下方 push-promote + qodana 模板。

### 1. 添加 `qodana.yaml`

从 [templates/qodana.yaml](../templates/qodana.yaml) 复制到 Worker 根目录（**勿**加 `failureConditions`；阻断 gate 在 workflow 的 SARIF 解析步骤）。

有 React 客户端时，合并 [templates/qodana.excludes.tsx-client.yaml](../templates/qodana.excludes.tsx-client.yaml) 中的 `exclude`（例如 `src/client`）。

有 `public/dashboard` 且触发 `JSJQueryEfficiency` 误报时：

```yaml
exclude:
  - name: JSJQueryEfficiency
    paths:
      - public/dashboard
```

### 2. 更新 `.github/workflows/ci.yml`

```yaml
jobs:
  verify:
    permissions:
      contents: write
      packages: read
    uses: workers-world/worker-actions/.github/workflows/worker-verify.yml@actions/v0.1.0
    secrets: inherit
    with:
      sync_packages_lock: true   # SDK 版本以 package.json 为准
      promote: false

  qodana:
    permissions:
      contents: read
      pull-requests: write
      issues: write
      actions: write   # PR 限频 cache（qodana-scan-gate）
    uses: workers-world/worker-actions/.github/workflows/worker-qodana-scan.yml@actions/v0.1.0
    secrets: inherit
    with:
      pr_number: ${{ github.event_name == 'pull_request' && format('{0}', github.event.pull_request.number) || '' }}

  # promote 须 verify + qodana 均绿
  promote:
    needs: [verify, qodana]
    if: always()
    permissions:
      contents: write
    uses: workers-world/worker-actions/.github/workflows/worker-promote-gated.yml@actions/v0.1.0
    secrets: inherit
    with:
      release_branch: ${{ github.ref_name }}
      verify_result: ${{ needs.verify.result }}
      qodana_result: ${{ needs.qodana.result }}
      require_qodana: true
```

可复用 workflow 内 PR 评论使用 `github.token`（**不要**用 `secrets.GITHUB_TOKEN`，不会自动传入）。

### 3. promote 与 Qodana gate（legacy）

**全仓默认**：采用 [Release PR 模型](./release-pr-ci.md)（`dev_* → master` 自动 PR + qodana + OCR + auto-merge），**不再使用** `worker-promote-gated` push FF。模板：[templates/ci-release-pr.yml](../templates/ci-release-pr.yml)。

**历史 push-promote（仅未迁移仓 / 应急）**：

| 场景 | ci.yml | promote 行为 |
|------|--------|--------------|
| **legacy** | `verify` + `qodana` + 外置 `promote` | qodana 红则不 FF |
| **更旧** | 仅 `verify`，不传 `promote` | `worker-verify` 内置 promote（`promote: true` 默认） |

legacy 要点：

1. `verify` 必须 `promote: false`，否则内置 promote 与外置 gate 并行时，qodana 失败仍可能 FF
2. 外置 `promote` 用 `worker-promote-gated.yml`，`if: always()`，`require_qodana: true`
3. Actions 图上会出现 skipped 的 `verify / promote`（内置关掉），真正 FF 的是顶层 `promote` — 属预期
4. **单仓 `qodana.yaml` 禁止 `failureConditions`**（orchestrator 等旧配置须删除）
5. **无 SDK / 无 test 的仓**（如 manim-playground-worker）：`worker-verify` 传 `materialize_sdk: false`、`run_tests: false`（仍跑 `npm run check`）

`verify` 与 `qodana` 在 Release PR 上仍并行；auto-merge 等待 verify + qodana + OCR 均成功且 OCR 零 comment。

### 4. 首周观测（可选）

仅评论、不 fail：

```yaml
  with:
    fail_on_blocking: false
```

## 本地 vs CI

| | 本地 monorepo | 单仓 CI |
|---|---------------|---------|
| 配置 | `scripts/qodana.yaml` | 仓根 `qodana.yaml` |
| 扫描范围 | 整个 `cloudflare_work/` | 当前 Worker 仓 |
| 解析 | `node scripts/parse-qodana-report.mjs` | CI 自动 |

## Gate 语义

与 `orchestrator-worker` 的 `evaluateQodanaSummary` 一致：

- **blocking**：`level=error` 或 `qodanaSeverity=High`
- 其余为 warning，不阻断 CI

**单仓 `qodana.yaml` 不要写 `failureConditions`**：否则 JetBrains Action 会在 SARIF 解析与 PR 评论之前就因 `failThreshold` 失败退出。阻断由 workflow 内 `qodana-parse` 的 `fail_on_blocking` 控制。

解析：CI 使用 composite action [`.github/actions/qodana-parse`](../.github/actions/qodana-parse/action.yml)；本地可用 [tools/qodana/parse-qodana-report.mjs](../tools/qodana/parse-qodana-report.mjs)

## 频次优化（`worker-qodana-scan.yml`）

为降低 GHA 分钟与 Qodana Cloud 消耗，`worker-ci` 内嵌的 Qodana job **在 job 内部**短路（**不用** `if:` skip 整个 job，以保证 branch protection / auto-merge 仍见 `success`）：

| 策略 | 行为 |
|------|------|
| **Org opt-in** | `QODANA_ENABLED` 未设置或非 `true`/`1`/`yes` → 全组织 skip（不调 Docker、不校验 `qodana.yaml`） |
| **路径过滤** | 仅当 PR diff 触及业务代码路径（`src/**`、`test/**`、`*.ts` 等，见 `qodana-scan-gate`）才启动 Docker 扫描；纯 docs / lock / workflow 变更 → 合成 pass 摘要，不调 Qodana |
| **PR 限频** | 默认同一 PR **30 分钟**内不重复全量扫描（`actions/cache` 存 `last_scan_at`）；`opened` / `reopened` / `ready_for_review` **始终**全扫 |
| **增量 checkout** | checkout `pull_request.head.sha` + `fetch-depth: 0`，启用 JetBrains `pr-mode` |
| **Nothing to analyse** | 增量无可分析文件时 **pass**（不再 fail job） |

Caller 可通过 `worker-ci` inputs 覆盖：

```yaml
with:
  qodana_throttle_minutes: 30   # 0 = 禁用限频
  qodana_code_paths: |          # 空 = 内置默认 glob
    src/**
    lib/**
```

跳过扫描时 PR 评论含 `<!-- qodana-meta: ... -->` 与说明「跳过扫描」；`release-auto-merge` 仍要求 `needs.qodana.result == success`（短路路径满足）。

**权限**：经 `worker-ci` 调用时，其 `qodana` job 须含 `actions: write`（PR 限频 cache）。含 Qodana 限频的 bundle 发布前，`worker-ci` 缺此项会导致 workflow 校验失败；合入 master 打新 tag 后各仓 bump pin。业务仓 caller 亦须保留 `actions: write`（见 `templates/ci-release-pr.yml`）。

## 产物

- `qodana-report` artifact（SARIF）
- `qodana-summary` artifact（JSON + PR 评论 markdown）
- **push 流程**：Actions 运行页 **Job summary**（`qodana-comment.md`）
- PR 上 bot 评论（可选，`<!-- qodana-report -->`）

Qodana 失败时请在本地用 IDE（全仓上下文）修 blocking，再 `npm run check` 后 push；**不在 CI 调 LLM 出 patch**（片段上下文不足，试点已放弃）。

## 常见失败（SARIF 未生成）

`worker-qodana-scan.yml` 会在 job 内输出明确的 `::error::` 注解（不再仅显示 `test -f qodana.sarif.json` 失败）：

| 现象 | workflow 报错 | 修复 |
|------|----------------|------|
| 仓根无 `qodana.yaml` | `缺少 qodana.yaml` | 复制 [templates/qodana.yaml](../templates/qodana.yaml) |
| `qodana.yaml` 无 `linter:`/`image:` | `缺少 linter: 或 image:` | 补 `linter: jetbrains/qodana-js:2026.2` |
| 日志 / results 含 `Nothing to analyse` | （`v0.4.32+`）**notice + pass**，不调 blocking | 增量 diff 无 TS/JS 变更时的预期行为 |
| 其它扫描失败 | `Qodana 扫描步骤失败` | 查 `QODANA_TOKEN`、linter 镜像、merge-commit warning |

## 相关

- [worker-promote-gated.yml](../.github/workflows/worker-promote-gated.yml) — 外置 promote gate（无 Qodana 仓勿用）
- [worker-verify.yml](../.github/workflows/worker-verify.yml) — check/test
- [抽象-spec.md](../../docs/抽象-spec.md) — Qodana SARIF adapter
