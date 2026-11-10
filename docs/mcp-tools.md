# MCP 工具契约

[简体中文](mcp-tools.md) | [English](en/mcp-tools.md)

手机暴露一组小而稳定的工具；其余都是 Agent 的事。

## 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| screenshot | format?=png/jpeg, quality? | 图像 + 尺寸 + 时间戳 |
| ui_tree | maxDepth?, interactiveOnly?=true, filter? | 裁剪后的树：id、文本、bounds、可点击、可编辑 |
| tap | nodeId 或 x,y | {ok, effect} |
| swipe | from, to, durationMs? | {ok, effect} |
| type | nodeId? 或 focused, text, submit? | {ok, effect} |
| launch_app | package 或 label | {ok, effect, package, foreground} |
| wait_for | nodeText?, package?, timeoutMs | {ok, effect, matched, elapsedMs} |
| observe | notifications?, clipboard? | 结构化文本 |

不变量：

- 每个写操作都返回**实际观察到的效果**（节点消失、文本出现），而不只是"已发送"。
- 失败显式且分类型：not_found、blocked、needs_confirmation、timeout、permission_denied。
- ui_tree 由手机侧裁剪和限长：token 效率是守护进程的责任，不是客户端的。
- 除非显式请求，不返回原始截图；截图像素不写日志。

## 动作结果

每个动作都返回 `ok` 与 `effect`。失败时 `ok: false`、`effect: null`，并带分类型的 `error`。

成功：

    { "ok": true, "effect": { "kind": "tap", "target": { "node": { "nodeId": "open", "text": "打开" }, "point": { "x": 540, "y": 240 } }, "changes": [ { "kind": "node_appeared", "nodeId": "dialog-ok", "text": "确定" } ], "changeCount": 1, "elapsedMs": 320 } }

失败：

    { "ok": false, "effect": null, "error": { "code": "not_found", "message": "tap target node login is not on the current screen", "details": { "nodeId": "login" } } }

失败类型（客户端按 `code` 分支，不要解析 message）：

| code | 含义 |
| --- | --- |
| invalid_argument | 参数缺失或非法 |
| not_found | 目标节点、App、包名或匹配条件不存在 |
| blocked | 目标不可操作（禁用、不可点击、不可编辑、坐标越界），或被设备策略阻止 |
| needs_confirmation | 需要设备端确认（M2 危险动作闸门；M1 不会返回） |
| timeout | 在期限内没等到条件（launch_app、wait_for） |
| permission_denied | 缺少无障碍或启动 App 的权限 |
| no_effect | 动作已下发，但观察窗口内界面没有任何变化（tap、swipe、type） |

`effect` 的字段：

- 公共：`changes`（最多 20 条差异）、`changeCount`（实际差异数）、`elapsedMs`。
- `tap`：`target.node`（按 nodeId 点击时的目标节点；坐标点击时若能命中则为该节点，否则 null）、`target.point`。
- `swipe`：`gesture.from`、`to`、`durationMs`。
- `type`：`node`、`beforeText`、`afterText`（提交后目标节点消失时为 null）、`submitted`。只有目标节点的文本实际变成请求的文本才算生效；`submit` 后节点消失也视为生效。
- `launch_app`：`package`、`label`、`foreground`、`alreadyForeground`。
- `wait_for`：`matched.node`（给了 nodeText 时）、`matched.package`（给了 package 时）、`elapsedMs`。

差异（`changes`）的 kind：foreground_changed、node_appeared、node_disappeared、text_changed、
bounds_changed、state_changed（enabled/clickable/editable/focused）。

观察窗口：

- tap/swipe/type 默认在 2000ms 内轮询界面快照；没有变化就是 no_effect，不会静默成功。
- launch_app 默认 5000ms 内要求目标包名进入前台；否则 timeout。
- wait_for 在 timeoutMs 内轮询；nodeText 为不区分大小写的子串匹配，package 为精确匹配；
  同时给出时两者都要满足。
- 节点 id 需要跨快照稳定；M1 的 FakeDevice 保证稳定，真机适配在 M2 负责规范化。

## 配对

1. 用户在 Phone as Tool 里点"连接 Agent"，显示二维码 + 6 位配对码。
2. 客户端用配对令牌连接 http://<手机局域网 IP>:<端口>/mcp。
3. 手机弹窗确认："允许此客户端？"（名称 + 指纹），批准后局域网内会话保持，直到撤销。
4. App 内列出所有会话：最近使用时间 + 撤销按钮。

## 客户端配置（目标）

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## token 预算

- ui_tree 默认：只返回可交互节点，文本截断到 100 字符，bounds 归一化。
- 目标：常见 App 屏幕中位数 < 3k token，p95 < 8k。
