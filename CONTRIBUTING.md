# Contributing

1. Open a PR against `master`. Fork PRs run workflow-lint only (no org secrets).
2. Pin reusable workflows with `actions/vX.Y.Z`. Never `@master` / `@main`.
3. Nested `uses:` inside this bundle must be the full path `workers-world/worker-actions/.github/…@<same-tag>`.
4. Do not add production hostnames, account IDs, or secret values to docs or workflows.
