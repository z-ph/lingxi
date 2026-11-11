import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendTextFixture, createFixture } from './helpers.mjs';

const CLI_PATH = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('cli exits 0 and emits json for a compliant repo', async (t) => {
  const root = await createFixture(t);
  const result = spawnSync(process.execPath, [CLI_PATH, '--root', root, '--format', 'json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.errorCount, 0);
  assert.deepEqual(payload.violations, []);
});

test('cli exits 1 and reports the rule id for a violating repo', async (t) => {
  const root = await createFixture(t);
  await appendTextFixture(root, 'docs/vision.md', '[broken](missing.md)');
  const result = spawnSync(process.execPath, [CLI_PATH, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /DOC-002/);
  assert.match(result.stdout, /missing\.md/);
});

test('cli prints help and exits 0', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--root/);
});
