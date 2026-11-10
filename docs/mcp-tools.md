# MCP 工具契约

[简体中文](mcp-tools.md) | [English](en/mcp-tools.md)

手机暴露一组小而稳定的工具；其余都是 Agent 的事。

## 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| screenshot | format?=png/jpeg, quality? | 图像 + 尺寸 + 时间戳 |
| ui_tree | maxDepth?, interactiveOnly?=true, filter? | 裁剪后的树：id、文本、bounds、可点击、可编辑 |
| tap | nodeId 或 x,y | {ok, effect} |
| swipe | from, to, durationMs? | {ok} |
| type | nodeId? 或 focused, text, submit? | {ok} |
| launch_app | package 或 label | {ok, package, foreground} |
| wait_for | nodeText?, package?, timeoutMs | {ok, matched, elapsedMs} |
| observe | notifications?, clipboard? | 结构化文本 |

M1 只实现前六个工具（screenshot、ui_tree、tap、type、launch_app、wait_for）；swipe 与 observe
在后续里程碑补齐。

不变量：

- 每个写操作都返回**实际观察到的效果**（节点消失、文本出现），而不只是"已发送"。
- 失败显式且分类型：not_found、blocked、needs_confirmation、timeout、permission_denied。
- ui_tree 由手机侧裁剪和限长：token 效率是守护进程的责任，不是客户端的。
- 除非显式请求，不返回原始截图；截图像素不写日志。

## 配对与认证（M1）

1. 设备端启动配对会话，显示 6 位配对码和 `phonetool://pair?url=...&code=...` URI（后续可渲染为二维码）。
   配对码默认 5 分钟有效、一次性使用。
2. 客户端 `POST /pair`，请求体 `{"code":"123456","clientName":"Claude Code","fingerprint":"..."}`；
   请求保持挂起，直到设备端处理。
3. 设备端**明确批准**后才发放令牌（M1 为终端里的 y/n；M2 为 App 弹窗）。批准后返回
   `{"token":"pat_...","client":{...}}`，令牌只返回这一次。拒绝、超时（默认 60 秒）或多次输错配对码都会失败。
4. 客户端后续请求带 `Authorization: Bearer <token>` 访问 `http://<手机局域网 IP>:<端口>/mcp`。
   **令牌不放进 URL**；服务端只保存 SHA-256 哈希，令牌绝不写入日志。
5. 设备端列出所有客户端（名称、指纹、最近使用时间）并按 id 撤销；撤销后该客户端的下一次请求立即返回 401。

## 客户端配置（目标形态）

具体客户端写法见 issue #5；认证头是统一的：

    { "mcpServers": { "phone-as-tool": {
        "url": "http://192.168.x.y:8765/mcp",
        "headers": { "Authorization": "Bearer pat_..." }
    } } }

## token 预算

- ui_tree 默认：只返回可交互节点，文本截断到 100 字符，bounds 归一化。
- 目标：常见 App 屏幕中位数 < 3k token，p95 < 8k。
