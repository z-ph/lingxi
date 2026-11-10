# AGENTS.md — how work happens here

This repository is operated by a proactive agent (dsh-superagent) under human ownership. Humans
and agents follow the same rules.

## Source of truth

docs/ is the contract. Code follows docs; if a change requires a different design, update the doc
in the same PR and say why. README.md is the product statement — keep it true to reality.

## Scope discipline

- One issue -> one PR. Only change what the issue asks; file follow-ups for the rest.
- We are in M1: implementation code is expected and pre-authorized; new directories, packages and
  config files are in scope without a separate approval.
- Never decline an issue because it "needs new code", "needs a real device" or "cannot be verified in
  this environment". Device-dependent acceptance items are covered by a fake device adapter and
  automated tests, and any limitation that cannot be verified in the repo is stated honestly in the PR.
- Do not change: license, repository settings, topics, release/tagging, CI provider, branding.
  These need human approval.
- Never add dependencies without a stated reason and a size/licensing note.
- Never push to main; open a PR.
- Merge policy: a PR may be merged by the worker only after a human has explicitly approved it on GitHub. Never merge without human approval, never self-approve, never enable auto-merge.
- Default to squash merge: one PR becomes one commit on main, keeping history linear.
- The PR body must contain an English closing keyword line (e.g. Closes #12) so GitHub closes the issue automatically on merge. Use Refs #12 with a reason when the issue should stay open. Do not close issues by hand after merge unless the PR lacked the keyword.

## Budget

The model provider (opencode-go / deepseek-v4.1-flash) has a very ample token budget. Do not stop early, skip context, skip verification, or hand back a draft to save tokens or time; optimize for correctness and completeness, and keep full technical evidence in the PR.

## Milestones

Work must name its milestone (M0-M4, see docs/roadmap.md). **M0 is complete; the current milestone is
M1.** Do not start a later milestone before the current one meets its acceptance criteria.

The shape of M1 is already decided — no further discussion or approval is needed:

- The MCP daemon is implemented in TypeScript / Node, with the repository root as the package root
  (`package.json`, `src/`, `test/`).
- All device access goes through a `Device` adapter. M1 ships `FakeDevice`: in-memory, scriptable,
  assertable, so tests never need a real phone.
- The Android device backend (Termux / ADB) belongs to M2 and is out of scope for M1.
- M1 acceptance is proven by `npm ci && npm test` (plus `npm run build`); the PR body states the
  "not verified on a real device" limitation.

## Engineering standards

- Branch prefix: agent/<ticket-name>; humans may use their own names too.
- Commits: imperative subject; body explains the why; reference the issue.
- Every PR states: milestone, what changed, how it was verified, what is out of scope.
- When code exists: it must build and pass tests before review; add a test for behavior changes
  (applies from M1 on: `npm ci && npm run build && npm test` must pass).
- Security-sensitive changes (see docs/security.md) require explicit human approval in the PR.

## Communication

- Issue/PR text: English. User-facing summaries to the owner: Chinese.
- Ask a human only when a decision is needed; otherwise proceed and document the assumption.
- Do not post progress updates; deliver results.

## First tasks

M0 is complete (vision, contract, security, benchmark, rules, demo script and FAQ are all merged).

Current queue: M1 issues #2-#5 (daemon skeleton and pairing, ui_tree token budget, action result
read-back, one-line client config).
