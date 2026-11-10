# Security

The phone is the most personal device a person owns. This document is the threat model the design
must satisfy; M2 implements it.

## Threats

1. **Unauthorized client on the LAN** — someone scanning the network drives the phone.
2. **Prompt injection from screen content** — an app, message or notification tells the agent to do
   something harmful; the controlling agent obeys.
3. **Destructive action** — payment, deletion, message sending, account change.
4. **Data exfiltration** — screenshots, notifications, files leaving the device unexpectedly.
5. **Credential exposure** — pairing token or app secrets leaking via logs/URLs.
6. **Confused deputy** — a second agent/client inherits permissions granted to the first.

## Requirements

- Bind to LAN interface only; no public exposure by default.
- Pairing requires a code shown on the phone + explicit allow prompt; tokens are per-client and
  revocable; tokens never appear in server logs.
- App allowlist: default empty — no app can be driven until the user adds it.
- Dangerous-action gate: a per-tool policy (e.g. tap on a payment button, type into a password
  field) requires device-side confirmation. The model cannot disable it.
- Audit log: every tool call, client identity, args summary, result; local, exportable, never
  uploaded.
- Kill switch in the app: revoke all clients and stop the MCP server immediately.
- Prompt-injection posture: tool results are data, not instructions; the daemon must not execute
  instructions found in UI text.
- Secrets at rest: Android Keystore for tokens; no plaintext in SharedPreferences/logs.

## Implementation status (M2 security gates)

The gates live in `src/security/` and are composed by `SecurityGate.execute()`. The M1 MCP server
(#2) must route every tool call through it.

### Gate order

Service state -> authenticate -> tool validation -> app allowlist -> dangerous-action confirmation ->
execute -> audit. Every failure returns a typed error and leaves an audit entry.

### App allowlist

- `AppAllowlist` is empty by default. Device-side `add` / `remove` / `clear` are the only mutation
  points; there is no corresponding MCP tool.
- Each call resolves its target app: `launch_app` uses the target package (the current launcher does
  not count), other tools use the foreground package; `wait_for` may name a target package. An
  unresolved target or a package outside the allowlist returns `blocked` and never executes.
- `tap` / `type` additionally require trusted `targetNode` context (it may be `null` when there is no
  node at that point / focus). Missing context is refused (fail closed) so dangerous labels cannot be
  bypassed.

### Dangerous actions

- A device-supplied `DangerPolicy` is injected into `SecurityGate`; the model cannot change it through
  any tool. Built-in rules cover payment / purchase / transfer targets, deletion / clearing /
  uninstall targets, send / publish / share targets, typing into password fields, and optional
  per-tool or per-app "always ask" policies.
- A match asks the phone through a `ConfirmationChannel`; `DeviceConfirmationQueue` is the in-memory
  implementation and a real app shows a system dialog. Approvals are bound to `id + digest`,
  one-time, and denial / timeout / cancellation never execute. Without a confirmation channel,
  dangerous actions are refused.
- `type.text` and password/token-like fields are redacted in both the prompt and the audit log.
- Prompt injection: UI text is only data for danger matching; it never changes policy or approves an
  action. Tool results are returned as data and never executed as instructions.

### Tokens

- `ClientRegistry` issues one random token per client and stores only its SHA-256 hash. It supports
  single and bulk revocation; audits, errors and the client list never include plaintext tokens.
- The pairing-code/QR flow belongs to #2; this module provides issuance and revocation after pairing.
- The Node daemon stores only hashes in memory; a real Android app must use Android Keystore.

### Audit log

- Every call (including authentication failures, allowlist denials, confirmation denials/timeouts
  and tool errors) appends: `seq`, `at`, `kind`, `client`, `tool`, `parameters`, `appPackages`,
  `decision`, `confirmation`, `result`, `durationMs`, `prevHash`, `hash`.
- `parameters` is a redacted summary: `type.text` stores only its length; password/token/
  authorization/image keys become `[redacted]`. `result` stores status, error code and a structural
  summary, never screen text, pixels or screenshots.
- A SHA-256 hash chain lets `verify()` / `verifyAuditChain()` detect tampering. `JsonlAuditSink`
  persists local JSONL; `exportJsonl()` / `exportJson()` / `writeExport()` export it. The module has
  no network code and never uploads.
- If the audit sink fails, the gate refuses to execute (fail closed). The hash chain detects
  tampering; it is not cryptographic proof against an attacker who can rewrite the file.

### Kill switch

- `KillSwitch.engage()` immediately locks the gate, revokes every client token, cancels pending
  confirmations and calls the MCP server's `stop()`. It returns revocation/stop details and is
  idempotent.
- Afterwards every call, including one with an old token, returns `blocked`; recovery requires
  re-pairing and a service restart. A real app's button calls `SecurityGate.engageKillSwitch()`.

### Wiring example

```ts
const gate = new SecurityGate({
  tools: toolHandlers,                 // screenshot / ui_tree / ... implementations
  clients,                              // ClientRegistry
  allowlist,                            // AppAllowlist, empty by default
  confirmation: deviceConfirmation,     // real-device ConfirmationChannel
  server: mcpServer,                    // at least stop()
});

const result = await gate.execute({
  token,
  tool: "tap",
  args: { nodeId: "n7" },
  context: { foregroundPackage, targetNode }, // resolved by the daemon, never by the model
});
```

## Current limitations

- Only the Node daemon's gates and unit tests are implemented here. The Android confirmation dialog,
  Keystore, allowlist/audit UI and reconnect/idle handling remain M2 follow-ups. The pairing-code flow
  belongs to #2.
- Not verified on a real device; acceptance is the automated `npm ci && npm run build && npm test`
  result.
- `KillSwitch` relies on the injected `server.stop` callback; without it, tokens are still revoked and
  the gate locked, but a real network listener cannot be stopped.

## Out of scope (for now)

- Multi-tenant device farms.
- Remote access over the public internet (M4 optional relay; explicit pairing, off by default).
