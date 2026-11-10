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

不变量：

- 每个写操作都返回**实际观察到的效果**（节点消失、文本出现），而不只是"已发送"。
- 失败显式且分类型：not_found、blocked、needs_confirmation、timeout、permission_denied。
- ui_tree 由手机侧裁剪和限长：token 效率是守护进程的责任，不是客户端的。
- 除非显式请求，不返回原始截图；截图像素不写日志。

## 配对

1. 用户在灵犀里点"连接 Agent"，显示二维码 + 6 位配对码。
2. 客户端用配对令牌连接 http://<手机局域网 IP>:<端口>/mcp。
3. 手机弹窗确认："允许此客户端？"（名称 + 指纹），批准后局域网内会话保持，直到撤销。
4. App 内列出所有会话：最近使用时间 + 撤销按钮。

## 客户端配置（目标）

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## token 预算

- ui_tree 默认：只返回可交互节点，文本截断到 100 字符，bounds 归一化。
- 目标：常见 App 屏幕中位数 < 3k token，p95 < 8k。
