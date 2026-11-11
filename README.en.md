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

## Non-goals

- Not a hosted cloud service. No account required to use your own phone.
- Not a general "do anything" assistant. We start where users are technical and tasks are repeatable.
- Not iOS. There is no equivalent public accessibility surface.

## Docs

- [Vision](docs/en/vision.md) — problem, users, wedge, success metrics
- [Roadmap](docs/en/roadmap.md) — milestones and acceptance criteria
- [Architecture and tech stack](docs/en/architecture.md) — layout, layers, single source of truth
- [MCP tool surface](docs/en/mcp-tools.md) — the contract agents see
- [Security](docs/en/security.md) — threat model and safety requirements
- [Benchmark](docs/en/benchmark.md) — how we measure success
- [CI gates](docs/en/ci-gates.md) — machine checks and usability probes
- [Architecture review](docs/en/architecture-review.md) — cadence and checklist
- [30-second demo](docs/en/demo.md) — task, script and recording plan
- [FAQ](docs/en/faq.md) — root/developer mode, data, Android versions

## Contributing

See [AGENTS.en.md](AGENTS.en.md) for how work is done in this repository (humans and agents alike).
Early days: please open an issue with the task you want automated.

## License

MIT
