# Benchmark

How we prove the thing works — and how contributors compare approaches. Numbers go in the README
once M3 lands; until then this is the spec.

## Task set (30)

- 10 simple: open app, read a value on screen, toggle a setting, copy text from a screen.
- 10 multi-step: search -> filter -> open detail -> act; fill a form; retry a failed load.
- 10 cross-app: reason across two apps (e.g. read a code from messages, enter it in another app).

Each task ships with: goal text, starting state, success predicate, dangerous-action label
(if any), and environment requirements.

## Metrics

| Metric | Definition |
| --- | --- |
| Success rate | tasks passing success predicate / total |
| Steps | tool calls per task |
| Wall time | task start -> success predicate true |
| Tokens | input+output attributed to the controlling agent |
| Action accuracy | daemon actions whose observed effect matched intent |
| Dangerous-action rate | attempts to trigger a gated action without confirmation (must be 0) |
| Recovery rate | failed action -> recovered without human help |

## Method

- Record device (model, OS version, screen size), network, and agent/model versions.
- Run each task 5x; report median and p95; publish raw logs.
- Separate "daemon quality" (action accuracy) from "model quality" (planning), so results are
  comparable across agents.
