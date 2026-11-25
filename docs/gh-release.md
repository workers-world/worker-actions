# GitHub Release（跨仓通用）

在 **git tag 已存在** 的前提下，建或更新 GitHub Releases 页面。与「打 tag」「部署」解耦。

| 层 | 文件 | 职责 |
|----|------|------|
| **Leaf** | [`.github/workflows/create-gh-release.yml`](../.github/workflows/create-gh-release.yml) | `workflow_call`；`softprops/action-gh-release@v2` + commit-based notes（`generate_release_notes` 兜底）+ **Release 成功后发发布通知邮件**（changelog + Release 链接） |
| **Caller** | 各仓 `gh-release-on-tag.yml` | `on.push.tags` 过滤 + 传 `tag_name` |

**不采用** [semantic-release](https://semantic-release.gitbook.io/)：与 `dev_* → Release PR → master` 及 `actions/v*` bundle 发版链重复；见 [actions-releases.md](./actions-releases.md)。

## 引用矩阵

| 仓类型 | 示例 | Caller `on.push.tags` | `uses` |
|--------|------|----------------------|--------|
| Actions bundle（本仓） | worker-actions | `actions/v*` | `./.github/workflows/create-gh-release.yml`（同仓 dogfood） |
| Actions bundle（Java） | java-actions | `actions/v*` | `workers-world/worker-actions/.../create-gh-release.yml@actions/vX.Y.Z` |
| 业务 Worker | counter-worker | `v*` | 同上（跨仓 pin） |
| 个人/工具仓 | dotfiles, HexoBlogSources | `v*` | 同上（worker-actions **Public**） |

模板（复制到消费仓）：

- [`templates/gh-release-on-tag-v.yml`](../templates/gh-release-on-tag-v.yml) — `v*`
- [`templates/gh-release-on-tag-actions.yml`](../templates/gh-release-on-tag-actions.yml) — `actions/v*`

合入含 `create-gh-release` 的 bundle 后，将模板中的 `@actions/v0.1.0` bump 到实际打出 tag。

## Caller 契约

```yaml
name: Create GitHub Release
on:
  push:
    tags: ["v*"]   # bundle 仓用 actions/v*
permissions:
  contents: write
jobs:
  release:
    uses: workers-world/worker-actions/.github/workflows/create-gh-release.yml@actions/v0.1.0
    secrets: inherit
    with:
      tag_name: ${{ github.ref_name }}
```

**Secrets**

| 场景 | 推荐 |
|------|------|
| `workers-world/*` | Org `GHA_TOKEN`（`secrets: inherit`）或 `GITHUB_TOKEN` |
| 个人仓 | `GITHUB_TOKEN`（caller 须 `permissions: contents: write`） |

**发布通知邮件**

Release 建立/更新成功后，经 `action-notify-email`（notify-worker 代理）发一封纯文本通知：
`subject: [release] <repo> <tag>`，正文 = changelog（commit notes）+ Release 链接。

- **绝不阻塞发布**：`fail-on-error: false` + `continue-on-error: true` 双保险，发信失败不影响 Release 结果
- draft 不发；dedup-key `release-<repo>-<tag>` 防重跑重发；正文 >16KB 截断并指向 Release 页
- 凭证：org 级 `NOTIFY_GHA_TOKEN` secret + `NOTIFY_WORKER_URL` var（打 tag 的仓零配置继承；缺失 = 该仓静默不发）

**跨仓前提**：worker-actions 保持 Public；消费仓允许使用 public reusable workflows。

## Leaf inputs

| input | 默认 | 说明 |
|-------|------|------|
| `tag_name` | （必填） | 如 `v1.2.0` 或 `actions/v0.1.1` |
| `release_name` | `Release {tag_name}` | Release 标题 |
| `body` | 空 | 非空时覆盖自动生成的 notes |
| `exclude_commit_pattern` | `^(Merge \|chore: release \|chore: merge master )` | 从生成的 commit notes 中剔除的 subject（ERE；空 = 全保留） |
| `generate_release_notes` | `true` | **兜底**：commit notes 生成不出（如无上一个 tag、过滤后为空）时用 GitHub 自动生成（含 PR 链接） |
| `draft` / `prerelease` | `false` | 草稿 / 预发布 |

**Notes 生成规则**（`body` 为空时生效）：上一个 tag 在**同 tag 家族**内取（`v*` 或 `actions/v*`，按 `tag_name` 前缀推断），对区间跑 `git log --no-merges --format='- %s (%h)'` 并按 `exclude_commit_pattern` 过滤。GitHub auto notes 只认两个 tag 间 merge 的 PR，`dev_*` 直推 commit 会被吞掉、changelog 退化成只剩 release 管道 PR，故默认走 commit 列表；消费仓如需 auto notes，传非空 `body` 或把 `generate_release_notes` 配合空过滤使用。

同一 tag 重跑 → softprops **update** 已有 Release（幂等）。

## 发版链（bundle 仓）

```mermaid
sequenceDiagram
  participant Master as master
  participant Bundle as release-actions-bundle
  participant Tag as actions_v_tag
  participant GHR as gh-release-on-tag
  participant UI as GitHub_Releases

  Master->>Bundle: push workflows/actions
  Bundle->>Tag: git push tag
  Tag->>GHR: push tag event
  GHR->>UI: create-gh-release
```

`release-actions-bundle` 在对齐内层 pin 的 commit 上 **打 tag**；`gh-release-on-tag` 监听 tag push 建 Release 页。回填 PR（squash subject 或 merge 的 PR 标题含 `[skip actions-release]`）不会二次打 tag。

## tag 从哪来

| 仓 | 打 tag 方式 |
|----|-------------|
| worker-actions / java-actions | `release-actions-bundle` 自动 `actions/v*` |
| `framework_sdk_worker` / `framework_sdk_ui` | `ci-publish` 新发 Packages 后自动 `v{semver}` |
| 业务 / 个人仓 | 手工或脚本，例如 `git tag v1.0.0 && git push origin v1.0.0` |

Caller **不会**自动打 tag；只负责「有 tag 时建 Release」（SDK / Actions bundle 由各自发版 workflow 打 tag）。

## 外部仓迁移

### dotfiles

删除本地 `.github/workflows/release.yml` 中的 `prev_tag` / `git log` / `create-release@v1` 逻辑，替换为从 [`templates/gh-release-on-tag-v.yml`](../templates/gh-release-on-tag-v.yml) 复制的 `gh-release-on-tag.yml`。

### HexoBlogSources

同上；**保留** `hugo_deploy.yml`（`push master` → 部署）与 `gh-release-on-tag.yml`（`push v*` → Release 页）分层。

## 与旧 release.yml 对比

| 项 | dotfiles / HexoBlogSources 旧版 | `create-gh-release` |
|----|--------------------------------|---------------------|
| Changelog | `grep -A1` + `git log` | `generate_release_notes` |
| Action | Hexo 用已废弃 `create-release@v1` | `softprops/action-gh-release@v2` |
| 跨仓复用 | 每仓复制 | 单 leaf + pin tag |

## 相关

- [actions-releases.md](./actions-releases.md) — bundle tag 与 pin bump
- [actions-workflows.md §6](./actions-workflows.md#6-bundle-发版链)
