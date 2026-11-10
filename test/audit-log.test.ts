import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AuditLog,
  JsonlAuditSink,
  MemoryAuditSink,
  summarizeParameters,
  summarizeToolResult,
  verifyAuditChain,
  type AuditEntry,
  type AuditStoreLike,
} from "../src/security/index.js";

const CLIENT = { id: "client-1", name: "Claude Code" };
const FIXED_CLOCK = () => new Date("2026-01-01T00:00:00.000Z");

function auditWithMemory(): { log: AuditLog; sink: MemoryAuditSink } {
  const sink = new MemoryAuditSink();
  return { log: new AuditLog({ sink, clock: FIXED_CLOCK }), sink };
}

test("every recorded call has client, tool, parameters, result and timestamp", () => {
  const { log } = auditWithMemory();
  const entry = log.record({
    client: CLIENT,
    tool: "tap",
    args: { nodeId: "n7", x: 100, y: 200 },
    appPackages: ["com.example.notes"],
    decision: "allowed",
    result: { status: "ok", summary: "{nodes[1]}" },
    durationMs: 12.5,
    at: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(entry.seq, 1);
  assert.equal(entry.at, "2026-01-01T00:00:00.000Z");
  assert.equal(entry.kind, "tool_call");
  assert.deepEqual(entry.client, CLIENT);
  assert.equal(entry.tool, "tap");
  assert.deepEqual(entry.parameters, { nodeId: "n7", x: 100, y: 200 });
  assert.deepEqual(entry.appPackages, ["com.example.notes"]);
  assert.equal(entry.decision, "allowed");
  assert.deepEqual(entry.result, { status: "ok", summary: "{nodes[1]}" });
  assert.equal(entry.durationMs, 12.5);
  assert.equal(entry.prevHash, "0".repeat(64));
  assert.equal(entry.hash.length, 64);
  assert.equal(log.verify().ok, true);
});

test("sensitive parameters are redacted before they reach the log", () => {
  const { log } = auditWithMemory();
  const entry = log.record({
    client: CLIENT,
    tool: "type",
    args: {
      text: "hunter2",
      token: "pairing-secret-token",
      password: "p@ss",
      authorization: "Bearer abc",
      nested: { apiKey: "key", note: "hello" },
      image: "iVBORw0KGgo=",
    },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 1,
  });

  assert.deepEqual(entry.parameters["text"], "[redacted 7 chars]");
  assert.deepEqual(entry.parameters["token"], "[redacted]");
  assert.deepEqual(entry.parameters["password"], "[redacted]");
  assert.deepEqual(entry.parameters["authorization"], "[redacted]");
  assert.deepEqual(entry.parameters["image"], "[redacted]");
  assert.deepEqual(entry.parameters["nested"], { apiKey: "[redacted]", note: "hello" });

  const serialized = log.exportJsonl();
  for (const secret of ["hunter2", "pairing-secret-token", "p@ss", "Bearer abc", "iVBORw0KGgo="]) {
    assert.equal(serialized.includes(secret), false, `audit leaked ${secret}`);
  }
});

test("long strings and nested structures are reduced to a summary", () => {
  const parameters = summarizeParameters("ui_tree", {
    filter: "x".repeat(500),
    maxDepth: 30,
    nested: { deep: { deeper: { deepest: "hidden" } } },
  });
  assert.equal(typeof parameters["filter"], "string");
  assert.equal((parameters["filter"] as string).length, 120);
  assert.equal(parameters["maxDepth"], 30);
  const nested = parameters["nested"] as Record<string, unknown>;
  const deep = nested["deep"] as Record<string, unknown>;
  assert.equal(deep["deeper"], "[object]");
});

test("result summaries never contain screen text, pixels or API payloads", () => {
  const uiTree = summarizeToolResult({
    ok: true,
    result: {
      nodes: [{ id: "n1", text: "private chat message" }],
      truncated: false,
    },
  });
  assert.equal(uiTree.status, "ok");
  assert.equal(uiTree.summary.includes("private chat message"), false);

  const screenshot = summarizeToolResult({
    ok: true,
    result: { format: "png", width: 1080, height: 2400, data: "BASE64PIXELS" },
  });
  assert.equal(screenshot.summary.includes("BASE64PIXELS"), false);

  const error = summarizeToolResult({
    ok: false,
    error: { code: "not_found", message: "node not found" },
  });
  assert.deepEqual(error, { status: "error", code: "not_found", summary: "node not found" });
  assert.equal(summarizeToolResult({ nope: true }).code, "internal");
});

test("JSONL and JSON exports are parseable and complete", () => {
  const { log } = auditWithMemory();
  for (let index = 0; index < 3; index += 1) {
    log.record({
      client: CLIENT,
      tool: "tap",
      args: { index },
      decision: "allowed",
      result: { status: "ok", summary: "ok" },
      durationMs: index,
    });
  }

  const jsonl = log.exportJsonl();
  const lines = jsonl.trim().split("\n");
  assert.equal(lines.length, 3);
  const parsed = lines.map((line) => JSON.parse(line) as AuditEntry);
  assert.deepEqual(parsed.map((entry) => entry.seq), [1, 2, 3]);
  assert.equal(verifyAuditChain(parsed).ok, true);

  const json = JSON.parse(log.exportJson()) as {
    version: number;
    exportedAt: string;
    entries: AuditEntry[];
  };
  assert.equal(json.version, 1);
  assert.equal(json.entries.length, 3);
  assert.equal(json.exportedAt, "2026-01-01T00:00:00.000Z");
});

test("exports can be written to a local file, never uploaded", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "phone-as-tool-audit-export-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { log } = auditWithMemory();
  log.record({
    client: CLIENT,
    tool: "screenshot",
    args: { format: "png" },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 2,
  });

  const jsonlPath = join(directory, "nested", "audit.jsonl");
  log.writeExport(jsonlPath, "jsonl");
  assert.equal(readFileSync(jsonlPath, "utf8"), log.exportJsonl());

  const jsonPath = join(directory, "audit.json");
  log.writeExport(jsonPath, "json");
  assert.equal(readFileSync(jsonPath, "utf8"), log.exportJson());
});

test("a JSONL sink persists entries across restarts and continues the hash chain", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "phone-as-tool-audit-sink-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "audit.jsonl");

  const first = new AuditLog({ sink: new JsonlAuditSink(path), clock: FIXED_CLOCK });
  first.record({
    client: CLIENT,
    tool: "tap",
    args: { step: 1 },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 1,
  });

  const second = new AuditLog({ sink: new JsonlAuditSink(path), clock: FIXED_CLOCK });
  assert.equal(second.size, 1);
  second.record({
    client: CLIENT,
    tool: "type",
    args: { text: "secret" },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 2,
  });
  assert.equal(second.size, 2);
  assert.equal(second.verify().ok, true);

  const third = new AuditLog({ sink: new JsonlAuditSink(path), clock: FIXED_CLOCK });
  assert.deepEqual(third.entries().map((entry) => entry.seq), [1, 2]);
  assert.equal(third.entries()[1]?.parameters["text"], "[redacted 6 chars]");
});

