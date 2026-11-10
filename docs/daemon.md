# M1 守护进程（开发预览）

[简体中文](daemon.md) | [English](en/daemon.md)

状态：**M1 开发预览**。仓库根目录就是一个 TypeScript / Node 包；设备能力由 `FakeDevice`
提供，真机 Android / Termux 通道属于 M2。M1 的验收以自动化测试为准，真机尚未验证。

## 快速开始

需要 Node.js >= 20。

    npm ci
    npm run build
    npm test

启动守护进程：

    npm start

默认会自动选择一个私有 IPv4 局域网地址（优先 Wi-Fi 接口），端口 8765。只想在本机试用：

    npm start -- --host 127.0.0.1

启动后终端会显示：

    Phone as Tool 0.1.0 — M1 daemon
    局域网地址: http://192.168.1.5:8765
    MCP 端点:   http://192.168.1.5:8765/mcp
    配对码: 123456   有效期至 ...
    配对 URI: phonetool://pair?url=...&code=...&expires=...

终端同时是 M1 的设备端 UI：配对码显示在这里，客户端提交配对后这里会要求输入 `y` / `n`
明确批准。配对码默认 5 分钟有效、一次性使用；批准超时默认 60 秒。

## 它做什么

- 在 `http://<局域网 IPv4>:<端口>/mcp` 提供 MCP Streamable HTTP 端点，支持 2025 时代的
  无状态客户端（Claude Code、Cursor 等使用的握手方式）。M1 不做会话状态：`GET`/`DELETE /mcp`
  返回 405，客户端用 `POST` 完成 initialize 和工具调用即可。
- 只绑定私有 IPv4 或 `127.0.0.1`；拒绝 `0.0.0.0`、公网地址和 IPv6 绑定。M1 不自动选择 IPv6
  局域网地址。
- 每个 HTTP 请求都检查对端地址、`Host` 和 `Origin`，防止局域网外的请求和 DNS rebinding。
- 配对码 + 设备端明确批准后，给每个客户端发放独立令牌；令牌可单独撤销或全部撤销。
- 令牌只保存 SHA-256 哈希；服务端日志和状态文件都不含明文令牌。
- 暴露 M1 的六个工具：`screenshot`、`ui_tree`、`tap`、`type`、`launch_app`、`wait_for`。

## 客户端连接

仓库自带一个小客户端，用来在没有 Claude Code / Cursor 的环境里验证配对和 `tools/list`：

    npm run pair -- --url http://192.168.1.5:8765 --code 123456 --name "Claude Code"

它会提交配对码，等待设备端批准，然后连接 `/mcp`、完成 initialize 并列出工具。配对成功后
令牌只打印一次；把它放进真实客户端的 `Authorization: Bearer ...` 配置即可。具体客户端的
一行配置见 issue #5。

## 令牌管理

守护进程终端里可以输入：

    tokens              列出客户端（id、名称、指纹、创建/最近使用时间；不含令牌）
    revoke <id>         撤销一个客户端；下一次请求立即 401
    revoke-all          撤销全部客户端
    pending             查看等待批准的配对请求
    pair                生成新的配对码（旧码立即作废）
    quit                停止守护进程

状态默认保存在 `~/.phone-as-tool/tokens.json`，只含令牌哈希和客户端元数据，文件权限 0600
（POSIX 系统）。可用 `--state-dir` 或 `PHONE_AS_TOOL_STATE_DIR` 修改。

## 配置

| 参数 / 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` / `PHONE_AS_TOOL_HOST` | 自动选择私有 IPv4 | 只接受私有 IPv4 或 `127.0.0.1` |
| `--port` / `PHONE_AS_TOOL_PORT` | `8765` | `0` 表示随机端口（测试用） |
| `--state-dir` / `PHONE_AS_TOOL_STATE_DIR` | `~/.phone-as-tool` | 令牌状态目录 |
| `PHONE_AS_TOOL_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

`GET /health` 返回 `{"ok":true,"name":"phone-as-tool","version":"..."}`，不包含任何密钥。

## 安全属性

- 只绑局域网：`0.0.0.0`、公网地址和 IPv6 绑定会被拒绝；非 loopback / RFC1918 / IPv6 ULA
  或 link-local 的对端会被拒绝。
- 配对：6 位一次性配对码 + 设备端显式批准；错误配对码最多尝试 5 次，同时最多 3 个待批准请求。
- 令牌：每个客户端一个随机 256-bit 令牌，服务端只存哈希；撤销立即生效；令牌不进 URL。
- 日志：结构化 JSON 写 stderr，只记录方法、路径（不含查询串）、状态码、耗时、对端地址和
  客户端 id；令牌、配对码和请求头不会写入日志。日志层还有正则兜底脱敏。
- 请求体上限：配对 16 KiB，MCP 4 MiB；HTTP 请求超时 90 秒。

## M1 边界（如实说明）

- **真机未验证**：M1 没有 Android 后端，所有测试和演示都走 `FakeDevice`；真机通道属于 M2。
- **Claude Code / Cursor 未在本环境运行**：验收用官方 MCP TypeScript 客户端和仓库自带
  客户端完成；真实客户端的实际配置与排障属于 issue #5。
- **二维码图片未渲染**：M1 输出 `phonetool://pair?...` URI 和 6 位配对码；二维码渲染属于
  Android App UI（M2）。配对码本身已满足“二维码或配对码”的 M1 验收。
- **M1 使用局域网 HTTP**：没有 TLS。请在可信 Wi-Fi 上配对和使用；不要在公共 Wi-Fi 上运行。
  令牌不会进 URL，但同网段嗅探仍属于 M2 之后要处理的传输安全问题。
- **ui_tree 预算与动作效果类型**：issue #2 提供工具骨架和基础输出；裁剪/token 预算由
  issue #3 完成，写动作的实际效果检测由 issue #4 完成。
- **M2 项**：应用白名单、危险动作确认、审计日志、一键断开、Android Keystore、断连/后台/
  网络切换处理尚未实现。

## 验证

    npm ci
    npm run build
    npm test

测试覆盖：局域网地址判定与绑定拒绝、Host/Origin 守卫、配对码/明确批准/拒绝/超时/错误次数、
令牌哈希持久化与撤销、令牌不进日志和状态文件、官方 MCP 客户端连接并列出六个工具、
`ui_tree` / `screenshot` 调用，以及终端 CLI 的显示配对码 → 显式 `y` 批准 → 撤销流程。

安全相关改动（配对、令牌、局域网边界）需要 PR 中人类明确批准后才能合并。
