/** The tool surface from docs/mcp-tools.md. */
export const TOOL_NAMES = [
  "screenshot",
  "ui_tree",
  "tap",
  "swipe",
  "type",
  "launch_app",
  "wait_for",
  "observe",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/** A paired MCP client. Tokens are deliberately not part of this identity. */
export interface ClientIdentity {
  readonly id: string;
  readonly name: string;
}

/** The UI node a tool targets, as resolved from the latest device snapshot. */
export interface TargetNode {
  readonly text?: string;
  readonly contentDescription?: string;
  readonly hint?: string;
  /** Android's InputType name, e.g. "textPassword" or "textVisiblePassword". */
  readonly inputType?: string;
  readonly packageName?: string;
  readonly className?: string;
}

/**
 * Trusted context supplied by the daemon, not by the model. The allowlist and
 * the dangerous-action policy are only as good as this context, so the daemon
 * must resolve it from the device snapshot rather than from tool arguments.
 */
export interface ToolCallContext {
  readonly foregroundPackage?: string | null;
  readonly targetPackage?: string | null;
  readonly targetNode?: TargetNode | null;
}

export interface ToolCallRequest {
  readonly token: string;
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly context?: ToolCallContext;
}

/** Failure codes from docs/mcp-tools.md plus `internal` for daemon faults. */
export type ToolErrorCode =
  | "invalid_argument"
  | "not_found"
  | "blocked"
  | "needs_confirmation"
  | "timeout"
  | "permission_denied"
  | "internal";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type ToolResult<T = unknown> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly error: ToolError };

export type ToolHandler<T = unknown> = (
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext,
) => ToolResult<T> | Promise<ToolResult<T>>;

export type ToolHandlerRegistry = Partial<Record<ToolName, ToolHandler>>;

/** Why an invoked action needs on-device confirmation. */
export type DangerCategory = "payment" | "deletion" | "send" | "password" | "configured" | "app";

export interface DangerReason {
  readonly ruleId: string;
  readonly category: DangerCategory;
  readonly message: string;
  readonly evidence?: string;
}

export interface DangerAssessment {
  readonly dangerous: boolean;
  readonly reasons: readonly DangerReason[];
}

export type ConfirmationDenyReason = "denied" | "timeout" | "cancelled" | "unavailable" | "error";

export type ConfirmationDecision =
  | {
      readonly approved: true;
      readonly approver: string;
      readonly decidedAt: string;
    }
  | {
      readonly approved: false;
      readonly reason: ConfirmationDenyReason;
      readonly decidedAt: string;
      readonly detail?: string;
    };

/** What the on-device confirmation UI is shown and asked to approve. */
export interface ConfirmationPrompt {
  readonly id: string;
  readonly client: ClientIdentity;
  readonly tool: ToolName;
  /** Redacted parameter summary; a device confirmation must never show secrets. */
  readonly argsSummary: Readonly<Record<string, unknown>>;
  readonly appPackages: readonly string[];
  readonly danger: DangerAssessment;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Binds the approval to this exact call. A one-time approval can never be replayed. */
  readonly digest: string;
}

/**
 * The device-side confirmation transport. `DeviceConfirmationQueue` implements
 * it for the in-memory daemon; a real Android app shows a system dialog.
 */
export interface ConfirmationChannel {
  request(prompt: ConfirmationPrompt, signal?: AbortSignal): Promise<ConfirmationDecision>;
  /** Cancel a pending prompt (used on timeout). */
  cancel?(promptId: string, reason: ConfirmationDenyReason): void;
  /** Cancel every pending prompt (used by the kill switch). */
  cancelAll?(reason: ConfirmationDenyReason, detail?: string): number;
}
