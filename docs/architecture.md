# Architecture

## Top-Level Positioning

Kimi Registry Adapter (KRA) is a local registry generator and HTTP server for Kimi provider imports. Its job is to turn upstream model discovery data into an editable Kimi registry file, keep user edits across updates when possible, and serve stable `api.json` URLs that Kimi can import.

Objective facts:

- The public npm package is `@kastral/kra` from `packages/cli` and it exposes the `kra` binary.
- `@kastral/kra-core` from `packages/core` is private workspace code used by the CLI and bundled into the CLI build.
- Runtime state defaults to `~/.kimi-registry-adapter`; the default HTTP bind address is `127.0.0.1:2727`.
- The current CLI command surface is default interactive mode plus `add`, `list`, `auth`, `update`, `remove`, and `serve`.
- Detailed command flags and HTTP endpoint behavior are documented in `docs/cli-and-server.md`.

Implicit assumptions:

- Users run KRA on the same machine that Kimi can reach over loopback or another configured host.
- A local state directory is the source of truth; remote provider APIs are discovery inputs, not the place where user registry edits live.

## Middle-Layer Logic

KRA is split into two main packages:

| Layer                 | Package             | Responsibility                                                                                                                                                    |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User/runtime boundary | `@kastral/kra`      | CLI command parsing, interactive prompts, output rendering, HTTP registry server startup, file watching                                                           |
| Domain engine         | `@kastral/kra-core` | Config/auth parsing, provider ID safety, model discovery, metadata enrichment, registry transformation, merge/update behavior, state mutations, local git commits |

The main runtime flows are:

1. Interactive setup: default CLI command starts a TTY-only wizard, gathers provider settings, saves config, writes auth when requested, updates the registry, and optionally starts the server.
2. Scripted provider add: `kra add <providerId> --base-url <url>` saves provider config, updates the registry by default, commits state changes when git is available, and prints JSON output.
3. Update: `kra update <providerId>` resolves the model source and auth, transforms discovered models into generated registry data, then either merges or overwrites the editable registry.
4. Serve: `kra serve` optionally updates configured providers, finds an available port at or above the requested port, starts a Hono HTTP app, loads current registry files, watches `registries/*/api.json` for cache refresh, and reports update health from the scheduled-update tracker.
5. Removal: `kra remove <providerId>` removes config/auth and deletes the provider registry directory unless `--keep-files` is set.

## Bottom-Layer Details

### CLI Boundary

`packages/cli/src/commands/index.ts` registers the commands that users can run. The registered subcommands are:

- `add`
- `remove`
- `list`
- `auth`
- `update`
- `serve`

The hidden default command starts interactive mode. Interactive mode requires both stdin and stdout to be TTYs; non-interactive usage should use `kra add` and the other subcommands.

Interactive add walks through provider ID, base URL, auth mode, provider type, model source, model inclusion, update mode, and whether to start the server. After a provider exists, the interactive update flow can change provider name, base URL, auth source, provider type, model source, included models, update mode, or refresh the registry.

### HTTP Server

`packages/cli/src/server/index.ts` builds a Hono app with these endpoints:

- `GET /healthz` returns status, state directory, provider count, provider IDs, invalid-registry count when present, and scheduled-update health when `serve` supplies it.
- `GET /api.json` returns an aggregate registry made from all loaded provider registries.
- `GET /:providerId/api.json` returns one provider registry, `400` for an invalid `providerId`, or `503` when that registry is unavailable.

The server loads valid registry files from `registries/<providerId>/api.json` at startup and watches for add/change/unlink events. A provider registry file must contain exactly one provider entry matching the directory `providerId`. Invalid registry files found at startup are skipped. If a watched registry file becomes invalid after a valid version was already loaded, the server keeps serving the last known good registry for that provider and reports degraded health until the file becomes valid again. When a watched registry file is deleted, the provider is removed from the in-memory cache.

### Core Operation Boundary

`packages/core/src/operations/index.ts` is the high-level API used by the CLI. It exposes operations such as `saveProvider`, `setupProviderOperation`, `updateProviderOperation`, `configureProviderAuth`, `listProviders`, `printUrl`, `validateRegistry`, `getServeCommand`, and `removeProvider`.

Not every core operation is a public CLI command. For example, `printUrl` and `validateRegistry` are library operations used by rendering or tests, but the current CLI does not register standalone `print-url` or `validate` commands.

### Data and Control Flow

```text
CLI args / prompts
  -> core operation
    -> config/auth/state path resolution
      -> model source resolution
        -> transform discovered models
          -> merge or overwrite editable registry
            -> write state files and optional git commit
              -> serve registry over HTTP
```

### Failure Boundaries

- Provider IDs are normalized before use in paths or URLs. They must be non-empty and cannot contain path separators, `.`/`..`, Windows drive prefixes, null bytes, or control characters.
- Model discovery failures surface as network or parse errors; `401`/`403` discovery failures include provider-specific auth hints.
- Registry server cache loading ignores invalid or unreadable registry files and reports degraded health.
- `kra serve` update failures are logged as warnings so one failing provider does not stop the server from starting or scheduled updates from continuing.
- Concurrent KRA processes coordinate with a global state lock and per-provider locks inside the same local state directory.

## Code Consistency Check

This document was checked against:

- `packages/cli/src/commands/index.ts`, `interactive-add.ts`, and `interactive-update-action.ts` for registered commands and interactive behavior.
- `packages/cli/src/server/index.ts`, `packages/cli/src/server/registry-listing.ts`, and `packages/cli/src/commands/server-runtime.ts` for HTTP endpoints, registry loading, update health, and server update behavior.
- `packages/core/src/operations/index.ts` for operation boundaries.
- `packages/core/src/provider-id.ts` for provider ID and path safety.
- `packages/core/src/lock.ts` for concurrency boundaries.

Related references: `docs/cli-and-server.md` for command/server details and `docs/configuration.md` for config and registry field details.
