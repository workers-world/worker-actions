# 容器 Worker 部署鉴权（GHCR + GitHub Packages）

Linear **[WW-167](https://linear.app/workers-world/issue/WW-167)** · GitHub **[worker-actions#117](https://github.com/workers-world/worker-actions/issues/117)**

在 **Cloudflare Workers Builds（容器镜像）** 或自建 `docker build` 部署流水线里，Install / Build 阶段常同时需要：

| 场景 | 典型失败 | 修复 |
|------|----------|------|
| `npm ci` 拉 `@workers-world/*` | `E403` / `read_package` | Org Secret **`GHA_TOKEN`**（`read:packages`）或包 **Manage Actions access** |
| `Dockerfile` `FROM ghcr.io/...` 私有基像 | `401 Unauthorized` | 构建前 **`docker login ghcr.io`** + `permissions.packages: read` |

日常 **Release PR verify** 仍走 [`worker-verify.yml`](../.github/workflows/worker-verify.yml)；下列 composite 供 **deploy / refresh-and-deploy** 类 workflow 复用，避免各仓复制 dld1 / fund-info 里的 bash。

## Composite actions

Pin 与 bundle 同 tag（见 [manifest/actions-bundle.yaml](../manifest/actions-bundle.yaml)），跨仓须全路径 `@actions/vX.Y.Z`。

### `ghcr-docker-login`

路径：[`.github/actions/ghcr-docker-login`](../.github/actions/ghcr-docker-login)。

在 `docker build` / `docker compose build` **之前**调用：

```yaml
permissions:
  contents: read
  packages: read

steps:
  - uses: workers-world/worker-actions/.github/actions/ghcr-docker-login@actions/vX.Y.Z
    with:
      username: ${{ github.actor }}
      token: ${{ secrets.GHA_TOKEN || secrets.GITHUB_TOKEN }}
```

### `npm-ci-github-packages`

路径：[`.github/actions/npm-ci-github-packages`](../.github/actions/npm-ci-github-packages)。

等价于 `setup-node`（registry `@workers-world`）+ 带 `NODE_AUTH_TOKEN` 的 `npm ci`，并在未配置 `GHA_TOKEN` 时打出与 verify 相同的 warning：

```yaml
permissions:
  contents: read
  packages: read

steps:
  - uses: actions/checkout@v7

  - uses: workers-world/worker-actions/.github/actions/npm-ci-github-packages@actions/vX.Y.Z
    with:
      token: ${{ secrets.GHA_TOKEN || secrets.GITHUB_TOKEN }}
      has_gha_token: ${{ secrets.GHA_TOKEN != '' }}
      # working-directory: "."   # 子目录项目可改
      # node_version: "22"
```

**Secret 约定**与 [release-pr-ci.md § GHA_TOKEN](./release-pr-ci.md#1-org-secret-gha_token) 相同：`secrets: inherit` 到 Org `GHA_TOKEN` 即可。

## 何时使用

- **需要**：仓库有私有 GHCR 基像、或 lock 指向 `npm.pkg.github.com` 的 `@workers-world` 依赖，且在 **非 worker-verify** 的 deploy workflow 里安装依赖 / 构建镜像。
- **不需要**：仅走 `worker-ci` verify、无容器 build、依赖已全部 public — 不必额外引用本页 composite。

消费者 bump pin 与发版见 [actions-releases.md](./actions-releases.md)；本 issue **不**在实现 PR 里改各业务仓 caller。

## 相关

- [actions-workflows.md § Composite actions 矩阵](./actions-workflows.md#8-composite-actions-矩阵)
- [release-pr-ci.md — GHA_TOKEN](./release-pr-ci.md)
