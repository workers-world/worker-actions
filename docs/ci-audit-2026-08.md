# worker-actions CI/CD 流程审计报告（2026-08）

> 审计范围：`.github/workflows/`（19 个 workflow，约 2600 行 YAML）、`.github/actions/`（6 个 composite action）、`tools/`（2 个 Node 脚本）、`templates/`、`docs/`、manifest 与 dependabot 配置。
> 对标基准：GitHub 官方 secure-use 文档、zizmor 审计规则（1.29）、CISA/NSA《Defending CI/CD Environments》、release-please 等业界 Release PR 方案。
> 状态标记：✅ 已随本报告同批修复；📋 已记录、择期处理。

## TL;DR

整体设计成熟度显著高于常见的自研 Actions bundle：job 级最小权限 + PAT/GITHUB_TOKEN 写读分离、actionlint+shellcheck 前置门禁、Qodana 限频 gate、OCR session cache、`add-mask`/HTML 转义/`::` 注入防护、fail-open vs fail-closed 的显式取舍都有清晰思考。本轮审计发现 **1 个链路级竞态缺陷（P1）、1 类可触发的输出注入（P1）、1 个实际不可用的第三方 action 引用（P1）、一批与 zizmor/官方基准的差距项（P2）**，均已修复；遗留 P3 以工程优化为主。

---

## 既有亮点（业界对标中已达标的部分）

| 项 | 说明 |
|----|------|
| 写读分离 | 写操作（建 PR / merge / push / 改默认分支）一律走 PAT，GITHUB_TOKEN 保持 `permissions: {}`；可复用 workflow 权限只能收紧不能放大 |
| 廉价前置门禁 | workflow-lint（actionlint + shellcheck + pin 检查 + 卫生 + 凭据 regex）先于 LLM/重 job，fast-fail 省成本 |
| OCR session cache | GHA cache + `--resume`，未改文件跳过 LLM 调用；同 PR concurrency 取消过期 run |
| Qodana 限频 | org 开关 + 路径过滤 + per-PR 节流，控制 Docker 扫描成本 |
| PR head SHA checkout | verify/qodana checkout head SHA 而非 `pull/N/merge`，避免 stale merge ref |
| 输出卫生 | `::add-mask::` 遮蔽 LLM token；邮件 HTML `escapeHtml`；行首 `::` 转义防 workflow command 注入；`gh-run-annotations.mjs` 用随机 UUID heredoc 定界符 |
| 威胁模型注释 | `pull_request_target`（outdated-pr-check）明确「禁止 checkout PR head / 只调 API」 |
| 版本纪律 | 禁 `@master`、manifest 回填、方案 B（tag 先存在再 bump 消费者）文档化 |
| 工具链 | actionlint + shellcheck + Dependabot（周更 + 分组）+ CODEOWNERS + SECURITY.md |

---

## P1 — 实质缺陷（✅ 全部修复）

### F1. release-auto-merge TOCTOU：可能合入未验证的 head
- 位置：`worker-release-auto-merge.yml`（原 71-86 行）
- 问题：门禁（verify/qodana/OCR）只验证过 event 里的 head SHA；merge 前未断言 PR 当前 `headRefOid` 仍等于该 SHA。PR synchronize 会取消旧 run，但**取消是异步的**——旧 run 的 merge 步骤若已在执行，会把新 push 的、未过门禁的代码合入 master。merge 走 PAT，若分支保护未堵 bypass（如 PAT 属 admin 且 ruleset 未开 "Do not allow bypassing"），无服务端兜底。
- 修复：新增必填 input `head_sha`（caller 传 `github.event.pull_request.head.sha`）；merge 前 `gh pr view --json headRefOid` 不等于 `head_sha` 即 exit 1，由新 push 触发的 run 重跑门禁。`worker-ci.yml` 与 `docs/templates/ci-release-pr.yml` 示例已同步。

