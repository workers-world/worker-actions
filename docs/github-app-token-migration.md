# GHA_TOKEN（classic PAT）→ GitHub App token 迁移设计

> 状态：**设计稿（未实施）**。出处：[ci-audit-2026-08.md](./ci-audit-2026-08.md) 业界对标第 1 条。
> 目标：以 `actions/create-github-app-token` 短周期 installation token 替代 classic PAT `GHA_TOKEN`，消除「个人账号绑定、repo 全量 scope、长期有效」三重风险（zizmor `github-app` 审计项；CISA 指引点名的长期 pipeline 凭证反模式）。

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
| `RELEASE_BOT_APP_ID` | Org Variable 或 Secret | App ID（数字，非敏感） |
| `RELEASE_BOT_PRIVATE_KEY` | Org Secret | App 私钥（PEM） |
| `RELEASE_BOT_APP_SLUG` | Org Variable | 生成 PR/commit 归因用（可选） |

每个 workflow 用 `actions/create-github-app-token@<pin SHA>` 就地换 token：

```yaml
- name: Mint app token
  id: app-token
  uses: actions/create-github-app-token@<full-sha> # vX.Y.Z
  with:
    app-id: ${{ vars.RELEASE_BOT_APP_ID }}
    private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
    # 不传 repositories → 默认仅当前仓（最小面）
```

之后所有步骤把 `${{ secrets.GHA_TOKEN }}` 换成 `${{ steps.app-token.outputs.token }}`。**新增 secrets 不再叫 GHA_TOKEN**，避免旧 PAT 残留混用；leaf workflow 的 `secrets:` 声明同步更名（如 `RELEASE_BOT_TOKEN`），caller 由 `worker-ci` 显式映射。

## 4. 六个 workflow 的改造点

| Workflow | 现凭证用途 | 改造 |
|----------|-----------|------|
| `worker-verify` | npm.pkg.github.com 读 SDK（`NODE_AUTH_TOKEN`） | **无需 App token**：Packages 读取走 `GITHUB_TOKEN` + 包的 "Manage Actions access" 授权（现状已支持的回退路径）；App token 无 packages:read，恰好强制收紧 |
| `worker-sync-packages-lock` | bot commit + push dev_ | App token（contents:write）；checkout token 参数与 git push 均换 |
| `worker-ensure-release-pr` | 建 Release PR | App token（pull-requests:write） |
| `worker-release-auto-merge` | merge Release PR | App token（pull-requests:write） |
| `worker-promote` | 建 PR + merge | 同上 |
| `worker-sync-default-dev-branch` | PATCH default_branch | App token（administration:write，仅试点仓安装该权限场景） |
| `release-actions-bundle`（本仓） | push tag + manifest 分支 + PR | App token（contents:write + pull-requests:write） |

注意：
- App 身份合 PR 会被分支保护按「App installation」对待；若要允许它越过 "Require approvals"，在分支保护里把 App 加入 bypass list（或要求其 PR 由人工 approve —— 更推荐后者，见 §6）。
- `github-actions[bot]` 的 commit 归因不变；App 发起的 PR 作者将显示为 `workers-world-release-bot[bot]`，notify 邮件模板无需改。

## 5. 缩权技巧：两枚 App / 一枚 App 分仓安装

- `administration:write`（改默认分支）权限过大，**不要**给全 Org 安装。方案 A：单独一枚 `workers-world-default-branch-bot` 只装到需要 sync-default 的仓；方案 B：同一枚 App 但只在对应仓的 installation 中启用该权限（App 权限是 App 级的，方案 B 实际不可行，**选方案 A**）。
- `release-actions-bundle` 的 tag push 只发生在本仓，可用单独 App 或同一 App 的本仓 installation。

## 6. 分阶段灰度

1. **准备**：Org 建 App（关 webhook）→ 配 3 个 Org 变量/Secret → 在 1 个试点业务仓（建议 counter-worker）安装。
2. **试点**：leaf workflow 增加 `bot: app|pat` 输入（默认 `pat`），试点仓 caller 传 `bot: app`；两通道并存期间 GHA_TOKEN 不删。
3. **验证项**：Release PR 创建/合并、sync-lock push、notify 邮件归因、（如启用）默认分支切换、分支保护对 App merge 的实际行为。
4. **推广**：逐仓把 caller 切 `bot: app`；全部切完后下一版 bundle 把 `pat` 通道标记 deprecated。
5. **清理**：吊销旧 classic PAT；`docs/secrets-inventory.md` 更新（根 meta 仓）。

## 7. 回滚

任何一步出问题：caller 把 `bot` 传回 `pat`（或去掉该 input）即回旧链路；App token mint 步骤失败时各 leaf 已有「缺少 token → 显式报错」守卫，不会静默半发布。

## 8. 与本仓其他决策的联动

- 分支保护建议同时启用：required checks（verify/qodana/OCR）+ "Do not allow bypassing"（对 PAT **和** App 一视同仁）→ F1 的 TOCTOU 守卫有服务端兜底。
- 迁移完成后，org 层可开启 Actions policy 的 SHA-pin 强制（对第三方 action），与本 bundle 的 zizmor `ref-pin` 策略互补。
- `docs/human-gate-loops.md` 的发布闸（人只守闸）不变：App merge 仍可要求人工 approve，OCR high-severity 阻断逻辑不受影响。
