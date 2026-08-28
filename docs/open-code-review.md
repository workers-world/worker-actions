# Open Code Review（Org 可复用 Workflow）

PR 触发 AI 代码审查，封装 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) Action；LLM **默认直连 DeepSeek**（OpenAI 兼容）。DeepSeek 经 AI Gateway 统计 / Workers AI 经 Org Variable **opt-in**。

Workflow 定义：[`.github/workflows/open-code-review.yml`](../.github/workflows/open-code-review.yml)

> Preflight 会校验 `OCR_LLM_URL` 须含 `/chat/completions`，配置错误时秒级 fail 而非等 25 分钟超时。

## 触发方式（Release PR 模型）

OCR 应在 **`pull_request` → `master`**（Release PR：`dev_* → master`）上运行，见 [release-pr-ci.md](./release-pr-ci.md)。

Caller `if` 须同时限定：`startsWith(github.head_ref, 'dev_')` 且 `github.event.pull_request.head.repo.full_name == github.repository`（排除 fork / 非 Release head，避免无 secrets 时 Preflight 红屏）。

推荐并入 [`ci.yml` 模板](./templates/ci-release-pr.yml) 的 `ocr` job，**不要**单独对 `dev_*` 开 PR 触发。

## GitHub Org 配置（配一次）

| 名称 | 类型 | 推荐值 |
|------|------|--------|
| `OCR_LLM_TOKEN` | Org **Secret** | DeepSeek API Key |
| `OCR_LLM_URL` | Org **Variable** | `https://api.deepseek.com/v1/chat/completions`（不配则用此默认） |
| `OCR_LLM_MODEL` | Org **Variable** | `deepseek-chat`（不配则用此默认） |
| `OCR_LLM_EXTRA_HEADERS` | Org **Variable** | DeepSeek 留空；AI Gateway 可选 `cf-aig-gateway-id=<gateway_id>` |
| `OCR_REVIEW_CONCURRENCY` | Org **Variable** | `3`（可选；OCR 文件并发审查数，默认 8；限流 429 时调低） |

> OpenAI 模式下 OCR 固定发 `Authorization: Bearer <token>`。**429 限流**：设 `OCR_REVIEW_CONCURRENCY=3`（或更低）降并发。

### 切换 provider（opt-in）

改 Org 配置即可，不动 CI：

| 切到 | `OCR_LLM_URL` | `OCR_LLM_MODEL` | `OCR_LLM_TOKEN` |
|------|---------------|-----------------|----------------|
| DeepSeek 直连（默认） | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` | DeepSeek API Key |
| DeepSeek 经 AI Gateway（统计/缓存） | `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/deepseek/chat/completions` | `deepseek-v4-flash` | DeepSeek API Key |
| GLM（Workers AI 旗舰） | `https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1/chat/completions` | `@cf/zai-org/glm-5.2` | Cloudflare API Token（`Account → Workers AI → Read`） |
| GLM（Workers AI 轻量） | 同上 | `@cf/zai-org/glm-4.7-flash` | 同上 |

### DeepSeek 经 AI Gateway（推荐：统计 + 缓存，用官方 key）

比直连多了 Gateway 的请求统计/缓存/限流/日志，且用 DeepSeek 官方 key（不经 Unified Billing，无 5% 充值手续费）。

1. CF Dashboard → AI Gateway → 新建 Gateway，记下 `{account_id}` 与 `{gateway_id}`
2. 该 Gateway **鉴权设 OFF**（OCR 发 `Authorization: Bearer <DeepSeek key>`；鉴权 OFF 仅表示不额外要求 `cf-aig-authorization`）
3. Org 配置（**用原生 DeepSeek provider**，勿用 `custom-deepseek`——后者易 502）：
   - `OCR_LLM_URL` = `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/deepseek/chat/completions`
   - `OCR_LLM_TOKEN` = DeepSeek API Key
   - `OCR_LLM_MODEL` = `deepseek-v4-flash`（或 `deepseek-v4-pro`）

> 经 AI Gateway 时使用原生 DeepSeek provider 路径（`.../deepseek/chat/completions`）。勿在 `api.cloudflare.com/.../ai/v1/...` 上用 DeepSeek key——那条走 Unified Billing，需要 Cloudflare token。

### GLM 经 AI Gateway（Workers AI）

用新 REST API（`api.cloudflare.com`），统一 `Authorization: Bearer <CF token>`，模型用 `@cf/...` 格式。Token 需 `Account → Workers AI → Read`。成本通常高于 DeepSeek。

> AI Gateway 路径另可设 `OCR_LLM_EXTRA_HEADERS=cf-aig-gateway-id=<gateway_id>` 路由到指定 gateway。

命名对照：调用方自备同名 Secret / Variable（见本仓 README）。

## 跳过 OCR

业务仓门面 [`worker-ci.yml`](../.github/workflows/worker-ci.yml)：

```yaml
    with:
      skip_ocr: true   # 默认 false；true 时不调 LLM，不阻断 auto-merge
