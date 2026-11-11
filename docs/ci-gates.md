# CI 闸机

[简体中文](ci-gates.md) | [English](en/ci-gates.md)

状态：M0 落地（issue #18）。本文是**机器可检查的规范清单**；语义判断仍归人工评审和定期巡检。
架构规则本身见 [architecture.md](architecture.md)。

## 1. 为什么要有闸机

规范如果只写在文档里，会随着“这次先例外”逐渐失效。机器闸机把可以判定的规则变成阻断条件：
违反规则的 PR 直接红，评审不必靠记忆检查布局、依赖和文档链接。

闸机只覆盖**能可靠机器判定**的部分。DRY 的语义、分层是否合理、依赖是否真的该加，仍需人类在 PR
和巡检中判断；闸机负责让这些讨论从“已经违规的基线”开始，而不是每次重新发现。

## 2. 在哪里运行

| 位置 | 内容 |
| --- | --- |
| `.github/workflows/ci.yml` | push 到 `main`、PR 到 `main` 时运行；Node 22 与 24 矩阵 |
| `packages/architecture-gate` | 闸机实现与 probe 测试；零运行时依赖 |
| `npm run format:check` | Prettier 检查代码/JSON/YAML 格式；失败退出码 1 |
| `npm run gate` | 对真实仓库跑全部规则；失败退出码 1 |
| `npm test` | 跑各 workspace 的测试，其中包含闸机 probe（可用性证明） |
| `npm run build` / `npm run typecheck` | 构建和类型检查（当前只有工具包，后续包自动纳入） |

CI 步骤顺序：`npm ci` → `npm run format:check` → `npm run gate` → `npm test`（含 probe）→
`npm run build` → `npm run typecheck`。任何一个失败都不能合并。

### 2.1 本地复现

```text
npm ci
npm run format:check
npm run gate
npm test
npm run build
npm run typecheck
```

只看闸机某个包/只看 JSON：

```text
npm test --workspace @phone-as-tool/architecture-gate
node packages/architecture-gate/src/cli.mjs --format json
```

`--format json` 输出 `{ root, violations, summary }`，供巡检或脚本读取；违规对象包含 `id`、`file`、
`message`。

### 2.2 不允许绕过

- 不使用 `continue-on-error`、`if: always()` 或注释工作流来让失败的闸机变绿。
- 不删除规则、不缩小扫描范围来回避问题；确需调整规则时，改规则 + 改本表 + 补 probe 必须同一个 PR。
- 不提交 `node_modules/`、构建产物或本地状态来“修复”检查。
- 闸机不支持内联豁免注释；确需架构例外按 [architecture.md](architecture.md) 第 7.3 节处理。

## 3. 规则

每条规则有稳定的 ID。修复时先看 ID，再看消息里的文件路径。

| ID | 检查 | 失败时通常意味着 |
| --- | --- | --- |
| `NORMS-001` | 规范文件、两个 workflow、机器契约齐全且可解析；英文镜像没有复制机器契约；CI 确实调用 `npm run format:check` 与 `npm run gate`；AGENTS 链接规范 | 规范或闸机被删除/改坏；文档双源 |
| `MONO-001` | 根 `package.json` 私有、scripts 齐全、workspaces 与机器契约一致、`engines.node` 一致；唯一根锁文件；包名/目录/`private` 合规 | 不是合法 monorepo，或有人引入第二个包管理器/锁文件 |
| `ARCH-001` | 包依赖只能指向 `mayDependOn` 中登记的更低层包；机器契约的依赖图无环 | 跨层依赖、循环依赖、未登记包依赖 |
| `ARCH-002` | 源码不能跨包相对导入、不能深导入 `@phone-as-tool/*/src/...`，内部导入必须有声明 | 绕过包的公开入口或依赖方向 |
| `DEPS-001` | 运行时依赖必须登记 `license`、`purpose`、`allowedIn`；同一运行时依赖版本一致 | 偷偷加依赖/重复造轮子/供应链风险未记录 |
| `DRY-001` | `src/` 下不得有内容完全重复的非测试源文件 | 复制粘贴代码；应下沉到共享层 |
| `DOC-001` | 每篇 `docs/*.md` 有英文镜像、镜像有中文主版本、主版本链接到镜像 | 文档双语漂移/孤儿镜像 |
| `DOC-002` | 文档中的本地链接和锚点可解析 | 移动/改名后留下死链 |
| `DOC-003` | README 与 README.en 索引全部主文档 | 新文档无人发现，或索引与文件不一致 |

机器契约字段与白名单的解释见 [architecture.md](architecture.md) 第 6 节；规则执行细节以
`packages/architecture-gate/src/rules/` 为准，两者不一致时先改文档再改代码（文档是契约）。

### 3.1 格式检查（Prettier）

格式不是自定义闸机规则，由 Prettier 3.9 提供：

- `npm run format:check` 检查代码、JSON、YAML；`npm run format` 修复。
- 中文 Markdown（`docs/`、`*.md`）不强制重排，避免中文段落被机器折行；文档由 `DOC-001`～`DOC-003` 检查。
- `package-lock.json` 不参与格式化，锁文件由 `npm ci` 校验。
- `NORMS-001` 会检查 CI 仍调用 `format:check`；`MONO-001` 检查根 `package.json` 保留该脚本。删掉任一侧都会红。

