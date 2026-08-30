# workers-world/worker-actions

Cloudflare Worker 仓可复用的 GitHub Actions bundle（verify、Release PR、Qodana、OCR、auto-merge）。

**不要** `@master`，pin `actions/vX.Y.Z`。

## Caller

```yaml
jobs:
  ci:
    permissions:
      contents: write
      packages: read
      pull-requests: write
      issues: write
      actions: write
      checks: read
    uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.1.3
    secrets: inherit
    with:
      sync_packages_lock: true
```

模板：[templates/ci-release-pr.yml](templates/ci-release-pr.yml)。完整说明：[docs/release-pr-ci.md](docs/release-pr-ci.md)、[docs/actions-releases.md](docs/actions-releases.md)、[docs/gh-release.md](docs/gh-release.md)（GitHub Release 页，跨仓通用）。

跨仓嵌套须写全路径并与 bundle **同 tag**（`$` / `./` 会解析到业务仓）：

```yaml
uses: workers-world/worker-actions/.github/workflows/worker-verify.yml@actions/v0.1.3
uses: workers-world/worker-actions/.github/actions/package-lock-in-sync@actions/v0.1.3
```

当前推荐 tag 见 [manifest/actions-bundle.yaml](manifest/actions-bundle.yaml)（第一条 tag 在首次 push `master` 后由 `release-actions-bundle` 打出）。

## 调用方配置（名称，不含值）

| 名称 | 类型 | 用途 |
|------|------|------|
| `GHA_TOKEN` | Secret | classic PAT：`read:packages`（建议加 `repo` 以便 promote / 建 PR） |
| `OCR_LLM_TOKEN` | Secret | OCR 用的 LLM API Key（可选；`skip_ocr: true` 时不需要） |
| `QODANA_TOKEN` | Secret | JetBrains Qodana（可选；未开 Org Variable 则 skip） |
| `NOTIFY_GHA_TOKEN` | Secret | 阻断邮件（可选） |
| `RELEASE_BOT_PRIVATE_KEY` | Secret | release-bot App 私钥（caller 传 `bot: app` 时需要；可选，见 docs/github-app-token-migration.md） |
| `RELEASE_BOT_APP_ID` | Variable | release-bot App ID（`bot: app` 时需要；可选） |
| `DEFAULT_BRANCH_BOT_PRIVATE_KEY` / `DEFAULT_BRANCH_BOT_APP_ID` | Secret / Variable | 独立 default-branch-bot App（`bot: app` 时需要；可选） |
| `OCR_LLM_URL` / `OCR_LLM_MODEL` | Variable | 默认 DeepSeek chat completions |
| `QODANA_ENABLED` | Variable | `true`/`1`/`yes` 才跑 Qodana Docker |
| `GHA_RUNNER` | Variable | 空则 `ubuntu-latest`；在 **caller** 上下文求值 |
| `NOTIFY_WORKER_URL` | Variable | 通知 HTTP 根 URL（可选） |


本仓自己的 CI **写死 `ubuntu-latest`**，不读 runner Variable。

## 本仓 CI

- 所有 PR（含 fork）：`worker-workflow-lint`（无 secrets）
- push `master` 且改了 workflows/actions：打 `actions/vX.Y.Z`
- 无 org-wide PAT auto-merge
