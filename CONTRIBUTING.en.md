# Contributing

Early days. Please open an issue describing the task you want the phone to do (app, steps,
expected result). PRs that follow [AGENTS.md](AGENTS.md) are welcome.

## Before opening a PR

- Run `npm ci && npm run format:check && npm run gate && npm test && npm run build && npm run typecheck`
  and record the result in the PR.
- Architecture, package-layout or dependency changes: read
  [docs/en/architecture.md](docs/en/architecture.md) first, update the machine contract in the same PR
  and pass `npm run gate`. Rule details are in [docs/en/ci-gates.md](docs/en/ci-gates.md).

## Ground rules

- Be explicit about what was tested on which device / OS version.
- Never include secrets, screenshots of private data, or logs containing personal content.
- Security-sensitive changes: say so in the PR.
