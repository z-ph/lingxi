#!/usr/bin/env node
/**
 * Interactive M1 daemon CLI.
 *
 * The terminal stands in for the Android app UI: it shows the pairing code/URI,
 * asks for explicit approval when a client submits the code, and lists/revokes
 * per-client tokens. Tokens themselves are only ever returned to the pairing
 * client, never printed or logged here.
 */

import { createInterface } from 'node:readline';
import process from 'node:process';
import { defaultStateDir, startDaemon, type RunningDaemon } from './daemon.js';
import { createLogger, levelFromEnv } from './logger.js';
import type { PendingApproval } from './pairing/pairing-manager.js';
import type { PairingInfo } from './pairing/pairing-manager.js';
import type { PublicTokenInfo } from './pairing/token-store.js';
import { PACKAGE_NAME, VERSION } from './version.js';

interface CliOptions {
  host?: string;
  port?: number;
  stateDir?: string;
  help?: boolean;
  version?: boolean;
}

function usage(): string {
  return `Phone as Tool M1 daemon ${VERSION}

用法:
  node dist/src/cli.js [选项]

选项:
  --host <IPv4>       绑定地址；默认自动选择私有 IPv4 局域网地址
  --port <port>       TCP 端口；默认 8765
  --state-dir <dir>   令牌状态目录；默认 ${defaultStateDir()}
  -h, --help          显示帮助
  --version           显示版本

环境变量:
  PHONE_AS_TOOL_HOST, PHONE_AS_TOOL_PORT, PHONE_AS_TOOL_STATE_DIR
  PHONE_AS_TOOL_LOG_LEVEL=debug|info|warn|error

交互命令:
  pair                生成新的配对码（旧的作废）
  pending             查看等待批准的配对请求
  tokens              列出已授权客户端（不含令牌）
  revoke <id>         撤销一个客户端令牌
  revoke-all          撤销全部客户端令牌
  help                显示命令
  quit                停止守护进程

安全:
  只绑定私有 IPv4 或 127.0.0.1；拒绝 0.0.0.0、公网地址和 IPv6。
  配对请求必须在这里输入 y 明确允许；否则超时拒绝。
  令牌只返回给客户端一次，服务端只保存 SHA-256 哈希，绝不写入日志。
`;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`无效端口: ${value}`);
  }
  return port;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--host': {
        const value = argv[index + 1];
        if (!value) throw new Error('--host 需要一个值');
        options.host = value;
        index += 1;
        break;
      }
      case '--port': {
        options.port = parsePort(argv[index + 1]);
        index += 1;
        break;
      }
      case '--state-dir': {
        const value = argv[index + 1];
        if (!value) throw new Error('--state-dir 需要一个值');
        options.stateDir = value;
        index += 1;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
        options.version = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

function formatTime(value: string | null): string {
  if (!value) return '-';
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function printPairing(info: PairingInfo): void {
  console.log('');
  console.log(`配对码: ${info.code}   有效期至 ${formatTime(info.expiresAt)}`);
  console.log(`配对 URI: ${info.uri}`);
  console.log('在客户端输入配对码；批准请求会显示在这里。');
}

function printTokens(tokens: readonly PublicTokenInfo[]): void {
  if (tokens.length === 0) {
    console.log('还没有已授权客户端。');
    return;
  }
  console.log('已授权客户端:');
  for (const token of tokens) {
    console.log(
      `  ${token.id}  ${token.clientName}  指纹=${token.fingerprint}  创建=${formatTime(token.createdAt)}  最近=${formatTime(token.lastUsedAt)}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.version) {
    console.log(`${PACKAGE_NAME} ${VERSION}`);
    return;
  }

  const logger = createLogger({ level: levelFromEnv(process.env.PHONE_AS_TOOL_LOG_LEVEL) });
  const host = options.host ?? process.env.PHONE_AS_TOOL_HOST;
  const port = options.port ?? parsePort(process.env.PHONE_AS_TOOL_PORT);
  const stateDir = options.stateDir ?? process.env.PHONE_AS_TOOL_STATE_DIR ?? defaultStateDir();

  const approvals: PendingApproval[] = [];
  let currentApproval: PendingApproval | null = null;
  let daemon: RunningDaemon | undefined;
  let closing = false;

  const showNextApproval = (): void => {
    if (currentApproval || approvals.length === 0) return;
    currentApproval = approvals.shift() ?? null;
    if (!currentApproval) return;
    console.log('');
    console.log('配对请求:');
    console.log(`  客户端: ${currentApproval.clientName}`);
    console.log(`  指纹:   ${currentApproval.fingerprint}`);
    if (currentApproval.remoteAddress) console.log(`  来源:   ${currentApproval.remoteAddress}`);
    console.log(`  有效期至: ${formatTime(currentApproval.expiresAt)}`);
    console.log('允许此客户端？输入 y 允许 / n 拒绝:');
  };

  const enqueueApproval = (approval: PendingApproval): void => {
    approvals.push(approval);
    showNextApproval();
  };

  const shutdown = async (exitCode = 0): Promise<void> => {
    if (closing) return;
    closing = true;
    rl.close();
    try {
      await daemon?.close();
    } finally {
      process.exit(exitCode);
    }
  };

  const handleApprovalLine = (line: string): void => {
    if (!currentApproval || !daemon) return;
    const answer = line.trim().toLowerCase();
    try {
      if (answer === 'y' || answer === 'yes' || answer === '允许') {
        const client = daemon.approve(currentApproval.id);
        console.log(`已允许 ${client.clientName}（${client.id}）。`);
        currentApproval = null;
        showNextApproval();
        return;
      }
      if (answer === 'n' || answer === 'no' || answer === '拒绝') {
        daemon.deny(currentApproval.id);
        console.log(`已拒绝 ${currentApproval.clientName}。`);
        currentApproval = null;
        showNextApproval();
        return;
      }
    } catch (error) {
      console.log(`批准失败: ${error instanceof Error ? error.message : String(error)}`);
      currentApproval = null;
      showNextApproval();
      return;
    }
    console.log('请输入 y 或 n:');
  };

  const handleCommand = async (line: string): Promise<void> => {
    if (!daemon) return;
    const [command, ...rest] = line.trim().split(/\s+/);
    switch (command) {
      case '':
        return;
      case 'pair':
        printPairing(daemon.startPairing());
        return;
      case 'pending': {
        const pending = daemon.pendingApprovals();
        if (pending.length === 0) console.log('没有等待批准的配对请求。');
        else for (const approval of pending) console.log(`  ${approval.id}  ${approval.clientName}  ${approval.fingerprint}`);
        return;
      }
      case 'tokens':
        printTokens(daemon.listTokens());
        return;
      case 'revoke': {
        const id = rest[0];
        if (!id) {
          console.log('用法: revoke <id>');
          return;
        }
        console.log(daemon.revokeToken(id) ? `已撤销 ${id}。` : `未找到 ${id}。`);
        return;
      }
      case 'revoke-all': {
        const count = daemon.revokeAllTokens();
        console.log(`已撤销 ${count} 个客户端令牌。`);
        return;
      }
      case 'help':
        console.log(usage());
        return;
      case 'quit':
      case 'exit':
        await shutdown(0);
        return;
      default:
        console.log(`未知命令: ${command}（输入 help 查看命令）`);
    }
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });
  rl.on('line', (line) => {
    if (currentApproval) {
      handleApprovalLine(line);
      return;
    }
    void handleCommand(line).catch((error: unknown) => {
      console.error(`命令失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  try {
    daemon = await startDaemon({
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      stateDir,
      logger,
      onApprovalRequest: enqueueApproval,
    });
  } catch (error) {
    logger.error('daemon failed to start', { error });
    console.error(error instanceof Error ? error.message : String(error));
    rl.close();
    process.exit(1);
  }

  console.log(`${PACKAGE_NAME} ${VERSION} — M1 daemon`);
  console.log(`局域网地址: ${daemon.url}`);
  console.log(`MCP 端点:   ${daemon.mcpUrl}`);
  console.log(`状态目录:   ${stateDir}`);
  printPairing(daemon.pairingInfo);
  if (process.stdin.isTTY !== true) {
    console.log('提示: stdin 不是交互终端；配对请求只有在收到显式 y 时才会被批准。');
  }
  console.log('输入 help 查看命令，quit 退出。');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
