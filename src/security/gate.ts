import { randomUUID } from "node:crypto";
import { AppAllowlist } from "./allowlist.js";
import { AuditLog, summarizeParameters, summarizeToolResult } from "./audit-log.js";
import type { AuditConfirmationRecord, AuditDecision, AuditResultRecord } from "./audit-log.js";
import { computeConfirmationDigest } from "./confirmation.js";
import { assessDanger, createDangerPolicy, type DangerPolicy } from "./danger-policy.js";
import { KillSwitch, type KillSwitchReport, type StoppableMcpService } from "./kill-switch.js";
import { ClientRegistry } from "./tokens.js";
import type {
  ClientIdentity,
  ConfirmationChannel,
  ConfirmationDecision,
  ConfirmationDenyReason,
  ConfirmationPrompt,
  DangerAssessment,
  ToolCallContext,
  ToolCallRequest,
  ToolErrorCode,
  ToolHandlerRegistry,
  ToolName,
  ToolResult,
} from "./types.js";
import { isToolName } from "./types.js";
import { errorMessage } from "./util.js";

export interface SecurityGateOptions {
  /** Real tool implementations. Unknown/unregistered tools are refused. */
  readonly tools: ToolHandlerRegistry;
  readonly allowlist?: AppAllowlist;
  readonly clients?: ClientRegistry;
  /** Device-side policy. The model has no way to replace or relax it. */
  readonly policy?: DangerPolicy;
  /** Device-side confirmation transport. Absent means dangerous actions fail closed. */
  readonly confirmation?: ConfirmationChannel | null;
  readonly audit?: AuditLog;
  readonly server?: StoppableMcpService | null;
  readonly clock?: () => Date;
  /** Monotonic clock for durations, injectable for deterministic tests. */
  readonly monotonicNow?: () => number;
  /** Overall confirmation deadline. Default 30 s; timeout denies. */
  readonly confirmationTimeoutMs?: number;
  readonly onKillSwitch?: () => void | Promise<void>;
}

const DENY_REASONS: ReadonlySet<ConfirmationDenyReason> = new Set([
  "denied",
  "timeout",
  "cancelled",
  "unavailable",
  "error",
]);

function failure<T>(
  code: ToolErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ToolResult<T> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code,
      message,
      ...(details === undefined ? {} : { details }),
    }),
  });
}

function isToolResult(value: unknown): value is ToolResult {
  if (value === null || typeof value !== "object" || !("ok" in value)) {
    return false;
  }
  const candidate = value as { ok?: unknown; result?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return true;
  }
  if (candidate.ok !== false || candidate.error === null || typeof candidate.error !== "object") {
    return false;
  }
  const error = candidate.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

function isConfirmationDecision(value: unknown): value is ConfirmationDecision {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    approved?: unknown;
    approver?: unknown;
    reason?: unknown;
    decidedAt?: unknown;
  };
  if (typeof candidate.decidedAt !== "string") {
    return false;
  }
  if (candidate.approved === true) {
    return typeof candidate.approver === "string" && candidate.approver.trim().length > 0;
  }
  if (candidate.approved === false) {
    return typeof candidate.reason === "string" && DENY_REASONS.has(candidate.reason as ConfirmationDenyReason);
  }
  return false;
}

/**
 * Resolve which apps a tool call touches. Only trusted context and validated
 * tool arguments are used; a missing target means "unknown", which is denied.
 */
export function resolveAppPackages(
  tool: ToolName,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext,
): readonly string[] {
  const packageNames = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0) {
      packageNames.add(value.trim());
    }
  };
  const foreground = context.foregroundPackage ?? null;

  switch (tool) {
    case "launch_app":
      // The current foreground may be the launcher; only the target app matters.
      add(args.package);
      add(context.targetPackage);
      break;
    case "wait_for":
      add(args.package);
      add(context.targetPackage);
      if (packageNames.size === 0) {
        add(foreground);
      }
      break;
    default:
      add(foreground);
      add(context.targetNode?.packageName);
      break;
  }

  return [...packageNames];
}

/**
 * Central security gate: service state -> authenticate -> tool validation ->
 * allowlist -> dangerous-action confirmation -> execute -> audit. Every branch,
 * including failures, appends an audit entry; if auditing itself is impossible
 * the call is refused.
 */
export class SecurityGate {
  readonly allowlist: AppAllowlist;
  readonly clients: ClientRegistry;
  readonly policy: DangerPolicy;
  readonly audit: AuditLog;
  readonly killSwitch: KillSwitch;
  readonly #tools: ToolHandlerRegistry;
  readonly #confirmation: ConfirmationChannel | null;
  readonly #clock: () => Date;
  readonly #monotonicNow: () => number;
  readonly #confirmationTimeoutMs: number;

