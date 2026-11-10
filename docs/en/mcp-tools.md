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

M1 implements only the first six tools (screenshot, ui_tree, tap, type, launch_app, wait_for);
swipe and observe land in a later milestone.

Invariants:

- Every write action returns the **observed effect** (e.g. the node disappeared, text appeared),
  not merely "sent".
- Failures are explicit and typed: not_found, blocked, needs_confirmation, timeout,
  permission_denied.
- ui_tree is pruned and bounded: the daemon owns token efficiency, not the client.
- No tool returns raw screenshots unless asked; screenshot bytes are never logged.

## Pairing and auth (M1)

1. The device starts a pairing session and shows a 6-digit code plus a
   `phonetool://pair?url=...&code=...` URI (a QR renderer can come later). The code is single-use and
   expires after 5 minutes by default.
2. The client `POST`s `/pair` with `{"code":"123456","clientName":"Claude Code","fingerprint":"..."}`;
   the request stays pending until the device handles it.
3. The token is issued only after **explicit device-side approval** (terminal y/n in M1, an app dialog
   in M2). The response is `{"token":"pat_...","client":{...}}`, returned exactly once. Denial, a
   60-second approval timeout, or too many wrong code attempts fail the request. `fingerprint` is a
   client-reported display identifier used for recognition on the device; M1 does not treat it as a
   cryptographic identity proof.
4. The client sends `Authorization: Bearer <token>` to
   `http://<phone-lan-ip>:<port>/mcp`. **Tokens never go in the URL**; the server stores only a
   SHA-256 hash and never writes the token to a log.
5. The device lists every client (name, fingerprint, last-used time) and revokes by id; the next
   request from a revoked client gets 401 immediately.

## Client config (target shape)

Exact client syntax is issue #5; the auth header is common:

    { "mcpServers": { "phone-as-tool": {
        "url": "http://192.168.x.y:8765/mcp",
        "headers": { "Authorization": "Bearer pat_..." }
    } } }

## Token budget

- ui_tree default: interactive nodes only, text truncated to 100 chars, bounds normalized.
- Target: median < 3k tokens for a typical app screen, p95 < 8k.