test("the hash chain detects tampering", () => {
  const { log } = auditWithMemory();
  log.record({
    client: CLIENT,
    tool: "tap",
    args: { x: 1 },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 1,
  });
  log.record({
    client: CLIENT,
    tool: "tap",
    args: { x: 2 },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 1,
  });

  const tampered = JSON.parse(JSON.stringify(log.entries())) as AuditEntry[];
  const first = tampered[0] as unknown as { parameters: Record<string, unknown> };
  first.parameters["x"] = 999;
  const verification = verifyAuditChain(tampered);
  assert.equal(verification.ok, false);
  assert.equal(verification.brokenAt, 1);

  const secondTampered = JSON.parse(JSON.stringify(log.entries())) as AuditEntry[];
  const second = secondTampered[1] as unknown as { result: { summary: string } };
  second.result.summary = "changed";
  assert.equal(verifyAuditChain(secondTampered).ok, false);
});

test("a corrupt or tampered log file is rejected at startup", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "phone-as-tool-audit-corrupt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const corruptPath = join(directory, "corrupt.jsonl");
  writeFileSync(corruptPath, "not json\n", "utf8");
  assert.throws(() => new JsonlAuditSink(corruptPath).readAll(), /corrupt audit log/);

  const path = join(directory, "tampered.jsonl");
  const first = new AuditLog({ sink: new JsonlAuditSink(path), clock: FIXED_CLOCK });
  first.record({
    client: CLIENT,
    tool: "tap",
    args: { x: 1 },
    decision: "allowed",
    result: { status: "ok", summary: "ok" },
    durationMs: 1,
  });
  const entry = JSON.parse(readFileSync(path, "utf8")) as AuditEntry & { parameters: Record<string, unknown> };
  entry.parameters["x"] = 2;
  writeFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  assert.throws(() => new AuditLog({ sink: new JsonlAuditSink(path), clock: FIXED_CLOCK }), /integrity/);
});

test("a failing sink refuses to record instead of losing entries silently", () => {
  const sink: AuditStoreLike = {
    append: () => {
      throw new Error("disk full");
    },
    readAll: () => [],
  };
  const log = new AuditLog({ sink, clock: FIXED_CLOCK });
  assert.throws(
    () =>
      log.record({
        client: CLIENT,
        tool: "tap",
        args: {},
        decision: "allowed",
        result: { status: "ok", summary: "ok" },
        durationMs: 1,
      }),
    /disk full/,
  );
  assert.equal(log.size, 0);
});

test("security events are audited in the same chain", () => {
  const { log } = auditWithMemory();
  const entry = log.recordSecurityEvent({
    type: "kill_switch",
    summary: "revoked 2 clients",
    details: { clientsRevoked: 2 },
    at: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(entry.kind, "security_event");
  assert.equal(entry.tool, "security.kill_switch");
  assert.equal(entry.client, null);
  assert.deepEqual(entry.parameters, { clientsRevoked: 2 });
  assert.equal(log.verify().ok, true);
});
