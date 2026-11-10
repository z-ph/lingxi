import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256Hex, stableJson, truncateText } from "./util.js";
import type { ClientIdentity, ToolResult } from "./types.js";

export const GENESIS_HASH = "0".repeat(64);

export type AuditKind = "tool_call" | "security_event";
export type AuditDecision = "allowed" | "denied" | "confirmation_required";
export type AuditConfirmationOutcome =
  | "not_required"
  | "approved"
  | "denied"
  | "timeout"
  | "cancelled"
  | "unavailable"
  | "error";
export type AuditStatus = "ok" | "error" | "denied";

export interface AuditClient {
  readonly id: string;
  readonly name: string;
}

export interface AuditConfirmationRecord {
  readonly required: boolean;
  readonly outcome: AuditConfirmationOutcome;
  readonly approver?: string;
  readonly promptId?: string;
}

export interface AuditResultRecord {
  readonly status: AuditStatus;
  readonly code?: string;
  /** A summary only. Never screen content, screenshots or raw tool payloads. */
  readonly summary: string;
}

export interface AuditEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: AuditKind;
  readonly client: AuditClient | null;
  readonly tool: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly appPackages: readonly string[];
  readonly decision: AuditDecision;
  readonly reason?: string;
  readonly confirmation: AuditConfirmationRecord;
  readonly result: AuditResultRecord;
  readonly durationMs: number;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditRecordInput {
  readonly kind?: AuditKind;
  readonly client: ClientIdentity | null;
  readonly tool: string;
  readonly args?: unknown;
  readonly appPackages?: readonly string[];
  readonly decision: AuditDecision;
  readonly reason?: string;
  readonly confirmation?: AuditConfirmationRecord;
  readonly result: AuditResultRecord;
  readonly durationMs: number;
  /** The call's start time. `AuditLog`'s clock is used when omitted. */
  readonly at?: Date;
}

export interface AuditStoreLike {
  append(entry: AuditEntry): void;
  readAll(): readonly AuditEntry[];
}

export class MemoryAuditSink implements AuditStoreLike {
  readonly #entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.#entries.push(entry);
  }

  readAll(): readonly AuditEntry[] {
    return [...this.#entries];
  }
}

/** Append-only JSONL file sink: one audit entry per line, local disk only. */
export class JsonlAuditSink implements AuditStoreLike {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(entry: AuditEntry): void {
    appendFileSync(this.#path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  readAll(): readonly AuditEntry[] {
    if (!existsSync(this.#path)) {
      return [];
    }
    const text = readFileSync(this.#path, "utf8");
    const entries: AuditEntry[] = [];
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim() ?? "";
      if (line.length === 0) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("entry is not an object");
        }
        entries.push(parsed as AuditEntry);
      } catch (error) {
        throw new Error(`corrupt audit log at ${this.#path}, line ${index + 1}: ${String(error)}`);
      }
    }
    return entries;
  }

  get path(): string {
    return this.#path;
  }
}

export interface AuditLogOptions {
  readonly sink?: AuditStoreLike;
  readonly clock?: () => Date;
}

export interface AuditVerification {
  readonly ok: boolean;
  readonly brokenAt?: number;
  readonly reason?: string;
}

export type AuditExportFormat = "jsonl" | "json";

/**
 * Append-only, local audit trail for every tool call.
 *
 * Entries form a SHA-256 hash chain so later tampering with the JSONL file is
 * detectable. Sensitive parameters are summarised and redacted before they
 * ever reach the sink. Export is a local file/string operation; this module has
 * no network code and never uploads anything.
 */
export class AuditLog {
  readonly #sink: AuditStoreLike;
  readonly #clock: () => Date;
  readonly #entries: AuditEntry[];
  #nextSeq: number;
  #lastHash: string;

