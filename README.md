# Phone as Tool

[简体中文](README.md) | [English](README.en.md)

**把你的 Android 手机，变成 AI Agent 的工具。**

Phone as Tool 把一台真 Android 手机变成一个本地 MCP 设备守护进程：跑在电脑或云端的 Agent 可以看见屏幕、
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

Phone as Tool 在手机这一侧补上这个缺口，而且控制权在你手里。

## 工作方式（目标形态）

    Agent（Claude Code / Cursor / DSH / 云端）
            |  MCP over 局域网（配对令牌）
            v
    手机上的 Phone as Tool App
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

## 评测（M3 参考基线）

30 个固定任务（10 简单 / 10 多步 / 10 跨 App），每个任务跑 5 次。**下表是 FakeDevice + 确定性脚本
Agent 的参考基线，用于验证任务集与评测框架，不是真机或真实模型成绩。** 真机与真实模型数字待 M1/M2
和真实客户端可用后补测；方法、任务定义与复现命令见
[`benchmark/README.md`](benchmark/README.md)。

| 类别 | 任务 | 运行 | 成功率 | 步数中位数 | 步数 p95 | 耗时中位数 | token 中位数 | 危险动作 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 简单 | 10 | 50 | 100.0% | 3.0 | 3.0 | 620.0 ms | 152.5 | 0 |
| 多步 | 10 | 50 | 100.0% | 6.0 | 7.0 | 800.0 ms | 300.5 | 0 |
| 跨 App | 10 | 50 | 100.0% | 9.0 | 13.0 | 1430.0 ms | 430.0 | 0 |
| 合计 | 30 | 150 | 100.0% | 6.0 | 10.0 | 800.0 ms | 300.5 | 0 |

- 设备：FakeDevice profile，Pixel 6a / Android 14 / 1080×2400 @ 420dpi / en-US。
- 网络：进程内模拟 Wi-Fi，0 ms RTT，无 socket / 配对 / 局域网。
- 模型：`scripted-reference-v1`（确定性参考策略，不调用语言模型；token 为上下文估算）。
- 动作准确率 100.0%（815/815）；恢复率 100.0%（5/5）；耗时是固定模拟动作延迟，不是墙钟时间。
- 原始日志：[`benchmark/results/2026-11-10-reference-baseline/`](benchmark/results/2026-11-10-reference-baseline/)
  （`runs.jsonl` 为 150 次运行的完整工具调用记录）。

## 文档

- [愿景](docs/vision.md)（[English](docs/en/vision.md)）
- [路线图](docs/roadmap.md)（[English](docs/en/roadmap.md)）
- [MCP 工具契约](docs/mcp-tools.md)（[English](docs/en/mcp-tools.md)）
- [安全](docs/security.md)（[English](docs/en/security.md)）
- [评测](docs/benchmark.md)（[English](docs/en/benchmark.md)）
- [评测框架与结果](benchmark/README.md)
- [常见问题](docs/faq.md)（[English](docs/en/faq.md)）

## 参与

见 [AGENTS.md](AGENTS.md)（[English](AGENTS.en.md)）。早期阶段：请开 issue 描述你想让它自动化的任务。

## 许可证

MIT
