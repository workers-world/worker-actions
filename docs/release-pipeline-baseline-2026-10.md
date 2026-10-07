# 发布管线基线（Phase A 采样）

> 生成时间（UTC）：2026-10-07T15:57:47.144Z
> 工具：`node tools/release-pipeline-benchmark/analyze.mjs` — 方案见 [release-pipeline-benchmark.md](./release-pipeline-benchmark.md)
> 关联：[WW-148](https://linear.app/drone01/issue/WW-148) / [issue #93](https://github.com/workers-world/worker-actions/issues/93)

## 采样范围

- **worker-actions** (`workers-world/worker-actions`)：`ci.yml`, `release-actions-bundle.yml`, `gh-release-on-tag.yml`
- **mok1** (`workers-world/mok1`)：`ci.yml`, `planning-release.yml`
- 每 workflow 成功 run 上限：**25**（conclusions=success)
- **未采样** `workers-world/deploy-tracker-worker`：本 run 的 token 无法访问该仓（404）；若后续授权可加入 profile
- **Cloudflare Builds**：Phase A 未配置 CF API 凭据；阶段级 CF Builds 耗时需 Phase A+ 或人工 Dashboard 导出

## Machine 指标 — workflow run 墙钟（p50 / p95，秒）

| 分组 | n | p50 | p95 | min | max |
| --- | --- | --- | --- | --- | --- |
| workers-world/mok1 | CI (Worker CI caller) (pull_request) | 9 | 50.0 | 80.6 | 31.0 | 83.0 |
| workers-world/worker-actions | CI (dogfood PR/push) (pull_request) | 20 | 38.5 | 56.1 | 29.0 | 58.0 |
| workers-world/mok1 | CI (Worker CI caller) (push) | 10 | 24.5 | 48.0 | 15.0 | 57.0 |
| workers-world/worker-actions | CI (dogfood PR/push) (push) | 5 | 37.0 | 44.8 | 36.0 | 46.0 |
| workers-world/worker-actions | Release actions bundle (push) | 12 | 14.0 | 23.4 | 6.0 | 24.0 |
| workers-world/worker-actions | Release actions bundle (workflow_dispatch) | 10 | 15.0 | 19.1 | 11.0 | 20.0 |
| workers-world/worker-actions | Create GitHub Release (tag push) (push) | 25 | 15.0 | 17.0 | 10.0 | 49.0 |

## Machine 指标 — job 墙钟 Top 20（按 p95）

| job | n | p50 | p95 |
| --- | --- | --- | --- |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint | 25 | 34.0 | 41.8 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / workflow-lint / lint | 9 | 15.0 | 36.8 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify | 9 | 26.0 | 32.2 |
| workers-world/worker-actions | Release actions bundle | tag | 18 | 11.0 | 14.6 |
| workers-world/worker-actions | Create GitHub Release (tag push) | release / release | 25 | 10.0 | 12.8 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / release-auto-merge / merge | 7 | 10.0 | 11.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / sync-lock / sync-lock | 10 | 7.5 | 10.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / ensure-release-pr / ensure | 10 | 5.0 | 6.5 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / lock-precheck | 1 | 6.0 | 6.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / ci-summary | 19 | 3.0 | 4.0 |
| workers-world/worker-actions | Release actions bundle | gate | 5 | 3.0 | 3.8 |

## Machine 指标 — step 墙钟 Top 30（按 p95）

