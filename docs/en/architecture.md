# Tech stack and architecture norms

Status: finalised for M0 (issue #18). This document is the single source of truth for the **tech
stack, repository layout, package boundaries, dependency direction and architecture norms**. Code, CI
gates and reviews follow it; architecture changes require a PR that updates this document.

What the product does and why is covered by [vision.md](vision.md) and
[README.en.md](../../README.en.md); this document does not repeat the product narrative. It answers
where functionality lives, how it is implemented, and which dependencies are allowed.

## 1. Functional scope

### 1.1 Product boundary

Phone as Tool exposes device-control capabilities on an Android phone to AI agents through a
LAN-only MCP: see the screen, read the UI tree, tap/swipe/type, launch apps, wait for UI changes,
plus pairing, safety gates, audit and benchmarking.

Scope and non-goals are defined by [vision.md](vision.md). This document only maps **functional
domains to code boundaries**.

### 1.2 Domains and ownership

| Domain | Contents | Owner |
| --- | --- | --- |
| Protocol contract | MCP tool names, input/output schemas, error codes, pairing/transport constraints | `contracts` |
| Device capability | UI tree/screenshot, tap, swipe, type, launch app, wait | `device` |
| Session and access | LAN binding, pairing, tokens, MCP transport, request validation | `daemon` |
| Policy and safety | App allowlist, dangerous-action confirmation, audit, kill switch (M2) | `daemon` |
| Output governance | ui_tree pruning, token budget, text truncation (M1 #3) | `daemon` |
| Evaluation | Task set, simulated devices/apps, metrics and reports (M3) | `benchmark` |
| Android host | Accessibility service, foreground service, permissions, app UI, Keystore (M2) | `apps/android` |
| Repository infrastructure | Architecture gate, probes, CI checks | `architecture-gate` |

### 1.3 Logical runtime shape

```text
MCP client (Claude Code / Cursor / DSH / cloud agent)
        │  MCP over LAN (pairing token)
        ▼
daemon: transport, sessions, policy, tool orchestration, ui_tree budget
        │  Device interface (in-process)
        ▼
device: FakeDevice (M1) / Android backend (M2)
        ▼
Android device
```

What is fixed is the **layering boundary**: `daemon` never calls Android APIs directly, `device`
never owns MCP, authentication or safety policy, and `contracts` performs no I/O. M1 validates the
protocol and tool semantics with a TypeScript/Node reference daemon and `FakeDevice`; M2 adds the
real-device channel. The host shape for the real-device channel (for example Node under Termux, or a
native Android host) is an M2 delivery decision, but the boundaries and package responsibilities
above do not change with it.

## 2. Tech stack

| Area | Choice | Constraint | Rationale |
| --- | --- | --- | --- |
| Language/runtime | TypeScript 5.9.x + Node.js | `engines.node` is `>=22`; CI covers Node 22 and 24 | Existing M1 decision; built-in HTTP/crypto/test are sufficient |
| Module format | ESM | `"type": "module"` in packages | Matches the official MCP SDK and Node ecosystem |
| Package management | npm workspaces | One root `package-lock.json` | No extra package manager; one lockfile |
| Build | `tsc` + shared `tsconfig.base.json` | No bundler | Output is the artifact; simple debugging |
| Tests | `node:test` + `node:assert/strict` | No test framework | Standard library is enough; CI runs it directly |
| Formatting | Prettier 3.9.x | `npm run format:check`; covers code/JSON/YAML, Chinese Markdown is not force-reflowed | Consistent formatting, less review noise; formatting does not replace linting |
| Static checks | `tsc --noEmit` + architecture gate | No ESLint for now | Small codebase; add dependencies and configs through 7.2 when needed, not idle tooling |
| MCP protocol | Official TypeScript SDK (currently `@modelcontextprotocol/server` / `@modelcontextprotocol/node`; `@modelcontextprotocol/client` for tests) | No hand-written JSON-RPC / Streamable HTTP | Protocol compatibility is a solved problem |
| Input validation | `zod` | Boundary schemas only | Matches the MCP SDK ecosystem; no hand-written validators |
| HTTP | Node built-in `http` + the official Node adapter | No Express/Koa/Fastify | A small LAN service; the standard library is enough |
| Android (M2) | Kotlin + Android SDK | Accessibility + foreground services; no Flutter/React Native | Needs system accessibility APIs and a low-overhead resident process |
| CI | GitHub Actions | See [ci-gates.md](ci-gates.md) | Existing repository platform; no vendor churn |
| Documentation | Markdown; Chinese primary + English mirror | Machine contract only in the Chinese primary | Avoids two sources |
| Storage (M1) | Local files with 0600 permissions; tokens stored as hashes only | No database | Single device, small state |
| Licence | Project MIT; dependencies limited to MIT/Apache-2.0/BSD/ISC | Copyleft dependencies require human approval | Keeps distribution and compliance risk bounded |

Exact versions are pinned by `package-lock.json`; this document records choices and major
constraints. Adding or replacing a technology requires updating this table, registering the dependency
in the machine contract in section 6, and running `npm run gate`.

## 3. Monorepo layout

```text
.
├── package.json                 # workspace root; toolchain and repository scripts only
├── package-lock.json            # the only lockfile
├── tsconfig.base.json           # shared strict TypeScript configuration
├── packages/
│   ├── contracts/               # planned M1: tool contract, error codes, shared schemas
│   ├── device/                  # planned M1: Device interface + FakeDevice
│   ├── daemon/                  # planned M1: MCP server, pairing, safety, ui_tree budget
│   ├── benchmark/               # planned M3: 30-task benchmark harness
│   └── architecture-gate/       # delivered M0: architecture/norm gate and probes (layer 99)
├── apps/
│   └── android/                 # planned M2: Kotlin host; Gradle build, not an npm workspace
├── docs/                        # Chinese primary docs; English mirror in docs/en/
├── tools/                       # optional: non-workspace temporary scripts; product code must not import them
└── .github/                     # workflows, issue/PR templates
```

Rules:

- **One package, one responsibility.** Package names are always `@phone-as-tool/<directory>`; all
  packages are `private: true`. This repository does not publish npm packages.
- **One lockfile only**: the root `package-lock.json`. Per-package `package-lock.json`, `yarn.lock`,
  `pnpm-lock.yaml` and `bun.lock*` are forbidden.
- **Internal dependencies use `workspace:*`** to avoid version drift, and may only point at packages
  registered in the machine contract.
- **Product source never lives at the repository root.** The root holds workspace/tooling config and
  docs; from M1 on, `src/` and `test/` live in a package.
- TypeScript packages provide a `tsconfig.json` extending the root `tsconfig.base.json`; a pure-JS
  tooling package (currently only `architecture-gate`) may omit it. Product packages expose entry
  points only (`src/index.ts` or `exports`); cross-package deep imports (`@phone-as-tool/x/src/...`)
  are forbidden.
- `apps/android` builds with Gradle separately and consumes only the JSON/schema contract of
  `contracts`; it does not import TypeScript source.
- Scripts under `tools/` are temporary repository tools; product packages must not depend on them.
  Long-lived tools belong in `packages/architecture-gate` or a dedicated package registered in the
  machine contract.

### 3.1 Package status

| Package | Layer | Status | Responsibility |
| --- | --- | --- | --- |
| `@phone-as-tool/contracts` | 0 | planned M1 | Tool names, schemas, error codes, cross-language contract |
| `@phone-as-tool/device` | 1 | planned M1 | `Device` interface, `FakeDevice`, later real-device backends |
| `@phone-as-tool/daemon` | 2 | planned M1 | MCP transport, pairing, auth, safety policy, ui_tree budget |
| `@phone-as-tool/benchmark` | 3 | planned M3 | Task set, simulated devices, metrics and reports |
| `@phone-as-tool/architecture-gate` | 99 | delivered M0 | Machine gate and probes (repository tooling, not product) |
| `apps/android` | — | planned M2 | Kotlin host: accessibility, foreground service, permissions, UI |

A “planned” package need not exist until its directory and `package.json` are created; once created,
it must match the machine contract in this document.

## 4. Layering rules

Lower layer numbers are further down; dependencies may only point at **lower layer numbers** and must
appear in that package's `mayDependOn` allowlist.

| Layer | Package | May depend on | Must not |
| --- | --- | --- | --- |
| 0 | contracts | nothing (types/constants/JSON schema only) | I/O, network, devices, auth |
| 1 | device | contracts | MCP, pairing/auth, safety policy, audit |
| 2 | daemon | contracts, device | Android native APIs, benchmark, tooling packages |
| 3 | benchmark | contracts, device, daemon | Be depended on by product packages |
| 99 | architecture-gate | nothing | Be depended on by any product package |

- `contracts` is the cross-language contract layer: TypeScript types/schemas and JSON test vectors;
  no runtime side effects, no Node-specific APIs.
- `device` only turns intent into device actions and reports observed results. Every device difference
  (fake, ADB, Termux, accessibility) is adapted here; `daemon` must not contain `if (android)` style
  branches.
- `daemon` owns protocol, sessions, policy and token budgets. Safety policy is defined only here and
  device layers must not bypass it.
- `benchmark` may reuse lower layers, but **product packages must not depend on benchmark**, keeping
  evaluation code out of release artifacts.
- `apps/android` is a separately built host. If it needs to exchange data with TypeScript packages, it
  does so only through the language-neutral schema/JSON in `contracts`; it does not duplicate business
  rules.
- Cross-layer calls, cycles and deep imports are blocked by `ARCH-001` / `ARCH-002`. Do not use
  relative paths to “get around” the layering.

## 5. Architecture norms

### 5.1 Single source of truth

Each kind of fact has exactly one authoritative definition; other places link to or reference it.

| Fact | Single source | Machine check |
| --- | --- | --- |
| Product scope, users, non-goals | [vision.md](vision.md) (README.en is the product summary) | Human review |
| MCP tool contract | [mcp-tools.md](mcp-tools.md) | Human review; contracts tests from M1 |
| Security requirements | [security.md](security.md) | Human review + security tests |
| Milestones and acceptance | [roadmap.md](roadmap.md) | Human review |
| Tech stack, layout, layers, dependency registry | This document (including the machine contract) | `npm run gate` |
| Gate rules and probes | [ci-gates.md](ci-gates.md) + gate code/tests | CI |
| Review cadence and checklist | [architecture-review.md](architecture-review.md) | CI file checks |
| Working rules | [AGENTS.md](../../AGENTS.md) | Human review |
| Exact versions | `package-lock.json` | `npm ci` |

Requirements:

- When documents reference a fact, link to it instead of restating the whole thing. Code comments do
  not redefine contracts; they point at the document/type.
- The machine contract (section 6 JSON) appears only in the Chinese primary document. This English
  mirror explains it and must not copy it; two copies count as dual sourcing and fail the gate.
- Changing behaviour or boundaries updates code, docs and tests in the same PR; no “merge code first,
  document later”.
- README is the product statement and must match reality; docs/ is the contract and code follows it.
- Tests are the executable source of truth for behaviour: what the docs allow, tests should prove;
  what the docs forbid, tests should block.

### 5.2 Do not reinvent the wheel

Priority: **platform/standard library → official SDK → well-maintained mature library → write it
yourself**. Writing it yourself is for project-specific device logic only.

Decided reuse:

- MCP protocol and transport use the official TypeScript SDK; no hand-written JSON-RPC, Streamable
  HTTP or session handshakes.
- HTTP services use Node's built-in `http` plus the official adapter; no web framework.
- Validation uses `zod`; no hand-written argument validators. Error types bind to schemas.
- Tests use `node:test`; no Jest/Vitest/Mocha.
- Cryptography, hashing and randomness use Node `crypto`; never implement cryptography yourself.
- Dates, paths and URLs use platform capabilities; do not add a utility library for one function.
- Android uses system accessibility/foreground-service APIs; no cross-platform UI framework imitating
  system capabilities.
- The architecture gate is deliberately dependency-free: CI must stay fast, auditable and immune to
  supply-chain failures.

Before adding a dependency, answer (in the PR):

1. Can an existing dependency or the standard library already do this? Is there an existing dependency
   with the same purpose?
2. Is it official/de-facto standard? How active is maintenance and how recent is the last release?
3. Are licence, install size and transitive dependency count acceptable?
4. How much code and risk would writing it ourselves add?
5. Has it been registered in `runtimeDependencies` in section 6 (purpose, licence, allowed packages)?

Keep one implementation per capability; two libraries doing the same thing is an architecture problem,
not “more choice”.

### 5.3 DRY: remove duplicated knowledge, not similar code

- **Duplicated knowledge** (the same protocol field, error code, default value or rule) must have one
  definition, shared through `contracts` or a lower layer.
- **Similar code** (looks alike but will evolve independently) is not forced into an abstraction;
  extract after the third repetition to avoid a premature god module.
- Never copy files across packages; share by moving down to an allowed lower layer or defining it in
  `contracts`.
- Test fixtures and English translations are **intentional duplication**: the former is independent
  evidence, the latter a language mirror. `DRY-001` excludes them, as it excludes generated files and
  lockfiles.
- Documents do not copy normative paragraphs; link to the single source.

The `DRY-001` gate detects non-test source files under `src/` whose contents are exactly identical.
Semantic duplication or copy-paste with renaming is covered by human review and the periodic review.

### 5.4 Responsibilities and layering for complex features

- One package covers one domain; one source file has one cohesive responsibility. A file over roughly
  400 lines, or one that handles protocol, policy and I/O at once, should be split or explained in the
  PR.
- Layers communicate through explicit interfaces: `daemon` calls the `Device` interface and does not
  care about the backend; `device` returns typed errors, not magic strings; `contracts` describes
  shapes, not behaviour.
- Validate at boundaries (MCP input, HTTP request, device reply), then trust types internally; do not
  re-validate the same input deep inside.
- Errors are typed at boundaries and keep context; no silent swallowing, `any` escapes or safety
  decisions in `device`.
- Concurrency/ordering policy lives in `daemon`; device layers are stateless or have explicit state
  and never schedule multiple clients themselves.
- Any cross-layer shortcut (daemon reading Android files directly, daemon importing benchmark, etc.)
  is an architecture change requiring review; inline exemptions are not allowed.

### 5.5 Documentation and language

- Chinese is the primary version; English mirrors live in `docs/en/`. Heading structure and facts must
  correspond; English may lag, but within the same PR or with an explicit “needs sync” marker.
- Every `docs/*.md` links to its English mirror at the top; English mirrors cannot be orphans.
- README and README.en link to each other and index every primary document (DOC-001 / DOC-003).
- The machine contract lives only in the Chinese primary; English mirrors do not copy it, avoiding
  drift.

## 6. Machine-readable contract

The JSON block in [the Chinese architecture document](../architecture.md) is the **single machine
source of truth** for layout and dependency rules. The gate parses it directly and verifies the root
`package.json` and `packages/*` against it. Layout, layer, allowlist or runtime-dependency changes
start there, then move to code, in the same PR.

This English mirror intentionally does not reproduce the JSON. Its field semantics:

- `node`: the root `package.json` `engines.node` must match exactly; `>=22` is the current minimum.
- `workspaces`: the root `package.json` `workspaces` must match exactly.
- `packageNamePrefix`: every package name starts with this prefix, and the suffix equals the directory
  name.
- `packages`: registers every npm workspace package. Lower `layer` numbers are further down; a
  dependency may only point at a lower layer, and `mayDependOn` is the allowlist for both runtime and
  development dependencies. Undeclared packages or dependencies fail the gate.
- `runtimeDependencies`: registry of external runtime dependencies. Each key is an npm package name;
  each value contains at least `license`, `purpose` and `allowedIn` (the packages allowed to use it).
  Every new runtime dependency must be registered here. Development dependencies (TypeScript, type
  definitions, etc.) are justified in the PR but do not go in the runtime table.

Constraints:

- A registered package that does not exist yet is “planned” and may be absent; once its directory
  exists, it must match exactly.
- The machine contract appears only in the Chinese primary document. English mirrors explain the rules
  and link back here.
- If the gate cannot parse or enforce the contract, it fails outright (`NORMS-001`); it never skips.
- Do not edit `packages/*/package.json` to bypass the contract; change the machine contract first.

## 7. Change, review and exceptions

### 7.1 Adding a package

1. Check whether an existing package can own the responsibility; only add a package when it cannot.
2. Update section 6 `packages`: directory, layer, `mayDependOn`.
3. Create `packages/<name>/package.json` (`private: true`, `@phone-as-tool/<name>`, `type: module`,
   `engines`), plus `src/`, `test/` and `tsconfig.json` extending `tsconfig.base.json`, with tests.
4. Run `npm install --package-lock-only` to update the root lockfile; `npm run gate` must pass.
5. State the package responsibility, dependency direction and verification commands in the PR.

### 7.2 Adding a dependency

1. Evaluate it through the five questions in 5.2.
2. Update section 6 `runtimeDependencies`; for a development dependency, state purpose, version,
   licence and size in the PR.
3. Install with npm and commit the root `package-lock.json`; never commit `node_modules/`.
4. `npm run gate` passes. If the dependency is a second library for the same purpose, first justify why
   the existing one cannot be reused.

### 7.3 Architecture exceptions

There are no inline exemptions (no `// gate:ignore` switch). A genuine exception requires:

- a PR explaining why the current layering cannot solve it, the blast radius and the removal condition;
- explicit approval from the human owner;
- a record in this document (reason, expiry/removal issue), while the gate still covers the rest;
- review at expiry; exceptions must not quietly become permanent.

Security-sensitive changes (see [security.md](security.md)) also require explicit human approval in the
PR.

### 7.4 Minimum PR verification

```text
npm ci
npm run format:check
npm run gate
npm test
npm run build
npm run typecheck
```

Record the actual results in the PR body; CI must be green. When the gate fails, fix the code or the
rule. Never “fix green” with `continue-on-error`, commented-out workflows or deleted gates.

## 8. Periodic review

Norms drift as code changes, so they need scheduled review. Cadence, checklist, automatic reminder and
exit criteria are in [architecture-review.md](architecture-review.md). Every milestone acceptance also
triggers a review. New packages, dependencies or cross-layer calls are structural changes and require
an architecture review record in the same PR.

## 9. Current state

- M0: tech stack, layout, layering, gate and review norms are in place; `packages/architecture-gate`
  is the only real workspace package.
- M1: implement the daemon in `packages/contracts`, `packages/device` and `packages/daemon`; product
  source no longer lives at the repository root.
- M2: the Android host and real-device channel land in `apps/android` and a `device` backend.
- M3: evaluation lands in `packages/benchmark` and must not flow back into product packages.

There is no product code yet, so the product-facing rules (layering, dependencies) are proven through
probe fixtures. Once real packages exist, the same rules inspect them directly; no second gate is
needed.

## 10. Related documents

- [MCP tool contract](mcp-tools.md)
- [Security requirements](security.md)
- [Roadmap](roadmap.md)
- [CI gates](ci-gates.md)
- [Architecture review](architecture-review.md)
- [Working rules](../../AGENTS.md)
