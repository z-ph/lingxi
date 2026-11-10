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

## 接入 MCP 客户端

> **M1 开发版。** 守护进程用 TypeScript / Node 实现，跑在电脑上，用 FakeDevice 模拟手机；
> Android 真机通道和手机 App 属于 M2，因此项目仍是 pre-alpha。下面的客户端配置在 M1 开发版和
> 后续手机版上相同。

### 1. 配对，拿到地址和令牌

在 Phone as Tool 里点「连接 Agent」，会显示局域网地址、6 位配对码和二维码。在客户端机器上输入
地址和配对码；手机明确批准后，客户端会拿到一次性令牌（`pat_...`）。令牌只显示一次，服务端只存
哈希；丢了就撤销该客户端并重新配对。

M1 开发版在电脑上运行守护进程（需要 Node.js >= 20）：`npm ci && npm run build && npm start`
会打印局域网地址、MCP 端点和 6 位配对码。另开一个终端，用配对码配对：

```bash
npm run pair -- --url http://<局域网 IP>:8765 --code <配对码> --name "Claude Code"
```

在守护进程终端输入 `y` 批准，配对命令会打印一次性令牌。配对命令在守护进程所在的电脑上运行即可，
把令牌复制到客户端机器上的配置里。

### 2. Claude Code

先安装 Claude Code，确认 `claude` 命令在 PATH 里。macOS、Linux 和 Windows（PowerShell 或 CMD）
都用同一条命令，把地址和令牌换成上一步的值：

```bash
claude mcp add --transport http phone-as-tool --scope user http://<局域网 IP>:8765/mcp --header "Authorization: Bearer <令牌>"
```

`--scope user` 让所有项目都能用；只在当前项目用就删掉它。检查：

```bash
claude mcp list
```

看到 `✔ Connected` 即可。移除：`claude mcp remove phone-as-tool --scope user`。

### 3. Cursor

先安装 Cursor 桌面版。编辑全局配置：macOS 是 `~/.cursor/mcp.json`，Windows 是
`%USERPROFILE%\.cursor\mcp.json`（PowerShell 里用 `$env:USERPROFILE\.cursor\mcp.json`）。
文件或目录不存在就创建：macOS 用 `mkdir -p ~/.cursor`，Windows PowerShell 用
`New-Item -ItemType Directory -Force "$env:USERPROFILE\.cursor"`。在 `mcpServers` 下加入一条；
一行版替换占位符后可以直接粘贴：

```json
{"mcpServers":{"phone-as-tool":{"url":"http://<局域网 IP>:8765/mcp","headers":{"Authorization":"Bearer <令牌>"}}}}
```

已有其他 server 时保留它们，只加 `phone-as-tool`。保存后重启 Cursor，或在 Customize > MCPs
里关开一次；Agent 的工具列表里应出现 `screenshot`、`ui_tree`、`tap` 等工具。项目级配置也可以放在
仓库的 `.cursor/mcp.json`，但它会进版本库：不要把含令牌的配置提交，优先用全局配置。

### 4. 验证

- Claude Code：`claude mcp list` 显示 `✔ Connected`；会话里 `/mcp` 能看到工具。
- Cursor：Customize > MCPs 里 server 正常；让 Agent 调用 `ui_tree` 能返回界面树。
- 健康检查：浏览器打开 `http://<局域网 IP>:8765/health`，应返回 `{"ok":true,...}`。

## 排障

### 发现：找不到手机 / 连不上

- 手机和客户端机器要在同一个局域网（同一 Wi-Fi / 路由器）。访客网络和部分公司、酒店 Wi-Fi 会
  开启 AP 隔离，设备之间互相不可见；换手机热点或家用路由器验证。
- 地址以 Phone as Tool 显示的为准；M1 开发版以守护进程打印的「局域网地址」为准。`127.0.0.1`
  只在守护进程绑定回环地址（`npm start -- --host 127.0.0.1`）且客户端在同一台机器时可用。
- M1 的 Host 校验只接受守护进程绑定的地址；用 IP，不要用 `localhost`、主机名或别名（除非守护
  进程绑定的就是它）。
- 先查连通性：macOS 用 `ping -c 3 <IP>`、`nc -vz <IP> 8765`；Windows 用 `ping <IP>`、
  `Test-NetConnection <IP> -Port 8765`。
- 浏览器或 `curl` 打开 `http://<IP>:8765/health`：返回 JSON 说明服务可达；超时或拒绝连接先看
  下一节「防火墙」。
