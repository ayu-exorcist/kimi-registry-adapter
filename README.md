# Kimi Registry Adapter

[English](./README.md) | [简体中文](./README.zh-CN.md)

Kimi Registry Adapter (KRA) builds editable Kimi provider registries from model discovery endpoints or model payload files, stores them in a local state directory, and serves importable `api.json` URLs for Kimi.

The project is a pnpm workspace with CLI and core packages.

## Requirements

- Node.js `>=22.18`
- pnpm (installed through `mise`; see `mise.toml`)

## Usage modes

KRA is designed for several workflows. The recommended first experience is **interactive mode**.

### Interactive mode: guided local setup

Interactive mode is the easiest way to configure providers because it turns the setup flow into a menu-driven wizard:

```sh
pnpm dlx @kastral/kra
npx @kastral/kra
bunx @kastral/kra
yarn dlx @kastral/kra
```

Use whichever package runner you already have available. `pnpx @kastral/kra` can be used as a shorthand for `pnpm dlx @kastral/kra`, and `bunx @kastral/kra` is equivalent to `bun x @kastral/kra`. Use interactive mode when you want KRA to guide you through provider creation, auth setup, registry updates, URL printing, and starting the local server. With no providers configured, the wizard starts with a minimal setup flow. After a provider exists, the home menu can manage the full lifecycle.

### CLI mode: repeatable commands

Use command mode when you already know the provider settings or want repeatable shell scripts:

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY \
  --update-mode merge
```

Other command-mode operations include `list`, `auth`, `update`, `remove`, and `serve`.

### One-off package-runner execution

The published CLI can be run without installing it into a project. Use whichever package runner you already have available:

```sh
pnpm dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
npx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
bunx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
yarn dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
```

Use the same runner for long-running server mode, for example:

```sh
pnpm dlx @kastral/kra serve --host 127.0.0.1 --port 2727
npx @kastral/kra serve --host 127.0.0.1 --port 2727
bunx @kastral/kra serve --host 127.0.0.1 --port 2727
```

For help with `npx`, pass CLI flags after `--` so npm does not consume them:

```sh
npx @kastral/kra -- --help
```

`pnpx @kastral/kra` can be used as a shorthand for `pnpm dlx @kastral/kra`, and `bunx @kastral/kra` is equivalent to `bun x @kastral/kra`. Deno is not currently supported; KRA is a Node.js CLI.

This is useful for local setup, CI jobs, and temporary machines. KRA still persists state under `~/.kimi-registry-adapter` unless `--state-dir` is provided.

### Server mode: keep Kimi registry URLs available

Kimi refreshes imported provider registries during startup, so the KRA HTTP server should already be running before you start Kimi:

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

Use `--update-concurrency <n>` to update multiple providers at once and `--update-timeout-ms <ms>` to change the per-provider update timeout. Defaults are concurrency `1` and timeout `30000ms`.

Use a terminal, startup script, or OS service to keep `kra serve` running. KRA intentionally does not use MCP for this because MCP servers start too late in the Kimi startup sequence to prevent registry refresh failures.

For troubleshooting, `KRA_DEBUG=1` enables structured diagnostics. Logs default to `~/.kimi-registry-adapter/logs/kra-debug.log`; `--state-dir` does not relocate them, so use `KRA_LOG_FILE` for a custom path. Prefer `KRA_DEBUG=1` over `KRA_LOG=1` for general diagnosis because interactive `KRA_LOG=1` can record raw terminal input bytes. See [Operations and troubleshooting](./docs/operations.md) for health, supervision, security, and recovery details.

## Packages

| Package                                          | Purpose                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [`@kastral/kra`](./packages/cli/README.md)       | Published CLI for interactive mode, command mode, one-off package-runner execution, and `serve`. |
| [`@kastral/kra-core`](./packages/core/README.md) | Private shared library for config, auth, update, transform, validation, and state mutations.     |

## Quick start

The shortest path is interactive mode:

```sh
pnpm dlx @kastral/kra
npx @kastral/kra
bunx @kastral/kra
yarn dlx @kastral/kra
```

After setup, start the local registry server before starting Kimi:

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

For many configured providers, tune startup and scheduled updates with `--update-concurrency <n>` and `--update-timeout-ms <ms>`.

Import the printed URL in Kimi. Provider-specific URLs use this shape:

```text
http://127.0.0.1:2727/<providerId>/api.json
```

KRA also serves an aggregate registry at:

```text
http://127.0.0.1:2727/api.json
```

## State directory

The default state directory is `~/.kimi-registry-adapter`.

```text
config.json                              # provider definitions and defaults
registries/<providerId>/api.json          # editable registry served to Kimi
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json  # KRA metadata, including lastGeneratedRegistry
auth.json                                # optional local credentials or env-var names
.git/                                    # state changes are committed for review/rollback when git is available
```

Only edit `registries/<providerId>/api.json`. Do not edit files under `.internal/`; KRA uses them for source snapshots and update merge baselines.

KRA commits successful `add`, `update`, and `remove` state changes when git is available. If git is not installed, KRA still updates and merges registries using `.internal/state.json`. If you manually edit `api.json`, validate the JSON shape before committing your edit with git; KRA also validates registry files when it loads them for serving. Future `kra update` runs normally use `.internal/state.json.lastGeneratedRegistry` as the merge baseline. If that internal state is unavailable, KRA falls back to the committed `api.json`, then to the newly generated registry; a manual commit can therefore become a recovery baseline only in that fallback case.

Use `--state-dir <path>` in CLI commands to target another directory.

KRA serializes global state changes and same-provider registry writes between KRA processes that use the same local state directory. Long-running model discovery happens outside the write lock; registry writes for different providers may run concurrently, while config/auth changes and git commits remain serialized. KRA rechecks provider and auth state before writing. This guarantee does not cover manual edits to state files, direct git commands inside the state directory, other tools that write the directory without taking KRA's lock, or concurrent writes to a network-shared state directory from multiple hosts.

## Configuration highlights

Provider config supports:

- provider types: `openai_responses`, `openai`, `anthropic`
- base URLs: `openai_responses` and `openai` providers usually use a `baseUrl` ending in `/v1`; `anthropic` providers usually use a `baseUrl` that does not end in `/v1`
- model sources: `openai_models`, `anthropic_models`, `local_file`, `remote_url`
- include/exclude filters for model IDs
- model metadata enrichment from `https://models.dev/models.json` or a custom source
- per-model overrides for name, family, limits, tool calling, reasoning, interleaved support, and modalities
- update modes: `merge` or `overwrite`

