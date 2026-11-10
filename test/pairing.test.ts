import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PairingError, PairingManager } from '../src/pairing/pairing-manager.js';
import type { PairingManagerOptions, PendingApproval } from '../src/pairing/pairing-manager.js';
import { TokenStore } from '../src/pairing/token-store.js';

function makeManager(options: Partial<PairingManagerOptions> = {}): {
  manager: PairingManager;
  store: TokenStore;
} {
  const store = TokenStore.inMemory();
  const manager = new PairingManager({
    tokenStore: store,
    generateCode: () => '123456',
    ...options,
  });
  return { manager, store };
}

function nextApproval(manager: PairingManager): Promise<PendingApproval> {
  return new Promise((resolve) => {
    const unsubscribe = manager.onApprovalRequest((approval) => {
      unsubscribe();
      resolve(approval);
    });
  });
}

function isPairingError(code: PairingError['code']) {
  return (error: unknown): boolean => error instanceof PairingError && error.code === code;
}

test('startPairing shows a six-digit code and a QR payload', () => {
  const { manager } = makeManager();
  try {
    const info = manager.startPairing('http://192.168.1.5:8765');
    assert.match(info.code, /^\d{6}$/);
    assert.equal(info.code, '123456');
    const uri = new URL(info.uri);
    assert.equal(uri.protocol, 'phonetool:');
    assert.equal(uri.searchParams.get('code'), info.code);
    assert.equal(uri.searchParams.get('url'), 'http://192.168.1.5:8765');
    assert.equal(manager.current()?.code, info.code);
  } finally {
    manager.close();
  }
});

test('requestPairing resolves only after explicit approval and issues one token', async () => {
  const { manager, store } = makeManager();
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    const approvalPromise = nextApproval(manager);
    const pending = manager.requestPairing({
      code: info.code,
      clientName: 'Claude Code',
      fingerprint: 'fp-123456',
      remoteAddress: '192.168.1.20',
    });
    const approval = await approvalPromise;
    assert.equal(approval.clientName, 'Claude Code');
    assert.equal(approval.fingerprint, 'fp-123456');
    assert.equal(approval.remoteAddress, '192.168.1.20');

    const client = manager.approve(approval.id);
    const issued = await pending;
    assert.equal(issued.client.id, client.id);
    assert.equal(issued.token.startsWith('pat_'), true);
    assert.equal(store.list().length, 1);
    assert.equal(manager.current(), null);
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: 'Another', fingerprint: 'fp-abcdef' }),
      isPairingError('no_active_pairing'),
    );
  } finally {
    manager.close();
  }
});

test('deny rejects the request but keeps the pairing code usable', async () => {
  const { manager } = makeManager();
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    const approvalPromise = nextApproval(manager);
    const pending = manager.requestPairing({ code: info.code, clientName: 'Cursor', fingerprint: 'fp-abcdef' });
    const approval = await approvalPromise;
    manager.deny(approval.id);
    await assert.rejects(pending, isPairingError('denied'));
    assert.equal(manager.current()?.code, info.code);
  } finally {
    manager.close();
  }
});

test('wrong codes consume attempts and then invalidate the session', async () => {
  const { manager } = makeManager({ maxFailedAttempts: 3 });
  try {
    manager.startPairing('http://127.0.0.1:8765');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        manager.requestPairing({ code: '000000', clientName: 'Intruder', fingerprint: 'fp-intruder' }),
        isPairingError('invalid_code'),
      );
    }
    assert.equal(manager.current(), null);
    await assert.rejects(
      manager.requestPairing({ code: '123456', clientName: 'Claude Code', fingerprint: 'fp-123456' }),
      isPairingError('no_active_pairing'),
    );
  } finally {
    manager.close();
  }
});

test('approval timeout rejects without issuing a token', async () => {
  const { manager, store } = makeManager({ approvalTtlMs: 20 });
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: 'Slow', fingerprint: 'fp-slow01' }),
      isPairingError('approval_timeout'),
    );
    assert.equal(store.list().length, 0);
  } finally {
    manager.close();
  }
});

test('pairing code expires', async () => {
  const { manager } = makeManager({ codeTtlMs: 20 });
  try {
    manager.startPairing('http://127.0.0.1:8765');
    await delay(40);
    assert.equal(manager.current(), null);
    await assert.rejects(
      manager.requestPairing({ code: '123456', clientName: 'Late', fingerprint: 'fp-late01' }),
      isPairingError('no_active_pairing'),
    );
  } finally {
    manager.close();
  }
});

test('pending approvals are bounded', async () => {
  const { manager } = makeManager({ maxPending: 1 });
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    const approvalPromise = nextApproval(manager);
    const first = manager.requestPairing({ code: info.code, clientName: 'First', fingerprint: 'fp-first1' });
    const approval = await approvalPromise;
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: 'Second', fingerprint: 'fp-second' }),
      isPairingError('too_many_requests'),
    );
    manager.approve(approval.id);
    await first;
  } finally {
    manager.close();
  }
});

test('an aborted client request is rejected and removed', async () => {
  const { manager } = makeManager();
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    const controller = new AbortController();
    const pending = manager.requestPairing(
      { code: info.code, clientName: 'Aborted', fingerprint: 'fp-abort1' },
      { signal: controller.signal },
    );
    controller.abort();
    await assert.rejects(pending, isPairingError('client_aborted'));
    assert.equal(manager.pendingApprovals().length, 0);
  } finally {
    manager.close();
  }
});

test('client name and fingerprint are validated', async () => {
  const { manager } = makeManager();
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: '', fingerprint: 'fp-123456' }),
      isPairingError('invalid_client'),
    );
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: 'Client', fingerprint: 'bad fingerprint' }),
      isPairingError('invalid_client'),
    );
    await assert.rejects(
      manager.requestPairing({ code: info.code, clientName: 'Client', fingerprint: 'x' }),
      isPairingError('invalid_client'),
    );
  } finally {
    manager.close();
  }
});

test('starting a new pairing session rejects pending approvals', async () => {
  const { manager } = makeManager();
  try {
    const info = manager.startPairing('http://127.0.0.1:8765');
    const pending = manager.requestPairing({ code: info.code, clientName: 'Old', fingerprint: 'fp-old123' });
    manager.startPairing('http://127.0.0.1:8765');
    await assert.rejects(pending, isPairingError('no_active_pairing'));
  } finally {
    manager.close();
  }
});

test('close rejects pending approvals with shutdown', async () => {
  const { manager } = makeManager();
  const info = manager.startPairing('http://127.0.0.1:8765');
  const pending = manager.requestPairing({ code: info.code, clientName: 'Pending', fingerprint: 'fp-pend01' });
  manager.close();
  await assert.rejects(pending, isPairingError('shutdown'));
  assert.equal(manager.current(), null);
});
