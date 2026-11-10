/**
 * Public entry point for the M1 daemon.
 *
 * The CLI (`src/cli.ts`) and tests import from here; downstream milestones can
 * reuse the same device/pairing/server pieces.
 */

export * from './device/types.js';
export { FakeDevice, TINY_JPEG_BASE64, TINY_PNG_BASE64 } from './device/fake-device.js';
export type { FakeApp, FakeDeviceAction, FakeDeviceOptions } from './device/fake-device.js';
export { createLogger, createMemoryLogger, levelFromEnv, redactString } from './logger.js';
export type { Logger, LogLevel, LogFields, MemoryLogEntry, MemoryLogger } from './logger.js';
export {
  LanAddressError,
  allowedHostHeaders,
  assertBindableAddress,
  formatHostForUrl,
  isAllowedPeerAddress,
  isBindableAddress,
  isLoopbackAddress,
  isPrivateIPv4,
  resolveLanAddress,
  stripScopeAndMapping,
} from './lan.js';
export type { NetworkInterfaceAddress, NetworkInterfacesLike } from './lan.js';
export { PairingManager, PairingError } from './pairing/pairing-manager.js';
export type {
  ApprovalListener,
  PairingErrorCode,
  PairingInfo,
  PairingManagerOptions,
  PairingRequest,
  PendingApproval,
} from './pairing/pairing-manager.js';
export { TOKEN_PREFIX, TokenStore, TokenStoreError } from './pairing/token-store.js';
export type {
  ClientTokenRecord,
  IssuedToken,
  IssueTokenInput,
  PublicTokenInfo,
  TokenStoreOptions,
} from './pairing/token-store.js';
export { createDeviceServer, M1_TOOL_NAMES } from './server/tools.js';
export { startHttpServer } from './server/http.js';
export type { HttpServerOptions, RunningHttpServer } from './server/http.js';
export { defaultStateDir, startDaemon } from './daemon.js';
export type { DaemonOptions, RunningDaemon } from './daemon.js';
export { MCP_SERVER_NAME, PACKAGE_NAME, VERSION } from './version.js';
