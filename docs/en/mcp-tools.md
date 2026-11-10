# MCP tool surface

The phone exposes a small, stable tool surface. Everything else is the agent's job.

## Tools

| Tool | Args | Returns |
| --- | --- | --- |
| screenshot | format?=png/jpeg, quality? | image + size + timestamp |
| ui_tree | maxDepth?, interactiveOnly?=true, filter? | pruned tree: id, text, bounds, clickable, editable |
| tap | nodeId or x,y | {ok, effect} |
| swipe | from, to, durationMs? | {ok, effect} |
| type | nodeId? or focused, text, submit? | {ok, effect} |
| launch_app | package or label | {ok, effect, package, foreground} |
| wait_for | nodeText?, package?, timeoutMs | {ok, effect, matched, elapsedMs} |
| observe | notifications?, clipboard? | structured text |

Invariants:

- Every write action returns the **observed effect** (e.g. the node disappeared, text appeared),
  not merely "sent".
- Failures are explicit and typed: not_found, blocked, needs_confirmation, timeout,
  permission_denied.
- ui_tree is pruned and bounded: the daemon owns token efficiency, not the client.
- No tool returns raw screenshots unless asked; screenshot bytes are never logged.

## Action results

Every action returns `ok` and `effect`. On failure `ok: false`, `effect: null`, and a typed
`error`.

Success:

    { "ok": true, "effect": { "kind": "tap", "target": { "node": { "nodeId": "open", "text": "Open" }, "point": { "x": 540, "y": 240 } }, "changes": [ { "kind": "node_appeared", "nodeId": "dialog-ok", "text": "OK" } ], "changeCount": 1, "elapsedMs": 320 } }

Failure:

    { "ok": false, "effect": null, "error": { "code": "not_found", "message": "tap target node login is not on the current screen", "details": { "nodeId": "login" } } }

Failure codes (clients branch on `code`, never parse the message):

| code | Meaning |
| --- | --- |
| invalid_argument | Missing or invalid arguments |
| not_found | Target node, app, package, or match does not exist |
| blocked | Target cannot be operated (disabled, not clickable, not editable, out of bounds) or device policy blocks it |
| needs_confirmation | Device-side confirmation required (M2 dangerous-action gate; never returned in M1) |
| timeout | A condition did not hold within the deadline (launch_app, wait_for) |
| permission_denied | Accessibility or app-launch permission is missing |
| no_effect | The action was dispatched but the UI showed no change during the observation window (tap, swipe, type) |

`effect` fields:

- Common: `changes` (at most 20 diff entries), `changeCount` (actual number of changes), `elapsedMs`.
- `tap`: `target.node` (the node when tapping by nodeId, or the hit node for coordinates, else null), `target.point`.
- `swipe`: `gesture.from`, `to`, `durationMs`.
- `type`: `node`, `beforeText`, `afterText` (null when the target disappears after submit), `submitted`. Success requires the target text to actually equal the requested text; a target that disappears after submit also counts.
- `launch_app`: `package`, `label`, `foreground`, `alreadyForeground`.
- `wait_for`: `matched.node` (when nodeText was given), `matched.package` (when package was given), `elapsedMs`.

Diff `changes` kinds: foreground_changed, node_appeared, node_disappeared, text_changed,
bounds_changed, state_changed (enabled/clickable/editable/focused).

Observation windows:

- tap/swipe/type poll UI snapshots for 2000ms by default; no change is `no_effect`, never a silent success.
- launch_app requires the target package to reach the foreground within 5000ms by default; otherwise `timeout`.
- wait_for polls for `timeoutMs`; nodeText is a case-insensitive substring match, package is exact; when both are given both must hold.
- Node ids must be stable across snapshots; M1's FakeDevice guarantees this, and the real-device adapter normalizes them in M2.

## Pairing

1. User opens Phone as Tool -> "Connect an agent" -> shows QR + 6-digit code.
2. Client connects to http://<phone-lan-ip>:<port>/mcp with the pairing token.
3. Phone prompts: allow this client? (name + fingerprint), then LAN-only session until revoked.
4. All sessions listed in the app with last-used time and revoke button.

## Client config (target)

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## Token budget

- ui_tree default: interactive nodes only, text truncated to 100 chars, bounds normalized.
- Target: median < 3k tokens for a typical app screen, p95 < 8k.
