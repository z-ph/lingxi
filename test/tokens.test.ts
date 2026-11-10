import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientRegistry } from "../src/security/index.js";

function deterministicRegistry(): ClientRegistry {
  let tokenCounter = 0;
  let idCounter = 0;
  return new ClientRegistry({
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    tokenFactory: () => `token-${(tokenCounter += 1).toString().padStart(2, "0")}-abcdefghijklmnop`,
    idFactory: () => `client-${(idCounter += 1).toString().padStart(2, "0")}`,
  });
}

test("issued tokens authenticate the right client", () => {
  const registry = deterministicRegistry();
  const first = registry.issue("Claude Code");
  const second = registry.issue("Cursor");

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.client.id, second.client.id);
  assert.deepEqual(registry.authenticate(first.token), first.client);
  assert.deepEqual(registry.authenticate(second.token), second.client);
  assert.equal(registry.authenticate("wrong-token"), null);
  assert.equal(registry.authenticate(""), null);
  assert.equal(registry.activeCount(), 2);
});

test("the client list never exposes tokens or token hashes", () => {
  const registry = deterministicRegistry();
  const issued = registry.issue("Claude Code");
  const serialized = JSON.stringify(registry.list());
  assert.equal(serialized.includes(issued.token), false);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.deepEqual(registry.get(issued.client.id), {
    ...issued.client,
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  });
});

test("revoking one client leaves the others usable", () => {
  const registry = deterministicRegistry();
  const first = registry.issue("Claude Code");
  const second = registry.issue("Cursor");

  assert.equal(registry.revoke(first.client.id), true);
  assert.equal(registry.revoke(first.client.id), false);
  assert.equal(registry.authenticate(first.token), null);
  assert.deepEqual(registry.authenticate(second.token), second.client);
  assert.equal(registry.activeCount(), 1);
  assert.notEqual(registry.get(first.client.id)?.revokedAt, null);
});

test("revokeAll removes every token and is idempotent", () => {
  const registry = deterministicRegistry();
  const first = registry.issue("Claude Code");
  const second = registry.issue("Cursor");
  registry.issue("DSH");

  assert.equal(registry.revokeAll(), 3);
  assert.equal(registry.revokeAll(), 0);
  assert.equal(registry.authenticate(first.token), null);
  assert.equal(registry.authenticate(second.token), null);
  assert.equal(registry.activeCount(), 0);
});

test("invalid client names and weak token factories are rejected", () => {
  const registry = deterministicRegistry();
  assert.throws(() => registry.issue(""), TypeError);
  assert.throws(() => registry.issue("   "), TypeError);
  assert.throws(() => registry.issue("x".repeat(81)), TypeError);

  const weak = new ClientRegistry({ tokenFactory: () => "short" });
  assert.throws(() => weak.issue("client"), Error);
});

test("a broken token factory that repeats tokens is rejected", () => {
  const registry = new ClientRegistry({
    tokenFactory: () => "duplicate-token-abcdefghijklmnop",
  });
  registry.issue("first");
  assert.throws(() => registry.issue("second"), /duplicate token/);
  assert.equal(registry.activeCount(), 1);
});

test("overlong tokens are rejected before hashing work", () => {
  const registry = deterministicRegistry();
  const issued = registry.issue("Claude Code");
  assert.deepEqual(registry.authenticate(issued.token), issued.client);
  assert.equal(registry.authenticate("x".repeat(10_000)), null);
});
