#!/usr/bin/env node
/**
 * Small MCP client used to prove the acceptance path without Claude Code or
 * Cursor installed:
 *
 *   npm run pair -- --url http://192.168.1.5:8765 --code 123456 --name "Claude Code"
 *
 * It pairs (code + name + fingerprint), connects to the authenticated MCP
 * endpoint, performs the initialize handshake and prints `tools/list`. The token
 * is printed once so it can be pasted into a real client's configuration; the
 * server never logs it.
 */

import { createHash } from 'node:crypto';
import os from 'node:os';
import process from 'node:process';
import { VERSION } from '../version.js';

interface CliOptions {
  url?: string;
  code?: string;
  name?: string;
  fingerprint?: string;
  token?: string;
  help?: boolean;
}

interface PairResponse {
  token: string;
  client: {
    id: string;
    clientName: string;
    fingerprint: string;
    createdAt: string;
    lastUsedAt: string | null;
  };
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function usage(): string {
  return `Phone as Tool pairing client ${VERSION}

用法:
  npm run pair -- --url <http://LAN-IP:8765> [--code <6位配对码>] [--name <客户端名>]
  npm run pair -- --url <http://LAN-IP:8765> --token <已有令牌>

选项:
  --url <url>          守护进程地址（必填）
  --code <code>        设备上显示的 6 位配对码
  --name <name>        客户端名称，显示在设备批准弹窗里
  --fingerprint <id>   客户端指纹；默认由主机名和名称派生
  --token <token>      跳过配对，使用已有令牌列出工具
  -h, --help           显示帮助

说明:
  令牌只在本命令输出中显示一次；服务端只保存哈希，且绝不会把令牌写进日志。
`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--url':
        options.url = argv[index + 1];
        index += 1;
        break;
      case '--code':
        options.code = argv[index + 1];
        index += 1;
        break;
      case '--name':
        options.name = argv[index + 1];
        index += 1;
        break;
      case '--fingerprint':
        options.fingerprint = argv[index + 1];
        index += 1;
        break;
      case '--token':
        options.token = argv[index + 1];
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`无效的 --url: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--url 必须是 http(s) 地址');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('--url 只填协议、主机和端口，例如 http://192.168.1.5:8765');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function defaultFingerprint(name: string): string {
  return createHash('sha256').update(`${os.hostname()}|${name}`).digest('hex').slice(0, 16);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`服务器返回了非 JSON 响应 (HTTP ${response.status})`);
  }
}

function parseSse(text: string): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (data.length === 0) continue;
    const parsed = JSON.parse(data) as JsonRpcResponse;
    if (parsed.result !== undefined || parsed.error !== undefined) last = parsed;
  }
  return last;
}

async function postMcp(baseUrl: string, token: string, body: unknown): Promise<JsonRpcResponse | null> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (response.status === 202 || text.length === 0) return null;
  const contentType = response.headers.get('content-type') ?? '';
  const parsed = contentType.includes('text/event-stream') ? parseSse(text) : (JSON.parse(text) as JsonRpcResponse);
  if (!response.ok) {
    const message = parsed?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`MCP 请求失败: ${message}`);
  }
  if (parsed?.error) throw new Error(`MCP 错误 ${parsed.error.code}: ${parsed.error.message}`);
  return parsed;
}

async function pair(baseUrl: string, options: CliOptions): Promise<PairResponse> {
  if (!options.code) throw new Error('需要 --code（设备上显示的 6 位配对码），或使用 --token');
  const name = options.name?.trim() || 'phone-as-tool CLI';
  const fingerprint = options.fingerprint?.trim() || defaultFingerprint(name);
  const response = await fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: options.code, clientName: name, fingerprint }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await readJson(response)) as { token?: unknown; client?: unknown; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !body || typeof body.token !== 'string') {
    const code = body?.error?.code ?? `HTTP ${response.status}`;
    const message = body?.error?.message ?? '配对失败';
    throw new Error(`配对失败 (${code}): ${message}`);
  }
  return body as unknown as PairResponse;
}

async function listTools(baseUrl: string, token: string): Promise<void> {
  const initialize = await postMcp(baseUrl, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'phone-as-tool-pair-cli', version: VERSION },
    },
  });
  if (!initialize?.result) throw new Error('initialize 没有返回结果');
  const server = initialize.result as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string };

  await postMcp(baseUrl, token, { jsonrpc: '2.0', method: 'notifications/initialized' });

  const tools = await postMcp(baseUrl, token, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  const result = tools?.result as { tools?: Array<{ name?: string; description?: string }> } | undefined;
  if (!result?.tools) throw new Error('tools/list 没有返回工具列表');

  console.log('');
  console.log(
    `已连接 ${server.serverInfo?.name ?? 'server'} ${server.serverInfo?.version ?? ''} (protocol ${server.protocolVersion ?? 'unknown'})`,
  );
  console.log(`工具 (${result.tools.length}):`);
  for (const tool of result.tools) {
    console.log(`  ${tool.name ?? '?'} — ${tool.description ?? ''}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.url) throw new Error('需要 --url，例如 http://192.168.1.5:8765');
  const baseUrl = normalizeBaseUrl(options.url);

  let token = options.token;
  if (!token) {
    const paired = await pair(baseUrl, options);
    token = paired.token;
    console.log(`已配对客户端: ${paired.client.clientName} (${paired.client.id})`);
    console.log(`MCP 端点: ${baseUrl}/mcp`);
    console.log(`令牌（只显示一次，请放进 MCP 客户端配置；不要发到聊天或日志里）:`);
    console.log(token);
  } else {
    console.log(`使用已有令牌连接 ${baseUrl}/mcp`);
  }
  await listTools(baseUrl, token);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
