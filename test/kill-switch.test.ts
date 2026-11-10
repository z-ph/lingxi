import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuditLog,
  ClientRegistry,
  KillSwitch,
  MemoryAuditSink,
  type AuditStoreLike,
} from "../src/security/index.js";
import { FakeMcpServer } from "./support/harness.js";

const FIXED_CLOCK = () => new Date("2026-01-01T00:00:00.000Z");

test("engaging the kill switch revokes every client and stops the server", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  const first = clients.issue("Claude Code");
  const second = clients.issue("Cursor");
  const server = new FakeMcpServer();
  const sink = new MemoryAuditSink();
  const audit = new AuditLog({ sink, clock: FIXED_CLOCK });
  let teardownCalls = 0;
  const killSwitch = new KillSwitch({
    clients,
    server,
    audit,
    clock: FIXED_CLOCK,
    onEngage: () => {
      teardownCalls += 1;
    },
  });

  assert.equal(killSwitch.engaged, false);
  const report = await killSwitch.engage("test");
  assert.equal(killSwitch.engaged, true);
  assert.equal(report.clientsRevoked, 2);
  assert.equal(report.serverStopAttempted, true);
  assert.equal(report.serverStopped, true);
  assert.deepEqual(report.warnings, []);
  assert.equal(server.stopCalls, 1);
  assert.equal(teardownCalls, 1);
  assert.equal(clients.authenticate(first.token), null);
  assert.equal(clients.authenticate(second.token), null);
  assert.equal(clients.activeCount(), 0);

  const event = audit.entries().find((entry) => entry.kind === "security_event");
  assert.ok(event);
  assert.equal(event.tool, "security.kill_switch");
  assert.equal(audit.verify().ok, true);
});

test("the kill switch is idempotent and does not stop the server twice", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  clients.issue("Claude Code");
  const server = new FakeMcpServer();
  const audit = new AuditLog({ sink: new MemoryAuditSink(), clock: FIXED_CLOCK });
  const killSwitch = new KillSwitch({ clients, server, audit, clock: FIXED_CLOCK });

  const first = await killSwitch.engage();
  const second = await killSwitch.engage();
  assert.equal(second.alreadyEngaged, true);
  assert.equal(second.clientsRevoked, 0);
  assert.equal(second.serverStopAttempted, false);
  assert.equal(second.serverStopped, true);
  assert.equal(server.stopCalls, 1);
  assert.equal(first.alreadyEngaged, false);
  assert.equal(audit.entries().filter((entry) => entry.kind === "security_event").length, 1);
});

test("a failing server stop still leaves the gate locked and reports the problem", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  const issued = clients.issue("Claude Code");
  const server = new FakeMcpServer();
  server.stopError = new Error("socket already gone");
  const killSwitch = new KillSwitch({ clients, server, clock: FIXED_CLOCK });

  const report = await killSwitch.engage();
  assert.equal(killSwitch.engaged, true);
  assert.equal(report.serverStopped, false);
  assert.equal(report.serverStopAttempted, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0] ?? "", /socket already gone/);
  assert.equal(clients.authenticate(issued.token), null);
});

test("teardown failures do not prevent revocation or server stop", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  clients.issue("Claude Code");
  const server = new FakeMcpServer();
  const killSwitch = new KillSwitch({
    clients,
    server,
    clock: FIXED_CLOCK,
    onEngage: () => {
      throw new Error("confirmation queue exploded");
    },
  });

  const report = await killSwitch.engage();
  assert.equal(report.clientsRevoked, 1);
  assert.equal(report.serverStopped, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0] ?? "", /confirmation queue exploded/);
});

test("a kill switch without an attached server still locks and revokes", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  clients.issue("Claude Code");
  const killSwitch = new KillSwitch({ clients, clock: FIXED_CLOCK });
  const report = await killSwitch.engage();
  assert.equal(report.clientsRevoked, 1);
  assert.equal(report.serverStopAttempted, false);
  assert.equal(report.serverStopped, false);
  assert.equal(killSwitch.engaged, true);
});

test("an unavailable audit sink cannot stop the kill switch", async () => {
  const clients = new ClientRegistry({ clock: FIXED_CLOCK });
  const issued = clients.issue("Claude Code");
  const sink: AuditStoreLike = {
    append: () => {
      throw new Error("disk full");
    },
    readAll: () => [],
  };
  const audit = new AuditLog({ sink, clock: FIXED_CLOCK });
  const server = new FakeMcpServer();
  const killSwitch = new KillSwitch({ clients, server, audit, clock: FIXED_CLOCK });

  const report = await killSwitch.engage();
  assert.equal(report.clientsRevoked, 1);
  assert.equal(report.serverStopped, true);
  assert.equal(clients.authenticate(issued.token), null);
});
