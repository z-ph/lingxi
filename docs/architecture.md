# 技术栈与架构规范

[简体中文](architecture.md) | [English](en/architecture.md)

状态：M0 定稿（issue #18）。本文是**技术栈、仓库布局、包边界、依赖方向与架构规范**的单一真源。
代码、CI 闸机和评审都以本文为准；改架构必须走 PR，并在同一个 PR 里更新本文。

产品要做什么、为什么做，见 [vision.md](vision.md) 和 [README.md](../README.md)；本文不重复产品叙述，
只回答“功能放在哪里、用什么实现、允许怎样依赖”。

## 1. 功能范围

### 1.1 产品边界

Phone as Tool 在 Android 手机上提供设备控制能力，通过仅局域网的 MCP 暴露给 AI Agent：
看见屏幕、读取界面树、点击/滑动/输入、启动 App、等待界面变化，并配套配对、安全闸门、审计和评测。

范围与非目标以 [vision.md](vision.md) 为准。本文只补充**功能域到代码边界的映射**。

### 1.2 功能域与归属

| 功能域 | 内容 | 归属 |
| --- | --- | --- |
| 协议契约 | MCP 工具名、入参/返回 schema、错误码、配对与传输约束 | `contracts` |
| 设备能力 | 读界面树/截图、点击、滑动、输入、启动 App、等待 | `device` |
| 会话与接入 | 局域网绑定、配对、令牌、MCP 传输、请求校验 | `daemon` |
| 策略与安全 | 应用白名单、危险动作确认、审计、一键断开（M2） | `daemon` |
| 输出治理 | ui_tree 裁剪、token 预算、文本截断（M1 #3） | `daemon` |
| 评测 | 任务集、模拟设备/App、指标与报告（M3） | `benchmark` |
| Android 宿主 | 无障碍服务、前台服务、权限、App UI、Keystore（M2） | `apps/android` |
| 仓库基础设施 | 架构闸机、probe、CI 检查 | `architecture-gate` |

### 1.3 逻辑运行形态

```text
MCP 客户端（Claude Code / Cursor / DSH / 云端 Agent）
        │  MCP over LAN（配对令牌）
        ▼
daemon：传输、会话、策略、工具编排、ui_tree 预算
        │  Device 接口（进程内调用）
        ▼
device：FakeDevice（M1）/ Android 真机后端（M2）
        ▼
Android 设备
```

固定的是**分层边界**：`daemon` 不直接调用 Android API，`device` 不做 MCP、鉴权或安全策略，
`contracts` 不碰 I/O。M1 用 TypeScript/Node 参考守护进程 + `FakeDevice` 验证协议和工具语义；
M2 落地真机通道。真机通道的宿主形态（例如 Termux 中运行 Node，或 Android 原生宿主）属于 M2
的落地决策，但无论选哪种，上述边界和包职责不变。

## 2. 技术栈

| 范围 | 选择 | 约束 | 理由 |
| --- | --- | --- | --- |
| 语言/运行时 | TypeScript 5.9.x + Node.js | `engines.node` 为 `>=22`；CI 验证 Node 22 与 24 | 既有 M1 决策；Node 内置 HTTP/crypto/test 足够 |
| 模块格式 | ESM | 包内 `"type": "module"` | 与 MCP 官方 SDK 和 Node 生态一致 |
| 包管理 | npm workspaces | 根目录一个 `package-lock.json` | 不引入额外包管理器；一个锁文件 |
| 构建 | `tsc` + 共享 `tsconfig.base.json` | 不加 bundler | 输出即产物，调试简单 |
| 测试 | `node:test` + `node:assert/strict` | 不加测试框架 | 标准库足够；CI 可直接跑 |
| 格式 | Prettier 3.9.x | `npm run format:check`；覆盖代码/JSON/YAML，中文 Markdown 不强制重排 | 统一格式，减少 review 噪音；格式化不替代 lint |
| 静态检查 | `tsc --noEmit` + 架构闸机 | 暂不引入 ESLint | 当前规模小；需要时按 7.2 加依赖并补配置，不预置空转工具 |
| MCP 协议 | 官方 TypeScript SDK（当前为 `@modelcontextprotocol/server` / `@modelcontextprotocol/node`；测试用 `@modelcontextprotocol/client`） | 不手写 JSON-RPC / Streamable HTTP | 协议兼容性是别人已经解决的问题 |
| 输入校验 | `zod` | 只用于边界 schema | 与 MCP SDK 生态一致，避免手写校验器 |
| HTTP | Node 内置 `http` + 官方 Node 适配器 | 不引入 Express/Koa/Fastify | 局域网小服务，标准库足够 |
| Android（M2） | Kotlin + Android SDK | 无障碍服务 + 前台服务；不引入 Flutter/React Native | 需要系统无障碍 API 和低开销常驻 |
| CI | GitHub Actions | 见 [ci-gates.md](ci-gates.md) | 仓库既有平台；不做多余供应商切换 |
| 文档 | Markdown；中文主版本 + 英文镜像 | 机器契约只放在中文主版本 | 避免双源 |
| 存储（M1） | 本地文件，权限 0600；令牌只存哈希 | 不引入数据库 | 单机、小状态 |
| 许可证 | 项目 MIT；依赖限 MIT/Apache-2.0/BSD/ISC | copyleft 依赖需人类批准 | 分发和合规风险可控 |

