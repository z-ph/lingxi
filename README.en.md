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

## Benchmark (M3 reference baseline)

30 fixed tasks (10 simple / 10 multi-step / 10 cross-app), five runs each. **The table below is a
FakeDevice + deterministic scripted-agent reference baseline. It validates the task set and harness;
it is not a real-phone or real-model result.** Real-device and real-model numbers are pending M1/M2
and a real client; see [`benchmark/README.md`](benchmark/README.md) for methodology, task definitions
and reproduction commands.

| Category | Tasks | Runs | Success | Steps median | Steps p95 | Time median | Tokens median | Dangerous actions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 10 | 50 | 100.0% | 3.0 | 3.0 | 620.0 ms | 152.5 | 0 |
| Multi-step | 10 | 50 | 100.0% | 6.0 | 7.0 | 800.0 ms | 300.5 | 0 |
| Cross-app | 10 | 50 | 100.0% | 9.0 | 13.0 | 1430.0 ms | 430.0 | 0 |
| Overall | 30 | 150 | 100.0% | 6.0 | 10.0 | 800.0 ms | 300.5 | 0 |

| Item | Value |
| --- | --- |
| Device | FakeDevice profile: Pixel 6a / Android 14 / 1080x2400 @ 420dpi / en-US |
| Network | in-process simulated Wi-Fi, 0 ms RTT, no sockets / pairing / LAN |
| Model | `scripted-reference-v1` (deterministic reference policy, no language model; estimated context tokens) |
| Action accuracy | 100.0% (815/815 write actions) |
| Recovery | 100.0% (5/5 failed actions) |
| Elapsed-time basis | sum of fixed simulated action latency, not wall time |
| Raw logs | [`benchmark/results/2026-11-10-reference-baseline/`](benchmark/results/2026-11-10-reference-baseline/) (`runs.jsonl` holds all 150 runs with every tool call) |

## Docs

- [Vision](docs/vision.md) — problem, users, wedge, success metrics
- [Roadmap](docs/roadmap.md) — milestones and acceptance criteria
- [MCP tool surface](docs/mcp-tools.md) — the contract agents see
- [Security](docs/security.md) — threat model and safety requirements
- [Benchmark](docs/benchmark.md) — how we measure success
- [Benchmark harness and results](benchmark/README.md)
- [FAQ](docs/en/faq.md) — root/developer mode, data, Android versions

## Contributing

See [AGENTS.md](AGENTS.md) for how work is done in this repository (humans and agents alike).
Early days: please open an issue with the task you want automated.

## License

MIT