The generated JSON schema is stored in [`schemas/config.schema.json`](./schemas/config.schema.json).

## Documentation

- [Documentation map](./docs/README.md)
- [Architecture](./docs/architecture.md)
- [CLI and server reference](./docs/cli-and-server.md)
- [Configuration and registry reference](./docs/configuration.md)
- [State and update design](./docs/state-and-update.md)
- [Operations and troubleshooting](./docs/operations.md)
- [Release and publishing](./docs/release.md)
- [Testing and verification](./docs/testing.md)
- [Terminal theme integration](./docs/terminal-theme.md)

## Development

Install dependencies:

```sh
pnpm install
```

Run the interactive CLI from source:

```sh
pnpm dev
```

Run command-mode help from source:

```sh
pnpm dev -- --help
```

Build all packages:

```sh
pnpm build
```

Run checks:

```sh
pnpm check
```

Individual checks:

```sh
pnpm lint
pnpm typecheck
pnpm config-schema:check
pnpm test
pnpm coverage
```

CI also runs `pnpm build` and `pnpm test:binary` after `pnpm check`.

Check formatting:

```sh
pnpm fmt
```

Apply formatting:

```sh
pnpm fmt:fix
```

## Publishing artifacts

The CLI package exposes built ESM output and declaration files from `dist`:

- `@kastral/kra` publishes the `kra` binary.

`@kastral/kra-core` is a private workspace package used by the CLI package and is bundled into the CLI build.

Releases are managed with Changesets. The config schema URL points at the current `main` branch schema file. Add a changeset for user-visible CLI changes:

```sh
pnpm changeset
```

Preview the release locally:

```sh
pnpm release:dry
```

On `main`, `.github/workflows/release.yml` creates a release PR and publishes to npm after that PR is merged. npm Trusted Publishing must be configured for `@kastral/kra` before the workflow can publish.

## License

MIT. See [LICENSE](./LICENSE).
