import { randomBytes, randomUUID } from "node:crypto";
import { sha256Hex } from "./util.js";
import type { ClientIdentity } from "./types.js";

export interface IssuedClient {
  readonly client: ClientIdentity;
  /** Returned exactly once, to the pairing UI. Never logged and never audited. */
  readonly token: string;
}

export interface ClientSummary extends ClientIdentity {
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

interface ClientRecord {
  readonly id: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  revokedAt: string | null;
}

export interface ClientRegistryOptions {
  readonly clock?: () => Date;
  readonly tokenFactory?: () => string;
  readonly idFactory?: () => string;
}

const MAX_CLIENT_NAME_LENGTH = 80;
const MAX_TOKEN_LENGTH = 512;

function tokenHash(token: string): string {
  return sha256Hex(token);
}

/**
 * Per-client pairing tokens. Only SHA-256 hashes are kept in memory; the
 * plaintext token exists only in the return value of `issue()` and is shown to
 * the user during pairing. Revocation is O(1) and `revokeAll()` implements the
 * token half of the kill switch.
 */
export class ClientRegistry {
  readonly #clock: () => Date;
  readonly #tokenFactory: () => string;
  readonly #idFactory: () => string;
  readonly #byTokenHash = new Map<string, ClientRecord>();
  readonly #byId = new Map<string, ClientRecord>();

  constructor(options: ClientRegistryOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.#idFactory = options.idFactory ?? (() => randomUUID());
  }

  /** Issue a token for a newly paired client. Device-side pairing action only. */
  issue(name: string): IssuedClient {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      throw new TypeError("client name must not be empty");
    }
    if (normalizedName.length > MAX_CLIENT_NAME_LENGTH) {
      throw new TypeError(`client name is longer than ${MAX_CLIENT_NAME_LENGTH} characters`);
    }
    const token = this.#tokenFactory();
    if (typeof token !== "string" || token.length < 16) {
      throw new Error("token factory must return a token of at least 16 characters");
    }
    const hashedToken = tokenHash(token);
    if (this.#byTokenHash.has(hashedToken)) {
      throw new Error("token factory returned a duplicate token");
    }
    const record: ClientRecord = {
      id: this.#idFactory(),
      name: normalizedName,
      tokenHash: hashedToken,
      createdAt: this.#clock().toISOString(),
      revokedAt: null,
    };
    this.#byTokenHash.set(record.tokenHash, record);
    this.#byId.set(record.id, record);
    return Object.freeze({
      client: Object.freeze({ id: record.id, name: record.name }),
      token,
    });
  }

  /** Authenticate a bearer token without ever exposing or logging the token. */
  authenticate(token: string): ClientIdentity | null {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }
    const record = this.#byTokenHash.get(tokenHash(token));
    if (record === undefined || record.revokedAt !== null) {
      return null;
    }
    return Object.freeze({ id: record.id, name: record.name });
  }

  /** Revoke one client. Returns false when the id is unknown or already revoked. */
  revoke(clientId: string): boolean {
    const record = this.#byId.get(clientId);
    if (record === undefined || record.revokedAt !== null) {
      return false;
    }
    record.revokedAt = this.#clock().toISOString();
    this.#byTokenHash.delete(record.tokenHash);
    return true;
  }

  /** Revoke every active client and every token. Returns the number revoked. */
  revokeAll(): number {
    let revoked = 0;
    const revokedAt = this.#clock().toISOString();
    for (const record of this.#byId.values()) {
      if (record.revokedAt === null) {
        record.revokedAt = revokedAt;
        this.#byTokenHash.delete(record.tokenHash);
        revoked += 1;
      }
    }
    return revoked;
  }

  /** Client list for the device UI; never includes a token or its hash. */
  list(): readonly ClientSummary[] {
    return [...this.#byId.values()].map((record) =>
      Object.freeze({
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        revokedAt: record.revokedAt,
      }),
    );
  }

  get(clientId: string): ClientSummary | null {
    const record = this.#byId.get(clientId);
    if (record === undefined) {
      return null;
    }
    return Object.freeze({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt,
    });
  }

  activeCount(): number {
    let count = 0;
    for (const record of this.#byId.values()) {
      if (record.revokedAt === null) {
        count += 1;
      }
    }
    return count;
  }
}
