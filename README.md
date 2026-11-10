# 灵犀（Lingxi）

[简体中文](README.md) | [English](README.en.md)

**把你的 Android 手机，变成 AI Agent 的工具。**

灵犀把一台真 Android 手机变成一个本地 MCP 设备守护进程：跑在电脑或云端的 Agent 可以看见屏幕、
读取界面树、点击、输入、启动 App、等待界面变化——操作的是你手机里的真实 App，不需要模拟器、
USB 线或 ADB 调试。

> **状态：pre-alpha。** 目前还没有可用版本。这个仓库从立项文档、规格和 backlog 开始，
> 实现按里程碑逐步落地。

## 为什么做

电脑上的 coding agent 已经能干活了，缺的是手机：

- 大多数 App 没有 API。微信、小红书、美团、银行——唯一接口就是像素和点击。
- 模拟器够不到真实的 App、账号和本机状态。
- 云手机方案要求把设备交出去，大多数人不会给。
- Agent 生态（Claude Code、Cursor、DSH……）都说 MCP，唯独手机不会。

灵犀在手机这一侧补上这个缺口，而且控制权在你手里。

## 工作方式（目标形态）

    Agent（Claude Code / Cursor / DSH / 云端）
            |  MCP over 局域网（配对令牌）
            v
    手机上的灵犀 App
            +- 无障碍服务：界面树、点击、滑动、输入、返回/主页
            +- 截屏：按需截图
            +- App 控制：列出 / 启动 / 前台检测
            +- 审计日志 + 应用白名单 + 危险动作确认

设计原则：

- **本地优先**：屏幕、像素和数据留在手机；只有 Agent 明确请求的内容才出设备。
- **自带 Agent 和模型**：任何 MCP 客户端都能用；手机本身不跑模型。
- **默认安全**：仅绑局域网、配对令牌、应用白名单默认空、危险动作需确认、完整审计、一键断开。
- **能确定就别猜**：常用流程录制后确定性回放；模型只负责恢复和新情况。

## 非目标

- 不是云托管服务。用你自己的手机不需要注册账号。
- 不是"什么都能干"的通用助手。先服务技术用户和可重复的任务。
- 不做 iOS。没有对等的公开无障碍接口。

## 文档

- [愿景](docs/vision.md)（[English](docs/en/vision.md)）
- [路线图](docs/roadmap.md)（[English](docs/en/roadmap.md)）
- [MCP 工具契约](docs/mcp-tools.md)（[English](docs/en/mcp-tools.md)）
- [安全](docs/security.md)（[English](docs/en/security.md)）
- [评测](docs/benchmark.md)（[English](docs/en/benchmark.md)）

## 参与

见 [AGENTS.md](AGENTS.md)（[English](AGENTS.en.md)）。早期阶段：请开 issue 描述你想让它自动化的任务。

## 许可证

MIT