  constructor(options: AuditLogOptions = {}) {
    this.#sink = options.sink ?? new MemoryAuditSink();
    this.#clock = options.clock ?? (() => new Date());
    const loaded = [...this.#sink.readAll()];
    const verification = verifyAuditChain(loaded);
    if (!verification.ok) {
      throw new Error(`audit log integrity check failed: ${verification.reason ?? "unknown reason"}`);
    }
    this.#entries = loaded;
    const last = loaded.at(-1);
    this.#nextSeq = (last?.seq ?? 0) + 1;
    this.#lastHash = last?.hash ?? GENESIS_HASH;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** Immutable snapshot for display/export. */
  entries(): readonly AuditEntry[] {
    return this.#entries.map((entry) => cloneEntry(entry));
  }

  verify(): AuditVerification {
    return verifyAuditChain(this.#entries);
  }

  /**
   * Append one entry. If the sink cannot persist the entry, the call throws and
   * the in-memory log is left unchanged; `SecurityGate` turns that into a
   * fail-closed `blocked` result rather than driving the phone unlogged.
   */
  record(input: AuditRecordInput): AuditEntry {
    const at = (input.at ?? this.#clock()).toISOString();
    const parameters = summarizeParameters(input.tool, input.args);
    const payload = {
      seq: this.#nextSeq,
      at,
      kind: input.kind ?? "tool_call",
      client: input.client === null ? null : { id: input.client.id, name: input.client.name },
      tool: input.tool,
      parameters,
      appPackages: [...(input.appPackages ?? [])],
      decision: input.decision,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      confirmation: input.confirmation ?? { required: false, outcome: "not_required" },
      result: input.result,
      durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs * 1000) / 1000) : 0,
      prevHash: this.#lastHash,
    };
    const payloadWithHash = { ...payload, hash: sha256Hex(stableJson(payload)) };
    this.#sink.append(payloadWithHash);
    this.#entries.push(payloadWithHash);
    this.#nextSeq += 1;
    this.#lastHash = payloadWithHash.hash;
    return cloneEntry(payloadWithHash);
  }

  /** Kill switch and other security events are part of the same audit trail. */
  recordSecurityEvent(event: {
    readonly type: string;
    readonly summary: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly at?: Date;
  }): AuditEntry {
    return this.record({
      kind: "security_event",
      client: null,
      tool: `security.${event.type}`,
      args: event.details === undefined ? {} : event.details,
      decision: "allowed",
      result: { status: "ok", summary: event.summary },
      durationMs: 0,
      ...(event.at === undefined ? {} : { at: event.at }),
    });
  }

  exportJsonl(): string {
    if (this.#entries.length === 0) {
      return "";
    }
    return `${this.#entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  }

  exportJson(): string {
    return `${JSON.stringify(
      {
        version: 1,
        exportedAt: this.#clock().toISOString(),
        entries: this.#entries,
      },
      null,
      2,
    )}\n`;
  }

  export(format: AuditExportFormat = "jsonl"): string {
    return format === "json" ? this.exportJson() : this.exportJsonl();
  }

  /** Write an export to a local path. This never uploads the log. */
  writeExport(filePath: string, format: AuditExportFormat = "jsonl"): string {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, this.export(format), "utf8");
    return filePath;
  }
}

export function verifyAuditChain(entries: readonly AuditEntry[]): AuditVerification {
  let previousHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return { ok: false, brokenAt: entry.seq, reason: `expected sequence ${expectedSeq}, found ${String(entry.seq)}` };
    }
    if (entry.prevHash !== previousHash) {
      return { ok: false, brokenAt: entry.seq, reason: `prevHash mismatch at sequence ${entry.seq}` };
    }
    const { hash, ...payload } = entry;
    const expectedHash = sha256Hex(stableJson(payload));
    if (hash !== expectedHash) {
      return { ok: false, brokenAt: entry.seq, reason: `hash mismatch at sequence ${entry.seq}` };
    }
    previousHash = hash;
    expectedSeq += 1;
  }
  return { ok: true };
}

function cloneEntry(entry: AuditEntry): AuditEntry {
  return JSON.parse(JSON.stringify(entry)) as AuditEntry;
}

const SENSITIVE_KEY = /pass(word|wd)?|pwd|secret|token|authorization|cookie|api[-_]?key|credential|session|private[-_]?key|\bpin\b/i;
const BINARY_KEY = /image|base64|screenshot|pixels?|blob|attachment/i;

function summarizeArgument(key: string, value: unknown, depth: number, tool: string): unknown {
  const lowered = key.toLowerCase();
  if (lowered === "text" && tool === "type") {
    return `[redacted ${typeof value === "string" ? value.length : 0} chars]`;
  }
  if (SENSITIVE_KEY.test(lowered)) {
    return "[redacted]";
  }
  if (BINARY_KEY.test(lowered) && (typeof value === "string" || value instanceof Uint8Array)) {
    return "[redacted]";
  }
  return summarizeValue(value, depth, tool);
}

function summarizeValue(value: unknown, depth: number, tool: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText(value, 120);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (depth >= 3) {
    return Array.isArray(value) ? `[${value.length} items]` : "[object]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => summarizeValue(item, depth + 1, tool));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort().slice(0, 20)) {
      result[key] = summarizeArgument(key, source[key], depth + 1, tool);
    }
    return result;
  }
  return "[unsupported]";
}

/** Redacted parameter summary suitable for both the audit trail and the confirmation UI. */
export function summarizeParameters(tool: string, args: unknown): Readonly<Record<string, unknown>> {
  if (args === undefined || args === null) {
    return {};
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    return { value: summarizeValue(args, 0, tool) };
  }
  const source = args as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    result[key] = summarizeArgument(key, source[key], 1, tool);
  }
  return result;
}

const SAFE_RESULT_STRING_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "status",
  "package",
  "foreground",
  "format",
  "code",
  "errorCode",
]);

function describeResult(value: unknown): string {
  if (value === undefined || value === null) {
    return "ok";
  }
  if (typeof value === "string") {
    return `<string ${value.length}>`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const parts: string[] = [];
    for (const key of keys.slice(0, 12)) {
      const item = source[key];
      if (item === null || item === undefined) {
        parts.push(`${key}=null`);
      } else if (typeof item === "number" || typeof item === "boolean") {
        parts.push(`${key}=${String(item)}`);
      } else if (typeof item === "string") {
        parts.push(
          SAFE_RESULT_STRING_KEYS.has(key)
            ? `${key}=${truncateText(item, 80)}`
            : `${key}=<string ${item.length}>`,
        );
      } else if (Array.isArray(item)) {
        parts.push(`${key}[${item.length}]`);
      } else if (typeof item === "object") {
        parts.push(`${key}{${Object.keys(item as Record<string, unknown>).length}}`);
      } else {
        parts.push(`${key}=<${typeof item}>`);
      }
    }
    if (keys.length > 12) {
      parts.push(`…+${keys.length - 12}`);
    }
    return truncateText(`{${parts.join(", ")}}`, 300);
  }
  return `<${typeof value}>`;
}

/**
 * Convert a daemon tool result into an audit-safe result record. Success
 * payloads are described structurally; screen text and binary data never enter
 * the audit log.
 */
export function summarizeToolResult(result: unknown): AuditResultRecord {
  if (result !== null && typeof result === "object" && "ok" in result) {
    const candidate = result as { ok?: unknown; result?: unknown; error?: unknown };
    if (candidate.ok === false) {
      const error = candidate.error as { code?: unknown; message?: unknown } | undefined;
      const code = typeof error?.code === "string" ? error.code : "internal";
      const message = typeof error?.message === "string" ? error.message : "tool failed";
      return { status: "error", code, summary: truncateText(message, 200) };
    }
    if (candidate.ok === true) {
      return { status: "ok", summary: describeResult(candidate.result) };
    }
  }
  return { status: "error", code: "internal", summary: "tool returned an invalid result" };
}

export function summarizeToolResultRecord(result: ToolResult): AuditResultRecord {
  return summarizeToolResult(result);
}