### F2. GITHUB_OUTPUT 固定 `EOF` 定界符 → 输出注入
- 位置：`tools/build-release-pr-blocked-email.mjs`（writeOutput）、`worker-notify-release-pr-blocked.yml`（fallback body heredoc）
- 问题：annotations 内容来自本 run 的错误消息（可含用户代码/日志）；出现单独一行 `EOF` 会截断 heredoc，后续行被解析成新的 output 键，污染 subject/body/html（下游 `with:` 直接消费这些 output）。
- 修复：随机 UUID 定界符（与 `gh-run-annotations.mjs` 既有做法统一）；notify workflow 内联 heredoc 同改。本地已用含 `EOF` 行的 annotations 模拟验证。

### F3. 第三方 action 引用了移动分支
- 位置：`worker-qodana-scan.yml` → `JetBrains/qodana-action@v2026.2`
- 问题：`v2026.2` 在上游是 **branch**（非 tag），可漂移—— Org 开启 Qodana 时每次扫描的 action 代码都可能在变。
- 修复：pin 到等价 commit `b588768b…`（= v2026.2.0 tag），注释说明。

### F4. 模板注入面（zizmor template-injection 类）
- 位置：`worker-ensure-release-pr.yml`（`pr_title_prefix` 内插 shell）、`qodana-scan-gate/action.yml`（inputs 直接作 shell 参数）、`worker-qodana-scan.yml`（outputs/head_sha 内插 + `node -e` 字符串内插）、`qodana-parse/action.yml`（skip_reason 等）、`open-code-review.yml`（github-script `Number('${{ inputs.pr_number }}')`）
- 风险评级说明：输入来自 caller workflow YAML（org 内可信），实际攻击者需已控制 caller 仓，实战风险低；但 bundle 是全 org 复制的样板，坏写法会被业务仓放大。
- 修复：全部改为 `env:` 传递；github-script 直接用 `process.env`。

### F5. 卫生
- 删除空目录 `.github/actions/qodana-suggest-fix/`（无 action.yml，git 不跟踪但误导维护者）。
- `open-code-review.yml` / `worker-notify-release-pr-blocked.yml` 中 `secrets.GHA_TOKEN != '' && secrets.GHA_TOKEN != ''` 重复条件笔误。

---

## P2 — 业界差距与一致性（✅ 全部修复）

### F6. 第三方 action 未 pin SHA
- `softprops/action-gh-release@v2` → pin `3bb12739… # v2`。GitHub 官方定调：**pin 到 full-length commit SHA 是唯一不可变引用**（secure-use 文档）；org 层可再叠加 SHA-pin 强制策略（2025-08 Actions policy changelog）。
- 保留 `actions/*`（GitHub 第一方）tag pin：官方构建 + 供应链保护 + Dependabot 周更 + cooldown，业界普遍接受；zizmor 基线中以 `actions/*: ref-pin` 策略显式放行。

### F7. `secrets: inherit` 全链路收敛
- zizmor 1.1+ 专设 `secrets-inherit` 审计："should almost never be used"（违反最小授权）。
- 修复：入口层（业务仓 → `worker-ci`）保留 inherit；`worker-ci` 内部 8 个 leaf 全部显式映射最小集（verify/ensure/auto-merge/promote → `GHA_TOKEN`；qodana → `QODANA_TOKEN`；ocr → `OCR_LLM_*`/`DEEPSEEK_API_KEY`/`GHA_TOKEN`；notify → `NOTIFY_GHA_TOKEN`/`GHA_TOKEN`；lint/failure-comment 无 secret）。`gh-release-on-tag`、`worker-promote-gated` 的 inherit 一并移除。
- 配套：各 leaf 的 `required: true` secret 翻转为 `required: false`（原有运行时守卫会给出更精准的修复指引，且避免「未配置 Org 时 caller 侧报错信息不可读」）。

### F8. dependabot 未覆盖 composite actions + 无 cooldown
- composite action 目录内 `action.yml` 的 `uses` 默认不被 `directory: "/"` 扫描（dependabot-core#6704）→ 已按目录显式列出 6 个 action。
- 增加 `cooldown: default-days: 7`（上游发版被撤回/投毒的观察窗；zizmor `dependabot-cooldown`）。

