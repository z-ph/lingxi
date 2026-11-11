# AGENTS.md —— 这个仓库的工作方式

[简体中文](AGENTS.md) | [English](AGENTS.en.md)

本仓库由主动式 agent（dsh-superagent）在人类所有者授权下运营。人和 agent 遵守同一套规则。

## 语言

仓库以**简体中文为主、英文为辅**：

- README、docs/ 下的主版本用中文；英文镜像放 README.en.md、docs/en/。
- issue、PR 标题和正文、提交信息用中文；PR 描述末尾可附一段简短英文摘要（English summary）。
- 与所有者沟通用中文。

## 事实来源

docs/ 是契约。代码服从文档；需要改设计时，同一个 PR 里更新文档并说明原因（中英文版本都改，
或先改中文并标注英文待同步）。README 是产品表述，必须与现状一致。

- 技术栈、包布局、分层与依赖规则的唯一来源是 [docs/architecture.md](docs/architecture.md)；
  其中机器契约只出现在中文主版本，由 `npm run gate` 直接校验。
- 机器闸机的规则和 probe 见 [docs/ci-gates.md](docs/ci-gates.md)；巡检节奏和清单见
  [docs/architecture-review.md](docs/architecture-review.md)。
- 改架构先改文档和机器契约，再改代码；不要用代码或 CI 配置制造第二份事实。

## 范围纪律

- 一个 issue 对应一个 PR。只改 issue 要求的内容，其余另开 issue。
- 当前处于 M1：允许并期待直接提交实现代码；新建目录、包、配置文件都在授权范围内，不需要额外批准。
- 不以“需要新代码”“需要真机”“当前环境无法验证”为由拒绝 issue。真机相关验收项用假设备适配器与自动化测试覆盖，无法在仓库内验证的限制在 PR 正文如实写明。
- 不要改：许可证、仓库设置、topics、发布/打标签、CI 供应商、品牌。这些需要人类批准。
- 不轻易加依赖；要加就说明原因、体积和许可证。运行时依赖必须登记到
  [docs/architecture.md](docs/architecture.md) 的 `runtimeDependencies`。
- 仓库是 npm workspaces monorepo：产品代码只放 `packages/*`，根目录只放 workspace/工具链配置。
  新增包、依赖或跨层调用必须在同一个 PR 更新 `docs/architecture.md` 的机器契约。
- 不要绕过 CI 闸机（`continue-on-error`、注释工作流、删除规则、缩小扫描范围）；例外按
  [docs/architecture.md](docs/architecture.md) 第 7.3 节处理。
- 不直接推 main；一律开 PR。
- 合并规则：PR 必须由人类在 GitHub 上明确 Approve 后，worker 才能合并；未获批准不得合并。不得自行 Approve，不得开启自动合并。
- 默认使用 Squash merge（压缩合并）：一个 PR 压成一个提交进 main，保持线性历史。
- PR 正文必须包含一行英文关闭关键字（例如 Closes #12），合并后由 GitHub 自动关闭对应 issue；只关联不关闭时用 Refs #12 并在正文说明原因。合并后不要手动关 issue（除非 PR 没带关键字）。

## 预算

模型供应商（opencode-go / deepseek-v4.1-flash）的 token 预算非常充足。不要为节省 token 或时间而提前收工、省略上下文、跳过验证或只给草稿；以正确性和完整性为准。PR 正文保留完整技术证据。

## 里程碑

每个改动要写明里程碑（M0–M4，见 docs/roadmap.md）。**M0 已完成，当前里程碑是 M1**；当前里程碑验收未通过前，不开始下一个。

M1 的实现形态已经确定，不需要再讨论或请示：

- MCP 守护进程用 TypeScript / Node 实现；仓库是 npm workspaces monorepo，产品代码进入
  `packages/contracts`、`packages/device`、`packages/daemon`（根目录只放 workspace/工具链配置）。
  包边界、依赖方向和机器契约见 [docs/architecture.md](docs/architecture.md)。
- 设备能力一律通过 `Device` 适配层访问。M1 实现 `FakeDevice`：内存态、可脚本化、可断言，测试不依赖真机。
- Android 真机通道（Termux / ADB 后端）属于 M2，M1 不做。
- M1 的验收用 `npm ci && npm run format:check && npm run gate && npm run build && npm test`
  （以及 `npm run typecheck`）的自动化结果证明；PR 正文写明“真机未验证”这一限制。

## 工程标准

- 分支前缀：agent/<任务名>；人类可用自己的命名。
- 提交信息：祈使句标题；正文说明"为什么"；引用 issue。
- 每个 PR 说明：里程碑、改了什么、如何验证、不做什么；如何验证里写明 `npm run gate` 结果。
- 有代码后：必须本地构建并通过测试；行为变更要有测试（M1 起即适用：
  `npm ci && npm run format:check && npm run gate && npm run build && npm test` 必须通过）。
- 新增包/依赖/跨层调用：必须同一 PR 更新 [docs/architecture.md](docs/architecture.md) 的机器契约并
  通过 `npm run gate`；新增规则还要补 probe。
- 安全相关改动（见 docs/security.md）需要 PR 中明确的人类批准。

## 沟通

- issue/PR 文本：中文（可附英文摘要）。
- 只在需要决策时找人类；否则自己推进并在文档里记录假设。
- 不要发进度汇报，直接交付结果。

## 当前任务

M0 已完成（愿景、契约、安全、评测、规则、demo 脚本、FAQ、技术栈/架构规范、monorepo 布局、
CI 闸机与定期巡检）。

当前队列：M1 的 issue #2–#5（守护进程骨架与配对、ui_tree 预算、动作结果回读、一行接入配置）；
实现按 [docs/architecture.md](docs/architecture.md) 的包边界落地。