版本细节由 `package-lock.json` 固定；本文只记录选型和大版本约束。新增或替换技术栈必须更新本表、
更新第 6 节机器契约里的依赖登记，并跑 `npm run gate`。

## 3. Monorepo 布局

```text
.
├── package.json                 # workspace 根；只放工具链与仓库脚本
├── package-lock.json            # 唯一锁文件
├── tsconfig.base.json           # 包共享的严格 TypeScript 配置
├── packages/
│   ├── contracts/               # 计划 M1：工具契约、错误码、共享 schema
│   ├── device/                  # 计划 M1：Device 接口 + FakeDevice
│   ├── daemon/                  # 计划 M1：MCP 服务、配对、安全、ui_tree 预算
│   ├── benchmark/               # 计划 M3：30 任务评测框架
│   └── architecture-gate/       # 已落地 M0：架构/规范闸机与 probe（layer 99）
├── apps/
│   └── android/                 # 计划 M2：Kotlin 宿主；Gradle 构建，不属于 npm workspace
├── docs/                        # 中文主文档；英文镜像在 docs/en/
├── tools/                       # 可选：不进 npm workspace 的临时脚本；不得被产品包导入
└── .github/                     # workflows、issue/PR 模板
```

规则：

- **一个包一个职责**。包名固定为 `@phone-as-tool/<目录名>`；全部 `private: true`，本仓库不发布 npm 包。
- **只有一个锁文件**：根 `package-lock.json`。禁止包级 `package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、
  `bun.lock*`。
- **内部依赖统一写 `workspace:*`**，避免版本漂移；内部依赖只能指向机器契约 `packages` 里登记过的包。
- **产品源码不放仓库根**。根目录只放 workspace 配置、工具链配置和文档；M1 起 `src/`、`test/` 进入具体包。
- TypeScript 包提供 `tsconfig.json` 并 extends 根 `tsconfig.base.json`；纯 JS 工具包（当前只有
  `architecture-gate`）可以没有。产品包对外只暴露入口（`src/index.ts` 或 `exports`）；跨包深导入
  （`@phone-as-tool/x/src/...`）禁止。
- `apps/android` 用 Gradle，独立构建；只消费 `contracts` 的 JSON/schema 契约，不导入 TypeScript 源码。
- `tools/` 下的脚本属于仓库临时工具，产品包不得依赖；长期工具应进入 `packages/architecture-gate`
  或独立包，并登记到机器契约。

### 3.1 包状态

| 包 | 层 | 状态 | 职责 |
| --- | --- | --- | --- |
| `@phone-as-tool/contracts` | 0 | 计划 M1 | 工具名、schema、错误码、跨语言契约 |
| `@phone-as-tool/device` | 1 | 计划 M1 | `Device` 接口、`FakeDevice`、后续真机后端 |
| `@phone-as-tool/daemon` | 2 | 计划 M1 | MCP 传输、配对、鉴权、安全策略、ui_tree 预算 |
| `@phone-as-tool/benchmark` | 3 | 计划 M3 | 任务集、模拟设备、指标与报告 |
| `@phone-as-tool/architecture-gate` | 99 | 已落地 M0 | 机器闸机与 probe（仓库工具，不是产品） |
| `apps/android` | — | 计划 M2 | Kotlin 宿主：无障碍、前台服务、权限、UI |

“计划”中的包在目录和 `package.json` 出现前不需要创建；一旦创建，必须与本文机器契约一致。

## 4. 分层规则

层号越小越底层；依赖只能指向**更小的层号**，且必须在该包机器契约的 `mayDependOn` 白名单里。

| 层 | 包 | 可以依赖 | 禁止 |
| --- | --- | --- | --- |
| 0 | contracts | 无（只允许类型/常量/JSON schema） | I/O、网络、设备、鉴权 |
| 1 | device | contracts | MCP、配对/鉴权、安全策略、审计 |
| 2 | daemon | contracts、device | Android 原生 API、benchmark、工具包 |
| 3 | benchmark | contracts、device、daemon | 被产品包依赖 |
| 99 | architecture-gate | 无 | 被任何产品包依赖 |

- `contracts` 是跨语言契约层：TypeScript 类型/schema 与 JSON 测试向量；不包含运行时副作用，不依赖 Node 专有 API。
- `device` 只负责“把意图变成设备动作并报告观察结果”。所有设备差异（Fake、ADB、Termux、无障碍）都在
  这一层适配；`daemon` 不得出现 `if (android)` 之类的分支。
- `daemon` 拥有协议、会话、策略和 token 预算。安全策略只在这里定义，设备层不得绕过。
- `benchmark` 可以复用下层实现，但**产品包不得依赖 benchmark**，避免评测代码进入发布产物。
- `apps/android` 是独立构建的宿主；若它需要与 TypeScript 包交换数据，只通过 `contracts` 中语言无关的
  schema/JSON，不复制业务规则。
- 跨层调用、循环依赖、深导入由闸机 `ARCH-001` / `ARCH-002` 拦截；不要用相对路径“绕到”别的包。

## 5. 架构规范

### 5.1 单一真源（Single source of truth）

同一类事实只允许有一个权威定义，其他位置只能链接或引用它。

| 事实 | 唯一来源 | 机器校验 |
| --- | --- | --- |
| 产品范围、用户、非目标 | [vision.md](vision.md)（README 是产品摘要） | 人工评审 |
| MCP 工具契约 | [mcp-tools.md](mcp-tools.md) | 人工评审；M1 起 contracts 测试 |
| 安全要求 | [security.md](security.md) | 人工评审 + 安全测试 |
| 里程碑与验收 | [roadmap.md](roadmap.md) | 人工评审 |
| 技术栈、布局、层、依赖登记 | 本文（含机器契约） | `npm run gate` |
| 闸机规则与 probe | [ci-gates.md](ci-gates.md) + gate 代码/测试 | CI |
| 巡检节奏与清单 | [architecture-review.md](architecture-review.md) | CI 文件检查 |
| 工作方式 | [AGENTS.md](../AGENTS.md) | 人工评审 |
| 具体版本 | `package-lock.json` | `npm ci` |

执行要求：

- 文档之间引用事实时用链接，不复述整段；代码注释不重新定义契约，只引用文档/类型。
- 机器契约（第 6 节 JSON）只在中文主版本出现；英文镜像解释它，不复制它。两处同时存在即视为双源，闸机报错。
- 改行为或边界时，代码、文档、测试在同一个 PR 内一致；不能“代码先合、文档后补”。
- README 是产品表述，必须与现状一致；docs/ 是契约，代码服从 docs/。
- 测试是行为的可执行真源：文档说允许的，测试要能证明；文档禁止的，测试要能拦截。

### 5.2 不要重复造轮子

优先级：**平台/标准库 → 官方 SDK → 维护良好的成熟库 → 自己写**。自己写只用于本项目特有的设备逻辑。

已决定的复用：

- MCP 协议与传输用官方 TypeScript SDK，不手写 JSON-RPC、Streamable HTTP、会话握手。
- HTTP 服务用 Node 内置 `http` 加官方适配器，不引入 Web 框架。
- 校验用 `zod`，不手写参数校验器；错误分型与 schema 绑定。
- 测试用 `node:test`，不引入 Jest/Vitest/Mocha。
- 加密、哈希、随机数用 Node `crypto`；不自己实现密码学。
- 日期、路径、URL 等用平台能力；不为一个函数引入工具库。
- Android 侧用系统无障碍/前台服务 API，不引入跨平台 UI 框架来“模拟”系统能力。
- 架构闸机刻意零依赖：CI 要快、可审计、不因供应链问题失效。

新增依赖前必须回答（写进 PR）：

1. 现有依赖或标准库是否已经能做？是否已有同用途依赖？
2. 是否官方/事实标准？维护活跃度和最近发布如何？
3. 许可证、安装体积、传递依赖数量是否可接受？
4. 不用它会多写多少代码、增加多少风险？
5. 是否已登记到第 6 节 `runtimeDependencies`（含用途、许可证、允许的包）？

同一种能力只保留一个实现；两个库做同一件事视为架构问题，不是“多一个选择”。

### 5.3 DRY：消除重复知识，不是消除相似代码

- **重复知识**（同一个协议字段、同一个错误码、同一个默认值、同一条规则）必须只有一个定义；通过
  `contracts` 或下层包共享。
- **相似代码**（两处看起来像、但会独立演化）不强行抽象；重复三次后再提取，避免过早抽象造出 god module。
- 禁止跨包复制文件；需要共用就下沉到允许依赖的下层，或在 `contracts` 定义。
- 测试 fixture 与英文翻译属于**有意重复**：前者是独立证据，后者是语言镜像；不参与 `DRY-001`。
  生成文件、锁文件同样排除。
- 文档不复制其他文档的规范段落；用链接指向唯一来源。

闸机 `DRY-001` 检查 `src/` 下内容完全重复的非测试源文件；语义重复、复制粘贴后改名等情况由人工评审
和巡检兜底。

### 5.4 复杂功能分职责、分层设计

- 一个包只承担一个功能域；一个源文件只承担一个内聚职责。文件超过约 400 行或同时处理
  协议、策略、I/O 三类事情时，应在 PR 中说明或拆分。
- 层间只通过明确接口通信：`daemon` 调 `Device` 接口，不关心后端类型；`device` 返回类型化错误，
  不返回“魔法字符串”；`contracts` 只描述形状，不承载行为。
- 输入在边界校验（MCP 入参、HTTP 请求、设备返回），内部信任类型；不要在深层重复校验同一输入。
- 错误在边界分型并保留上下文；禁止静默吞错、用 `any` 绕过契约、或在 `device` 层做安全决策。
- 并发/顺序策略集中在 `daemon`：设备层保持无状态或显式状态，不自行调度多个客户端。
- 任何跨层“捷径”（例如 daemon 直接读 Android 文件、benchmark 被 daemon 引用）都按架构变更处理，
  需要评审，不允许内联豁免。

### 5.5 文档与语言

- 中文是主版本；英文镜像放 `docs/en/`。两边的标题层级和事实必须对应；英文可滞后，但必须在同一
  PR 或明确标注待同步。
- 每篇 `docs/*.md` 必须在开头链接到自己的英文镜像；英文镜像不得有孤儿文件。
- README 与 README.en 必须互相链接，并索引全部主文档（DOC-001 / DOC-003）。
- 机器契约只放中文主版本；英文镜像不复制，避免漂移。

## 6. 机器可读契约

下面的 JSON 块是布局和依赖规则的**唯一机器真源**：闸机直接解析它，并校验根 `package.json`、
`packages/*` 与它一致。修改布局、层、白名单或运行时依赖时，先改这里，再改代码；同一个 PR 完成。

```json architecture-gate
{
  "schemaVersion": 1,
  "node": ">=22",
  "workspaces": ["packages/*"],
  "packageNamePrefix": "@phone-as-tool/",
  "packages": {
    "@phone-as-tool/contracts": {
      "dir": "packages/contracts",
      "layer": 0,
      "mayDependOn": []
    },
    "@phone-as-tool/device": {
      "dir": "packages/device",
      "layer": 1,
      "mayDependOn": ["@phone-as-tool/contracts"]
    },
    "@phone-as-tool/daemon": {
      "dir": "packages/daemon",
      "layer": 2,
      "mayDependOn": ["@phone-as-tool/contracts", "@phone-as-tool/device"]
    },
    "@phone-as-tool/benchmark": {
      "dir": "packages/benchmark",
      "layer": 3,
      "mayDependOn": [
        "@phone-as-tool/contracts",
        "@phone-as-tool/device",
        "@phone-as-tool/daemon"
      ]
    },
    "@phone-as-tool/architecture-gate": {
      "dir": "packages/architecture-gate",
      "layer": 99,
      "mayDependOn": []
    }
  },
  "runtimeDependencies": {}
}
```

字段含义：

- `node`：根 `package.json` 的 `engines.node` 必须与它完全一致；`>=22` 是当前支持下限。
- `workspaces`：根 `package.json` 的 `workspaces` 必须与它完全一致。
- `packageNamePrefix`：所有包名必须以此开头，包名后缀必须等于目录名。
- `packages`：登记所有 npm workspace 包；`layer` 越小越底层，依赖只能指向层号更小的包；
  `mayDependOn` 是**运行时和开发时**都适用的白名单。未登记的包、未登记的依赖都会让闸机失败。
- `runtimeDependencies`：外部运行时依赖登记表。键是 npm 包名，值至少包含 `license`、`purpose`、
  `allowedIn`（允许使用它的包名数组）。新增运行时依赖必须在这里登记；开发依赖（TypeScript、类型定义等）
  由 PR 说明，不要求进入运行时表。

约束：

- 已登记但尚未创建的包是“计划中”，闸机允许其暂时不存在；一旦目录存在，必须和登记完全一致。
- 机器契约只出现在本文；英文镜像解释规则并链接回这里。
- 闸机不能解析或违反字段约束时整体失败（NORMS-001），不会“跳过继续”。
- 不要直接编辑 `packages/*/package.json` 绕过契约；先改机器契约，再改包。

## 7. 变更、评审与例外

### 7.1 新增包

1. 先判断能否放进现有包；不能才新增。
2. 更新第 6 节 `packages`：目录、层号、`mayDependOn`。
3. 创建 `packages/<name>/package.json`（`private: true`、`@phone-as-tool/<name>`、`type: module`、`engines`）、
   `src/`、`test/`、`tsconfig.json`（extends `tsconfig.base.json`），并加测试。
4. 本地 `npm install --package-lock-only` 更新根锁文件；`npm run gate` 必须通过。
5. 在 PR 正文写明包职责、依赖方向和验证命令。

### 7.2 新增依赖

1. 按 5.2 的五个问题评估。
2. 更新第 6 节 `runtimeDependencies`；如果是开发依赖，在 PR 正文写用途、版本、许可证、体积。
3. 用 npm 安装并提交根 `package-lock.json`；不要提交 `node_modules/`。
4. `npm run gate` 通过；如果依赖属于同用途的第二个库，先证明为什么不能复用现有依赖。

### 7.3 架构例外

原则上没有内联豁免（不存在 `// gate:ignore` 一类开关）。确需例外时：

