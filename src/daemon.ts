/**
 * Daemon assembly: LAN bind address -> token store -> pairing manager -> MCP
 * HTTP server. The CLI and tests both use this entry point.
 */

import os from 'node:os';
import path from 'node:path';
import { FakeDevice } from './device/fake-device.js';
import type { Device } from './device/types.js';
import { assertBindableAddress, resolveLanAddress } from './lan.js';
import { createLogger, levelFromEnv, type Logger } from './logger.js';
import { PairingManager, type PairingInfo, type PendingApproval } from './pairing/pairing-manager.js';
import { TokenStore, type PublicTokenInfo } from './pairing/token-store.js';
import { startHttpServer, type RunningHttpServer } from './server/http.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export interface DaemonOptions {
  /** Bind address. Defaults to the first private IPv4 LAN interface. */
  host?: string;
  /** TCP port. Defaults to 8765; 0 picks an ephemeral port (tests). */
  port?: number;
  /** Directory for `tokens.json`; null keeps everything in memory (tests). */
  stateDir?: string | null;
  device?: Device;
  logger?: Logger;
  codeTtlMs?: number;
  approvalTtlMs?: number;
  onApprovalRequest?: (approval: PendingApproval) => void;
  now?: () => Date;
}

export interface RunningDaemon {
  host: string;
  port: number;
  /** Base URL, e.g. http://192.168.1.5:8765 */
  url: string;
  /** MCP endpoint, e.g. http://192.168.1.5:8765/mcp */
  mcpUrl: string;
  device: Device;
  logger: Logger;
  tokenStore: TokenStore;
  pairing: PairingManager;
  http: RunningHttpServer;
  pairingInfo: PairingInfo;
  startPairing(): PairingInfo;
  pendingApprovals(): PendingApproval[];
  approve(id: string): PublicTokenInfo;
  deny(id: string): void;
  listTokens(): PublicTokenInfo[];
  revokeToken(id: string): boolean;
  revokeAllTokens(): number;
  close(): Promise<void>;
}

export function defaultStateDir(): string {
  return process.env.PHONE_AS_TOOL_STATE_DIR ?? path.join(os.homedir(), '.phone-as-tool');
}

export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const host = options.host ?? resolveLanAddress();
  assertBindableAddress(host);
  const port = options.port ?? 8765;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid port: ${port}`);
  }

  const logger = options.logger ?? createLogger({ level: levelFromEnv(process.env.PHONE_AS_TOOL_LOG_LEVEL) });
  const stateDir = options.stateDir === undefined ? defaultStateDir() : options.stateDir;
  const tokenStore =
    stateDir === null
      ? TokenStore.inMemory({ ...(options.now === undefined ? {} : { now: options.now }) })
      : TokenStore.open(path.join(stateDir, 'tokens.json'), { ...(options.now === undefined ? {} : { now: options.now }) });
  const device = options.device ?? new FakeDevice();
  const pairing = new PairingManager({
    tokenStore,
    ...(options.codeTtlMs === undefined ? {} : { codeTtlMs: options.codeTtlMs }),
    ...(options.approvalTtlMs === undefined ? {} : { approvalTtlMs: options.approvalTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (options.onApprovalRequest) pairing.onApprovalRequest(options.onApprovalRequest);

  const http = await startHttpServer({ host, port, device, tokenStore, pairing, logger }).catch((error: unknown) => {
    tokenStore.close();
    throw error;
  });
  let pairingInfo: PairingInfo;
  try {
    pairingInfo = pairing.startPairing(http.url);
  } catch (error) {
    await http.close();
    tokenStore.close();
    throw error;
  }
  logger.info('daemon listening', { host: http.host, port: http.port, mcpUrl: `${http.url}/mcp` });

  const daemon: RunningDaemon = {
    host: http.host,
    port: http.port,
    url: http.url,
    mcpUrl: `${http.url}/mcp`,
    device,
    logger,
    tokenStore,
    pairing,
    http,
    pairingInfo,
    startPairing: () => {
      const info = pairing.startPairing(http.url);
      daemon.pairingInfo = info;
      return info;
    },
    pendingApprovals: () => pairing.pendingApprovals(),
    approve: (id) => pairing.approve(id),
    deny: (id) => pairing.deny(id),
    listTokens: () => tokenStore.list(),
    revokeToken: (id) => tokenStore.revoke(id),
    revokeAllTokens: () => tokenStore.revokeAll(),
    async close(): Promise<void> {
      pairing.close();
      await http.close();
      tokenStore.close();
      logger.info('daemon stopped', { name: PACKAGE_NAME, version: VERSION });
    },
  };
  return daemon;
}