### F9. 下载二进制无完整性校验
- actionlint / gh（5 处安装）原为 `curl | tar` 直灌。
- 修复：运行时下载官方 `checksums.txt` 后 `sha256sum -c`（actionlint、cli/cli 均发布官方 checksums；本地已验证管道逻辑）。shellcheck 官方不发 checksums → 保留并留 TODO（可考虑固化 SHA256 或改源）。

### F10. sync-lock push 把 token 拼进 URL
- `git push https://x-access-token:${PUSH_TOKEN}@github.com/...` 在 git 报错路径上有泄漏面。checkout 已 `persist-credentials`，直接 `git push origin HEAD:$REF`。`PUSH_TOKEN` env 已删。

### F11. worker-promote 缺 concurrency（zizmor `concurrency-limits`）
- 部署类 job 同 dev_ 分支两次 push 会并行抢 merge。加 `concurrency: promote-${{ github.repository }}-${{ inputs.release_branch }}`（排队不取消）。

### F12. manifest / README / 内层 pin 三方漂移
- 审计时：manifest `current: actions/v0.1.0` + `sha: ""`；内层与 templates 已是 v0.1.2；README/模板注释仍写 v0.1.0 —— docs 自己定义的「外层升内层没升」正在发生。
- 修复：manifest 回填至 v0.1.2（含真实 SHA）；README/模板/内层 pin 全部对齐 v0.1.3（本批发版目标 tag）；**workflow-lint 新增「内层 pin 一致性」检查**（`.github/workflows` + `.github/actions` + `templates` + `docs/templates` 内所有 `@actions/vX.Y.Z` 必须同版本），防止复发。

### F13. 本仓 ci.yml 与文档脱节
- 实际 `ci.yml` 只剩 fork-safe 的 workflow-lint（无 secrets），但 `docs/actions-workflows.md §4.2`、`docs/actions-releases.md` 仍描述「push dev_* 自动 ensure-release-pr → auto-merge」，且引用不存在的 `smoke-dollar-self` workflow；`templates/ci-release-pr.yml` 注释引用已删除的 `enable_autofix` 入参（取消注释会让 caller 直接校验失败）。
- 修复：文档按实际重写（发版第一步 = 人工开 Release PR）、删模板幽灵入参、`docs/templates/ci-release-pr.yml` 展开式示例补 `head_sha` 并对齐 pin。

### F14. zizmor 接入 workflow-lint（工具链闭环）
- 业界标准三件套：actionlint（正确性）+ zizmor（安全）+ Dependabot（更新）。GitHub 自家仓库也在用 zizmor。
- 落地：`zizmor.yml` 基线配置（policies：`actions/*` 与 `workers-world/*` ref-pin，其余默认 hash-pin）+ composite 内行内 `# zizmor: ignore[...]`（每条带理由）+ workflow 级 artipacked 按文件 ignore；lint workflow 新增安装（PyPI 固定版本 + venv）与 `--min-severity medium` 阻断步骤。
- 本地验证：`zizmor --min-severity medium .` → **No findings to report**（14 ignored 均带理由，57 suppressed 为策略放行/低于阈值）。

---

## P3 — 已记录，择期处理（📋）

