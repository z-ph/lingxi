# Benchmark

[简体中文](../benchmark.md) | [English](benchmark.md)

How we prove the thing works — and how contributors compare approaches. M3 benchmark code and reference baseline are implemented: the
30-task set, harness and reference results live in [`benchmark/`](../../benchmark/), and the root
README publishes the result table. The current publication is a **FakeDevice + deterministic
scripted-agent reference baseline**; real-device and real-model numbers are pending M1/M2 and a real
client.

## Task set (30)

- 10 simple: open an app, read a value on screen, toggle a setting, copy text from a screen.
- 10 multi-step: search -> filter -> open detail -> act; fill a form; retry a failed load.
- 10 cross-app: reason across two apps (e.g. read a code from messages, enter it in another app).

Each task ships with: goal text, starting state, success predicate, dangerous-action label
(if any), and environment requirements. Task definitions live in
[`benchmark/src/suite/`](../../benchmark/src/suite/); goal, initial state, predicate and danger marker
are reviewable in one place.

## Metrics

| Metric | Definition |
| --- | --- |
| Success rate | tasks passing success predicate / total |
| Steps | tool calls per task |
| Elapsed time | task start -> success predicate true |
| Tokens | input+output attributed to the controlling agent |
| Action accuracy | daemon actions whose observed effect matched intent |
| Dangerous-action rate | attempts to trigger a gated action without confirmation (must be 0) |
| Recovery rate | failed action -> recovered without human help |

## Method

- Record device (model, OS version, screen size), network, and agent/model versions.
- Run each task 5x; report median and p95; publish raw logs.
- Separate "daemon quality" (action accuracy) from "model quality" (planning), so results are
  comparable across agents.

## Implementation (M3)

- **Task set**: 10/10/10 tasks under [`benchmark/src/suite/`](../../benchmark/src/suite/), each with
  goal text, starting state, fixed environment, declarative success predicate, danger marker,
  step/time limits and a reference trace.
- **Fixed environment**: 12 fixture apps, one FakeDevice profile (Pixel 6a / Android 14 /
  1080x2400 / en-US), fixed action latencies, no randomness; the world resets at the start of every
  task.
- **Runner**: [`benchmark/src/runner.ts`](../../benchmark/src/runner.ts) reports success rate, steps,
  elapsed time, tokens, action accuracy, dangerous attempts and recovery; five runs per task by
  default, with median and p95.
- **Danger gate**: fixture payment/delete/send nodes require confirmation at the tool layer; an
  unconfirmed attempt is recorded and marks the run unsafe, so reaching the goal still does not
  pass.
- **Public logs**: every tool call, argument and result lands in `runs.jsonl` under
  [`benchmark/results/`](../../benchmark/results/); device/network/model context lands in
  `environment.json`.
- **Reproduction**: `cd benchmark && npm ci && npm test && npm run bench -- --repeat=5`. A real
  model can use `--agent=openai` (OpenAI-compatible endpoint), but CI needs no key and runs no
  model.

The current baseline proves that the task set, predicates, danger gate and metric pipeline work; it
does not touch a real phone or a real model and must not be read as a product-availability or model
capability result. Real-device runs need a Device backend plus a "real state -> success predicate"
adapter, which follows M1/M2.
