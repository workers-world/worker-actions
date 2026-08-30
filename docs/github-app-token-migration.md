# GHA_TOKEN（classic PAT）→ GitHub App token 迁移设计

> 状态：**代码侧已实施（2026-08-30，双通道灰度）**；Org 侧建 App / 配 Secret / 试点仓 opt-in 仍需人工（见 §6 准备清单）。
> 出处：[ci-audit-2026-08.md](./ci-audit-2026-08.md) 业界对标第 1 条。
> 目标：以 `actions/create-github-app-token` 短周期 installation token 替代 classic PAT `GHA_TOKEN`，消除「个人账号绑定、repo 全量 scope、长期有效」三重风险（zizmor `github-app` 审计项；CISA 指引点名的长期 pipeline 凭证反模式）。
>
> **已落地的代码形态**：leaf workflow 新增 `bot: pat|app` 输入（默认 `pat`，零行为变化）；`bot: app` 时用 `actions/create-github-app-token@bcd2ba49… # v3.2.0`（full SHA pin）就地 mint 1h token，mint 失败 fail-closed 不回落 PAT。App mint 仅在当前仓 scope（不传 `repositories`）。

## 1. 为什么现在可行

- `GITHUB_TOKEN` 不能触发下游 workflow / 需要跨仓写，这是 PAT 存在的唯一理由；App installation token 与 PAT 一样可触发后续 workflow、可跨仓操作，但**不绑定人**、可精确到 repo 级权限、1 小时自动过期、GitHub 侧有完整审计（Installation activity）。
- 本 bundle 的写操作全部集中在 6 个 leaf workflow，改造成本可控。

## 2. App 定义（Org 级，只挂本 bundle 需要的权限）

建议 App 名：`workers-world-release-bot`（Org-owned App，安装到需要的业务仓）。

| Permission | 级别 | 用途 |
|------------|------|------|
| Contents | Read & write | sync-lock bot commit、push dev_ 分支（sync-lock）、tag/分支（release-actions-bundle） |
| Pull requests | Read & write | ensure-release-pr 建.Release PR、promote / auto-merge |
| Administration | Read & write | sync-default-branch 的 PATCH default_branch（**仅安装到需要该功能的仓**，见 §5 缩权技巧） |
| Metadata | Read-only | 强制 |

Webhook 全关（本链路不消费事件）。不给 repo events 以外任何权限；不授予 Org 权限。

## 3. Secrets / 参数布局

| 名称 | 位置 | 内容 |
|------|------|------|
| `RELEASE_BOT_APP_ID` | Org Variable（Secret 亦可） | release-bot App ID（数字，非敏感） |
| `RELEASE_BOT_PRIVATE_KEY` | Org Secret | release-bot App 私钥（PEM） |
| `DEFAULT_BRANCH_BOT_APP_ID` | Org Variable（Secret 亦可） | default-branch-bot App ID（独立 App，见 §5） |
| `DEFAULT_BRANCH_BOT_PRIVATE_KEY` | Org Secret | default-branch-bot App 私钥 |

每个 leaf 用 `actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0`（full SHA pin）就地 mint。

**作用域与限权（zizmor `github-app` 审计要求，勿删）**：

- `owner` 与 `repositories` **均不传** → token 仅限当前仓（v3 语义：传 `owner` 不传 `repositories` 反而放大到安装的全部仓）；
- 显式 `permission-*`（默认继承 App 全部安装权限，必须收敛到本 workflow 实际所需）。

```yaml
- name: Mint GitHub App token
  id: bot-token
  if: inputs.bot == 'app'
  uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
  with:
    app-id: ${{ vars.RELEASE_BOT_APP_ID || secrets.RELEASE_BOT_APP_ID }}
    private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    # owner/repositories 均不传 → token 仅限当前仓
    permission-pull-requests: write   # 按 workflow 实际需要：contents / pull-requests / administration
```

各 workflow 的 permission 矩阵：ensure-release-pr / release-auto-merge / promote → `pull-requests: write`；sync-lock → `contents: write`；sync-default（独立 App）→ `administration: write`；release-actions-bundle → `contents: write` + `pull-requests: write`。

灰度期 token 解析统一为 `${{ steps.bot-token.outputs.token || secrets.GHA_TOKEN }}`（bot=pat 时 bot-token 步骤 skip、输出为空 → 回落 PAT，行为与迁移前完全一致）。全量切 App 后再删 GHA_TOKEN 通道与 `pat` 取值。

## 4. 六个 workflow 的改造点（实施状态）