- 关掉 VPN / 代理，或把局域网网段设为直连；`HTTP_PROXY`、`HTTPS_PROXY` 也可能把 MCP 请求带走。
- macOS 15+ 首次访问局域网会弹「本地网络」权限；拒绝过就到 系统设置 > 隐私与安全性 > 本地网络
  里允许 Terminal / Cursor / Claude Code。
- Windows 把网络配置文件设为「专用网络」；「公用网络」默认阻止入站。
- M1 不做 mDNS 自动发现，地址就是 App / 守护进程显示的那个 IP。多网卡（VPN、Docker、虚拟机）
  选错地址时，用 `npm start -- --host <IP>` 或环境变量 `PHONE_AS_TOOL_HOST=<IP>` 指定。
- 在 WSL 里运行 Claude Code / Cursor 时，确认 WSL 能访问该局域网 IP；不行就用 Windows 原生客户端。

### 令牌：401 / 配对失败 / 令牌丢失

- `401 Unauthorized` 表示令牌缺失、错误或已被撤销。令牌放在
  `Authorization: Bearer <令牌>` 请求头里，不要放进 URL。
- 6 位配对码 5 分钟内有效、一次性（M1 开发版）；输错多次、超过尝试次数或超时会失败，回
  App / 守护进程重新生成。
- 配对请求要在设备端明确批准（M1 开发版：在守护进程终端输入 `y`）；60 秒内不批准会超时
  （M1 开发版）。
- 令牌只显示一次，服务端只存 SHA-256 哈希；丢了就在 App / 守护进程里撤销该客户端并重新配对，
  不要试图找回。
- 怀疑泄露：立即撤销该令牌。M1 开发版用 `tokens` 查看、`revoke <id>` 撤销一个客户端、
  `revoke-all` 撤销全部，然后重新配对。
- Claude Code：`claude mcp get phone-as-tool` 看状态；配置改坏了就
  `claude mcp remove phone-as-tool --scope user` 后重加。
- Cursor：改完 `mcp.json` 要重启；Output 面板选 MCP Logs 看具体错误；删除 server 再重新添加
  可以强制重连。

### 防火墙：连接超时 / 被拒绝

- 守护进程所在机器要允许入站 TCP 8765。M1 开发版守护进程跑在电脑上，所以检查电脑防火墙；
  手机版则检查手机和路由器是否允许局域网互访。
- macOS：系统设置 > 网络 > 防火墙 > 选项，允许 `node` 接收传入连接；排障时可临时关闭防火墙确认。
- Windows：首次运行 Node.js 会弹防火墙提示，勾选「专用网络」并允许。漏点就到
  Windows 安全中心 > 防火墙和网络保护 > 允许应用通过防火墙，勾选 Node.js。管理员 PowerShell
  也可以直接加规则：
  `New-NetFirewallRule -DisplayName "Phone as Tool" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Private`
- Linux：启用 ufw 时执行 `sudo ufw allow 8765/tcp`。
- 只开 8765。不要为了排障把守护进程绑到 `0.0.0.0` 或公网：M1 只绑私有 IPv4 或回环地址。
- 公司网络或路由器可能禁止设备互访；换一个网络验证，排除网络策略。

### 手机休眠：空闲后断开 / 请求超时

- Android 的 Doze / 省电策略会挂起后台 App 并断开 Wi-Fi。给 Phone as Tool 关闭电池优化
  （设置 > 应用 > Phone as Tool > 电池 > 不受限制），会话期间保持手机充电和亮屏。
- 部分厂商（小米、华为、OPPO、vivo 等）还会在锁屏后限制后台；在系统设置里允许 Phone as Tool
  自启动 / 后台运行，并在 Wi-Fi 高级设置里关闭「睡眠时关闭 Wi-Fi」一类的省电项。
- 手机休眠后，客户端请求会超时；唤醒手机、确认 App / 守护进程还在，再重试。手机版的前台服务
  和自动重连属于 M2 的可靠性项，当前还没有。
- M1 开发版守护进程跑在电脑上：电脑睡眠 / 合盖同样会断开。macOS 可以用 `caffeinate`，
  Windows 把电源计划设为「从不睡眠」，或排障时临时改。

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
- [常见问题](docs/faq.md)（[English](docs/en/faq.md)）

## 参与

见 [AGENTS.md](AGENTS.md)（[English](AGENTS.en.md)）。早期阶段：请开 issue 描述你想让它自动化的任务。

## 许可证

MIT
