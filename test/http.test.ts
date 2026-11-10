import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startDaemon, type DaemonOptions, type RunningDaemon } from '../src/daemon.js';
import { createMemoryLogger, type MemoryLogger } from '../src/logger.js';
import { M1_TOOL_NAMES } from '../src/server/tools.js';
import type { PendingApproval } from '../src/pairing/pairing-manager.js';

const execFileAsync = promisify(execFile);

interface TestContext {
  daemon: RunningDaemon;
  logs: MemoryLogger;
  waitForApproval(): Promise<PendingApproval>;
}

async function startTestDaemon(options: Partial<DaemonOptions> = {}): Promise<TestContext> {
  const logs = createMemoryLogger();
  const approvals: PendingApproval[] = [];
  const waiters: Array<(approval: PendingApproval) => void> = [];
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 0,
    stateDir: null,
    logger: logs.logger,
    onApprovalRequest: (approval) => {
      approvals.push(approval);
      const waiter = waiters.shift();
      if (waiter) waiter(approval);
    },
    ...options,
  });
  return {
    daemon,
    logs,
    waitForApproval: () =>
      new Promise((resolve) => {
        const existing = approvals.shift();
        if (existing) resolve(existing);
        else waiters.push(resolve);
      }),
  };
}

function pairRequest(
  daemon: RunningDaemon,
  code: string,
  clientName = 'Claude Code',
  fingerprint = 'fp-123456',
): Promise<Response> {
  return fetch(`${daemon.url}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, clientName, fingerprint }),
  });
}

async function pairAndApprove(context: TestContext): Promise<{ token: string; client: { id: string; clientName: string } }> {
  const pending = pairRequest(context.daemon, context.daemon.pairingInfo.code);
  const approval = await context.waitForApproval();
  context.daemon.approve(approval.id);
  const response = await pending;
  assert.equal(response.status, 200);
  return (await response.json()) as { token: string; client: { id: string; clientName: string } };
}

function mcpHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
}

function rawStatus(port: number, requestPath: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', headers },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('health is reachable without a token and exposes no secrets', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());
  const response = await fetch(`${context.daemon.url}/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.name, 'phone-as-tool');
  assert.equal('token' in body, false);
});

test('MCP endpoint rejects missing and invalid bearer tokens', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  const missing = await fetch(`${context.daemon.url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body,
  });
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate') ?? '', /^Bearer /);

  const invalid = await fetch(`${context.daemon.url}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('pat_invalid-token-that-was-never-issued'),
    body,
  });
  assert.equal(invalid.status, 401);
  assert.equal(context.logs.text().includes('pat_invalid-token-that-was-never-issued'), false);
});

test('Host and Origin guards reject DNS-rebinding style requests', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());

  const badHost = await rawStatus(context.daemon.port, '/health', { host: 'evil.example' });
  assert.equal(badHost, 403);

  const badOrigin = await rawStatus(context.daemon.port, '/health', {
    host: `127.0.0.1:${context.daemon.port}`,
    origin: 'http://evil.example',
  });
  assert.equal(badOrigin, 403);

  const goodOrigin = await rawStatus(context.daemon.port, '/health', {
    host: `127.0.0.1:${context.daemon.port}`,
    origin: context.daemon.url,
  });
  assert.equal(goodOrigin, 200);
});

test('pairing endpoint validates media type and JSON', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());

  const wrongType = await fetch(`${context.daemon.url}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);

  const badJson = await fetch(`${context.daemon.url}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(badJson.status, 400);

  const wrongMethod = await fetch(`${context.daemon.url}/pair`);
  assert.equal(wrongMethod.status, 405);

  const missing = await fetch(`${context.daemon.url}/nope`);
  assert.equal(missing.status, 404);
});

test('denying a pairing request returns 403 and no token', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());
  const pending = pairRequest(context.daemon, context.daemon.pairingInfo.code, 'Denied Client', 'fp-denied');
  const approval = await context.waitForApproval();
  context.daemon.deny(approval.id);
  const response = await pending;
  assert.equal(response.status, 403);
  const body = (await response.json()) as { token?: unknown; error?: { code?: string } };
  assert.equal(body.token, undefined);
  assert.equal(body.error?.code, 'denied');
});

test('a real MCP client connects, lists six tools, calls ui_tree, and loses access on revoke', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());
  const { token, client: clientInfo } = await pairAndApprove(context);

  assert.equal(context.daemon.listTokens().length, 1);
  assert.equal(context.daemon.listTokens()[0]?.id, clientInfo.id);
  assert.equal(context.logs.text().includes(token), false);
  assert.equal(context.logs.text().includes(context.daemon.pairingInfo.code), false);
  assert.equal(JSON.stringify(context.daemon.listTokens()).includes(token), false);

  const client = new Client({ name: 'phone-as-tool-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${context.daemon.url}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...M1_TOOL_NAMES].sort(),
    );
    const result = await client.callTool({ name: 'ui_tree', arguments: {} });
    assert.notEqual(result.isError, true);
    const textBlock = result.content.find((block) => block.type === 'text');
    assert.ok(textBlock && textBlock.type === 'text');
    const payload = JSON.parse(textBlock.text) as { nodes?: Array<{ id?: string }> };
    assert.ok((payload.nodes?.length ?? 0) > 0);

    const screenshot = await client.callTool({ name: 'screenshot', arguments: { format: 'png' } });
    assert.notEqual(screenshot.isError, true);
    const imageBlock = screenshot.content.find((block) => block.type === 'image');
    assert.ok(imageBlock && imageBlock.type === 'image');
    assert.equal(imageBlock.mimeType, 'image/png');
    assert.ok(imageBlock.data.length > 0);
  } finally {
    await client.close();
  }

  context.daemon.revokeToken(clientInfo.id);
  const afterRevoke = await fetch(`${context.daemon.url}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(afterRevoke.status, 401);
  assert.equal(context.logs.text().includes(token), false);
});

test('the separate pairing client CLI pairs and lists tools', async (t) => {
  const context = await startTestDaemon();
  t.after(() => context.daemon.close());
  const cliPath = path.resolve('dist/src/client/pair-cli.js');
  const clientPromise = execFileAsync(
    process.execPath,
    [
      cliPath,
      '--url',
      context.daemon.url,
      '--code',
      context.daemon.pairingInfo.code,
      '--name',
      'CLI Test Client',
      '--fingerprint',
      'fp-cli-test',
    ],
    { timeout: 20_000 },
  );
  const approval = await context.waitForApproval();
  context.daemon.approve(approval.id);
  const { stdout } = await clientPromise;
  for (const tool of M1_TOOL_NAMES) assert.match(stdout, new RegExp(tool));
  assert.match(stdout, /已连接 phone-as-tool/);
});
