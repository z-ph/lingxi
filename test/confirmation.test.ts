import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeConfirmationDigest,
  DeviceConfirmationQueue,
  type ConfirmationDecision,
  type ConfirmationPrompt,
} from "../src/security/index.js";

function makePrompt(id = "prompt-1"): ConfirmationPrompt {
  const base: Omit<ConfirmationPrompt, "digest"> = {
    id,
    client: { id: "client-1", name: "Claude Code" },
    tool: "tap",
    argsSummary: { nodeId: "n7" },
    appPackages: ["com.example.notes"],
    danger: {
      dangerous: true,
      reasons: [{ ruleId: "default.payment", category: "payment", message: "支付" }],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:00:30.000Z",
  };
  return { ...base, digest: computeConfirmationDigest(base) };
}

test("approval requires the exact prompt id and digest", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 1000 });
  const prompt = makePrompt();
  const decisionPromise = queue.request(prompt);

  assert.equal(queue.size, 1);
  assert.deepEqual(queue.pending(), [prompt]);
  assert.equal(queue.approve(prompt.id, "wrong-digest"), false);
  assert.equal(queue.size, 1);

  assert.equal(queue.approve(prompt.id, prompt.digest, "phone-owner"), true);
  const decision = await decisionPromise;
  assert.deepEqual(decision, {
    approved: true,
    approver: "phone-owner",
    decidedAt: decision.decidedAt,
  });
  assert.equal(queue.size, 0);
  assert.equal(queue.approve(prompt.id, prompt.digest), false);
});

test("denial is reported and the request is removed", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 1000 });
  const prompt = makePrompt();
  const decisionPromise = queue.request(prompt);
  assert.equal(queue.deny(prompt.id, "owner said no"), true);
  const decision = await decisionPromise;
  assert.equal(decision.approved, false);
  if (!decision.approved) {
    assert.equal(decision.reason, "denied");
    assert.equal(decision.detail, "owner said no");
  }
  assert.equal(queue.size, 0);
  assert.equal(queue.deny(prompt.id), false);
});

test("unanswered requests time out and deny", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 20 });
  const prompt = makePrompt();
  const decision = await queue.request(prompt);
  assert.equal(decision.approved, false);
  if (!decision.approved) {
    assert.equal(decision.reason, "timeout");
  }
  assert.equal(queue.size, 0);
  assert.equal(queue.approve(prompt.id, prompt.digest), false);
});

test("cancelAll settles every pending request and is kill-switch safe", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 1000 });
  const decisions: Promise<ConfirmationDecision>[] = [
    queue.request(makePrompt("one")),
    queue.request(makePrompt("two")),
  ];
  assert.equal(queue.size, 2);
  assert.equal(queue.cancelAll("cancelled", "kill switch engaged"), 2);
  assert.equal(queue.cancelAll("cancelled"), 0);
  for (const decision of await Promise.all(decisions)) {
    assert.equal(decision.approved, false);
    if (!decision.approved) {
      assert.equal(decision.reason, "cancelled");
    }
  }
  assert.equal(queue.size, 0);
});

test("concurrent prompts are independent", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 1000 });
  const first = makePrompt("first");
  const second = makePrompt("second");
  const firstDecision = queue.request(first);
  const secondDecision = queue.request(second);

  assert.equal(queue.approve(second.id, second.digest, "owner"), true);
  assert.equal(queue.deny(first.id), true);

  assert.equal((await firstDecision).approved, false);
  const approved = await secondDecision;
  assert.equal(approved.approved, true);
  if (approved.approved) {
    assert.equal(approved.approver, "owner");
  }
});

test("the digest is stable and changes with the action", () => {
  const prompt = makePrompt();
  const { digest, ...base } = prompt;
  assert.equal(computeConfirmationDigest(base), digest);

  const changed = { ...base, argsSummary: { nodeId: "n8" } };
  assert.notEqual(computeConfirmationDigest(changed), prompt.digest);
});

test("duplicate pending ids are rejected", async () => {
  const queue = new DeviceConfirmationQueue({ timeoutMs: 1000 });
  const prompt = makePrompt();
  const first = queue.request(prompt);
  assert.throws(() => queue.request(prompt), Error);
  queue.cancel(prompt.id, "cancelled");
  assert.equal((await first).approved, false);
});

test("invalid timeouts are rejected", () => {
  assert.throws(() => new DeviceConfirmationQueue({ timeoutMs: 0 }), TypeError);
  assert.throws(() => new DeviceConfirmationQueue({ timeoutMs: Number.NaN }), TypeError);
});
