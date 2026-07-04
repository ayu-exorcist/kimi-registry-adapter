# Testing And Verification

## Top-Level Positioning

Testing in KRA protects three boundaries: the core state/update engine, the CLI/user workflow layer, and the release artifacts. The repository uses Vitest for package tests and combines formatting, linting, typechecking, generated-schema checks, tests, coverage, and build checks before release.

Objective facts:

- Vitest includes `packages/**/*.test.ts`.
- The test resolver aliases `@kastral/kra-core` to `packages/core/src/index.ts`, so CLI tests exercise current core source rather than stale build output.
- CI runs `pnpm check`, `pnpm coverage`, and `pnpm build` on pull requests and pushes to `main`.
- `pnpm release` runs checks, coverage, build, config schema checks, and `changeset publish`.

Implicit assumptions:

- Contributors run commands from the repository root with Node.js and pnpm versions from `mise.toml`.
- Unit and integration-style tests are the primary regression net; there is no separate browser or end-to-end Kimi test suite in this repository.
- `dist/` files are build artifacts and should be regenerated with `pnpm build` rather than edited by hand.

## Middle-Layer Logic

Use the smallest command that covers the change, then run the broader gate before claiming a release-ready state.

| Change area                         | Primary verification                                  | Broader gate                                      |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Core config/auth/state/update logic | `pnpm exec vitest run packages/core`                  | `pnpm check && pnpm coverage`                     |
| CLI command parsing or JSON output  | `pnpm exec vitest run packages/cli`                   | `pnpm check && pnpm build`                        |
| Interactive prompts and flows       | Relevant `packages/cli/test/interactive*.test.ts`     | `pnpm exec vitest run packages/cli`               |
| HTTP server and scheduled updates   | `packages/cli/test/server-runtime*.test.ts`           | `pnpm exec vitest run packages/cli && pnpm build` |
| Config schema changes               | `pnpm config-schema:generate` or `--check` equivalent | `pnpm check`                                      |
| Release or versioning changes       | `pnpm release:dry`                                    | CI release workflow on `main`                     |
| Documentation-only changes          | `pnpm fmt`                                            | Run targeted tests when docs describe behavior    |

## Bottom-Layer Details

### Root Verification Commands

```sh
pnpm fmt
pnpm lint
pnpm typecheck
pnpm config-schema:check
pnpm test
pnpm coverage
pnpm build
pnpm check
```

`pnpm check` runs formatting, linting, typechecking, config schema generation check, and tests. Coverage and build are separate in CI and release scripts, so run them explicitly when validating release readiness.

### Test Layout

Core tests live under `packages/core/test` and cover:

- atomic file writes and fault recovery
- auth precedence and auth file behavior
- config parsing and generated JSON Schema consistency
- fetch error formatting and retry behavior
- git initialization and state commits
- lock behavior
- provider descriptors and provider ID safety
- registry schema validation and merge/update behavior
- provider operations, removal, state layout, and update edge cases

CLI tests live under `packages/cli/test` and cover:

- binary smoke checks
- command-mode argument parsing and handlers
- interactive add/update/list/remove/server flows
- prompt primitives and prompt adapters
- duration parsing
- HTTP server runtime, scheduled updates, concurrency, timeout, and health tracking

### Coverage Thresholds

`vitest.config.ts` uses the V8 coverage provider and writes reports to `coverage/`. Global thresholds are:

- statements: `75`
- branches: `65`
- functions: `80`
- lines: `75`

Selected interactive prompt files have lower per-file thresholds because they are TTY-heavy boundaries. Do not lower thresholds to make a change pass; add focused tests or justify a separate architecture change.

### Generated Schema Checks

Config schema behavior has two coupled artifacts:

1. `packages/core/src/config.ts` defines the runtime config schema and default `$schema` URL.
2. `schemas/config.schema.json` is generated from the runtime schema.

Use:

```sh
pnpm config-schema:generate
pnpm config-schema:check
```

`pnpm version-packages` runs schema generation after Changesets updates package versions.

### Regression-Test Expectations

When fixing behavior, prefer adding a test at the seam that observed the bug:

- provider state/update bugs: `packages/core/test/update.test.ts`, `state.test.ts`, or `operations.test.ts`
- CLI argument/output bugs: `packages/cli/test/commands*.test.ts`
- serve/update scheduling bugs: `packages/cli/test/server-runtime*.test.ts`
- prompt flow bugs: the matching `interactive*.test.ts`

Keep fixtures in `packages/core/test/fixtures` when the payload is reusable. Avoid weakening assertions to match current broken behavior.

### Operational Smoke Checks

For manual local verification, use a temporary state directory so the default user state is not modified:

```sh
STATE_DIR=$(mktemp -d)
printf '{}\n' > ./metadata.json
pnpm dev -- add local \
  --state-dir "$STATE_DIR" \
  --base-url http://localhost:4000/v1 \
  --model-source local_file \
  --model-source-path packages/core/test/fixtures/openai-minimal-models.json \
  --models-metadata-path ./metadata.json
pnpm dev -- list --state-dir "$STATE_DIR"
pnpm dev -- update local --state-dir "$STATE_DIR" --dry-run
pnpm dev -- serve --state-dir "$STATE_DIR" --host 127.0.0.1 --port 2727 --no-update
```

The last command is long-running; stop it with Ctrl+C after checking `/healthz` or an `api.json` endpoint. Remove `./metadata.json` after the smoke check if you created it in the repository root.

## Code Consistency Check

This document was checked against:

- `package.json` for root scripts.
- `vitest.config.ts` for test include patterns, aliases, coverage reporter, and thresholds.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` for CI/release gates.
- `scripts/generate-config-schema.ts` for generated artifact verification commands.
- `packages/core/test` and `packages/cli/test` for the current test layout.

Related references: `docs/cli-and-server.md` for CLI/server seams and `docs/configuration.md` for config/schema seams.