| Workflow | 现凭证用途 | 实施状态 |
|----------|-----------|----------|
| `worker-verify` | npm.pkg.github.com 读 SDK（`NODE_AUTH_TOKEN`） | ✅ 无需 App token：Packages 读取走 `GITHUB_TOKEN` + 包的 "Manage Actions access" 授权（现状已支持的回退路径）；App token 无 packages:read，恰好强制收紧。npm 认证不接 App 通道 |
| `worker-sync-packages-lock` | bot commit + push dev_ | ✅ 已支持 `bot: app`；**npm 认证与 git 认证分离**（NODE_AUTH_TOKEN 始终 GHA_TOKEN/GITHUB_TOKEN）；经 `worker-verify` 的 `bot` 输入透传 |
| `worker-ensure-release-pr` | 建 Release PR | ✅ 已支持 `bot: app`（worker-ci 透传） |
| `worker-release-auto-merge` | merge Release PR | ✅ 已支持 `bot: app`（worker-ci 透传） |
| `worker-promote` | 建 PR + merge | ✅ 独立调用时已支持 `bot: app`；⚠️ 经 `worker-verify` 的 promote 嵌套链**暂走 PAT**（与 SDK 物化的 packages 读共用 GHA_TOKEN，全量切 App 前置条件见下） |
| `worker-sync-default-dev-branch` | PATCH default_branch | ✅ 已支持 `bot: app`，用**独立 App**（`DEFAULT_BRANCH_BOT_*`，administration:write 权限过大不与 release-bot 混用，见 §5） |
| `release-actions-bundle`（本仓） | push tag + manifest 分支 + PR | ✅ 变量开关式：配置 `RELEASE_BOT_APP_ID` 变量 + `RELEASE_BOT_PRIVATE_KEY` Secret 即自动启用，无需改 workflow |

**promote 嵌套链切 App 的前置条件**：试点仓先在 `framework_sdk_worker` 包设置 "Manage Actions access" 授权（或确认 `GITHUB_TOKEN` 路径可用），随后 `worker-verify` 才能把 promote 也切到 App 通道——否则 verify 的 npm 认证会断。

注意：
- App 身份合 PR 会被分支保护按「App installation」对待；若要允许它越过 "Require approvals"，在分支保护里把 App 加入 bypass list（或要求其 PR 由人工 approve —— 更推荐后者，见 §6）。
- `github-actions[bot]` 的 commit 归因不变；App 发起的 PR 作者将显示为 `workers-world-release-bot[bot]`，notify 邮件模板无需改。

## 5. 缩权技巧：两枚 App / 一枚 App 分仓安装

- `administration:write`（改默认分支）权限过大，**不要**给全 Org 安装。方案 A：单独一枚 `workers-world-default-branch-bot` 只装到需要 sync-default 的仓；方案 B：同一枚 App 但只在对应仓的 installation 中启用该权限（App 权限是 App 级的，方案 B 实际不可行，**选方案 A**）。
- `release-actions-bundle` 的 tag push 只发生在本仓，可用单独 App 或同一 App 的本仓 installation。

## 6. 分阶段灰度

1. **准备（人工，Org Admin）**：
   - [ ] Org 建 App `workers-world-release-bot`（关 Webhook；权限：Contents RW + Pull requests RW + Metadata R）
   - [ ] Org 建 App `workers-world-default-branch-bot`（同上 + Administration RW；仅安装到需要 sync-default 的仓）
   - [ ] Org Variables 配 `RELEASE_BOT_APP_ID` / `DEFAULT_BRANCH_BOT_APP_ID`；Org Secrets 配两个 `*_PRIVATE_KEY`
   - [ ] 两枚 App 安装到试点仓（建议 counter-worker；default-branch-bot 仅装确认需要的仓）
2. **试点（代码已就绪）**：试点仓 caller 传 `bot: app`（`ci.yml` 与 `sync-default-branch.yml` 各一处）；两通道并存期间 GHA_TOKEN 不删。
3. **验证项**：Release PR 创建/合并、sync-lock push（确认 App push 触发下游 PR synchronize）、notify 邮件归因、默认分支切换、分支保护对 App merge 的实际行为。
4. **推广**：逐仓把 caller 切 `bot: app`；完成 `framework_sdk_worker` 包的 Actions 授权后，`worker-verify` 的 promote 嵌套链再切 App（见 §4 前置条件）；全部切完后下一版 bundle 把 `pat` 通道标记 deprecated。
5. **清理**：吊销旧 classic PAT；`docs/secrets-inventory.md` 更新（根 meta 仓）。

## 7. 回滚

任何一步出问题：caller 把 `bot` 传回 `pat`（或去掉该 input）即回旧链路；App token mint 步骤失败时各 leaf 已有「缺少 token → 显式报错」守卫，不会静默半发布。

## 8. 与本仓其他决策的联动

- 分支保护建议同时启用：required checks（verify/qodana/OCR）+ "Do not allow bypassing"（对 PAT **和** App 一视同仁）→ F1 的 TOCTOU 守卫有服务端兜底。
- 迁移完成后，org 层可开启 Actions policy 的 SHA-pin 强制（对第三方 action），与本 bundle 的 zizmor `ref-pin` 策略互补。
- `docs/human-gate-loops.md` 的发布闸（人只守闸）不变：App merge 仍可要求人工 approve，OCR high-severity 阻断逻辑不受影响。
