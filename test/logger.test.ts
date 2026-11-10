import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger, createMemoryLogger, redactString } from '../src/logger.js';

const TOKEN = `pat_${'A'.repeat(43)}`;

test('redactString removes tokens, bearer headers and secret query parameters', () => {
  const input = `token=${TOKEN}&code=123456 Authorization: Bearer abcdefghijklmnop`;
  const output = redactString(input);
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes('123456'), false);
  assert.equal(output.includes('abcdefghijklmnop'), false);
  assert.match(output, /pat_\[redacted\]/);
  assert.match(output, /Bearer \[redacted\]/);
});

test('logger redacts fields and error objects', () => {
  const memory = createMemoryLogger();
  memory.logger.info('pairing', { token: TOKEN, nested: { authorization: `Bearer ${TOKEN}` } });
  memory.logger.error('failure', { error: new Error(`request failed for ${TOKEN}`) });
  const text = memory.text();
  assert.equal(text.includes(TOKEN), false);
  assert.match(text, /pat_\[redacted\]/);
  assert.equal(memory.entries.length, 2);
});

test('logger honors the configured level', () => {
  const memory = createMemoryLogger({ level: 'warn' });
  memory.logger.debug('debug');
  memory.logger.info('info');
  memory.logger.warn('warn');
  memory.logger.error('error');
  assert.deepEqual(
    memory.entries.map((entry) => entry.msg),
    ['warn', 'error'],
  );
});

test('child logger adds bound fields', () => {
  const memory = createMemoryLogger();
  const child = memory.logger.child({ component: 'http' });
  child.info('listening', { port: 8765 });
  assert.equal(memory.entries[0]?.fields.component, 'http');
  assert.equal(memory.entries[0]?.fields.port, 8765);
});

test('default logger writes JSON to the sink', () => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line) });
  logger.info('hello', { answer: 42 });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? '') as { msg: string; answer: number };
  assert.equal(parsed.msg, 'hello');
  assert.equal(parsed.answer, 42);
});
