# Security expert (seed rules)

- 禁止硬编码 secret、API key、私钥；检查 env 与日志泄露。
- 用户输入进入 shell/SQL/路径/URL 须有边界校验（Workers：注意 fetch 目标 SSRF、HTML 注入）。
- 鉴权/授权：默认拒绝；跨 tenant 数据隔离。
- 依赖：已知高危模式（eval、动态 require 不可信源）。
- 报告 severity：high = 可利用或明确 secret 泄露；medium = 需环境配合；low = 防御性建议。
