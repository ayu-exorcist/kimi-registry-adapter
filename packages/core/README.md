# @kastral/kra-core

[English](./README.md) | [简体中文](./README.zh-CN.md)

Private shared library for Kimi Registry Adapter. It contains the implementation used by the CLI and HTTP server: configuration schemas, model discovery, registry transformation, update/merge behavior, validation, auth storage, and state-directory mutations.

This package is private and is consumed inside the workspace through `workspace:*` aliases and TypeScript path mappings.

## Responsibilities

- Parse and write `config.json` with a JSON Schema URL.
- Parse and write `auth.json` with either local API keys or environment variable names.
- Discover models from OpenAI-compatible endpoints, Anthropic-compatible endpoints, local files, or remote URLs.
- Enrich discovered models with metadata from `https://models.dev/models.json` or a custom metadata source.
- Transform discovered models into editable Kimi registry entries.
- Merge or overwrite generated application data while preserving local edits when possible.
- Validate editable registry files.
- Commit state-directory changes to the local git repository for review/rollback when git is available.
- Provide operation-level functions for CLI callers.

## State layout

Most functions operate on a state directory with this layout:

```text
config.json
registries/<providerId>/api.json
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json
auth.json
.git/
.kra.lock
.kra.locks/<providerId>.lock
```

Only `registries/<providerId>/api.json` is intended for manual edits. Files under `.internal/` are KRA-owned source snapshots and merge state. Git commits are created when git is available; without git, update merging still works from `.internal/state.json`.

Use `createStatePaths(stateDir, providerId)` to derive canonical paths.

## Configuration model

Provider configuration supports:

- `name` — provider display name.
- `baseUrl` — provider API base URL. OpenAI-style provider types (`openai_responses` and `openai`) usually end in `/v1`; Anthropic-compatible providers usually use a `baseUrl` that does not end in `/v1`.
- `type` — `openai_responses`, `openai`, or `anthropic`.
- `modelSource` — one of:
  - `openai_models` with optional `modelsUrl`
  - `anthropic_models` with optional `modelsUrl`
  - `local_file` with `path`
  - `remote_url` with `url` and optional `auth: "none" | "provider"`; default is `none`
- `modelsMetadataPath` — custom metadata source URL or local path.
- `preserveUnknownModels` — keep editable models that are no longer present in generated data during merge updates.
- `fallbackContext` / `fallbackToolCall` — fallback capability defaults when source and metadata do not provide values.
- `apiKeyEnv` — environment variable name for the provider API key.
- `updateMode` — `merge` or `overwrite`.
- `include` / `exclude` — model ID filters.
- `overrides` — per-model editable overrides for identity, limits, capabilities, and modalities.

## Public operations

The `operations` module provides higher-level functions used by the CLI:

- `saveProvider(input)` — save a provider definition without updating its registry.
- `setupProviderOperation(input)` — save config, optionally update the provider, commit changes when git is available, and return provider ID, config path, optional editable registry path, model count, metadata match summary, and optional commit hash.
- `updateProviderOperation(input)` — update one provider registry and return model counts, metadata match summary, warning/error/conflict counts, and optional commit hash.
- `configureProviderAuth(input)` — set, update, or clear auth settings.
- `listProviders(input)` — read configured provider IDs.
- `printUrl(input)` — build `http://<host>:<port>/<providerId>/api.json`.
- `validateRegistry(input)` — validate `registries/<providerId>/api.json`.
- `getServeCommand(input)` — build a `kra serve` command.
- `removeProvider(input)` — remove provider config/auth and optionally registry files.

## Lower-level exports

`src/index.ts` exposes the public core surface used by the CLI:

- fetch helpers and `KraFetchError` from `fetch-client`
- operation-level APIs from `operations`
- provider descriptors and provider ID helpers
- selected model-source helpers such as `fetchProviderModels`, `readModelsPayload`, `readModelsMetadata`, and `resolveModelsUrl`
- registry schema validators and registry types
- transform helpers and metadata match types
- `KraConfig` and `ProviderConfig` types

Modules such as `state`, `lock`, `git`, and `editable-registry-store` are implementation modules inside the workspace, not the package's documented public surface.

For the full configuration reference, see [Configuration And Registry Reference](../../docs/configuration.md).

For the full state and update design, see [State And Update Design](../../docs/state-and-update.md).

For the CLI/server boundary, see [CLI And Server Reference](../../docs/cli-and-server.md).

For test coverage, generated-schema checks, and verification commands, see [Testing And Verification](../../docs/testing.md).

## Build and test

```sh
pnpm --filter @kastral/kra-core build
pnpm typecheck
pnpm exec vitest run packages/core
```

From the repository root, `pnpm check` runs linting, typechecking, and tests for the workspace.

## Related docs

- [Architecture](../../docs/architecture.md)
- [CLI and server reference](../../docs/cli-and-server.md)
- [Configuration and registry reference](../../docs/configuration.md)
- [State and update design](../../docs/state-and-update.md)
- [Release and publishing](../../docs/release.md)

## License

MIT.