## 4. 可用性证明（probe）

“闸机通过”本身可能只是因为它没在工作。为防止空转，每条规则都有 probe 用例，证明它在该失败时
**确实失败**，并且在一个合规基线上**不误报**。

实现方式：

- `packages/architecture-gate/test/fixtures/good-repo/` 是一个最小合规模拟仓库，包含根配置、文档、
  机器契约、三个示例包和两个 workflow。
- 每个 probe 把 good-repo 复制到临时目录，**只制造一个违规场景**，然后断言出现预期的规则 ID 和文件；
  不修改真实仓库，不需要网络。
- `good fixture passes every rule` 断言合规基线零违规，防止规则整体误报。
- CLI probe 直接运行 `cli.mjs --root <fixture>`，验证退出码 0/1 和 JSON 输出格式；如果 CLI 坏了，
  规则即使正确也不会阻断 CI。

| 规则 | probe（`packages/architecture-gate/test/gate.test.mjs`） | 证明什么 |
| --- | --- | --- |
| 基线 | `good fixture passes every rule` | 无违规，规则不误报 |
| `DOC-001` | `DOC-001 rejects a document without an English mirror` / `DOC-001 rejects an orphan English mirror` / `DOC-001 rejects a missing language link` | 缺镜像、孤儿镜像、缺语言链接都会红 |
| `DOC-002` | `DOC-002 rejects a broken local link` / `DOC-002 rejects a broken anchor` | 死链和坏锚点都会红 |
| `DOC-003` | `DOC-003 rejects a doc missing from the README index` | 新文档未进索引会红 |
| `MONO-001` | `MONO-001 rejects a missing root lockfile` / `MONO-001 rejects a nested package lockfile` / `MONO-001 rejects an undeclared workspace package` / `MONO-001 rejects an engines.node mismatch` / `MONO-001 rejects a missing root format:check script` | 锁文件、包布局、Node 版本和格式脚本违规会红 |
| `ARCH-001` | `ARCH-001 rejects a dependency outside mayDependOn` / `ARCH-001 rejects a dependency cycle` | 跨层/环依赖会红 |
| `ARCH-002` | `ARCH-002 rejects a relative import escaping the package` / `ARCH-002 rejects a deep import into another package` / `ARCH-002 rejects an undeclared internal import` | 绕过入口和未声明依赖会红 |
| `DEPS-001` | `DEPS-001 rejects an unregistered runtime dependency` / `DEPS-001 accepts a registered runtime dependency` / `DEPS-001 rejects inconsistent runtime dependency versions` | 未登记会红、版本漂移会红、登记后放行 |
| `DRY-001` | `DRY-001 rejects duplicate source files` | 重复源文件会红 |
| `NORMS-001` | `NORMS-001 rejects a missing CI gate workflow` / `NORMS-001 rejects CI without format check` / `NORMS-001 rejects a duplicated machine contract in the English mirror` / `NORMS-001 rejects an invalid machine contract` | 闸机/契约/格式检查被破坏会红 |
| CLI | `cli exits 0 and emits json for a compliant repo` / `cli exits 1 and reports the rule id for a violating repo` | 真实入口可用 |

`npm test` 会运行这些 probe；CI 的测试步骤即 probe 证据。当前仓库没有产品代码，因此产品相关规则
（ARCH/DEPS/DRY）只在 fixture 上被证明；M1 包落地后，同一套规则会直接检查真实包，无需另写门禁。

## 5. 局限与误报

闸机是**结构检查**，不是设计评审：

- 它无法判断两个模块是不是“同一个知识”的重复，只能发现完全相同的文件。
- 它无法判断新增依赖是否真有必要，只能要求登记和解释。
- 它无法判断层内拆分是否合理，只能阻止跨层和循环依赖。
- 它对路径、包名和机器契约格式敏感；重命名时按提示同步修改，不要临时放宽规则。

如果规则误报：

1. 在 PR 中说明具体文件/场景和为什么是误报；
2. 修规则（不是关规则），补一个能复现误报的 probe；
3. 同一 PR 更新本表；
4. 人类评审确认后合入。

如果规则漏报，同样先加失败 probe，再改规则；probe 先红后绿。

## 6. 新增闸机规则

1. 选一个稳定的 ID（`DOMAIN-NNN`）。
2. 在 `packages/architecture-gate/src/rules/` 实现，输出文件路径和可操作的错误消息。
3. 在 `gate.test.mjs` 加负向 probe（该失败时失败）和必要时的正向 probe（不误报）。
4. 更新本文件的规则表和 probe 表。
5. 如果规则对应新的架构事实，更新 [architecture.md](architecture.md) 的机器契约或规范段落。
6. 本地跑 `npm ci && npm run gate && npm test`；CI 全绿后进入评审。

规则实现不得访问网络，不得依赖当前工作目录，不得修改被检查的仓库；测试必须在临时目录运行。
