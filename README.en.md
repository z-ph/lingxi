# Phone as Tool (Phone as Tool)

**Your Android phone, as a tool for AI agents.**

Phone as Tool turns a real Android device into a local MCP device daemon: an agent running on your
laptop or in the cloud gets eyes and hands on your actual phone — screenshot, UI tree, tap, type,
swipe, launch app, wait for UI — on your real apps, without emulators, USB cables or ADB debugging.

> **Status: pre-alpha.** There is no usable build yet. This repository starts with the charter,
> specs and backlog; implementation lands milestone by milestone.

## Why

Coding agents already run on your computer. The missing piece is the phone:

- Most apps have no API. WeChat, 小红书, 美团, banks — the only interface is pixels and taps.
- Emulators cannot reach the real apps, accounts and device state that matter.
- Cloud phone-control products require handing over the device; most people will not.
- The agent ecosystem (Claude Code, Cursor, DSH, ...) speaks MCP; phones do not.

Phone as Tool closes that gap on the phone itself, under your control.

## How it works (intended)

    Agent (Claude Code / Cursor / DSH / cloud)
            |  MCP over LAN  (pairing token)
            v
    Phone as Tool app on your Android phone
            +- Accessibility service: UI tree, tap, swipe, type, back/home
            +- Screen capture: screenshots on demand
            +- App control: list / launch / foreground detection
            +- Audit log + allowlist + confirmation gate

Design principles:

- **Local-first** — the phone's screen, pixels and data stay on the device; only what the agent
  explicitly asks for crosses the wire.
- **Bring your own agent and model** — any MCP client works; the phone never needs to run a model.
- **Safe by default** — LAN-only bind, pairing token, empty app allowlist by default, explicit
  confirmation for destructive or payment actions, full audit log, one-tap kill switch.
- **Deterministic where possible** — record a flow once, replay it deterministically; the model
  handles only recovery and new situations.

## Connect an MCP client

> **M1 developer preview.** The daemon is TypeScript / Node and runs on your computer, with a
> FakeDevice standing in for the phone; the Android app and real-device channel are M2, so the
> project is still pre-alpha. The client configuration below is the same for the M1 preview and the
> later phone build.

### 1. Pair, then note the address and token

In Phone as Tool, tap "Connect an agent" to see the LAN address, a 6-digit pairing code and a QR
code. Enter the address and code on the client machine; after you explicitly approve the request on
the phone, the client receives a one-time token (`pat_...`). The token is shown once and the server
stores only its hash; if you lose it, revoke the client and pair again.

In the M1 developer preview the daemon runs on your computer (Node.js >= 20):
`npm ci && npm run build && npm start` prints the LAN address, the MCP endpoint and a 6-digit code.
In another terminal, pair with that code:

```bash
npm run pair -- --url http://<LAN IP>:8765 --code <code> --name "Claude Code"
```

Type `y` in the daemon terminal to approve; the pairing command prints the one-time token. Run the
pairing command on the daemon's computer if you like, then copy the token into the client's config.

### 2. Claude Code

Install Claude Code first and make sure `claude` is on PATH. macOS, Linux and Windows (PowerShell or
CMD) all use the same command; replace the address and token with the values from the previous step:

```bash
claude mcp add --transport http phone-as-tool --scope user http://<LAN IP>:8765/mcp --header "Authorization: Bearer <token>"
```

`--scope user` makes the server available in every project; drop it to use the current project only.
Check it with:

```bash
claude mcp list
```

`✔ Connected` means it works. Remove it with
`claude mcp remove phone-as-tool --scope user`.

### 3. Cursor

Install the Cursor desktop app first. Edit the global config: `~/.cursor/mcp.json` on macOS,
`%USERPROFILE%\.cursor\mcp.json` on Windows (in PowerShell, `$env:USERPROFILE\.cursor\mcp.json`).
Create the file or directory if needed: `mkdir -p ~/.cursor` on macOS,
`New-Item -ItemType Directory -Force "$env:USERPROFILE\.cursor"` in PowerShell. Add an entry under
`mcpServers`; this one-line version can be pasted after replacing the placeholders:

```json
{"mcpServers":{"phone-as-tool":{"url":"http://<LAN IP>:8765/mcp","headers":{"Authorization":"Bearer <token>"}}}}
```

Keep any other servers and add only `phone-as-tool`. Save the file and restart Cursor, or toggle the
server off and on under Customize > MCPs; the Agent's tool list should show `screenshot`, `ui_tree`,
`tap` and the other tools. A project-level `.cursor/mcp.json` also works, but it is committed to the
repository: do not commit a config containing the token — prefer the global config.

### 4. Verify

- Claude Code: `claude mcp list` shows `✔ Connected`; `/mcp` in a session lists the tools.
- Cursor: the server looks healthy under Customize > MCPs; ask the Agent to call `ui_tree` and it
  returns a UI tree.
- Health check: open `http://<LAN IP>:8765/health` in a browser; it should return `{"ok":true,...}`.

## Troubleshooting

### Discovery: cannot find the phone / cannot connect

- The phone and the client machine must be on the same LAN (same Wi-Fi / router). Guest networks and
  some corporate or hotel Wi-Fi enable AP isolation, so devices cannot see each other; test with a
  phone hotspot or a home router.
