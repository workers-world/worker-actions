{
  "rules": [
    {
      "path": "**/.github/workflows/*.{yml,yaml}",
      "merge_system_rule": true,
      "rule": "GitHub Actions（workers-world Release PR 模型）：\n- 使用 `uses:` 调用 reusable workflow 的 caller job **禁止** 写 `runs-on`、`timeout-minutes`、`steps`；caller 仅允许 `uses`/`with`/`secrets`/`needs`/`if`/`permissions`\n- 需要 job 超时时，在 **被调 workflow**（workers-world/worker-actions）内带 `runs-on` 的 job 上设 `timeout-minutes`，勿在业务仓 caller 的 ci.yml 里加\n- 跨仓 pin：`workers-world/worker-actions/.github/workflows/…@actions/vX.Y.Z`（禁止 `@master`）\n- PAT / NOTIFY Secret 写操作（ensure-release-pr 建 PR、release-auto-merge 合入、sync-default-branch 改 default_branch、notify-blocked 发信）：caller job **必须** 显式 `permissions: {}`，**禁止** `contents: write`/`contents: read`/`pull-requests: write`——这些写操作不经 GITHUB_TOKEN\n- Release PR：`pull_request` → master 跑 qodana + OCR；OCR 有 comment 时不得 auto-merge，须在 dev_* 修复后 push 重跑\n- Org Secret：`WORKERS_WORLD_GHA_TOKEN`（`secrets: inherit`）；OCR LLM：`OCR_LLM_TOKEN`"
    },
    {
      "path": "**/*.{ts,js,mjs}",
      "merge_system_rule": true,
      "rule": "Cloudflare Worker（{{WORKER_NAME}}）：\n- Env 定义放在 env.ts，禁止在 index.ts 内联 Env\n- routes/ 只调 services/，不得直接访问 env.DB_* / KV / Queue 等 binding\n- Service Binding 须用 hostname https://<short-name>，Bearer 用规范 *_AUTH_TOKEN\n- 禁止在代码或日志中输出 secret / token 明文\n{{WORKER_EXTRA_RULES}}"
    }
  ]
}
