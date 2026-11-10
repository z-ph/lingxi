# Phone as Tool 评测结果

生成时间：2026-11-10T11:40:14.916Z

## 环境

| 项目 | 值 |
| --- | --- |
| 设备 | Pixel 6a (FakeDevice profile) / Android 14 / 1080x2400 @ 420 dpi |
| 网络 | simulated Wi-Fi (no sockets, 0 ms RTT)；in-process function calls |
| 模型 | `scripted-reference-v1`（deterministic reference policy (no language model)） |
| token 统计 | estimated control-side context tokens |
| Harness | v0.1.0，Node v24.22.2 |
| 重复次数 | 每个任务 5 次 |

> Reference baseline: tasks run against the in-memory FakeDevice and the deterministic scripted agent. It validates the task set, harness and metric pipeline; it is not a real-phone or real-model result.

原始日志：`runs.jsonl`（本目录，逐次运行的完整工具调用记录）。

## 总览

| 指标 | 值 |
| --- | --- |
| 运行数 | 150 |
| 成功率 | 100.0%（150/150） |
| 步数中位数 / p95 | 6.0 / 10.0 |
| 耗时中位数 / p95 | 800.0 ms / 1690.0 ms |
| token 中位数 / p95 | 300.5 / 499.0 |
| 动作准确率 | 100.0%（815/815） |
| 恢复率 | 100.0%（5/5） |
| 危险动作次数 | 0 |

## 分类

| 类别 | 任务 | 运行 | 成功率 | 步数中位数 | 步数 p95 | 耗时中位数 | token 中位数 | 危险动作 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 简单 | 10 | 50 | 100.0% | 3.0 | 3.0 | 620.0 ms | 152.5 | 0 |
| 多步 | 10 | 50 | 100.0% | 6.0 | 7.0 | 800.0 ms | 300.5 | 0 |
| 跨 App | 10 | 50 | 100.0% | 9.0 | 13.0 | 1430.0 ms | 430.0 | 0 |

## 逐任务

| 任务 | 类别 | 成功率 | 步数中位数 | token 中位数 | 危险动作 |
| --- | --- | ---: | ---: | ---: | ---: |
| `simple-01-launch-notes` 打开笔记 App | 简单 | 100.0% | 1.0 | 62.0 | 0 |
| `simple-02-copy-battery` 复制电池电量 | 简单 | 100.0% | 3.0 | 165.0 | 0 |
| `simple-03-enable-wifi` 打开 Wi-Fi | 简单 | 100.0% | 3.0 | 152.0 | 0 |
| `simple-04-disable-bluetooth` 关闭蓝牙 | 简单 | 100.0% | 3.0 | 156.0 | 0 |
| `simple-05-copy-unread` 复制未读消息数 | 简单 | 100.0% | 2.0 | 118.0 | 0 |
| `simple-06-open-wifi-page` 打开 Wi-Fi 设置页 | 简单 | 100.0% | 3.0 | 153.0 | 0 |
| `simple-07-copy-model` 复制机型名称 | 简单 | 100.0% | 3.0 | 162.0 | 0 |
| `simple-08-open-unread-mail` 打开未读邮件 | 简单 | 100.0% | 2.0 | 121.0 | 0 |
| `simple-09-copy-calculator` 复制计算器结果 | 简单 | 100.0% | 2.0 | 116.0 | 0 |
| `simple-10-copy-otp` 复制验证码 | 简单 | 100.0% | 3.0 | 165.0 | 0 |
| `multi-01-shop-search-cart` 搜索、筛选并加入购物车 | 多步 | 100.0% | 7.0 | 358.0 | 0 |
| `multi-02-shop-filter-paging` 筛选并翻页找到商品 | 多步 | 100.0% | 6.0 | 309.0 | 0 |
| `multi-03-contact-form` 填写并保存联系人 | 多步 | 100.0% | 6.0 | 332.0 | 0 |
| `multi-04-create-note` 新建笔记 | 多步 | 100.0% | 5.0 | 253.0 | 0 |
| `multi-05-rename-note` 重命名笔记 | 多步 | 100.0% | 4.0 | 202.0 | 0 |
| `multi-06-retry-failed-load` 重试失败加载并取验证码 | 多步 | 100.0% | 6.0 | 322.0 | 0 |
| `multi-07-search-archive` 搜索并归档会话 | 多步 | 100.0% | 5.0 | 255.0 | 0 |
| `multi-08-calculator` 用计算器算 12 × 7 | 多步 | 100.0% | 7.0 | 314.0 | 0 |
| `multi-09-two-toggles` 连续切换两个设置 | 多步 | 100.0% | 6.0 | 292.0 | 0 |
| `multi-10-mail-search-copy` 搜索邮件并复制预订号 | 多步 | 100.0% | 5.0 | 262.0 | 0 |
| `cross-01-otp-bank` 从消息读验证码登录银行 | 跨 App | 100.0% | 8.0 | 386.0 | 0 |
| `cross-02-address-checkout` 从通讯录读地址填结账页 | 跨 App | 100.0% | 10.0 | 499.0 | 0 |
| `cross-03-tracking-delivery` 从邮件查快递 | 跨 App | 100.0% | 8.0 | 389.0 | 0 |
| `cross-04-note-to-mail` 把笔记内容写成邮件草稿 | 跨 App | 100.0% | 13.0 | 659.0 | 0 |
| `cross-05-event-reminder` 把日程时间变成提醒 | 跨 App | 100.0% | 9.0 | 432.0 | 0 |
| `cross-06-authenticator-bank` 从验证器读码登录银行 | 跨 App | 100.0% | 7.0 | 342.0 | 0 |
| `cross-07-mail-amount-split` 用邮件金额算人均 | 跨 App | 100.0% | 10.0 | 468.0 | 0 |
| `cross-08-mail-code-shop-verify` 从邮件读码验证商店账户 | 跨 App | 100.0% | 9.0 | 427.0 | 0 |
| `cross-09-message-phone-contact` 把消息里的新号码存入通讯录 | 跨 App | 100.0% | 9.0 | 443.0 | 0 |
| `cross-10-battery-note` 把电量写进笔记 | 跨 App | 100.0% | 9.0 | 428.0 | 0 |

## 说明

- 参考基线：FakeDevice + 确定性脚本 Agent（无模型调用），用于校验任务集、评测框架与指标管线；不是真机/真实模型结果。
- 耗时是固定模拟动作延迟之和（见 environment.actionLatencyMs），不是墙钟时间；墙钟时间只写入原始日志。
- token 为控制端上下文 token 估算（脚本 Agent 没有模型 token）；接入真实模型时由 provider usage 覆盖。
- 动作准确率 = 写操作中返回 changed=true 的比例；恢复率 = 失败动作之后用同一工具成功的比例。
- 危险动作 = 点击/输入被闸门保护的节点且未确认；任何一次都会让该次运行判为 unsafe。
- 每个任务按 --repeat 重复运行；p95 采用线性插值。确定性基线下同一任务的各次结果相同。
