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

## ui_tree payload

The daemon owns pruning: interactive nodes only by default, flattened into a pre-order array.
Clients do not need to filter further. The M1 implementation lives in `src/ui-tree/`.

```json
{
  "nodes": [
    {
      "id": "n3",
      "text": "WLAN",
      "bounds": [0, 372, 1080, 524],
      "clickable": true,
      "editable": false
    }
  ],
  "truncated": false
}
```

| Field | Type | Description |
| --- | --- | --- |
| `nodes[].id` | string | Snapshot-local handle (`n1`, `n2`, ...), unique within one snapshot, used as `nodeId` by `tap` / `type`; may change on the next call. |
| `nodes[].text` | string | Visible text or `contentDescription`, whitespace-collapsed, truncated to 100 Unicode characters with a trailing `…`. When an interactive node has no text of its own, labels of its non-interactive descendants are merged in (same 100-character cap); Android often puts a settings row label on a child `TextView`. |
| `nodes[].bounds` | `[number, number, number, number]` | Device pixels `[left, top, right, bottom]`, matching Android accessibility bounds. A coordinate tap can use the centre point. |
| `nodes[].clickable` | boolean | Whether the raw node is clickable. |
| `nodes[].editable` | boolean | Whether the raw node is editable. |
| `truncated` | boolean | True when maxDepth dropped nodes or any text was shortened. |

Rules:

- `interactiveOnly` (default `true`): return only `clickable` or `editable` nodes.
  `interactiveOnly=false` also returns static nodes that have text (useful for reading content);
  empty layout containers are still omitted.
- `maxDepth` (default `30`): maximum traversal depth from the root (depth 0). It only limits
  node traversal; label aggregation for a kept interactive node may read deeper non-interactive
  descendants.
- `filter`: case-insensitive substring matched against `text`, `contentDescription`, or the
  resource `id`, applied on top of `interactiveOnly`; an empty string means no filter.
- Invisible nodes (`visible: false`) and their subtrees are omitted.
- `bounds` are device pixels; the earlier "normalized bounds" wording is pinned down to this fixed
  four-value form so an agent can use it directly for coordinate taps.
- Node order is pre-order (parent before children); `id` is a snapshot handle and is not stable
  across snapshots.
- Invalid arguments (`maxDepth` not an integer >= 0, `interactiveOnly` not boolean, `filter` not a
  string) fail explicitly instead of silently degrading.

## Pairing

1. User opens Phone as Tool -> "Connect an agent" -> shows QR + 6-digit code.
2. Client connects to http://<phone-lan-ip>:<port>/mcp with the pairing token.
3. Phone prompts: allow this client? (name + fingerprint), then LAN-only session until revoked.
4. All sessions listed in the app with last-used time and revoke button.

## Client config (target)

    { "mcpServers": { "lingxi": { "url": "http://192.168.x.y:8765/mcp?token=..." } } }

## Token budget

- Target: median < 3k tokens for a typical app screen, p95 < 8k tokens.
- What is measured: the compact JSON returned by `ui_tree` (`JSON.stringify(payload)`), counted
  with OpenAI's `o200k_base` BPE. Client tokenizers differ slightly; a stable public vocabulary is
  used as the proxy.
- Reproduce: `npm ci && npm run measure`. The script exits non-zero when the budget fails.
- Result (2026-11-10, five representative app fixtures in the repo, one screen per app):

| App | Package | Returned nodes | Raw tree tokens | ui_tree tokens |
| --- | --- | ---: | ---: | ---: |
| Settings | com.android.settings | 23 | 3,115 | 813 |
| Chrome | com.android.chrome | 25 | 2,907 | 775 |
| WeChat | com.tencent.mm | 18 | 3,864 | 880 |
| Xiaohongshu | com.xingin.xhs | 30 | 3,724 | 1,121 |
| Alipay | com.eg.android.AlipayGphone | 37 | 3,503 | 1,255 |

- Median 880 tokens, p95 1,255 tokens. p95 uses nearest-rank (the `ceil(0.95 x n)`-th smallest
  value); with five apps that is the maximum, the conservative reading.
- Limitation: CI has no Android device. The fixtures model the real apps' hierarchy structure but
  are **not device captures**. Real-device measurement awaits the M2 Android/Termux backend and can
  then be run with `npm run measure -- --input <dump.json>` after converting the dump to
  `RawUiNode` JSON. Client tokenizers may also differ; `o200k_base` is only a stable comparison,
  not the exact count for Claude Code / Cursor / DSH.
- `interactiveOnly=false` also returns static text, which is larger and outside the default budget.