```

直接调用本 workflow 时：

```yaml
    with:
      skip: true
```

`skip=true` 时跑轻量 `skip-ack` job（success），不要求 `OCR_LLM_TOKEN`。

## Session 缓存（降 LLM 成本）

默认可复用 workflow 已开启 `enable_session_cache: true`（可用 `with.enable_session_cache: false` 关闭）。

| 机制 | 说明 |
|------|------|
| Composite Action | [`.github/actions/ocr-pr-review`](../.github/actions/ocr-pr-review) 替代直接 `uses: alibaba/open-code-review` |
| GHA `actions/cache` | 按 `pr_number` + `ocr_version` 缓存 `~/.opencodereview/sessions` 与 `cache-meta` |
| `ocr review --resume` | 同 PR 后续 run（含 autofix push 后的 `synchronize`）对**未改文件**复用 session，不调 LLM |
| 稳定 ref | `--from origin/${base_ref}`、`--to ${head_ref}`（不用每次变化的 HEAD SHA，否则 resume 失效） |
| Action 引用 | checkout `workers-world/worker-actions`（`actions_bundle_ref`）后 `uses: ./.gha-actions-bundle/...`（勿 sparse checkout） |

日志中关注 `OCR resume stats: reused_files=… rerun_files=…`：`reused_files` 越大，本轮 LLM 调用越少。`--resume` 失败会自动回退全量审查。

`actions_bundle_ref` 默认与 actions bundle tag 一致；本仓 dogfood 在合 tag 前可传 `github.head_ref`。

### `review_mode`（借鉴 Flue）

| 值 | 行为 |
|----|------|
| `comment`（默认） | 正常发 PR 评论；`block_merge_on_comments` 对 high 生效 |
| `log` | 仍跑 OCR 并写 artifact；**不**因 high 阻断 auto-merge（便于灰度 / 干跑） |

```yaml
    with:
      review_mode: log
```

### 规则 eval harness

轻量回归（无 LLM）：

```bash
node tools/ocr-eval/run.mjs
node tools/ocr-eval/run.mjs --rule docs/templates/opencodereview-rule.base.json
```

校验 rule JSON 可解析、无可疑 token 前缀，并断言本文档仍描述增量审查与 `review_mode`。

## 本仓 lint

本仓 [`ci.yml`](../.github/workflows/ci.yml) 对所有 PR 跑 workflow-lint（**不** `secrets: inherit`）。OCR 由业务仓 Release PR 调用本 bundle，不在公开仓 dogfood 上跑。

## 业务仓接入

采用 [ci-release-pr.yml](./templates/ci-release-pr.yml) 全量模板（含 verify、ensure-release-pr、qodana、**ocr**、release-auto-merge、**notify-blocked**）。

`ocr` job 示例：

```yaml
  ocr:
    if: github.event_name == 'pull_request' && github.base_ref == 'master'
    permissions:
      contents: read
      pull-requests: write
    uses: workers-world/worker-actions/.github/workflows/open-code-review.yml@actions/v0.5.0
    secrets: inherit
    with:
      rule: .opencodereview/rule.json
