# Roadmap

Milestones are sequential. A milestone ships only when its acceptance criteria pass.

## M0 — Charter (complete)

- [x] Vision, non-goals, principles
- [x] MCP tool contract
- [x] Security requirements
- [x] Benchmark plan
- [x] AGENTS.md operating rules
- [x] 30-second demo script defined (issue #1)
- [x] FAQ (issue #10)

## M1 — MCP MVP (usable by a developer, in progress)

Implementation shape (decided):
- The daemon is TypeScript / Node with the repository root as the package root; `npm ci && npm run
  build && npm test` must pass.
- All device access goes through a `Device` adapter; M1 ships `FakeDevice` (in-memory, scriptable),
  so tests never need a real phone.
- The Android device backend (Termux / ADB) belongs to M2 and is out of scope for M1.

Acceptance:
- App runs a local MCP server on the phone (LAN only), pairing by QR or code + token.
- Six tools work end to end: screenshot, ui_tree, tap, type, launch_app, wait_for.
- One documented one-line config for at least two MCP clients (Claude Code, Cursor/DSH).
- Action results report whether the action took effect; failures are explicit, not silent.
- Demo recording: agent on a laptop completes one real task on the phone. (The recording is a demo
  item; M1 code acceptance is proven by automated tests. Without a device attached, the PR body states
  the "not verified on a real device" limitation.)

Out of scope: record/replay, allowlist UI, multi-client concurrency fairness.

## M2 — Safety and reliability

Acceptance:
- App allowlist enforced by default (empty = nothing can be driven until the user allows it).
- Explicit confirmation gate for configured dangerous actions (payments, deletions, sending).
- Audit log of every tool call: client, tool, args summary, result, timestamp; exportable.
- Kill switch: disconnect all clients, revoke tokens.
- Reconnect/idle handling: phone reboot, app backgrounded, network change.

## M3 — Evaluation

Acceptance:
- 30-task benchmark set (10 simple, 10 multi-step, 10 cross-app) with fixtures.
- Harness runs a task set against a device and reports: success rate, steps, wall time, tokens,
  dangerous-action attempts.
- Results published in the README with hardware/network/model context.

## M4 — Ecosystem

- Chinese app skills (WeChat, Feishu, 小红书, 支付宝, 美团) as documented recipes.
- Record & replay for frequent flows; deterministic replay + model recovery.
- Multi-client concurrency policy (one active operator at a time by default).
- Optional relay for remote use, off by default, with explicit pairing.
