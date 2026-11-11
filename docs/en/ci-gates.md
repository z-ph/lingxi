# CI gates

Status: delivered in M0 (issue #18). This document is the **machine-checkable norm list**; semantic
judgement stays with human review and the periodic architecture review. The architecture rules
themselves are in [architecture.md](architecture.md).

## 1. Why gates

A norm that only lives in a document decays as soon as “just this once” becomes normal. Machine gates
turn reliably decidable rules into blocking conditions: a PR that breaks the layout, dependencies or
document links goes red, and reviewers do not have to remember every rule.

Gates only cover what can be decided reliably by a machine. Semantic DRY, whether a layer split is
sound, or whether a dependency is genuinely needed remain human review items. The gate makes those
discussions start from a compliant baseline instead of re-discovering known violations.

## 2. Where they run

| Location | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Runs on pushes to `main` and PRs targeting `main`; Node 22 and 24 matrix |
| `packages/architecture-gate` | Gate implementation and probe tests; zero runtime dependencies |
| `npm run format:check` | Prettier check for code/JSON/YAML; exits 1 on failure |
| `npm run gate` | Runs every rule against the real repository; exits 1 on failure |
| `npm test` | Runs each workspace's tests, including the gate probes (usability proof) |
| `npm run build` / `npm run typecheck` | Build and type check (only the tooling package today; future packages join automatically) |

CI order: `npm ci` → `npm run format:check` → `npm run gate` → `npm test` (probes included) →
`npm run build` → `npm run typecheck`. Any failure blocks merge.

### 2.1 Reproduce locally

```text
npm ci
npm run format:check
npm run gate
npm test
npm run build
npm run typecheck
```

Gate only, or JSON:

```text
npm test --workspace @phone-as-tool/architecture-gate
node packages/architecture-gate/src/cli.mjs --format json
```

`--format json` prints `{ root, violations, summary }` for review or scripts; each violation has `id`,
`file` and `message`.

### 2.2 No bypassing

- Do not use `continue-on-error`, `if: always()` or commented-out workflows to turn a failing gate
  green.
- Do not delete rules or shrink scan scope to avoid a finding. If a rule must change, change the rule,
  this document and the probes in the same PR.
- Do not commit `node_modules/`, build output or local state to “fix” checks.
- The gate has no inline exemption comments. A genuine architecture exception follows section 7.3 of
  [architecture.md](architecture.md).

## 3. Rules

Each rule has a stable ID. When a gate fails, read the ID first, then the file path in the message.

| ID | Check | What a failure usually means |
| --- | --- | --- |
| `NORMS-001` | Required docs, both workflows and the machine contract exist and parse; the English mirror does not copy the machine contract; CI actually calls `npm run format:check` and `npm run gate`; AGENTS links the norms | Norms or gates were deleted/broken; documentation has two sources |
| `MONO-001` | Root `package.json` is private with required scripts, workspaces and `engines.node` match the machine contract; exactly one root lockfile; package names/directories/`private` are compliant | Not a valid monorepo, or a second package manager/lockfile appeared |
| `ARCH-001` | Package dependencies only point at lower-layer packages in `mayDependOn`; the machine contract dependency graph is acyclic | Cross-layer dependency, cycle, undeclared package dependency |
| `ARCH-002` | Source cannot cross packages with relative imports or deep-import `@phone-as-tool/*/src/...`; internal imports must be declared | Bypassing package entry points or dependency direction |
| `DEPS-001` | Runtime dependencies must register `license`, `purpose`, `allowedIn`; the same runtime dependency uses one version | Dependencies added quietly, reinvented wheels, or supply-chain risk not recorded |
| `DRY-001` | No non-test source file under `src/` has an exactly duplicated file | Copy-paste; logic should move to a shared lower layer |
| `DOC-001` | Every `docs/*.md` has an English mirror, every mirror has a Chinese primary, and the primary links to the mirror | Bilingual drift or orphan mirrors |
| `DOC-002` | Local links and anchors in docs resolve | Dead links after moves/renames |
| `DOC-003` | README and README.en index every primary document | New docs nobody finds, or an index out of sync |

Machine-contract field and allowlist semantics are in section 6 of [architecture.md](architecture.md).
Rule implementation lives in `packages/architecture-gate/src/rules/`; when the two disagree, fix the
document first (the document is the contract), then the code.

### 3.1 Format check (Prettier)

Formatting is a tool gate, not a custom rule ID, provided by Prettier 3.9:

- `npm run format:check` checks code, JSON and YAML; `npm run format` fixes.
- Chinese Markdown (`docs/`, `*.md`) is not force-reflowed, avoiding machine rewrapping of Chinese
  paragraphs; docs are checked by `DOC-001` to `DOC-003`.
- `package-lock.json` is not formatted; `npm ci` verifies the lockfile.
- `NORMS-001` verifies CI still calls `format:check`; `MONO-001` verifies the root `package.json`
  keeps the script. Removing either side goes red.

## 4. Usability proof (probes)

“The gate passed” may simply mean it was not doing anything. To prevent a no-op gate, every rule has a
probe that proves it **actually fails** when it should, and does **not false-positive** on a compliant
baseline.

How it works:

- `packages/architecture-gate/test/fixtures/good-repo/` is a minimal compliant fake repository: root
  config, docs, machine contract, three example packages and both workflows.
- Each probe copies good-repo to a temporary directory, creates **exactly one violation scenario**,
  then asserts the expected rule ID and file. It never modifies the real repository and
  needs no network.
- `good fixture passes every rule` asserts the compliant baseline has zero violations, guarding against
  systemic false positives.
- CLI probes run `cli.mjs --root <fixture>` directly, checking exit codes 0/1 and the JSON shape; if the
  CLI is broken, correct rules would still not block CI.

| Rule | Probe (`packages/architecture-gate/test/gate.test.mjs`) | Proves |
| --- | --- | --- |
| Baseline | `good fixture passes every rule` | No violations; no false positives |
| `DOC-001` | `DOC-001 rejects a document without an English mirror` / `DOC-001 rejects an orphan English mirror` / `DOC-001 rejects a missing language link` | Missing mirrors, orphan mirrors and missing language links go red |
| `DOC-002` | `DOC-002 rejects a broken local link` / `DOC-002 rejects a broken anchor` | Dead links and bad anchors go red |
| `DOC-003` | `DOC-003 rejects a doc missing from the README index` | An unindexed doc goes red |
| `MONO-001` | `MONO-001 rejects a missing root lockfile` / `MONO-001 rejects a nested package lockfile` / `MONO-001 rejects an undeclared workspace package` / `MONO-001 rejects an engines.node mismatch` / `MONO-001 rejects a missing root format:check script` | Lockfile, package-layout, Node-version and format-script violations go red |
| `ARCH-001` | `ARCH-001 rejects a dependency outside mayDependOn` / `ARCH-001 rejects a dependency cycle` | Cross-layer and cyclic dependencies go red |
| `ARCH-002` | `ARCH-002 rejects a relative import escaping the package` / `ARCH-002 rejects a deep import into another package` / `ARCH-002 rejects an undeclared internal import` | Entry-point bypasses and undeclared internal imports go red |
| `DEPS-001` | `DEPS-001 rejects an unregistered runtime dependency` / `DEPS-001 accepts a registered runtime dependency` / `DEPS-001 rejects inconsistent runtime dependency versions` | Unregistered and drifting versions fail; a registered dependency passes |
| `DRY-001` | `DRY-001 rejects duplicate source files` | Duplicate source goes red |
| `NORMS-001` | `NORMS-001 rejects a missing CI gate workflow` / `NORMS-001 rejects CI without format check` / `NORMS-001 rejects a duplicated machine contract in the English mirror` / `NORMS-001 rejects an invalid machine contract` | Broken gates/contracts/format checks go red |
| CLI | `cli exits 0 and emits json for a compliant repo` / `cli exits 1 and reports the rule id for a violating repo` | The real entry point works |

`npm test` runs these probes; the CI test step is the probe evidence. The repository has no product code
yet, so product rules (ARCH/DEPS/DRY) are proven on fixtures only; once M1 packages land, the same rules
inspect them directly. No second gate is needed.

## 5. Limitations and false positives

The gate checks **structure**, not design:

- It cannot tell whether two modules duplicate the same knowledge; it only finds identical files.
- It cannot judge whether a new dependency is necessary; it can only require registration and a reason.
- It cannot judge whether a split inside a layer is sensible; it can only block cross-layer and cyclic
  dependencies.
- It is sensitive to paths, package names and machine-contract format; when renaming, update them as
  the error says rather than weakening the rule.

If a rule is wrong:

1. Explain the exact file/scenario and why it is a false positive in the PR.
2. Fix the rule (do not disable it) and add a probe that reproduces the false positive.
3. Update the tables in this document in the same PR.
4. Merge after human review.

If a rule misses something, add a failing probe first, then fix the rule: red before green.

## 6. Adding a gate rule

1. Pick a stable ID (`DOMAIN-NNN`).
2. Implement it under `packages/architecture-gate/src/rules/`, emitting file paths and actionable
   messages.
3. Add a negative probe (fails when it should) and a positive probe where useful (does not
   false-positive) in `gate.test.mjs`.
4. Update the rule and probe tables in this document.
5. If the rule encodes a new architecture fact, update the machine contract or norms in
   [architecture.md](architecture.md).
6. Run `npm ci && npm run gate && npm test` locally; merge after CI is green.

Rule code must not access the network, depend on the current working directory, or modify the
repository being checked; tests must run in temporary directories.
