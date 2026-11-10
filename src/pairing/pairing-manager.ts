/**
 * Pairing: a short-lived 6-digit code, an explicit device-side approval, then a
 * per-client bearer token.
 *
 * Flow (docs/mcp-tools.md, "配对"):
 *   1. Device UI starts a pairing session; the daemon shows the code + URI.
 *   2. A client POSTs the code, its name and a fingerprint to `/pair`.
 *   3. The request waits while the device UI explicitly approves or denies it.
 *   4. On approval the daemon issues one revocable token for that client.
 *
 * The code is single-use and never logged. A wrong code consumes one of a
 * small number of attempts; an approval times out by default after 60 seconds.
 */

import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IssuedToken, PublicTokenInfo, TokenStore } from './token-store.js';

export type PairingErrorCode =
  | 'no_active_pairing'
  | 'invalid_code'
  | 'invalid_client'
  | 'denied'
  | 'approval_timeout'
  | 'approval_not_found'
  | 'too_many_requests'
  | 'client_aborted'
  | 'shutdown';

export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
  }
}

export interface PairingInfo {
  code: string;
  /** `phonetool://pair?...` payload to render as a QR code. */
  uri: string;
  createdAt: string;
  expiresAt: string;
}

export interface PendingApproval {
  id: string;
  clientName: string;
  fingerprint: string;
  requestedAt: string;
  expiresAt: string;
  remoteAddress?: string;
}

export interface PairingRequest {
  code: string;
  clientName: string;
  fingerprint: string;
  remoteAddress?: string;
}

export interface PairingManagerOptions {
  tokenStore: TokenStore;
  codeTtlMs?: number;
  approvalTtlMs?: number;
  maxFailedAttempts?: number;
  maxPending?: number;
  now?: () => Date;
  generateCode?: () => string;
}

export type ApprovalListener = (approval: PendingApproval) => void;

interface ActivePairing {
  info: PairingInfo;
  failedAttempts: number;
  timer: NodeJS.Timeout;
}

interface PendingEntry {
  approval: PendingApproval;
  resolve: (issued: IssuedToken) => void;
  reject: (error: PairingError) => void;
  timer: NodeJS.Timeout;
  cleanupAbort?: () => void;
}

const DEFAULT_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_APPROVAL_TTL_MS = 60 * 1000;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_MAX_PENDING = 3;
const CLIENT_NAME_MAX = 64;
const FINGERPRINT_MIN = 6;
const FINGERPRINT_MAX = 128;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]+$/;

function defaultGenerateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeClientName(value: unknown): string {
  if (typeof value !== 'string') throw new PairingError('invalid_client', 'clientName is required');
  const name = value.trim();
  if (name.length === 0 || name.length > CLIENT_NAME_MAX) {
    throw new PairingError('invalid_client', `clientName must be 1-${CLIENT_NAME_MAX} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new PairingError('invalid_client', 'clientName must not contain control characters');
  }
  return name;
}

function normalizeFingerprint(value: unknown): string {
  if (typeof value !== 'string') throw new PairingError('invalid_client', 'fingerprint is required');
  const fingerprint = value.trim();
  if (fingerprint.length < FINGERPRINT_MIN || fingerprint.length > FINGERPRINT_MAX) {
    throw new PairingError('invalid_client', `fingerprint must be ${FINGERPRINT_MIN}-${FINGERPRINT_MAX} characters`);
  }
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new PairingError('invalid_client', 'fingerprint may only contain letters, digits, ".", "_", ":" and "-"');
  }
  return fingerprint;
}

function buildPairingUri(baseUrl: string, code: string, expiresAt: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`invalid base URL for pairing: ${baseUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`pairing base URL must be http(s): ${baseUrl}`);
  }
  const params = new URLSearchParams({ url: baseUrl, code, expires: expiresAt });
  return `phonetool://pair?${params.toString()}`;
}

export class PairingManager {
  private readonly tokenStore: TokenStore;
  private readonly codeTtlMs: number;
  private readonly approvalTtlMs: number;
  private readonly maxFailedAttempts: number;
  private readonly maxPending: number;
  private readonly now: () => Date;
  private readonly generateCode: () => string;
  private readonly approvalListeners = new Set<ApprovalListener>();
  private readonly pending = new Map<string, PendingEntry>();
  private active: ActivePairing | null = null;

  constructor(options: PairingManagerOptions) {
    this.tokenStore = options.tokenStore;
    this.codeTtlMs = options.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.now = options.now ?? (() => new Date());
    this.generateCode = options.generateCode ?? defaultGenerateCode;
  }

  /** Register a device-side UI callback; returns an unsubscribe function. */
  onApprovalRequest(listener: ApprovalListener): () => void {
    this.approvalListeners.add(listener);
    return () => this.approvalListeners.delete(listener);
  }

  /** Start (or replace) the visible pairing session. */
  startPairing(baseUrl: string): PairingInfo {
    const previousCode = this.active?.info.code;
    this.clearActive(new PairingError('no_active_pairing', 'pairing session replaced'), true);
    let code = this.generateCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (/^\d{6}$/.test(code) && code !== previousCode) break;
      code = this.generateCode();
    }
    if (!/^\d{6}$/.test(code)) throw new Error('pairing code generator must produce six digits');
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.codeTtlMs).toISOString();
    const info: PairingInfo = { code, uri: buildPairingUri(baseUrl, code, expiresAt), createdAt, expiresAt };
    const timer = setTimeout(() => this.expireActive(), this.codeTtlMs);
    timer.unref?.();
    this.active = { info, failedAttempts: 0, timer };
    return { ...info };
  }

  /** Current pairing info, or null when there is no active/valid session. */
  current(): PairingInfo | null {
    if (!this.active) return null;
    if (this.now().getTime() >= Date.parse(this.active.info.expiresAt)) {
      this.expireActive();
      return null;
    }
    return { ...this.active.info };
  }

  pendingApprovals(): PendingApproval[] {
    return [...this.pending.values()].map((entry) => ({ ...entry.approval }));
  }

  /**
   * Submit a pairing request. Resolves only after the device explicitly
   * approves it; rejects on denial, timeout, shutdown or client abort.
   */
  async requestPairing(input: PairingRequest, options: { signal?: AbortSignal } = {}): Promise<IssuedToken> {
    const clientName = normalizeClientName(input.clientName);
    const fingerprint = normalizeFingerprint(input.fingerprint);
    const active = this.active;
    if (!active || this.now().getTime() >= Date.parse(active.info.expiresAt)) {
      if (active) this.expireActive();
      throw new PairingError('no_active_pairing', 'no active pairing session; ask the device owner to start pairing');
    }
    if (typeof input.code !== 'string' || !safeEqual(input.code, active.info.code)) {
      active.failedAttempts += 1;
      if (active.failedAttempts >= this.maxFailedAttempts) {
        this.clearActive(new PairingError('invalid_code', 'too many invalid pairing code attempts'), true);
      }
      throw new PairingError('invalid_code', 'pairing code is invalid');
    }
    if (this.pending.size >= this.maxPending) {
      throw new PairingError('too_many_requests', 'too many pending pairing approvals');
    }
    if (options.signal?.aborted === true) {
      throw new PairingError('client_aborted', 'pairing request was aborted');
    }

    const id = randomUUID();
    const requestedAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.approvalTtlMs).toISOString();
    const approval: PendingApproval = {
      id,
      clientName,
      fingerprint,
      requestedAt,
      expiresAt,
      ...(input.remoteAddress === undefined ? {} : { remoteAddress: input.remoteAddress }),
    };

    return await new Promise<IssuedToken>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settlePending(id, new PairingError('approval_timeout', 'device approval timed out'));
      }, this.approvalTtlMs);
      timer.unref?.();
      const entry: PendingEntry = { approval, resolve, reject, timer };
      if (options.signal) {
        const onAbort = (): void => {
          this.settlePending(id, new PairingError('client_aborted', 'pairing request was aborted'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        entry.cleanupAbort = () => options.signal?.removeEventListener('abort', onAbort);
      }
      this.pending.set(id, entry);
      for (const listener of this.approvalListeners) {
        try {
          listener({ ...approval });
        } catch {
          // A broken device UI must not break the pairing flow; the approval
          // still times out safely.
        }
      }
    });
  }

  /** Device-side approval. Issues the token that the waiting request receives. */
  approve(id: string): PublicTokenInfo {
    const entry = this.pending.get(id);
    if (!entry) throw new PairingError('approval_not_found', 'approval request is no longer pending');
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.cleanupAbort?.();
    let issued: IssuedToken;
    try {
      issued = this.tokenStore.issue({
        clientName: entry.approval.clientName,
        fingerprint: entry.approval.fingerprint,
      });
    } catch (error) {
      entry.reject(new PairingError('shutdown', 'failed to issue a client token'));
      throw error;
    }
    // A pairing code is single-use. Invalidate it and fail any other waiting
    // clients; the approved request still gets its token.
    this.clearActive(new PairingError('no_active_pairing', 'pairing code was already used'), true);
    entry.resolve(issued);
    return issued.client;
  }

  /** Device-side denial. The pairing code remains valid until its TTL. */
  deny(id: string): void {
    this.settlePending(id, new PairingError('denied', 'device owner denied the pairing request'));
  }

  /** Cancel the current code and fail every pending approval. */
  cancelPairing(): void {
    this.clearActive(new PairingError('no_active_pairing', 'pairing was cancelled'), true);
  }

  /** Stop the manager: fail pending approvals and clear timers. */
  close(): void {
    this.clearActive(new PairingError('shutdown', 'daemon is shutting down'), true);
  }

  private expireActive(): void {
    if (!this.active) return;
    if (this.now().getTime() < Date.parse(this.active.info.expiresAt)) return;
    this.clearActive(new PairingError('no_active_pairing', 'pairing code expired'), true);
  }

  private clearActive(reason: PairingError, rejectPending: boolean): void {
    if (this.active) clearTimeout(this.active.timer);
    this.active = null;
    if (!rejectPending) return;
    for (const id of [...this.pending.keys()]) this.settlePending(id, reason);
  }

  private settlePending(id: string, error: PairingError): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.cleanupAbort?.();
    entry.reject(error);
  }
}
