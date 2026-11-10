# M1 daemon (developer preview)

[简体中文](../daemon.md) | [English](daemon.md)

Status: **M1 developer preview**. The repository root is a TypeScript / Node package; device
capabilities come from `FakeDevice`, and the real Android / Termux backend belongs to M2. M1 is
accepted through automated tests; it is not yet verified on a real phone.

## Quick start

Node.js >= 20 is required.

    npm ci
    npm run build
    npm test

Start the daemon:

    npm start

It auto-selects a private IPv4 LAN address (Wi-Fi interfaces win) and port 8765. To try it locally:

    npm start -- --host 127.0.0.1

Startup prints:

    Phone as Tool 0.1.0 — M1 daemon
    LAN endpoint: http://192.168.1.5:8765
    MCP endpoint: http://192.168.1.5:8765/mcp
    Pairing code: 123456   expires ...
    Pairing URI: phonetool://pair?url=...&code=...&expires=...

The terminal is the M1 device UI: it shows the pairing code and asks for an explicit `y` / `n`
approval when a client submits it. Codes are single-use and valid for 5 minutes by default; approval
times out after 60 seconds.

## What it does

- Serves an MCP Streamable HTTP endpoint at `http://<LAN IPv4>:<port>/mcp`, supporting stateless
  2025-era clients (the handshake Claude Code, Cursor and similar clients use). M1 keeps no session
  state: `GET`/`DELETE /mcp` return 405; clients use `POST` for initialize and tool calls.
- Binds only a private IPv4 or `127.0.0.1`; `0.0.0.0`, public addresses and IPv6 binds are refused.
  M1 does not auto-select an IPv6 LAN address.
- Checks the peer address, `Host` and `Origin` on every request (LAN-only + DNS-rebinding guard).
- Issues one revocable token per client after pairing code + explicit device approval.
- Stores only a SHA-256 token hash; neither server logs nor the state file contain a plaintext token.
- Exposes the six M1 tools: `screenshot`, `ui_tree`, `tap`, `type`, `launch_app`, `wait_for`.

## Connecting a client

The repository ships a small client to verify pairing and `tools/list` without Claude Code / Cursor:

    npm run pair -- --url http://192.168.1.5:8765 --code 123456 --name "Claude Code"

It submits the pairing code, waits for device approval, connects to `/mcp`, runs the initialize
handshake and lists tools. On success the token is printed once; put it in the real client's
`Authorization: Bearer ...` configuration. Exact one-line client configs are issue #5.

## Token management

Commands in the daemon terminal:

    tokens              list clients (id, name, fingerprint, created/last-used; no tokens)
    revoke <id>         revoke one client; its next request gets 401 immediately
    revoke-all          revoke every client
    pending             list pairing requests awaiting approval
    pair                generate a new code (invalidates the old one)
    quit                stop the daemon

State defaults to `~/.phone-as-tool/tokens.json`, containing only token hashes and client metadata,
mode 0600 on POSIX systems. Override with `--state-dir` or `PHONE_AS_TOOL_STATE_DIR`.

## Configuration

| Flag / env | Default | Notes |
| --- | --- | --- |
| `--host` / `PHONE_AS_TOOL_HOST` | first private IPv4 | only private IPv4 or `127.0.0.1` |
| `--port` / `PHONE_AS_TOOL_PORT` | `8765` | `0` picks an ephemeral port (tests) |
| `--state-dir` / `PHONE_AS_TOOL_STATE_DIR` | `~/.phone-as-tool` | token state directory |
| `PHONE_AS_TOOL_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

`GET /health` returns `{"ok":true,"name":"phone-as-tool","version":"..."}` with no secrets.

## Security properties

- LAN-only bind: `0.0.0.0`, public and IPv6 binds are refused; peers outside loopback / RFC1918 /
  IPv6 ULA or link-local are refused.
- Pairing: a single-use 6-digit code plus explicit device approval; at most 5 wrong code attempts and
  3 pending approvals.
- Tokens: one random 256-bit token per client, only its hash is stored, revocation is immediate, and
  tokens never go in URLs.
- Logs: structured JSON on stderr with method, path (no query string), status, duration, peer address
  and client id only; tokens, pairing codes and request headers are not logged. A regex redaction
  layer is a second line of defense.
- Body limits: 16 KiB for pairing, 4 MiB for MCP; HTTP request timeout is 90 seconds.

## M1 limits (honest scope)

- **No real-device verification**: M1 has no Android backend; every test and demo uses `FakeDevice`.
  The real device channel belongs to M2.
- **Claude Code / Cursor were not run in this environment**: acceptance uses the official MCP
  TypeScript client and the repository's own client. Real client setup and troubleshooting are
  issue #5.
- **No QR image rendering**: M1 prints the `phonetool://pair?...` URI and the 6-digit code; QR
  rendering belongs to the Android app UI (M2). The code already satisfies the M1 "QR or pairing
  code" acceptance item.
- **M1 uses plain LAN HTTP**: there is no TLS. Pair and operate on trusted Wi-Fi only, never on a
  public network. Tokens never go in URLs, but same-network sniffing remains a transport-security
  concern for a later milestone.
- **ui_tree budget and action-effect typing**: issue #2 provides the tool skeleton and basic output;
  pruning/token budgets are issue #3 and observed-effect typing is issue #4.
- **M2 items**: app allowlist, dangerous-action confirmation, audit log, kill switch, Android
  Keystore, and reconnect/background/network-switch handling are not implemented yet.

## Verification

    npm ci
    npm run build
    npm test

Tests cover LAN address classification and bind refusal, Host/Origin guards, pairing code / explicit
approval / denial / timeout / wrong-attempt behavior, hashed token persistence and revocation, tokens
absent from logs and the state file, a real MCP client connecting and listing all six tools,
`ui_tree` / `screenshot` calls, and the terminal CLI flow of showing a code → explicit `y` approval →
revocation.

Security-related changes (pairing, tokens, LAN boundary) require explicit human approval in the PR
before merge.
