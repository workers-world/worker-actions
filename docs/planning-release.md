# Planning Release（prepare / publish 族）

可复用 workflow：[`.github/workflows/planning-release.yml`](../.github/workflows/planning-release.yml)（`workflow_call`）。

**不在此文件**：sch1 的 resolve → install → release-upload → release-deploy → summary 链。

## Caller

业务仓保留 `workflow_dispatch`（deploy-tracker Sequence 字段不变），单 job 调用 bundle：

```yaml
uses: workers-world/worker-actions/.github/workflows/planning-release.yml@actions/v0.2.33
secrets: inherit
with:
  mode: ${{ inputs.mode }}
  git_ref: ${{ inputs.git_ref }}
  # …
```

薄壳示例：[templates/planning-release-mok1.yml](../templates/planning-release-mok1.yml)、[templates/planning-release-deploy-tracker-worker.yml](../templates/planning-release-deploy-tracker-worker.yml)。

## 模式

| 消费者 | `resolve_from_platform` | `run_build_on_upload` | 说明 |
|--------|---------------------------|------------------------|------|
| mok1 | `true`（默认） | `false` | DEPLOY_ADMIN_TOKEN + `planning_version_id` → platform resolve |
| deploy-tracker-worker | `false` | `true` | `git_ref` checkout；upload 前 `npm run build` |

## Secrets（caller `secrets: inherit` 或显式映射）

| Secret | 何时需要 |
|--------|----------|
| `DEPLOY_ADMIN_TOKEN` | `resolve_from_platform=true` |
| `CLOUDFLARE_API_TOKEN` | 始终 |
| `CLOUDFLARE_ACCOUNT_ID` | 始终 |

Tag 随 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml) bump；本 workflow 随 bundle 发版进入 `actions/v*`，消费者在外层 pin 升级。