```

## 仓级可选规则

路径 `.opencodereview/rule.json`（[OCR 规则格式](https://open-codereview.ai/docs/review-rules)）。建议提炼 Worker 约束，并设 `merge_system_rule: true`。

共享模板（复制后替换占位符）：

| 文件 | 用途 |
|------|------|
| [opencodereview-rule.base.json](./templates/opencodereview-rule.base.json) | workflow `uses` job 约束（单条 rule 片段） |
| [opencodereview-rule.worker.json.tpl](./templates/opencodereview-rule.worker.json.tpl) | 完整 rule.json：`{{WORKER_NAME}}` / `{{WORKER_EXTRA_RULES}}` |

## 与 Release PR auto-merge

默认 **`block_merge_on_comments: true`**（见 workflow input）：OCR 产出 ≥1 条 comment 时 job **fail**，阻断同 run 的 `release-auto-merge`，PR 保持 OPEN 以便 Apply suggestion 或在 dev 修复。

同 run 的 **`notify-blocked`**（[worker-notify-release-pr-blocked.yml](../.github/workflows/worker-notify-release-pr-blocked.yml)）会经 `action-notify-email` 发邮件；详见 [release-pr-ci.md](./release-pr-ci.md)「阻断通知」。

Caller 无需改 `ci.yml`；若某仓仅作顾问、不阻断 merge，可传 `block_merge_on_comments: false`。

## 与 orchestrator-worker PR 审计

启用 OCR 后，**PR 行级审查以 OCR 为准**。orchestrator `pr-audit-pipeline` 默认 **关闭 LLM 回帖**（`PR_AUDIT_LLM_ENABLED` 须显式 `"true"` 才启用）；避免与 OCR 双评论。

## 升级 OCR 版本

修改 reusable workflow 的 `ocr_version` default（当前 `v1.8.10`），合入 `master` 并打新 `actions/vX.Y.Z` 后 bump Worker。

## OCR Autofix（opt-in，`actions/v0.6.0+`）

OCR 有评论导致 job fail 时，可选用 Cursor CLI **restricted autonomy** 自动修复并 push，触发新一轮 `synchronize` → 重跑 qodana/OCR。

> **本仓 dogfood 暂缓**：[`ci.yml`](../.github/workflows/ci.yml) 中 `ocr-autofix` 已 `if: false`（保留代码，待 `dev_00_05_00` 手动测通后再开）。业务仓仍靠 `enable_autofix`（默认 `false`）opt-in。

| 项 | 说明 |
|----|------|
| Workflow | [ocr-autofix.yml](../.github/workflows/ocr-autofix.yml) |
| 脚本 | [tools/ocr-autofix.sh](../tools/ocr-autofix.sh)、[ocr-autofix-comments.mjs](../tools/ocr-autofix-comments.mjs)；**从可信 `scripts_ref`（默认 `actions/v0.6.0`）检出，不执行 PR head 内脚本** |
| Cursor 安装 | 下载安装器后打印 sha256；可选 Org `CURSOR_INSTALL_SHA256` 固定校验 |
| 评论预处理 | 同 `path:line` 去重；`suggestion` 已在文件中则跳过 agent；push 后 GraphQL resolve thread |
| **Session 缓存** | [ocr-pr-review](../.github/actions/ocr-pr-review)：`actions/cache` 持久化 `~/.opencodereview/sessions` + `ocr review --resume`；**未改文件不调 LLM** |
| 接入 | `worker-ci.yml` → `enable_autofix: true`（默认 `false`） |
| Secret | `CURSOR_API_KEY`（Org；Dashboard → Integrations） |
| Push | 复用 `WORKERS_WORLD_GHA_TOKEN`（默认**无** `workflow` scope） |
| 不可 autofix push | **仅** `.github/workflows/`（GitHub 强制）、`tools/ocr-autofix*`、`wrangler.toml` |
| 可 autofix push | `.github/actions/`、dependabot、issue 模板等其余 `.github/` 下文件 |
| 轮次 | commit message `[ocr-autofix N/3]`，达上限 fail → `notify-blocked` |
| Smoke | `autofix_verify_command`（默认 `npm run check`；无应用代码可传 `""`） |
| 日志 | GHA `::group::Cursor agent` 打印 tool/assistant 摘要；artifact `cursor-autofix-logs-pr-*`（raw JSONL + 摘要 + ocr-comments.json） |

业务仓示例：

```yaml
    uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/v0.5.0
    with:
      enable_autofix: true
      autofix_verify_command: "npm run check"
```

`ocr-autofix` 成功 push 后**不**发 `notify-blocked`（等待下一轮 CI）；失败或达 max 轮次才通知。
