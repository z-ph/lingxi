export {
  AppAllowlist,
  MemoryAppAllowlistStore,
  isAppPackageName,
  normalizeAppPackage,
} from "./allowlist.js";
export type { AppAllowlistStore } from "./allowlist.js";

export {
  AuditLog,
  GENESIS_HASH,
  JsonlAuditSink,
  MemoryAuditSink,
  summarizeParameters,
  summarizeToolResult,
  summarizeToolResultRecord,
  verifyAuditChain,
} from "./audit-log.js";
export type {
  AuditClient,
  AuditConfirmationOutcome,
  AuditConfirmationRecord,
  AuditDecision,
  AuditEntry,
  AuditExportFormat,
  AuditKind,
  AuditLogOptions,
  AuditRecordInput,
  AuditResultRecord,
  AuditStatus,
  AuditStoreLike,
  AuditVerification,
} from "./audit-log.js";

export { DeviceConfirmationQueue, computeConfirmationDigest } from "./confirmation.js";
export type { DeviceConfirmationQueueOptions } from "./confirmation.js";

export {
  DEFAULT_DANGER_PATTERNS,
  assessDanger,
  createDangerPolicy,
} from "./danger-policy.js";
export type { DangerPattern, DangerPolicy, DangerPolicyOptions } from "./danger-policy.js";

export { SecurityGate, resolveAppPackages } from "./gate.js";
export type { SecurityGateOptions } from "./gate.js";

export { KillSwitch } from "./kill-switch.js";
export type { KillSwitchOptions, KillSwitchReport, StoppableMcpService } from "./kill-switch.js";

export { ClientRegistry } from "./tokens.js";
export type { ClientRegistryOptions, ClientSummary, IssuedClient } from "./tokens.js";

export {
  TOOL_NAMES,
  isToolName,
} from "./types.js";
export type {
  ClientIdentity,
  ConfirmationChannel,
  ConfirmationDecision,
  ConfirmationDenyReason,
  ConfirmationPrompt,
  DangerAssessment,
  DangerCategory,
  DangerReason,
  TargetNode,
  ToolCallContext,
  ToolCallRequest,
  ToolError,
  ToolErrorCode,
  ToolHandler,
  ToolHandlerRegistry,
  ToolName,
  ToolResult,
} from "./types.js";
