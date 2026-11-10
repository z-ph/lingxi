/**
 * Per-client bearer tokens.
 *
 * Tokens are random 256-bit values returned to the client exactly once. The
 * store keeps only a SHA-256 hash plus display metadata, so a leaked state file
 * cannot be replayed as a token. Revocation is immediate: every MCP request
 * re-verifies the bearer token, so there is no long-lived session to invalidate.
 *
 * The store never logs; callers must not log raw tokens either.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TOKEN_PREFIX = 'pat_';

export interface TokenStoreOptions {
  filePath?: string;
  now?: () => Date;
  generateToken?: () => string;
  generateId?: () => string;
}

export interface IssueTokenInput {
  clientName: string;
  fingerprint: string;
}

export interface ClientTokenRecord {
  id: string;
  clientName: string;
  fingerprint: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Safe projection: deliberately has no token or hash. */
export interface PublicTokenInfo {
  id: string;
  clientName: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface IssuedToken {
  /** Raw token. Show it to the client once; never log or persist it. */
  token: string;
  client: PublicTokenInfo;
}

interface StateFile {
  version: 1;
  tokens: ClientTokenRecord[];
}

export class TokenStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenStoreError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicInfo(record: ClientTokenRecord): PublicTokenInfo {
  return {
    id: record.id,
    clientName: record.clientName,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function defaultGenerateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function defaultGenerateId(): string {
  return `tok_${randomBytes(6).toString('hex')}`;
}

function parseStateFile(filePath: string, text: string): ClientTokenRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenStoreError(`token state file is not valid JSON: ${filePath}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tokens)) {
    throw new TokenStoreError(`token state file has an unsupported shape: ${filePath}`);
  }
  const records: ClientTokenRecord[] = [];
  const seenHashes = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of parsed.tokens) {
    if (!isRecord(entry)) throw new TokenStoreError(`token state file has a malformed entry: ${filePath}`);
    const { id, clientName, fingerprint, tokenHash, createdAt, lastUsedAt } = entry;
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      typeof clientName !== 'string' ||
      typeof fingerprint !== 'string' ||
      typeof tokenHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(tokenHash) ||
      typeof createdAt !== 'string' ||
      (lastUsedAt !== null && typeof lastUsedAt !== 'string')
    ) {
      throw new TokenStoreError(`token state file has a malformed entry: ${filePath}`);
    }
    if (seenHashes.has(tokenHash) || seenIds.has(id)) {
      throw new TokenStoreError(`token state file has duplicate entries: ${filePath}`);
    }
    seenHashes.add(tokenHash);
    seenIds.add(id);
    records.push({ id, clientName, fingerprint, tokenHash, createdAt, lastUsedAt });
  }
  return records;
}

export class TokenStore {
  private readonly records = new Map<string, ClientTokenRecord>();
  private readonly filePath: string | undefined;
  private readonly now: () => Date;
  private readonly generateToken: () => string;
  private readonly generateId: () => string;
  private dirty = false;

  private constructor(options: TokenStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date());
    this.generateToken = options.generateToken ?? defaultGenerateToken;
    this.generateId = options.generateId ?? defaultGenerateId;
    if (this.filePath) this.load(this.filePath);
  }

  /** Open a store backed by `filePath` (created on first write) or in memory. */
  static open(filePath: string, options: Omit<TokenStoreOptions, 'filePath'> = {}): TokenStore {
    return new TokenStore({ ...options, filePath });
  }

  static inMemory(options: Omit<TokenStoreOptions, 'filePath'> = {}): TokenStore {
    return new TokenStore(options);
  }

  get path(): string | undefined {
    return this.filePath;
  }

  issue(input: IssueTokenInput): IssuedToken {
    if (typeof input.clientName !== 'string' || input.clientName.length === 0) {
      throw new TokenStoreError('clientName must not be empty');
    }
    if (typeof input.fingerprint !== 'string' || input.fingerprint.length === 0) {
      throw new TokenStoreError('fingerprint must not be empty');
    }
    let token = this.generateToken();
    let tokenHash = sha256(token);
    while (this.records.has(tokenHash)) {
      token = this.generateToken();
      tokenHash = sha256(token);
    }
    let id = this.generateId();
    const existingIds = new Set([...this.records.values()].map((record) => record.id));
    while (existingIds.has(id)) id = this.generateId();
    const record: ClientTokenRecord = {
      id,
      clientName: input.clientName,
      fingerprint: input.fingerprint,
      tokenHash,
      createdAt: this.now().toISOString(),
      lastUsedAt: null,
    };
    this.records.set(tokenHash, record);
    this.dirty = true;
    this.flush();
    return { token, client: publicInfo(record) };
  }

  /** Return the matching active record and mark it used; null for unknown tokens. */
  verify(token: string): ClientTokenRecord | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200 || !token.startsWith(TOKEN_PREFIX)) {
      return null;
    }
    const record = this.records.get(sha256(token));
    if (!record) return null;
    const updated: ClientTokenRecord = { ...record, lastUsedAt: this.now().toISOString() };
    this.records.set(updated.tokenHash, updated);
    this.dirty = true;
    return { ...updated };
  }

  list(): PublicTokenInfo[] {
    return [...this.records.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(publicInfo);
  }

  revoke(id: string): boolean {
    for (const [hash, record] of this.records) {
      if (record.id === id) {
        this.records.delete(hash);
        this.dirty = true;
        this.flush();
        return true;
      }
    }
    return false;
  }

  revokeAll(): number {
    const count = this.records.size;
    this.records.clear();
    this.dirty = true;
    this.flush();
    return count;
  }

  /** Persist pending `lastUsedAt` updates and any other dirty state. */
  flush(): void {
    if (!this.filePath || !this.dirty) return;
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const state: StateFile = {
      version: 1,
      tokens: [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    };
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows and some filesystems do not implement POSIX modes; the file is
      // still only as readable as the user's profile directory.
    }
    this.dirty = false;
  }

  close(): void {
    this.flush();
  }

  private load(filePath: string): void {
    if (!existsSync(filePath)) return;
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      throw new TokenStoreError(`cannot read token state file: ${filePath}`);
    }
    const records = parseStateFile(filePath, text);
    for (const record of records) this.records.set(record.tokenHash, record);
    this.dirty = false;
  }
}
