import type { AuditLog } from "./audit-log.js";
import type { ClientRegistry } from "./tokens.js";
import { errorMessage } from "./util.js";

export interface StoppableMcpService {
  stop(): void | Promise<void>;
}

export interface KillSwitchOptions {
  readonly clients: ClientRegistry;
  /** The real MCP server. When absent, the gate still locks and revokes tokens. */
  readonly server?: StoppableMcpService | null;
  readonly audit?: AuditLog | null;
  readonly clock?: () => Date;
  /** Extra teardown, e.g. cancelling pending device confirmations. */
  readonly onEngage?: () => void | Promise<void>;
}

export interface KillSwitchReport {
  readonly at: string;
  readonly reason: string;
  readonly alreadyEngaged: boolean;
  readonly clientsRevoked: number;
  readonly serverStopAttempted: boolean;
  readonly serverStopped: boolean;
  readonly warnings: readonly string[];
}

/**
 * One-tap disconnect: revoke every client token, cancel security work and stop
 * the MCP server. The gate checks `engaged` before every call, so subsequent
 * requests are refused even if a stop callback misbehaves; a handler that has
 * already started cannot be rolled back.
 */
export class KillSwitch {
  readonly #clients: ClientRegistry;
  readonly #server: StoppableMcpService | null;
  readonly #audit: AuditLog | null;
  readonly #clock: () => Date;
  readonly #onEngage: (() => void | Promise<void>) | undefined;
  #engaged = false;
  #report: KillSwitchReport | null = null;

  constructor(options: KillSwitchOptions) {
    this.#clients = options.clients;
    this.#server = options.server ?? null;
    this.#audit = options.audit ?? null;
    this.#clock = options.clock ?? (() => new Date());
    this.#onEngage = options.onEngage;
  }

  get engaged(): boolean {
    return this.#engaged;
  }

  get report(): KillSwitchReport | null {
    return this.#report;
  }

  async engage(reason = "user"): Promise<KillSwitchReport> {
    if (this.#engaged && this.#report !== null) {
      return Object.freeze({
        at: this.#report.at,
        reason,
        alreadyEngaged: true,
        clientsRevoked: 0,
        serverStopAttempted: false,
        serverStopped: this.#report.serverStopped,
        warnings: Object.freeze([]),
      });
    }

    // Lock first: a concurrent tool call must see the disconnect immediately.
    this.#engaged = true;
    const warnings: string[] = [];
    const clientsRevoked = this.#clients.revokeAll();

    if (this.#onEngage !== undefined) {
      try {
        await this.#onEngage();
      } catch (error) {
        warnings.push(`teardown failed: ${errorMessage(error)}`);
      }
    }

    let serverStopAttempted = false;
    let serverStopped = false;
    if (this.#server !== null) {
      serverStopAttempted = true;
      try {
        await this.#server.stop();
        serverStopped = true;
      } catch (error) {
        warnings.push(`MCP server stop failed: ${errorMessage(error)}`);
      }
    }

    const at = this.#clock().toISOString();
    const report: KillSwitchReport = Object.freeze({
      at,
      reason,
      alreadyEngaged: false,
      clientsRevoked,
      serverStopAttempted,
      serverStopped,
      warnings: Object.freeze(warnings),
    });
    this.#report = report;

    if (this.#audit !== null) {
      try {
        this.#audit.recordSecurityEvent({
          type: "kill_switch",
          summary:
            `kill switch engaged (${reason}): revoked ${clientsRevoked} client(s), ` +
            `server ${serverStopped ? "stopped" : serverStopAttempted ? "stop failed" : "not attached"}`,
          details: {
            reason,
            clientsRevoked,
            serverStopAttempted,
            serverStopped,
            warnings,
          },
          at: new Date(at),
        });
      } catch {
        // The kill switch must complete even if the audit sink is unavailable.
      }
    }

    return report;
  }
}
