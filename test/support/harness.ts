import { AppAllowlist } from "../../src/security/allowlist.js";
import { AuditLog, MemoryAuditSink, type AuditStoreLike } from "../../src/security/audit-log.js";
import { DeviceConfirmationQueue } from "../../src/security/confirmation.js";
import { createDangerPolicy, type DangerPolicyOptions } from "../../src/security/danger-policy.js";
import { SecurityGate } from "../../src/security/gate.js";
import type { StoppableMcpService } from "../../src/security/kill-switch.js";
import { ClientRegistry } from "../../src/security/tokens.js";
import { TOOL_NAMES } from "../../src/security/types.js";
import type {
  ClientIdentity,
  TargetNode,
  ToolCallContext,
  ToolCallRequest,
  ToolErrorCode,
  ToolHandlerRegistry,
  ToolName,
  ToolResult,
} from "../../src/security/types.js";

export const NOTES_APP = "com.example.notes";
export const OTHER_APP = "com.example.other";
export const LAUNCHER = "com.android.launcher3";

export interface RecordedCall {
  readonly tool: ToolName;
  readonly args: Readonly<Record<string, unknown>>;
  readonly context: ToolCallContext;
}

export interface HarnessOptions {
  readonly allowApps?: readonly string[];
  readonly handlers?: ToolHandlerRegistry;
  readonly confirmation?: DeviceConfirmationQueue | null;
  readonly policyOptions?: DangerPolicyOptions;
  readonly confirmationTimeoutMs?: number;
  readonly server?: StoppableMcpService | null;
  readonly clock?: () => Date;
  readonly monotonicNow?: () => number;
  readonly auditSink?: AuditStoreLike;
}

export interface Harness {
  readonly gate: SecurityGate;
  readonly allowlist: AppAllowlist;
  readonly clients: ClientRegistry;
  readonly client: ClientIdentity;
  readonly token: string;
  readonly audit: AuditLog;
  readonly sink: MemoryAuditSink;
  readonly confirmation: DeviceConfirmationQueue | null;
  readonly calls: readonly RecordedCall[];
  readonly clock: () => Date;
  call(
    tool: string,
    args?: Readonly<Record<string, unknown>>,
    context?: ToolCallContext,
    token?: string,
  ): ToolCallRequest;
}

export function success(value: unknown = {}): ToolResult {
  return { ok: true, result: value };
}

export function failure(code: ToolErrorCode, message = "failed"): ToolResult {
  return { ok: false, error: { code, message } };
}

export function makeDefaultHandlers(calls: RecordedCall[]): ToolHandlerRegistry {
  const registry: ToolHandlerRegistry = {};
  for (const tool of TOOL_NAMES) {
    registry[tool] = (args, context) => {
      calls.push({ tool, args, context });
      return success({ tool, accepted: true });
    };
  }
  return registry;
}

export function makeClock(startMs = Date.UTC(2026, 0, 1, 0, 0, 0)): () => Date {
  let current = startMs - 1000;
  return () => {
    current += 1000;
    return new Date(current);
  };
}

export function appContext(packageName: string = NOTES_APP, targetNode?: TargetNode): ToolCallContext {
  return {
    foregroundPackage: packageName,
    targetNode: targetNode === undefined ? null : { packageName, ...targetNode },
  };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? makeClock();
  const calls: RecordedCall[] = [];
  const handlers = options.handlers ?? makeDefaultHandlers(calls);
  const clients = new ClientRegistry({ clock });
  const issued = clients.issue("test-client");
  const allowlist = new AppAllowlist();
  for (const packageName of options.allowApps ?? [NOTES_APP]) {
    allowlist.add(packageName);
  }
  const sink = new MemoryAuditSink();
  const audit = new AuditLog({ sink: options.auditSink ?? sink, clock });
  const confirmation =
    options.confirmation === undefined
      ? new DeviceConfirmationQueue({ timeoutMs: 500, clock })
      : options.confirmation;
  const gate = new SecurityGate({
    tools: handlers,
    allowlist,
    clients,
    policy: createDangerPolicy(options.policyOptions),
    confirmation,
    audit,
    server: options.server ?? null,
    clock,
    monotonicNow: options.monotonicNow ?? (() => 0),
    confirmationTimeoutMs: options.confirmationTimeoutMs ?? 500,
  });
  return {
    gate,
    allowlist,
    clients,
    client: issued.client,
    token: issued.token,
    audit,
    sink,
    confirmation,
    calls,
    clock,
    call(tool, args = {}, context = appContext(), token = issued.token) {
      return { token, tool, args, context };
    },
  };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met before the test timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

export class FakeMcpServer implements StoppableMcpService {
  stopCalls = 0;
  stopError: Error | null = null;

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopError !== null) {
      throw this.stopError;
    }
  }
}
