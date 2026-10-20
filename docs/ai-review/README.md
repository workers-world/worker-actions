# Self-hosted AI PR review (MVP)

替代已移除的 alibaba/open-code-review（OCR）。对齐 OpenCode 2.0 / Cloudflare 博客式 **可控规则 + 结构化 PR 反馈 + 可观测**；**不是** OCR 封装，无 OCR fallback。

跟踪：`workers-world/cloudflare_work#19` / `PGREQ20261020000015`。

## 行为

- 读取 PR unified diff + 仓内规则（`AGENTS.md`、`.ai-review/config.json`、`docs/ai-review/experts/*`）。
- MVP：**Security** + **Code quality** 两个 expert，轻量 **Coordinator** 合并为一条 sticky PR 评论（`<!-- workers-world-ai-review -->`）。
- **非 merge 门禁**：workflow job `continue-on-error: true`；LLM/发布失败不阻断 `release-auto-merge`。
- Step summary / 评论底部 `<details>` 记录 duration、model、token 用量（若 provider 返回）。

## Org 配置

| 名称 | 类型 | 说明 |
|------|------|------|
| `AI_REVIEW_LLM_TOKEN` | Secret | LLM API Key（必填才跑 review） |
| `AI_REVIEW_LLM_URL` | Variable | OpenAI-compatible `/chat/completions`（默认 DeepSeek） |
| `AI_REVIEW_LLM_MODEL` | Variable | 如 `deepseek-chat` |
| `AI_REVIEW_LLM_EXTRA_HEADERS` | Variable | 可选；AI Gateway 可设 `cf-aig-gateway-id=...` |

勿再使用 `OCR_LLM_*` / `DEEPSEEK_API_KEY`（仅服务 OCR，已移除）。

## 启用 / 禁用

| 场景 | 做法 |
|------|------|
| **worker-ci 门面** | `with.skip_ai_review: false`（默认 `true`）+ Org 配 `AI_REVIEW_LLM_TOKEN` |
| **独立 job** | 见下方 caller YAML |
| **禁用** | `skip_ai_review: true`（默认），或不配置 `AI_REVIEW_LLM_TOKEN`（preflight 跳过） |

发布新 bundle tag 后，将 `@actions/vX.Y.Z` pin 到含 `ai-pr-review.yml` 的版本（与 `worker-ci` 内嵌 job 一致）。

## Caller 示例（试点仓）

复制 [`config.example.json`](./config.example.json) → 仓根 `.ai-review/config.json`（可选；缺省用 [`default-config.json`](./default-config.json)）。

### 方式 A：`worker-ci`（推荐）

```yaml
uses: workers-world/worker-actions/.github/workflows/worker-ci.yml@actions/vX.Y.Z
secrets: inherit
with:
  sync_packages_lock: true
  skip_ai_review: false   # 试点打开
```

### 方式 B：独立 reusable workflow

```yaml
ai-review:
  if: github.event_name == 'pull_request'
  permissions:
    contents: read
    pull-requests: write
  uses: workers-world/worker-actions/.github/workflows/ai-pr-review.yml@actions/vX.Y.Z
  secrets: inherit
  with:
    skip: false
    config_path: .ai-review/config.json
```

试点建议：`dly2`、`deploy-tracker-worker` — pin bump 后去掉 `OCR_LLM_*` secrets 映射，改为 `secrets: inherit`（含 `AI_REVIEW_LLM_TOKEN`）。

## 仓内规则

- [`experts/security.md`](./experts/security.md) — 注入/密钥/SSRF/依赖等
- [`experts/code-quality.md`](./experts/code-quality.md) — 可读性、错误处理、测试缺口
- 可选 `docs/ai-review/repo-context.md` 补充团队约定

## 后续（本 repo 外）

- `java-actions` / `container-actions` 模板去掉 OCR job
- 业务仓 `ci.yml` 批量移除 `OCR_LLM_*`
- Org secrets-inventory 标记 OCR 废弃、登记 `AI_REVIEW_*`
