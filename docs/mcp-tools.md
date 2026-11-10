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

## ui_tree 载荷

裁剪由守护进程负责：默认只返回可交互节点，并压成先序扁平数组；客户端不需要再过滤。
M1 实现见 `src/ui-tree/`。

```json
{
  "nodes": [
    {
      "id": "n3",
      "text": "WLAN",
      "bounds": [0, 372, 1080, 524],
      "clickable": true,
      "editable": false
    }
  ],
  "truncated": false
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `nodes[].id` | string | 本次快照内的短句柄（`n1`、`n2`…），同一快照内唯一，供 `tap` / `type` 的 `nodeId` 使用；下一次调用可能变化。 |
| `nodes[].text` | string | 可见文本或 `contentDescription`，空白折叠为单个空格，超过 100 个 Unicode 字符时截断并以 `…` 结尾。可交互节点自身没有文本时，用其非交互子节点的文本补齐（同样 ≤100 字符），例如设置项标题在子 `TextView` 上。 |
| `nodes[].bounds` | `[number, number, number, number]` | 设备像素 `[left, top, right, bottom]`，与 Android 无障碍 bounds 一致。坐标点击可用其中心点。 |
| `nodes[].clickable` | boolean | 原节点是否可点击。 |
| `nodes[].editable` | boolean | 原节点是否可编辑。 |
| `truncated` | boolean | 有节点因 `maxDepth` 未返回，或有文本被截断时为 `true`。 |

规则：

- `interactiveOnly`（默认 `true`）：只返回 `clickable` 或 `editable` 的节点。
  `interactiveOnly=false` 额外返回有文本的静态节点（用于读取正文），仍不返回空布局容器。
- `maxDepth`（默认 `30`）：从根（深度 0）算起的最大遍历深度。它只限制节点遍历；
  为可交互节点补文本时仍可读取更深层的非交互子节点。
- `filter`：不区分大小写的子串，匹配 `text` 或资源 `id`；与 `interactiveOnly` 叠加，
  空字符串表示不过滤。
- 不可见节点（`visible: false`）及其子树不返回。
- `bounds` 使用设备像素；M0 文档里的“归一化”在此具体化为固定的四元组，
  方便 Agent 直接用于坐标点击。
- 节点顺序为先序（父节点在子节点之前）；`id` 只是快照句柄，不保证跨快照稳定。
- 参数非法（`maxDepth` 不是 ≥0 的整数、`interactiveOnly` 不是布尔、`filter` 不是字符串）
  时显式报错，不静默降级。

## 配对

1. 用户在 Phone as Tool 里点"连接 Agent"，显示二维码 + 6 位配对码。
2. 客户端用配对令牌连接 http://<手机局域网 IP>:<端口>/mcp。
3. 手机弹窗确认："允许此客户端？"（名称 + 指纹），批准后局域网内会话保持，直到撤销。
4. App 内列出所有会话：最近使用时间 + 撤销按钮。

## 客户端配置（目标）

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## token 预算

- 目标：常见 App 屏幕中位数 < 3k token，p95 < 8k token。
- 测量对象：`ui_tree` 返回的紧凑 JSON（`JSON.stringify(payload)`），用 OpenAI
  `o200k_base` BPE 计数。不同客户端的 tokenizer 不完全一样，使用稳定的公开词表作为代理。
- 复现：`npm ci && npm run measure`。数字不达标时脚本以非 0 退出。
- 结果（2026-11-10，仓库内五个代表性 App fixture）：

| App | 包名 | 返回节点 | 原始树 token | ui_tree token |
| --- | --- | ---: | ---: | ---: |
| Android 设置 | com.android.settings | 23 | 3,115 | 813 |
| Chrome | com.android.chrome | 25 | 2,907 | 775 |
| 微信 | com.tencent.mm | 18 | 3,864 | 880 |
| 小红书 | com.xingin.xhs | 30 | 3,724 | 1,121 |
| 支付宝 | com.eg.android.AlipayGphone | 37 | 3,503 | 1,255 |

- 中位数 880 token，p95 1,255 token。p95 采用 nearest-rank（第 `ceil(0.95 × n)` 小的值）；
  五个 App 时等于最大值，是保守口径。
- 限制：CI 没有 Android 真机；这些 fixture 是按真实 App 结构编写的代表性层级，
  **不是设备抓取**。真机测量待 M2 的 Android/Termux 后端接入后，用
  `npm run measure -- --input <dump.json>` 对真实 dump（先转成 `RawUiNode` JSON）补测。客户端 tokenizer 也可能不同；
  `o200k_base` 只用于稳定比较，不代表 Claude Code / Cursor / DSH 的精确计数。
- `interactiveOnly=false` 会额外返回静态文本，载荷更大，不属于默认预算目标。
