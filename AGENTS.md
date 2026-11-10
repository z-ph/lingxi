# AGENTS.md — how work happens here

This repository is operated by a proactive agent (dsh-superagent) under human ownership. Humans
and agents follow the same rules.

## Source of truth

docs/ is the contract. Code follows docs; if a change requires a different design, update the doc
in the same PR and say why. README.md is the product statement — keep it true to reality.

## Scope discipline

- One issue -> one PR. Only change what the issue asks; file follow-ups for the rest.
- Until M1 code exists, docs-only contributions are the default.
- Do not change: license, repository settings, topics, release/tagging, CI provider, branding.
  These need human approval.
- Never add dependencies without a stated reason and a size/licensing note.
- Never push to main; open a PR. Never merge your own PR; never enable auto-merge.

## Milestones

Work must name its milestone (M0-M4, see docs/roadmap.md). Do not start a later milestone before
the current one meets its acceptance criteria.

## Engineering standards

- Branch prefix: agent/<ticket-name>; humans may use their own names too.
- Commits: imperative subject; body explains the why; reference the issue.
- Every PR states: milestone, what changed, how it was verified, what is out of scope.
- When code exists: it must build and pass tests before review; add a test for behavior changes.
- Security-sensitive changes (see docs/security.md) require explicit human approval in the PR.

## Communication

- Issue/PR text: English. User-facing summaries to the owner: Chinese.
- Ask a human only when a decision is needed; otherwise proceed and document the assumption.
- Do not post progress updates; deliver results.

## First tasks

M0 remaining: demo script + recording plan. Then M1. See the backlog issues for the current queue.
