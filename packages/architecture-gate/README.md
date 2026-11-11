# @phone-as-tool/architecture-gate

零运行时依赖的架构与规范闸机。规则、probe 设计和不绕过原则见
[docs/ci-gates.md](../../docs/ci-gates.md)；被校验的机器契约和分层规范见
[docs/architecture.md](../../docs/architecture.md)。

## 使用

```text
npm run gate                         # 对真实仓库运行
node packages/architecture-gate/src/cli.mjs --format json
npm test --workspace @phone-as-tool/architecture-gate
```

退出码：0 通过，1 有违规，2 用法或内部错误。

## 结构

- `src/cli.mjs`：参数解析和输出。
- `src/gate.mjs`：规则注册、执行和汇总。
- `src/context.mjs`：读取根配置、解析 `docs/architecture.md` 的机器契约并校验。
- `src/rules/`：每条规则一个模块。
- `test/`：probe 测试；`test/fixtures/good-repo/` 是合规模拟仓库。

新增规则时先读 `docs/ci-gates.md` 第 6 节；负向 probe 和正向基线必须同时存在。