- Use the address shown by Phone as Tool; in the M1 preview use the "LAN address" printed by the
  daemon. `127.0.0.1` only works when the daemon binds loopback (`npm start -- --host 127.0.0.1`)
  and the client runs on the same machine.
- M1's Host guard only accepts the address the daemon is bound to; use the IP, not `localhost`, a
  hostname or an alias (unless that is what the daemon is bound to).
- Check reachability first: `ping -c 3 <IP>` and `nc -vz <IP> 8765` on macOS; `ping <IP>` and
  `Test-NetConnection <IP> -Port 8765` on Windows.
- Open `http://<IP>:8765/health` in a browser or with `curl`: a JSON response means the service is
  reachable; a timeout or refused connection points at the firewall section below.
- Turn off VPNs and proxies, or exclude the LAN subnet from them; `HTTP_PROXY` / `HTTPS_PROXY` can
  also capture MCP requests.
- macOS 15+ asks for Local Network permission the first time an app touches the LAN. If you denied
  it, allow Terminal / Cursor / Claude Code under System Settings > Privacy & Security > Local
  Network.
- On Windows set the network profile to Private; the Public profile blocks inbound connections.
- M1 does not do mDNS discovery; the address is the IP shown by the app or daemon. If a multi-homed
  machine (VPN, Docker, VM) picks the wrong address, use `npm start -- --host <IP>` or
  `PHONE_AS_TOOL_HOST=<IP>`.
- When Claude Code / Cursor runs inside WSL, confirm WSL can reach that LAN IP; otherwise use the
  native Windows client.

### Tokens: 401 / pairing failure / lost token

- `401 Unauthorized` means the token is missing, wrong or revoked. Put the token in the
  `Authorization: Bearer <token>` header, never in the URL.
- The 6-digit pairing code is valid for 5 minutes and single-use (M1 preview); too many wrong
  attempts or a timeout ends it, so generate a new one in the app or daemon.
- The pairing request needs explicit approval on the device (M1 preview: type `y` in the daemon
  terminal); it times out after 60 seconds without approval (M1 preview).
- The token is shown once and the server stores only its SHA-256 hash; if it is lost, revoke the
  client in the app or daemon and pair again — it cannot be recovered.
- If you suspect a leak, revoke the token immediately. In the M1 preview, `tokens` lists clients,
  `revoke <id>` revokes one and `revoke-all` revokes all; then pair again.
- Claude Code: `claude mcp get phone-as-tool` shows the status; if the config is broken,
  `claude mcp remove phone-as-tool --scope user` and add it again.
- Cursor: restart after editing `mcp.json`; open Output > MCP Logs for the exact error; remove and
  re-add the server to force a reconnect.

### Firewall: timeouts / connection refused

- The machine running the daemon must allow inbound TCP 8765. In the M1 preview the daemon runs on
  your computer, so check that computer's firewall; for the phone build, check that the phone and
  router allow LAN traffic.
- macOS: System Settings > Network > Firewall > Options, allow `node` to accept incoming
  connections; temporarily disable the firewall to confirm.
- Windows: the first Node.js run prompts for firewall access; allow it on Private networks. If you
  missed the prompt, open Windows Security > Firewall & network protection > Allow an app through
  firewall and enable Node.js. An administrator PowerShell can also add the rule:
  `New-NetFirewallRule -DisplayName "Phone as Tool" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Private`
- Linux: with ufw enabled, run `sudo ufw allow 8765/tcp`.
- Open only 8765. Do not bind the daemon to `0.0.0.0` or the public internet while troubleshooting:
  M1 binds a private IPv4 or loopback address only.
- Corporate networks or routers may block device-to-device traffic; test on another network to rule
  out the network policy.

### Phone sleep: idle disconnects / request timeouts

- Android Doze / battery optimization suspends background apps and can drop Wi-Fi. Disable battery
  optimization for Phone as Tool (Settings > Apps > Phone as Tool > Battery > Unrestricted) and keep
  the phone charging and awake during a session.
- Some vendors (Xiaomi, Huawei, OPPO, vivo, ...) restrict background apps after the screen locks;
  allow Phone as Tool to auto-start / run in the background, and turn off power-saving options such
  as "keep Wi-Fi on during sleep" in the advanced Wi-Fi settings.
- After the phone sleeps, client requests time out; wake the phone, confirm the app or daemon is
  still running, and retry. The phone build's foreground service and automatic reconnect are M2
  reliability items and do not exist yet.
- In the M1 preview the daemon runs on your computer: computer sleep / closing the lid disconnects
  it too. Use `caffeinate` on macOS, set the Windows power plan to "Never" sleep, or change it
  temporarily while troubleshooting.

## Non-goals

- Not a hosted cloud service. No account required to use your own phone.
- Not a general "do anything" assistant. We start where users are technical and tasks are repeatable.
- Not iOS. There is no equivalent public accessibility surface.

## Docs

- [Vision](docs/vision.md) — problem, users, wedge, success metrics
- [Roadmap](docs/roadmap.md) — milestones and acceptance criteria
- [MCP tool surface](docs/mcp-tools.md) — the contract agents see
- [Security](docs/security.md) — threat model and safety requirements
- [Benchmark](docs/benchmark.md) — how we measure success
- [FAQ](docs/en/faq.md) — root/developer mode, data, Android versions

## Contributing

See [AGENTS.md](AGENTS.md) for how work is done in this repository (humans and agents alike).
Early days: please open an issue with the task you want automated.

## License

MIT
