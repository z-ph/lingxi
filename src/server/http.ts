/**
 * The LAN-only HTTP face of the daemon.
 *
 * Routes:
 *   GET  /health  – unauthenticated liveness probe (no secrets)
 *   POST /pair    – pairing code + client name/fingerprint, waits for device approval
 *   *    /mcp     – Streamable HTTP MCP endpoint, requires a per-client bearer token
 *
 * Defenses in front of every route: peer must be loopback/LAN, Host must match
 * the bound address (DNS-rebinding guard), and an Origin header, when present,
 * must be the daemon's own origin. MCP requests are authenticated on every
 * request, so revoking a token takes effect immediately.
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import type { Device } from '../device/types.js';
import { allowedHostHeaders, assertBindableAddress, formatHostForUrl, isAllowedPeerAddress } from '../lan.js';
import { PairingError, type PairingManager } from '../pairing/pairing-manager.js';
import type { TokenStore } from '../pairing/token-store.js';
import type { Logger } from '../logger.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { createDeviceServer } from './tools.js';

const MAX_PAIR_BODY_BYTES = 16 * 1024;
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
const PAIRING_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = PAIRING_TIMEOUT_MS + 30_000;

export interface HttpServerOptions {
  host: string;
  port: number;
  device: Device;
  tokenStore: TokenStore;
  pairing: PairingManager;
  logger: Logger;
}

export interface RunningHttpServer {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  allowedHosts: ReadonlySet<string>;
  close(): Promise<void>;
}

type AuthedIncomingMessage = IncomingMessage & { auth?: AuthInfo };

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function requestPath(rawUrl: string | undefined): string {
  const raw = rawUrl ?? '/';
  const query = raw.indexOf('?');
  return query === -1 ? raw : raw.slice(0, query);
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = headerValue(header);
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function isAllowedOrigin(origin: string | undefined, allowedHosts: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  return allowedHosts.has(parsed.host.toLowerCase());
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  writeJson(
    res,
    401,
    { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
    { 'www-authenticate': 'Bearer realm="phone-as-tool"' },
  );
}

function forbidden(res: ServerResponse, reason: string): void {
  writeJson(res, 403, { error: { code: 'forbidden', reason } });
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new HttpError(413, 'payload_too_large', `request body exceeds ${limit} bytes`);
    chunks.push(buffer);
  }
  if (total === 0) throw new HttpError(400, 'empty_body', 'request body is required');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be valid JSON');
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pairingStatus(code: PairingError['code']): number {
  switch (code) {
    case 'invalid_client':
      return 400;
    case 'invalid_code':
      return 403;
    case 'no_active_pairing':
    case 'approval_not_found':
      return 409;
    case 'denied':
      return 403;
    case 'approval_timeout':
    case 'client_aborted':
      return 408;
    case 'too_many_requests':
      return 429;
    case 'shutdown':
      return 503;
    default:
      return 500;
  }
}

export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  assertBindableAddress(options.host);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error(`invalid port: ${options.port}`);
  }
  const logger = options.logger.child({ component: 'http' });
  const mcpHandler = createMcpHandler(() => createDeviceServer(options.device), { legacy: 'stateless' });
  const nodeHandler = toNodeHandler(mcpHandler, {
    maxRequestBodySize: MAX_MCP_BODY_BYTES,
    onerror: (error) => logger.error('mcp handler failed', { error }),
  });
  let allowedHosts: ReadonlySet<string> = new Set();

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      logger.error('request handler failed', { error });
      if (!res.headersSent && !res.destroyed) writeJson(res, 500, { error: { code: 'internal' } });
      else if (!res.destroyed) res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    const path = requestPath(req.url);
    const remote = req.socket.remoteAddress;
    res.on('finish', () => {
      logger.debug('http request', {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Date.now() - startedAt,
        remote,
      });
    });

    if (!isAllowedPeerAddress(remote)) {
      logger.warn('rejected non-LAN peer', { remote });
      forbidden(res, 'peer_not_lan');
      return;
    }
    const hostHeader = headerValue(req.headers.host)?.toLowerCase();
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      logger.warn('rejected request with unexpected Host header', { remote, host: hostHeader });
      forbidden(res, 'host_not_allowed');
      return;
    }
    if (!isAllowedOrigin(headerValue(req.headers.origin), allowedHosts)) {
      logger.warn('rejected request with unexpected Origin header', { remote });
      forbidden(res, 'origin_not_allowed');
      return;
    }

    if (path === '/health') {
      if (req.method !== 'GET') {
        writeJson(res, 405, { error: { code: 'method_not_allowed' } }, { allow: 'GET' });
        return;
      }
      writeJson(res, 200, { ok: true, name: PACKAGE_NAME, version: VERSION });
      return;
    }

    if (path === '/pair') {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: { code: 'method_not_allowed' } }, { allow: 'POST' });
        return;
      }
      await handlePair(req, res, remote);
      return;
    }

    if (path === '/mcp') {
      await handleMcp(req, res, remote);
      return;
    }

    writeJson(res, 404, { error: { code: 'not_found' } });
  }

  async function handlePair(req: IncomingMessage, res: ServerResponse, remote: string | undefined): Promise<void> {
    const contentType = headerValue(req.headers['content-type']) ?? '';
    if (!/^application\/json\b/i.test(contentType)) {
      writeJson(res, 415, { error: { code: 'unsupported_media_type', message: 'use application/json' } });
      return;
    }

    const abort = new AbortController();
    const onAborted = (): void => abort.abort();
    const onClose = (): void => {
      if (!res.writableEnded) abort.abort();
    };
    req.on('aborted', onAborted);
    res.on('close', onClose);
    try {
      const body = await readJsonBody(req, MAX_PAIR_BODY_BYTES);
      if (!isJsonObject(body)) throw new HttpError(400, 'invalid_body', 'body must be a JSON object');
      const code = body.code;
      const clientName = body.clientName;
      const fingerprint = body.fingerprint;
      if (typeof code !== 'string' || typeof clientName !== 'string' || typeof fingerprint !== 'string') {
        throw new HttpError(400, 'invalid_body', 'code, clientName and fingerprint are required strings');
      }
      const issued = await options.pairing.requestPairing(
        {
          code,
          clientName,
          fingerprint,
          ...(remote === undefined ? {} : { remoteAddress: remote }),
        },
        { signal: abort.signal },
      );
      logger.info('pairing approved', {
        clientId: issued.client.id,
        clientName: issued.client.clientName,
        fingerprint: issued.client.fingerprint,
        remote,
      });
      // The token is returned exactly once and is never logged.
      writeJson(res, 200, { token: issued.token, client: issued.client });
    } catch (error) {
      if (error instanceof PairingError) {
        logger.info('pairing rejected', { code: error.code, remote });
        if (!res.writableEnded && !res.destroyed) {
          writeJson(res, pairingStatus(error.code), { error: { code: error.code, message: error.message } });
        }
        return;
      }
      if (error instanceof HttpError) {
        if (!res.writableEnded && !res.destroyed) {
          writeJson(res, error.status, { error: { code: error.code, message: error.message } });
        }
        return;
      }
      throw error;
    } finally {
      req.off('aborted', onAborted);
      res.off('close', onClose);
    }
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse, remote: string | undefined): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      writeJson(res, 405, { error: { code: 'method_not_allowed' } }, { allow: 'GET, POST, DELETE' });
      return;
    }
    const token = extractBearerToken(req.headers.authorization);
    const record = token ? options.tokenStore.verify(token) : null;
    if (!token || !record) {
      logger.warn('mcp authentication failed', { remote, reason: token ? 'unknown_or_revoked_token' : 'missing_token' });
      unauthorized(res);
      return;
    }
    const authInfo: AuthInfo = { token, clientId: record.id, scopes: ['mcp'] };
    (req as AuthedIncomingMessage).auth = authInfo;
    await nodeHandler(req, res);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('HTTP server did not report a TCP address');
  }
  const port = address.port;
  allowedHosts = allowedHostHeaders(options.host, port);
  const url = `http://${formatHostForUrl(options.host)}:${port}`;

  return {
    server,
    host: options.host,
    port,
    url,
    allowedHosts,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        server.close(() => finish());
        const timer = setTimeout(() => {
          server.closeAllConnections();
          finish();
        }, 1_000);
        timer.unref?.();
      });
      await mcpHandler.close();
    },
  };
}
