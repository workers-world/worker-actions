# 发布管线 Benchmark 方案（WW-148 Phase A）

关联：[GitHub issue #93](https://github.com/workers-world/worker-actions/issues/93) · [WW-148](https://linear.app/drone01/issue/WW-148)

Phase A **只度量、不优化**发版 workflow；试点改 pipeline 属于 Phase B / 后续 issue。

## 测什么

### Machine（墙钟，可自动化）

从 GitHub Actions API 读取 **真实** workflow run（只读，不为 benchmark 触发 workflow）：

| 路径 | 仓库 | Workflow | 含义 |
|------|------|----------|------|
| Bundle 发 tag | `workers-world/worker-actions` | `release-actions-bundle.yml` | master 合入后 destin→`actions/v*` tag（含 gate + tag job / step） |
| Tag → GH Release | 同上 | `gh-release-on-tag.yml` | tag push 后 Create GitHub Release |
| 本仓 dogfood | 同上 | `ci.yml` | PR/push 上 workflow-lint 等 |
| 消费者 Release PR | `workers-world/mok1`（优先） | `ci.yml` | 调用 `worker-ci` 的 verify / auto-merge 全链路 |
| Planning Release | `workers-world/mok1` | `planning-release.yml` | 规划发版（若有 run 则纳入） |

**聚合维度**：run 总墙钟 → job → step；对每维度计算 **p50 / p95**（秒）。

Docker **不**作为发版周期基线；仅允许在本地调试分析脚本时使用。

### Calendar（与 machine 分开）

**destin → 消费者可用**（含回填 PR、人工 bump、排队）：

1. 取 bundle `actions/v*` tag 的 commit 时间；
2. 在消费者仓搜索引用该 tag 的 bump commit（GitHub commit search）；
3. 取 bump 之后 `master` 上首次 **成功** 的 `ci.yml` run 完成时间。

启发式，可能漏检 squash message 变体；结果仅作 calendar 参考，不与 machine 混算。

### Cloudflare Builds（已知缺口）

Phase A **未**接入 CF Builds / Observability API（需账号凭据）。消费者「部署可用」的 CF 阶段耗时请从 Dashboard 导出或后续 issue 接 MCP。

### 备用 fixture

`workers-world/deploy-tracker-worker`：profile 已预留；当前采样 token 对该仓 **404**，未纳入基线。

## 怎么采

工具目录：`tools/release-pipeline-benchmark/`

```bash
# 依赖：Node 20+、gh CLI 已 login（或 export GITHUB_TOKEN）
node tools/release-pipeline-benchmark/analyze.mjs \
  --profile tools/release-pipeline-benchmark/profiles.phase-a.json \
  --write docs/release-pipeline-baseline-2026-10.md \
  --json docs/release-pipeline-baseline-2026-10.json
```

| 参数 | 说明 |
|------|------|
| `--profile` | 采样仓库 / workflow 列表（见 `profiles.phase-a.json`） |
| `--runs N` | 每个 workflow 最多 N 条成功 run（默认 25） |
| `--write PATH` | 写入 Markdown 基线表 + ROI 清单 |
| `--json PATH` | 写入聚合 JSON（默认不含原始 run 明细） |
| `--include-samples` | JSON 内附带逐步明细（体积大，本地调试用） |
| `--verbose` | stderr 进度 |

实现要点：

- REST：`/actions/workflows/{id}/runs`、`/actions/runs/{id}/jobs`（step 的 `started_at` / `completed_at`）
- 简单退避处理 429/5xx
- 分位数：排序 + 线性插值（`lib/stats.mjs`）

## 产出物

| 文件 | 内容 |
|------|------|
| [release-pipeline-baseline-2026-10.md](./release-pipeline-baseline-2026-10.md) | 首次采样的 **基线表** + **ROI 优化清单**（标注数据支撑 vs 假设） |
| [release-pipeline-baseline-2026-10.json](./release-pipeline-baseline-2026-10.json) | 同上数据的机器可读聚合 |
| 本文 | 方案与复跑说明 |

## Phase B 验收约定（未在本 PR 实施）

对 ROI 清单中的每一项试点优化：

1. 合入前后用 **同一 profile + `--runs`** 重跑本工具；
2. 对比同一分组（如 `mok1 | CI | pull_request`）的 run p95 与 Top step p95；
3. calendar 行单独对比 tag→bump / tag→CI 绿间隔。

## 非目标（Phase A）

- 不改 release / publish workflow 以「刷快」
- 不为 benchmark 额外触发 workflow 消耗额度
- 不引入重型外部 APM
