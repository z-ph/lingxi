import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TokenStore, TokenStoreError, TOKEN_PREFIX } from '../src/pairing/token-store.js';

function tempFile(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'phone-as-tool-token-'));
  return { dir, file: path.join(dir, 'tokens.json') };
}

test('issue returns a token once and list never exposes it', () => {
  const store = TokenStore.inMemory();
  const issued = store.issue({ clientName: 'Claude Code', fingerprint: 'fp-123456' });
  assert.equal(issued.token.startsWith(TOKEN_PREFIX), true);
  assert.equal(issued.client.clientName, 'Claude Code');
  assert.equal(issued.client.lastUsedAt, null);

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes(issued.token), false);
  assert.equal('token' in (listed[0] as object), false);
  assert.equal('tokenHash' in (listed[0] as object), false);
});

test('verify accepts only issued tokens and updates lastUsedAt', () => {
  const store = TokenStore.inMemory();
  const issued = store.issue({ clientName: 'Cursor', fingerprint: 'fp-abcdef' });
  const record = store.verify(issued.token);
  assert.ok(record);
  assert.equal(record?.clientName, 'Cursor');
  assert.notEqual(record?.lastUsedAt, null);
  assert.equal(store.verify('pat_not-a-real-token-xxxxxxxxxxxxxxxx'), null);
  assert.equal(store.verify('not-even-the-prefix'), null);
});

test('revoke is immediate and revokeAll clears every client', () => {
  const store = TokenStore.inMemory();
  const first = store.issue({ clientName: 'A', fingerprint: 'fp-aaaaaa' });
  const second = store.issue({ clientName: 'B', fingerprint: 'fp-bbbbbb' });
  assert.equal(store.revoke(first.client.id), true);
  assert.equal(store.verify(first.token), null);
  assert.ok(store.verify(second.token));
  assert.equal(store.revoke('tok_missing'), false);
  assert.equal(store.revokeAll(), 1);
  assert.equal(store.list().length, 0);
});

test('state file stores only hashes, is 0600, and survives reopen', () => {
  const { dir, file } = tempFile();
  try {
    const store = TokenStore.open(file);
    const issued = store.issue({ clientName: 'Claude Code', fingerprint: 'fp-123456' });
    store.close();

    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes(issued.token), false);
    const expectedHash = createHash('sha256').update(issued.token).digest('hex');
    assert.equal(text.includes(expectedHash), true);
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);

    const reopened = TokenStore.open(file);
    assert.ok(reopened.verify(issued.token));
    assert.equal(reopened.list().length, 1);
    reopened.revoke(issued.client.id);
    reopened.close();

    const afterRevoke = TokenStore.open(file);
    assert.equal(afterRevoke.verify(issued.token), null);
    afterRevoke.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt state fails closed instead of silently dropping tokens', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, '{"version":1,"tokens":[', 'utf8');
    assert.throws(() => TokenStore.open(file), TokenStoreError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persisted lastUsedAt is written on flush', () => {
  const { dir, file } = tempFile();
  try {
    const store = TokenStore.open(file);
    const issued = store.issue({ clientName: 'Claude Code', fingerprint: 'fp-123456' });
    assert.ok(store.verify(issued.token));
    store.flush();
    const reopened = TokenStore.open(file);
    assert.notEqual(reopened.list()[0]?.lastUsedAt, null);
    reopened.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
