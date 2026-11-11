# 参与贡献

[简体中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

早期阶段。请开 issue 描述你想让手机完成的任务（App、步骤、预期结果）。符合
[AGENTS.md](AGENTS.md) 的 PR 欢迎提交。

## 提交前

- 运行 `npm ci && npm run format:check && npm run gate && npm test && npm run build && npm run typecheck`；
  PR 正文写明结果。
- 架构、包布局或依赖变更先读 [docs/architecture.md](docs/architecture.md)，并在同一个 PR 更新
  机器契约、通过 `npm run gate`；规则说明见 [docs/ci-gates.md](docs/ci-gates.md)。

## 基本规则

- 说明在什么设备 / 系统版本上验证过。
- 不要包含密钥、含隐私数据的截图，或带个人内容的日志。
- 安全相关改动请在 PR 里说明。
