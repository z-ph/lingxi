import { sha256Hex, stableJson } from "./util.js";
import type {
  ConfirmationChannel,
  ConfirmationDecision,
  ConfirmationDenyReason,
  ConfirmationPrompt,
} from "./types.js";

export function computeConfirmationDigest(prompt: Omit<ConfirmationPrompt, "digest">): string {
  return sha256Hex(
    stableJson({
      id: prompt.id,
      client: { id: prompt.client.id, name: prompt.client.name },
      tool: prompt.tool,
      argsSummary: prompt.argsSummary,
      appPackages: prompt.appPackages,
      danger: prompt.danger,
      createdAt: prompt.createdAt,
      expiresAt: prompt.expiresAt,
    }),
  );
}

export interface DeviceConfirmationQueueOptions {
  /** How long the phone's dialog stays open. Default 30 s; timeout denies. */
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
}

interface PendingRequest {
  readonly prompt: ConfirmationPrompt;
  readonly resolve: (decision: ConfirmationDecision) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * In-memory stand-in for the Android confirmation dialog.
 *
 * The gate receives this object as an opaque `ConfirmationChannel`; the model
 * has no MCP tool that can approve a request. A real app calls `approve()` /
 * `deny()` from its own UI thread after showing the prompt. Approvals are bound
 * to the prompt digest and are consumed exactly once.
 */
export class DeviceConfirmationQueue implements ConfirmationChannel {
  readonly #timeoutMs: number;
  readonly #clock: () => Date;
  readonly #pending = new Map<string, PendingRequest>();

  constructor(options: DeviceConfirmationQueueOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("confirmation timeoutMs must be a positive finite number");
    }
    this.#timeoutMs = timeoutMs;
    this.#clock = options.clock ?? (() => new Date());
  }

  request(prompt: ConfirmationPrompt): Promise<ConfirmationDecision> {
    if (this.#pending.has(prompt.id)) {
      throw new Error(`confirmation request already pending: ${prompt.id}`);
    }
    return new Promise<ConfirmationDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.#settle(prompt.id, {
          approved: false,
          reason: "timeout",
          decidedAt: this.#nowIso(),
          detail: `device confirmation timed out after ${this.#timeoutMs}ms`,
        });
      }, this.#timeoutMs);
      timer.unref();
      this.#pending.set(prompt.id, { prompt, resolve, timer });
    });
  }

  /** Called by the device UI. Returns false for an unknown id or a mismatched digest. */
  approve(promptId: string, digest: string, approver = "device-user"): boolean {
    const pending = this.#pending.get(promptId);
    if (pending === undefined || pending.prompt.digest !== digest) {
      return false;
    }
    return this.#settle(promptId, {
      approved: true,
      approver,
      decidedAt: this.#nowIso(),
    });
  }

  /** Called by the device UI. */
  deny(promptId: string, detail?: string): boolean {
    return this.#settle(promptId, {
      approved: false,
      reason: "denied",
      decidedAt: this.#nowIso(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  cancel(promptId: string, reason: ConfirmationDenyReason = "cancelled"): void {
    this.#settle(promptId, {
      approved: false,
      reason,
      decidedAt: this.#nowIso(),
      detail: `confirmation cancelled: ${reason}`,
    });
  }

  cancelAll(reason: ConfirmationDenyReason = "cancelled", detail?: string): number {
    let cancelled = 0;
    for (const promptId of [...this.#pending.keys()]) {
      if (
        this.#settle(promptId, {
          approved: false,
          reason,
          decidedAt: this.#nowIso(),
          detail: detail ?? `confirmation cancelled: ${reason}`,
        })
      ) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** Snapshot of prompts currently waiting for a human, for the device UI and tests. */
  pending(): readonly ConfirmationPrompt[] {
    return [...this.#pending.values()].map((pending) => pending.prompt);
  }

  get size(): number {
    return this.#pending.size;
  }

  #settle(promptId: string, decision: ConfirmationDecision): boolean {
    const pending = this.#pending.get(promptId);
    if (pending === undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(promptId);
    pending.resolve(decision);
    return true;
  }

  #nowIso(): string {
    return this.#clock().toISOString();
  }
}