| 项 | 位置 | 说明 |
|----|------|------|
| qodana 无 `needs: workflow-lint` | worker-ci.yml | 与「lint 先于重 job」注释意图不一致；lint 红时 Docker 白跑。但因 qodana 自带限频 gate，影响小 |
| blocking gate 重复 parse | worker-qodana-scan.yml 末步 | 应复用 `steps.parse.outputs.pass`，现重跑一次 qodana-parse（fail_only） |
| `printf '%b'` 格式串 | worker-ci-failure-comment.yml | HEAD_REF 含 `%` 时 printf 报错（git refname 允许 `%`）；建议改 here-doc 拼接 |
| notify-blocked 死分支 | worker-ci.yml notify if | 「auto-merge skipped + 四门全绿」分支被 draft/fork 过滤条件覆盖，逻辑不可达 |
| ensure-gh-cli 5 份拷贝 | 4 个 leaf 内联 + 1 composite | bundle 仓公开后，内联的前提（私有仓 codeload 404）已弱化；可评估全部收敛为 composite 引用（checksum 逻辑也随之单点化） |
| `fetch-depth: 0` 偏多 | 多个 workflow | 大仓慢；verify/lint 需要全量，qodana/ocr 可评估 2 级 fetch |
| SDK 物化目录 | worker-verify.yml | 写到 `GITHUB_WORKSPACE/../`，self-hosted 下有残留风险；建议 `RUNNER_TEMP` + 先清目录 |
| 自写凭据 regex | workflow-lint | 可换 gitleaks（org 已有 worker-support-action 在跑 gitleaks），误报更少 |
| pin 检查覆盖面 | workflow-lint | 只扫 `.github/`，`templates/`/`docs/templates/` 未纳入（内层一致性检查已纳入） |
| `ocr_version` 无格式校验 | open-code-review.yml | `actions_bundle_ref` 有白名单校验，`ocr_version` 没有；建议同样限制为 `vX.Y.Z` |
| release-actions-bundle 缩进 | 61-110 行 | shell if/else 缩进混乱，维护性 |
| create-gh-release 语义 | — | softprops 与 `gh release` 功能重叠（zizmor superfluous-actions 提示）；可评估原生 CLI 替换，进一步去第三方依赖 |

---

## 业界对标结论（差距清单）

1. **凭证模型（最大差距项）**：classic PAT（`GHA_TOKEN`，repo 全量 scope、绑定个人账号、跨全部业务仓）→ 业界现状是 GitHub App token（`actions/create-github-app-token`：短生命周期、按 installation+repo 授权、机器身份审计）。zizmor `github-app` 审计直接覆盖。→ 迁移设计见 [github-app-token-migration.md](./github-app-token-migration.md)。
2. **版本引用**：SHA pin 为唯一不可变引用 + org 级 SHA-pin 强制策略（GitHub 2025-08 起）。本 bundle 已折中：第三方 SHA pin、第一方/自有 tag pin（ref-pin 策略显式化 + Dependabot + cooldown）。
3. **部署闸门**：业界用 GitHub Environment（required reviewers）+ per-env concurrency + 分支保护 auto-merge；本 bundle 用 PAT 脚本直接 merge（已补 concurrency 与 TOCTOU 守卫，语义上仍是「脚本合并」）。App token 迁移后可平滑切到 Environment 闸门。
4. **Release PR 方案**：release-please/changesets 已覆盖 PR 创建/版本计算/changelog；本 bundle 的 promote 语义（发版≠部署）自建有价值，PR 生成部分未来可评估交给 release-please，收敛自维护攻击面。
5. **Cloudflare 部署凭证**：wrangler-action 至今不支持 OIDC/trusted publishing（open issue #402）——API token 是业界当前下限；改进方向是最小权限 Account token + 轮换 + 审计，或迁 Cloudflare Workers Builds（GitHub App，token 不出 Cloudflare）。
6. **平台演进对齐**：GitHub 2026 安全路线（secure by default、policy controls、scoped secrets）意味着宽 permissions、pull_request_target 依赖、个人 PAT 都在收缩名单上；本 bundle 的加固方向与之一致。

## 验证记录（本批修复）

- `actionlint 1.7.12`（与 CI 同版本、同 ignore 集）+ `yamllint`：全部 workflow/action 无告警
- `zizmor 1.29.0 --min-severity medium .`：No findings（基线 `zizmor.yml` + 行内 ignore 均带理由）
- `node --check` 两个工具脚本通过；随机定界符输出含 `EOF` 行的 annotations 模拟通过
- checksum 管道（grep|sed|sha256sum -c）用官方 checksums.txt 实测 OK
- 内层 pin 一致性：28 处引用全部 `@actions/v0.1.3`