  constructor(options: SecurityGateOptions) {
    const clock = options.clock ?? (() => new Date());
    const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 30_000;
    if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs <= 0) {
      throw new TypeError("confirmationTimeoutMs must be a positive finite number");
    }
    this.allowlist = options.allowlist ?? new AppAllowlist();
    this.clients = options.clients ?? new ClientRegistry({ clock });
    this.policy = options.policy ?? createDangerPolicy();
    this.audit = options.audit ?? new AuditLog({ clock });
    this.#tools = options.tools;
    this.#confirmation = options.confirmation ?? null;
    this.#clock = clock;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#confirmationTimeoutMs = confirmationTimeoutMs;
    this.killSwitch = new KillSwitch({
      clients: this.clients,
      server: options.server ?? null,
      audit: this.audit,
      clock,
      onEngage: async () => {
        this.#confirmation?.cancelAll?.("cancelled", "kill switch engaged");
        await options.onKillSwitch?.();
      },
    });
  }

  get isDisconnected(): boolean {
    return this.killSwitch.engaged;
  }

  /** Device-side one-tap disconnect. Not exposed as an MCP tool. */
  async engageKillSwitch(reason = "user"): Promise<KillSwitchReport> {
    return this.killSwitch.engage(reason);
  }

  async execute<T = unknown>(request: ToolCallRequest): Promise<ToolResult<T>> {
    const startedAt = this.#clock();
    const startedMono = this.#monotonicNow();
    const args: Readonly<Record<string, unknown>> =
      request.args !== null && typeof request.args === "object" && !Array.isArray(request.args)
        ? request.args
        : {};
    const context: ToolCallContext =
      request.context !== null && typeof request.context === "object" ? request.context : {};
    const auditTool = typeof request.tool === "string" && request.tool.length > 0 ? request.tool : "(invalid)";
    const client = this.clients.authenticate(typeof request.token === "string" ? request.token : "");
    const duration = (): number => Math.max(0, this.#monotonicNow() - startedMono);

    const finish = (
      result: ToolResult<T>,
      record: {
        readonly decision: AuditDecision;
        readonly reason?: string;
        readonly appPackages?: readonly string[];
        readonly confirmation?: AuditConfirmationRecord;
        readonly auditResult?: AuditResultRecord;
      },
    ): ToolResult<T> => {
      try {
        this.audit.record({
          client,
          tool: auditTool,
          args,
          appPackages: record.appPackages ?? [],
          decision: record.decision,
          ...(record.reason === undefined ? {} : { reason: record.reason }),
          ...(record.confirmation === undefined ? {} : { confirmation: record.confirmation }),
          result: record.auditResult ?? summarizeToolResult(result),
          durationMs: duration(),
          at: startedAt,
        });
      } catch (error) {
        return failure<T>("blocked", "audit log is unavailable; refusing to run an unaudited call", {
          cause: errorMessage(error),
        });
      }
      return result;
    };

    const deny = (
      code: ToolErrorCode,
      message: string,
      reason: string,
      options: {
        readonly appPackages?: readonly string[];
        readonly confirmation?: AuditConfirmationRecord;
        readonly details?: Readonly<Record<string, unknown>>;
      } = {},
    ): ToolResult<T> => {
      const result = failure<T>(code, message, options.details);
      return finish(result, {
        decision: "denied",
        reason,
        ...(options.appPackages === undefined ? {} : { appPackages: options.appPackages }),
        ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
        auditResult: { status: "denied", code, summary: message },
      });
    };

    // The kill switch is checked first so a disconnected daemon refuses calls
    // even if a revocation or a token lookup were to misbehave.
    if (this.killSwitch.engaged) {
      return deny("blocked", "MCP service is disconnected", "server_disconnected");
    }

    if (client === null) {
      return deny("permission_denied", "invalid or revoked client token", "unauthenticated");
    }

    if (typeof request.tool !== "string" || !isToolName(request.tool)) {
      return deny("invalid_argument", `unknown tool: ${auditTool}`, "unknown_tool");
    }
    const tool = request.tool;
    const handler = this.#tools[tool];
    if (handler === undefined) {
      return deny("not_found", `tool is not available: ${tool}`, "tool_not_registered");
    }

    const appPackages = resolveAppPackages(tool, args, context);
    if (appPackages.length === 0) {
      return deny("blocked", "cannot determine the target app; the security gate denies unknown targets", "app_unknown");
    }
    const disallowedApp = appPackages.find((packageName) => !this.allowlist.isAllowed(packageName));
    if (disallowedApp !== undefined) {
      return deny("blocked", `app is not on the allowlist: ${disallowedApp}`, "app_not_allowed", {
        appPackages,
        details: { package: disallowedApp },
      });
    }

    if ((tool === "tap" || tool === "type") && context.targetNode === undefined) {
      return deny(
        "blocked",
        "UI target context is required for tap/type; refusing to act without a resolved target node",
        "ui_context_missing",
        { appPackages },
      );
    }

    const danger = assessDanger(this.policy, tool, args, context, appPackages);
    let confirmation: AuditConfirmationRecord = {
      required: danger.dangerous,
      outcome: "not_required",
    };

    if (danger.dangerous) {
      if (this.#confirmation === null) {
        return deny("needs_confirmation", "this action needs on-device confirmation, but no confirmation channel is available", "confirmation_unavailable", {
          appPackages,
          confirmation: { required: true, outcome: "unavailable" },
        });
      }
      const prompt = this.#buildPrompt(client, tool, args, appPackages, danger);
      const decision = await this.#requestConfirmation(prompt);
      if (!decision.approved) {
        confirmation = {
          required: true,
          outcome: decision.reason,
          promptId: prompt.id,
        };
        const message = `dangerous action was not approved on the device (${decision.reason})`;
        return finish(
          failure<T>("needs_confirmation", message, {
            reason: decision.reason,
            promptId: prompt.id,
            ...(decision.detail === undefined ? {} : { detail: decision.detail }),
            reasons: danger.reasons,
          }),
          {
            decision: "confirmation_required",
            reason: `confirmation_${decision.reason}`,
            appPackages,
            confirmation,
            auditResult: { status: "denied", code: "needs_confirmation", summary: message },
          },
        );
      }
      confirmation = {
        required: true,
        outcome: "approved",
        approver: decision.approver,
        promptId: prompt.id,
      };
      if (this.killSwitch.engaged) {
        return deny("blocked", "MCP service is disconnected", "server_disconnected", {
          appPackages,
          confirmation,
        });
      }
    }

    let rawResult: unknown;
    try {
      rawResult = await handler(args, context);
    } catch {
      rawResult = failure("internal", "tool handler failed");
    }
    const result: ToolResult<T> = isToolResult(rawResult)
      ? (rawResult as ToolResult<T>)
      : failure<T>("internal", "tool handler returned an invalid result");

    return finish(result, {
      decision: "allowed",
      ...(danger.dangerous
        ? { reason: `danger:${danger.reasons.map((reason) => reason.ruleId).join(",")}` }
        : {}),
      appPackages,
      confirmation,
    });
  }

  #buildPrompt(
    client: ClientIdentity,
    tool: ToolName,
    args: Readonly<Record<string, unknown>>,
    appPackages: readonly string[],
    danger: DangerAssessment,
  ): ConfirmationPrompt {
    const createdAt = this.#clock();
    const base: Omit<ConfirmationPrompt, "digest"> = Object.freeze({
      id: randomUUID(),
      client: Object.freeze({ id: client.id, name: client.name }),
      tool,
      argsSummary: summarizeParameters(tool, args),
      appPackages: Object.freeze([...appPackages]),
      danger,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#confirmationTimeoutMs).toISOString(),
    });
    return Object.freeze({ ...base, digest: computeConfirmationDigest(base) });
  }

  async #requestConfirmation(prompt: ConfirmationPrompt): Promise<ConfirmationDecision> {
    const channel = this.#confirmation;
    if (channel === null) {
      return {
        approved: false,
        reason: "unavailable",
        decidedAt: this.#clock().toISOString(),
      };
    }

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeoutDecision: ConfirmationDecision = {
      approved: false,
      reason: "timeout",
      decidedAt: this.#clock().toISOString(),
      detail: `device confirmation timed out after ${this.#confirmationTimeoutMs}ms`,
    };
    const timeout = new Promise<ConfirmationDecision>((resolve) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // A broken abort listener must not prevent the timeout denial.
        }
        resolve(timeoutDecision);
      }, this.#confirmationTimeoutMs);
      timer.unref();
    });

    const requested = (async (): Promise<ConfirmationDecision> => {
      try {
        const decision: unknown = await channel.request(prompt, controller.signal);
        if (!isConfirmationDecision(decision)) {
          return {
            approved: false,
            reason: "error",
            decidedAt: this.#clock().toISOString(),
            detail: "confirmation channel returned an invalid decision",
          };
        }
        return decision;
      } catch (error) {
        return {
          approved: false,
          reason: "error",
          decidedAt: this.#clock().toISOString(),
          detail: errorMessage(error),
        };
      }
    })();

    try {
      const decision = await Promise.race([requested, timeout]);
      if (!decision.approved) {
        try {
          channel.cancel?.(prompt.id, decision.reason);
        } catch {
          // A broken cancellation hook must not turn a denial into a crash.
        }
      }
      return decision;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
