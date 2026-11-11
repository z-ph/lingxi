# Architecture and norm review

Status: finalised for M0 (issue #18). Norms are in [architecture.md](architecture.md); machine gates
are in [ci-gates.md](ci-gates.md). This document defines **when, by whom and against which checklist**
we check whether the norms and architecture have drifted.

## 1. Purpose

Gates only catch problems already encoded as rules. Project decay usually starts outside the rules:

- docs still describe M0 while code has invented new boundaries;
- new packages, dependencies and “temporary” directories accumulate;
- the same logic is copied in several places, and the gate only finds exactly identical files;
- CI gates are quietly weakened, or probes were broken and nobody noticed;
- assumptions survive past a milestone and are never re-checked.

Periodic review is a fixed checkpoint for these “not machine-checkable but cumulative” problems, and
turns findings into issues/PRs with an owner.

## 2. Cadence

Review is required:

1. **Every month**: on the 1st, `.github/workflows/architecture-review.yml` opens a review issue; it
   will not create a duplicate while an open review issue exists.
2. **After every milestone acceptance**: after the M1, M2, M3 acceptance PR merges, review docs,
   package layout and acceptance conclusions for consistency.
3. **On structural change**: adding/removing packages, changing layers or dependency direction, adding a
   runtime dependency, or changing the MCP contract/security boundary requires an architecture review
   record in the same PR (not necessarily a separate issue).
4. **After an incident or regression**: unauthorized access, token leakage, silent action failures or a
   persistently red CI trigger a check for missing rules.

Closing a review issue is not permanent completion; the next month/milestone creates a new one.

## 3. Automatic reminder

`.github/workflows/architecture-review.yml`:

- `schedule`: 01:00 UTC on the 1st of every month;
- `workflow_dispatch`: maintainers can trigger it at any time;
- creates an issue titled `[架构巡检] YYYY-MM 规范与架构巡检` with the GitHub Actions token;
- skips when an open `[架构巡检]` issue already exists, avoiding noise;
- the issue body links this document and lists the minimum commands; it does not copy the full
  checklist (avoiding dual sourcing).

If the reminder stops (Actions disabled, missing permissions, etc.), a maintainer opens the issue
manually using this document. “No automatic issue” is not a reason to skip review.

## 4. Checklist

Give a conclusion for every item; “looks fine” is not a conclusion. Each item is either “no change
needed + why” or a link to a follow-up issue/PR.

### 4.1 Docs and reality

- [ ] README / README.en product statements and milestone status match the code.
- [ ] [mcp-tools.md](mcp-tools.md) tool names, arguments and error types match the implementation.
- [ ] [security.md](security.md) requirements are not silently bypassed; unimplemented items have a
  milestone.
- [ ] [architecture.md](architecture.md) package table, layers, `mayDependOn` and machine contract match
  `packages/`.
- [ ] Every Chinese doc has an English mirror; no orphan mirrors; language links work.
- [ ] No second machine contract, duplicated norm paragraph or contradictory default.
- [ ] The README index covers every primary document.

### 4.2 Package layout and layering

- [ ] `packages/*` contains only registered packages; no root-level product source or wild directories.
- [ ] Each package has one responsibility; cross-package dependencies obey layer numbers with no cycles,
  deep imports or entry-point bypasses.
- [ ] `contracts` has no I/O; `device` has no MCP/auth/safety policy; `daemon` has no native Android
  calls.
- [ ] `benchmark` is not depended on by product packages; `tools/` is not imported by product packages.
- [ ] Public entry points and `exports` are clear; other packages do not reach into internals.

### 4.3 Dependencies and supply chain

- [ ] New runtime dependencies register purpose, licence and `allowedIn`; versions are pinned by the
  root lockfile.
- [ ] No two dependencies do the same thing; no large library for one small function.
- [ ] Dependencies are maintained; known high-severity vulnerabilities or stale dependencies have a
  remediation plan.
- [ ] No `node_modules/`, per-package lockfiles or unused dependencies are committed.
- [ ] Dependency licences still fit architecture.md (copyleft requires human approval).

### 4.4 DRY and complexity

- [ ] No cross-package copy-paste; shared logic moved down to an allowed layer or `contracts`.
- [ ] No god module: files over roughly 400 lines with several responsibilities are split or explained.
- [ ] Patterns repeated three or more times are extracted; two similar places that will evolve
  independently are not forced into an abstraction.
- [ ] Error handling, defaults and protocol fields have one definition.
- [ ] Deleted code left no dead branches, stale TODOs or “temporary” switches.

### 4.5 Tests and gates

- [ ] `npm ci && npm run format:check && npm run gate && npm test && npm run build && npm run typecheck` is green.
- [ ] Gate probes still trigger their expected rules on fixtures; no rule was silently broken.
- [ ] No `continue-on-error`, deleted steps or shrunken scan scope bypasses a gate.
- [ ] CI duration, Node matrix and caching remain reasonable; new packages are covered by workspace
  commands.
- [ ] Behaviour changes have tests; real-device limitations are recorded honestly in PRs.

### 4.6 Security and boundaries

- [ ] Pairing, tokens, LAN binding and log redaction are not bypassed by new code.
- [ ] Dangerous-action allowlist/confirmation/audit (from M2) still runs in `daemon`; device layers have
  no safety branches.
- [ ] Screenshots, UI trees, notifications and other sensitive data did not enter logs, test fixtures or
  commit history.
- [ ] Security-sensitive changes have explicit human approval in the PR.

### 4.7 Open items and assumptions

- [ ] Backlog, issues and PRs contain no ignored item that conflicts with these norms.
- [ ] “Undecided/assumed” notes have an owner and trigger condition; stale assumptions are updated.
- [ ] Findings from the previous review are closed or have an explicit blocker.
- [ ] The current milestone's acceptance items were not skipped with “merge now, fix later”.

## 5. Commands

Run in a clean worktree:

```text
npm ci
npm run format:check
npm run gate
npm test
npm run build
npm run typecheck
```

Machine-readable gate output:

```text
node packages/architecture-gate/src/cli.mjs --format json
```

Use `git ls-files` and `npm ls --all` for statistics where useful. Never paste screenshots or logs
containing personal data into an issue.

## 6. Recording and closing

- The review issue records date, reviewer (human or agent), command result summary and a conclusion per
  checklist item.
- Findings are:
  - **Fix now**: security, data or red-line violations — open a PR and merge through normal review;
  - **Schedule**: structural problems and debt — open an issue with milestone and acceptance, linked
    from the review issue;
  - **Record, no change**: an explicit trade-off — state the reason and re-check condition; “not now” is
    not enough.
- Before closing, every finding has an issue/PR link or a “no change” reason; otherwise keep it open.
- Architecture changes still follow section 7 of [architecture.md](architecture.md): update the machine
  contract, add probes, same PR.
- Decisions about security or product scope are approved by the human owner; the agent does not expand
  scope by itself.

## 7. Exit criteria

A review is complete only when:

- [ ] every item in section 4 has a conclusion;
- [ ] gates and probes are green, or rule defects are fixed;
- [ ] there are no unregistered packages, dependencies or cross-layer calls;
- [ ] every finding has an owner (PR, issue or explicit no-change reason);
- [ ] the review issue records the conclusions and is closed;
- [ ] human-decision items are clearly marked and not pretended to be resolved.
