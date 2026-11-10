import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface LineWaiter {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function watchLines(child: ChildProcessWithoutNullStreams): {
  lines: string[];
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>;
} {
  const lines: string[] = [];
  const waiters: LineWaiter[] = [];
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    lines.push(line);
    for (const waiter of [...waiters]) {
      const match = line.match(waiter.pattern);
      if (!match) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(match);
    }
  });
  return {
    lines,
    waitFor(pattern, timeoutMs = 10_000) {
      const existing = lines.map((line) => line.match(pattern)).find((match): match is RegExpMatchArray => match !== null);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`timed out waiting for ${pattern}; output so far:\n${lines.join('\n')}`));
        }, timeoutMs);
        timer.unref?.();
        waiters.push({ pattern, resolve, reject, timer });
      });
    },
  };
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not exit in time')), timeoutMs);
    timer.unref?.();
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

test('the daemon CLI displays the code, requires explicit approval, and revokes by id', async (t) => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'phone-as-tool-cli-'));
  const child = spawn(
    process.execPath,
    [path.resolve('dist/src/cli.js'), '--host', '127.0.0.1', '--port', '0', '--state-dir', stateDir],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(stateDir, { recursive: true, force: true });
  });
  const output = watchLines(child);
  child.stderr.resume();
  const endpointMatch = await output.waitFor(/MCP 端点:\s+(http:\/\/[^/\s]+)/);
  const baseUrl = endpointMatch[1] ?? '';
  const codeMatch = await output.waitFor(/配对码:\s+(\d{6})/);
  const code = codeMatch[1] ?? '';

  const pairResponse = fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, clientName: 'CLI Approval Test', fingerprint: 'fp-cli-approval' }),
  });
  await output.waitFor(/配对请求:/);
  await output.waitFor(/客户端: CLI Approval Test/);
  await output.waitFor(/允许此客户端？/);
  child.stdin.write('y\n');

  const response = await pairResponse;
  assert.equal(response.status, 200);
  const body = (await response.json()) as { token: string; client: { id: string; clientName: string } };
  assert.equal(body.client.clientName, 'CLI Approval Test');
  assert.equal(body.token.startsWith('pat_'), true);
  assert.equal(output.lines.join('\n').includes(body.token), false, 'daemon CLI must never print the token');

  await output.waitFor(/已允许 CLI Approval Test/);
  child.stdin.write('tokens\n');
  await output.waitFor(new RegExp(`\\b${body.client.id}\\b`));
  child.stdin.write(`revoke ${body.client.id}\n`);
  await output.waitFor(/已撤销/);
  child.stdin.write('quit\n');
  assert.equal(await waitForExit(child), 0);
});
