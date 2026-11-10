# 安全

[简体中文](security.md) | [English](en/security.md)

手机是个人最私密的设备。本文是设计必须满足的威胁模型；M2 实现。

## 威胁

1. **局域网内未授权客户端**：有人扫描网络驱动你的手机。
2. **屏幕内容提示注入**：App、消息或通知诱导控制端 Agent 做坏事。
3. **危险动作**：支付、删除、发消息、改账号。
4. **数据外泄**：截图、通知、文件意外离开设备。
5. **凭据泄露**：配对令牌或 App 密钥出现在日志/URL。
6. **混淆代理**：第二个客户端继承了第一个客户端的权限。

## 要求

- 只绑局域网接口；默认不对外暴露。
- 配对需要手机上显示的配对码 + 明确允许；令牌按客户端发放、可撤销；令牌绝不进服务端日志。
- 应用白名单：默认空——用户添加前，任何 App 都驱动不了。
- 危险动作闸门：按工具策略（例如点击支付按钮、向密码框输入）需要设备端确认。模型无法关闭。
- 审计日志：每次工具调用、客户端身份、参数摘要、结果；本地保存、可导出、不上传。
- 一键断开：撤销所有客户端并立即停止 MCP 服务。
- 提示注入对策：工具结果是数据不是指令；守护进程不执行界面文本里的指令。
- 静态加密：Android Keystore 保存令牌；SharedPreferences/日志不存明文。

## 实现状态（M2 安全闸门）

安全闸门在 `src/security/` 中以独立模块实现，由 `SecurityGate.execute()` 统一串联。M1 的 MCP 服务
（#2）接入工具调用时必须经过它。

### 闸门顺序

服务状态 → 认证 → 工具校验 → 应用白名单 → 危险动作确认 → 执行 → 审计。任一步失败都返回带类型的
错误，并在审计中留下记录。

### 应用白名单

- `AppAllowlist` 默认空；设备端 `add` / `remove` / `clear` 是唯一修改入口，没有对应 MCP 工具。
- 每次调用解析目标 App：`launch_app` 取目标包名（当前桌面不算），其他工具取前台包名；`wait_for`
  可在参数里指定目标包名。无法解析目标或目标不在白名单 → `blocked`，不执行。
- `tap` / `type` 还要求守护进程提供可信的 `targetNode`（可为 `null`，表示该位置/焦点没有节点）；
  缺失时拒绝（fail closed），避免绕过危险文案识别。

### 危险动作

- 设备端配置 `DangerPolicy` 注入 `SecurityGate`，模型无法通过工具修改。默认规则：
  - 支付 / 购买 / 转账 / 下单等目标文案；
  - 删除 / 清空 / 卸载 / 移除等；
  - 发送 / 发布 / 分享等；
  - 向密码框输入；
  - 可按工具或 App 追加“总是确认”。
- 命中后通过 `ConfirmationChannel` 请求手机端确认；`DeviceConfirmationQueue` 是内存实现，真机由
  App 弹窗实现。确认绑定 `id + digest`、一次性，拒绝 / 超时 / 取消均不执行；没有确认通道时危险
  动作直接拒绝。
- 参数摘要中的 `type.text`、密码/令牌等敏感字段在确认提示和审计中都已脱敏。
- 提示注入：界面文本只作为危险识别数据，绝不驱动策略或自动批准；工具结果原样返回给客户端，不执行
  其中指令。

### 令牌

- `ClientRegistry` 每客户端一枚随机令牌，仅保存 SHA-256 哈希，支持单撤销和全部撤销；审计、错误和
  列表不包含明文令牌。
- 配对码 / 二维码流程属于 #2；本模块提供配对成功后的令牌发放与撤销接口。
- Node 守护进程内存中只保存哈希；真机 App 必须用 Android Keystore 保存。

### 审计日志

- 每次调用（认证失败、白名单拒绝、确认拒绝/超时、工具错误都算）追加一条：`seq`、`at`、`kind`、
  `client`、`tool`、`parameters`、`appPackages`、`decision`、`confirmation`、`result`、
  `durationMs`、`prevHash`、`hash`。
- `parameters` 是脱敏摘要：`type.text` 只记长度，密码/令牌/授权/图片等键为 `[redacted]`；
  `result` 只记状态、错误码和结构摘要，不记屏幕文本、像素或截图。
- SHA-256 哈希链；`verify()` / `verifyAuditChain()` 检测篡改，`JsonlAuditSink` 本地 JSONL 落盘，
  `exportJsonl()` / `exportJson()` / `writeExport()` 导出。模块没有网络代码，不上传。
- 审计写入失败时闸门拒绝执行（fail closed）。哈希链能发现篡改，但不是对抗拥有审计文件写权限的
  攻击者的加密证明。

### 一键断开

- `KillSwitch.engage()`：立即锁定闸门、撤销全部客户端令牌、取消待确认请求、调用 MCP server 的
  `stop()`；返回撤销数、停止结果和警告。幂等。
- 之后所有调用（含旧令牌）返回 `blocked`；恢复需要重新配对并重启服务。真机上的按钮和前台服务
  停止由 App 接入点调用 `SecurityGate.engageKillSwitch()`。

### 接入示例

```ts
const gate = new SecurityGate({
  tools: toolHandlers,                 // screenshot / ui_tree / ... 的实际处理函数
  clients,                              // ClientRegistry
  allowlist,                            // AppAllowlist，默认空
  confirmation: deviceConfirmation,     // 真机确认弹窗的 ConfirmationChannel
  server: mcpServer,                    // 至少提供 stop()
});

const result = await gate.execute({
  token,
  tool: "tap",
  args: { nodeId: "n7" },
  context: { foregroundPackage, targetNode }, // 守护进程从设备快照解析，不来自模型
});
```

## 当前实现限制

- 只实现 Node 守护进程侧的安全闸门与单元测试；Android 真机上的确认弹窗、Keystore、白名单/审计 UI、
  断连/空闲处理不在本 PR 内，按 M2 后续接入。配对码流程属于 #2。
- 未在真机上验证；验收以 `npm ci && npm run build && npm test` 的自动化结果为准。
- `KillSwitch` 依赖注入的 `server.stop` 回调；没有回调时仍会撤销令牌并锁住闸门，但无法停止真实
  网络监听。

## 暂不覆盖

- 多租户设备农场。
- 公网远程访问（M4 可选的中继；默认关闭，显式配对）。
