# Vision

## Problem

Agents are becoming capable enough to do work, but on a phone they have no interface. Real
Android apps have no stable API, emulators cannot reproduce the user's accounts and state, and
cloud phone farms require surrendering the device. Meanwhile desktop agents (Claude Code, Cursor,
DSH) are already where people run their most capable models — they just cannot reach the phone.

## Users (in order)

1. **Agent power users** — people already running coding/agent clients who want the phone as one
   more tool (send the file I just downloaded, check my notifications, drive this app).
2. **Mobile QA / automation** — teams that currently maintain Appium scripts; an agent plus a
   stable device daemon replaces brittle selectors with on-demand judgement.
3. **Accessibility / family support** — helping someone operate their own phone remotely, with
   data staying on the device. (Later; privacy requirements are strict.)

## Wedge

**Phone as a tool**, not phone as an assistant.

- System-level assistants (Apple/Google/OEM) own "the phone's own brain"; we own "an agent's hands
  for a phone".
- Remote-control products (scrcpy/ADB/cloud phones) require developer mode, USB, or device
  surrender; accessibility + LAN pairing is the consumer-viable path.
- Existing MCP servers either need ADB/USB (fragile setup) or run inside the phone and cannot use
  the strong model the user already pays for.

## Success metrics

- A new user goes from APK to "my agent clicked something on my phone" in under 5 minutes.
- Tool-call success rate >= 99% (the daemon's own actions, independent of model choice).
- UI tree payload median < 3k tokens, p95 < 8k tokens.
- No incident where an unauthorized client operated a phone.
- 30-task benchmark: document success rate, steps, latency, tokens (see benchmark.md).

## Risks

- Platform policy: accessibility is a sensitive permission; distribution will be sideload/enterprise.
- App-side anti-automation detection.
- Prompt injection from on-screen content into the controlling agent (see security.md).
- Safety incidents (payments, deletions) damaging trust.
