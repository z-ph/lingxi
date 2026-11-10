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

## Out of scope (for now)

- Multi-tenant device farms.
- Remote access over the public internet (M4 optional relay; explicit pairing, off by default).