- 在 PR 中说明为什么现有分层无法解决、影响范围和移除条件；
- 由人类所有者明确批准；
- 在本文记录例外（原因、到期时间/移除 issue），并让闸机规则仍能覆盖其他部分；
- 例外到期必须复核，不能静默长期存在。

安全相关改动（见 [security.md](security.md)）还需要 PR 中的人类明确批准。

### 7.4 PR 最小验证

```text
npm ci
npm run format:check
npm run gate
npm test
npm run build
npm run typecheck
```

PR 正文记录实际结果；CI 必须全绿。闸机失败时修规则/代码，不要用 `continue-on-error`、注释工作流或
删除门禁来“修绿”。

## 8. 定期巡检

规范会随代码漂移，必须定期检查。巡检节奏、清单、自动提醒和退出标准见
[architecture-review.md](architecture-review.md)。每个里程碑验收后也必须巡检一次；新增包、依赖或
跨层调用属于结构性变更，要在同一个 PR 里完成架构评审记录。

## 9. 当前状态

- M0：技术栈、布局、分层、闸机与巡检规范已落地；`packages/architecture-gate` 是唯一的实际工作区包。
- M1：按本布局把守护进程实现放进 `packages/contracts`、`packages/device`、`packages/daemon`；根目录
  不再放产品源码。
- M2：Android 宿主与真机通道落地 `apps/android` 和 `device` 后端。
- M3：评测进入 `packages/benchmark`，不得反向进入产品。

当前没有产品代码，因此闸机的产品规则（分层、依赖）通过 probe fixture 证明可用；真实包落地后，
同一套规则直接检查它们，不需要另写门禁。

## 10. 相关文档

- [MCP 工具契约](mcp-tools.md)
- [安全要求](security.md)
- [路线图](roadmap.md)
- [CI 闸机](ci-gates.md)
- [架构巡检](architecture-review.md)
- [工作规则](../AGENTS.md)