| step | n | p50 | p95 |
| --- | --- | --- | --- |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint :: Pin 检查（禁止 @master/@main/@HEAD） | 25 | 20.0 | 21.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Run npm ci | 9 | 6.0 | 17.4 |
| workers-world/worker-actions | Create GitHub Release (tag push) | release / release :: Create or update GitHub Release | 25 | 8.0 | 8.0 |
| workers-world/worker-actions | Release actions bundle | tag :: Resolve version, create tag, open manifest PR | 16 | 5.0 | 7.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / release-auto-merge / merge :: Merge release PR | 7 | 6.0 | 6.7 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Post Run actions/setup-node@v7 | 9 | 2.0 | 6.6 |
| workers-world/worker-actions | Release actions bundle | tag :: Resolve version, align pins, create tag, open backfill PR | 2 | 5.5 | 5.9 |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint :: Install zizmor | 25 | 4.0 | 5.0 |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint :: Run actions/setup-node@v7 | 25 | 1.0 | 4.8 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / workflow-lint / lint :: Install zizmor | 9 | 4.0 | 4.6 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Run actions/setup-node@v7 | 9 | 2.0 | 4.6 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Run actions/checkout@v7 | 9 | 1.0 | 4.4 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / workflow-lint / lint :: Run actions/setup-node@v7 | 9 | 1.0 | 4.2 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Materialize SDK from GitHub Packages | 9 | 2.0 | 3.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / ensure-release-pr / ensure :: Open release PR if missing | 10 | 0.5 | 2.6 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Run npm run check | 9 | 2.0 | 2.6 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / sync-lock / sync-lock :: Run actions/setup-node@v7 | 10 | 0.5 | 2.1 |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint :: Run actions/checkout@v7 | 25 | 1.0 | 2.0 |
| workers-world/worker-actions | CI (dogfood PR/push) | workflow-lint / lint :: Checkout zizmor baseline | 25 | 1.0 | 2.0 |
| workers-world/worker-actions | Release actions bundle | tag :: Set up job | 18 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / workflow-lint / lint :: Checkout zizmor baseline | 9 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / lock-precheck :: Run workers-world/worker-actions/.github/actions/package-lock-in-sync@actions/v0.2.24 | 1 | 2.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Set up job | 9 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: npm test | 9 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / release-auto-merge / merge :: Ensure GitHub CLI | 7 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / sync-lock / sync-lock :: Set up job | 10 | 1.5 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / sync-lock / sync-lock :: Run actions/checkout@v7 | 10 | 1.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / verify / verify :: Wait for sync-lock bot on PR head (if lock stale) | 8 | 0.0 | 2.0 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / ensure-release-pr / ensure :: Checkout release branch | 2 | 1.5 | 1.9 |
| workers-world/mok1 | CI (Worker CI caller) | release-pr / release-auto-merge / merge :: Set up job | 7 | 1.0 | 1.7 |

## Calendar 指标（与 machine 分开统计）

从 bundle tag 时间点起，到消费者仓出现 bump commit / 首次 CI 成功 run（任意分支，启发式；含人工等待与回填）。

| tag | consumer | tag→bump (s) | tag→CI绿 (s) | bump SHA |
| --- | --- | --- | --- | --- |
| actions/v0.2.17 | mok1 | — | — | — |
| actions/v0.2.18 | mok1 | — | — | — |
| actions/v0.2.19 | mok1 | — | — | — |
| actions/v0.2.20 | mok1 | — | — | — |
| actions/v0.2.21 | mok1 | — | — | — |
| actions/v0.2.22 | mok1 | — | — | — |
| actions/v0.2.23 | mok1 | 1049.0 | 4904.0 | 05e25cb |
| actions/v0.2.24 | mok1 | 213.0 | 2879.0 | 442e47d |

## ROI 优化清单（Phase B 候选；本 PR 不实施）

| 优先级 | 方向 | 证据 |
| --- | --- | --- |
| P1 | 缩短最慢 job 段：`workflow-lint / lint` | 数据支撑：job p95=41.8s（n=25） |
| P1 | 缩短热点 step：`Pin 检查（禁止 @master/@main/@HEAD）` | 数据支撑：step p95=21.0s（n=25） |
| P1 | 消费者 verify 路径：npm ci 缓存/并行/条件跳过（无 lock 变更） | 数据支撑：npm ci p50=6.0s p95=17.4s |
| P2 | workflow-lint：zizmor 安装/基线 checkout 缓存或 pin 到预装 runner 镜像 | 数据支撑：相关 step p95=5.0s |
| P2 | release-auto-merge：调查 merge step 等待（API/branch protection） | 数据支撑：Merge release PR p95=6.7s |
| P1 | 消费者 Release PR 整 run 墙钟（含 verify 矩阵与 auto-merge） | 数据支撑：mok1 CI PR p95=80.6s |
| P3 | bundle 打 tag 路径已很短；优化重心应在消费者 verify 与 calendar 等待 | 数据支撑：release-actions-bundle p95=23.4s |
| P2 | 空 Release（0 files）短路 / 跳过 ensure-release-pr | 假设待验证：需标注 0-file Release PR 样本量后对比 |
| P2 | CF Builds 与 GH verify 重复工作合并 | 假设待验证：本 Phase 未接入 CF Builds API |
| P1 | Phase B 回填 PR + 消费者 bump 自动化（缩短 calendar） | 数据支撑：actions/v0.2.23 tag→bump 1049.0s（mok1） |

## 复跑

```bash
node tools/release-pipeline-benchmark/analyze.mjs \
  --profile tools/release-pipeline-benchmark/profiles.phase-a.json \
  --write docs/release-pipeline-baseline-2026-10.md \
  --json docs/release-pipeline-baseline-2026-10.json
```
