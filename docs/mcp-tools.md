# MCP tool surface

The phone exposes a small, stable tool surface. Everything else is the agent's job.

## Tools

| Tool | Args | Returns |
| --- | --- | --- |
| screenshot | format?=png/jpeg, quality? | image + size + timestamp |
| ui_tree | maxDepth?, interactiveOnly?=true, filter? | pruned tree: id, text, bounds, clickable, editable |
| tap | nodeId or x,y | {ok, effect} |
| swipe | from, to, durationMs? | {ok} |
| type | nodeId? or focused, text, submit? | {ok} |
| launch_app | package or label | {ok, package, foreground} |
| wait_for | nodeText?, package?, timeoutMs | {ok, matched, elapsedMs} |
| observe | notifications?, clipboard? | structured text |

Invariants:

- Every write action returns the **observed effect** (e.g. the node disappeared, text appeared),
  not merely "sent".
- Failures are explicit and typed: not_found, blocked, needs_confirmation, timeout,
  permission_denied.
- ui_tree is pruned and bounded: the daemon owns token efficiency, not the client.
- No tool returns raw screenshots unless asked; screenshot bytes are never logged.

## Pairing

1. User opens Lingxi -> "Connect an agent" -> shows QR + 6-digit code.
2. Client connects to http://<phone-lan-ip>:<port>/mcp with the pairing token.
3. Phone prompts: allow this client? (name + fingerprint), then LAN-only session until revoked.
4. All sessions listed in the app with last-used time and revoke button.

## Client config (target)

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## Token budget

- ui_tree default: interactive nodes only, text truncated to 100 chars, bounds normalized.
- Target: median < 3k tokens for a typical app screen, p95 < 8k.
