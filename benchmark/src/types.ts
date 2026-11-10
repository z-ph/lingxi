/**
 * Core types shared by the benchmark harness, the simulated phone and the agents.
 *
 * The tool names and result shapes intentionally mirror `docs/mcp-tools.md`. A
 * benchmark run talks to a `ToolHost`; the reference host is the in-memory
 * simulated phone in `src/sim/phone.ts`, and a future adapter can forward the
 * same calls to the real M1 daemon without changing tasks or metrics.
 */

export const TOOL_NAMES = [
  'screenshot',
  'ui_tree',
  'tap',
  'swipe',
  'type',
  'launch_app',
  'wait_for',
  'observe',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Tools that change device state. Read-only tools are excluded from accuracy. */
export const WRITE_TOOLS: readonly ToolName[] = ['tap', 'swipe', 'type', 'launch_app'];

export const DEVICE_FAILURE_CODES = [
  'not_found',
  'blocked',
  'needs_confirmation',
  'timeout',
  'permission_denied',
  'invalid_argument',
  'unsupported',
  'internal',
] as const;

export type DeviceFailureCode = (typeof DEVICE_FAILURE_CODES)[number];

export type DangerKind = 'payment' | 'delete' | 'send';

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface DeviceFailure {
  code: DeviceFailureCode;
  message: string;
}

export interface ActionResult {
  ok: boolean;
  effect?: {
    changed: boolean;
    summary: string;
  };
  error?: DeviceFailure;
}

export interface ScreenshotImage {
  format: 'png' | 'jpeg';
  /** Base64 bytes, same shape as the MCP image content block. */
  data: string;
  width: number;
  height: number;
  timestamp: string;
}

/**
 * One tool round trip as observed by the controlling agent.
 *
 * `simulatedMs` is the fake device's action latency, taken from the fixed
 * latency profile. `wallMs` is only present in the JSONL log and is not used
 * for scoring, so published numbers stay reproducible.
 */
export interface ToolResult {
  ok: boolean;
  simulatedMs: number;
  wallMs: number;
  /** The textual payload an MCP client would receive, as JSON. */
  text: string;
  effect?: {
    changed: boolean;
    summary: string;
  };
  error?: DeviceFailure;
  screenshot?: ScreenshotImage;
}

export interface ToolCallRecord {
  step: number;
  tool: ToolName;
  args: Record<string, unknown>;
  ok: boolean;
  simulatedMs: number;
  wallMs: number;
  /** Truncated text for metrics; full text lives in the run log. */
  resultText: string;
  errorCode?: DeviceFailureCode;
  effectChanged?: boolean;
}

export interface DangerAttempt {
  kind: DangerKind;
  nodeId: string;
  screen: string;
  tool: ToolName;
  step: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  /** How the numbers were obtained: provider usage or context estimation. */
  source: 'provider-usage' | 'estimated-context' | 'none';
}

export function emptyUsage(source: TokenUsage['source'] = 'none'): TokenUsage {
  return { input: 0, output: 0, total: 0, source };
}
