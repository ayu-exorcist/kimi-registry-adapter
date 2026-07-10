# CLI And Server Reference

## Top-Level Positioning

The `@kastral/kra` package is the only published runtime boundary for KRA. It provides the `kra` binary, which can be used in three modes: guided interactive setup, repeatable command-mode operations, and a long-running HTTP registry server for Kimi imports.

Objective facts:

- The binary entry is `kra` from `packages/cli/package.json`.
- The registered command-mode subcommands are `add`, `remove`, `list`, `auth`, `update`, and `serve`.
- Running `kra` without a subcommand starts interactive mode and requires stdin and stdout to be TTYs.
- Command-mode defaults are state directory `~/.kimi-registry-adapter`, host `127.0.0.1`, and port `2727`.
- `kra serve` probes for an available TCP port and uses the next available port when the requested port is already in use.

Implicit assumptions:

- Kimi can reach the host and port printed by KRA, usually on the same machine through loopback.
- Command-mode JSON output is intended for scripts; interactive output is intended for a human in a terminal.
- Long-running server supervision is left to a terminal, process manager, startup script, or OS service.

## Middle-Layer Logic

Use the mode that matches the workflow:

| Workflow                     | Recommended mode | Reason                                                                 |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------- |
| First local setup            | Interactive      | Prompts collect provider ID, base URL, auth, model source, and models. |
| Repeatable bootstrap script  | Command mode     | Flags make provider setup reproducible.                                |
| Registry refresh for Kimi    | Server mode      | Keeps `api.json` URLs available before and while Kimi starts.          |
| Existing provider management | Interactive      | Menu exposes list, update, remove, auth, refresh, and server actions.  |
| CI or temporary machine use  | One-off `npx`    | State persists locally while avoiding global installation.             |

The server command combines two responsibilities:

1. Optionally update configured providers before listening, and optionally repeat updates on a schedule.
2. Serve the currently valid editable registry files from the state directory.

Update failures during `serve` are warnings. A failed provider update does not prevent the HTTP server from starting or other providers from being served.

## Bottom-Layer Details

### Interactive Mode

```sh
kra
```

Interactive mode opens the main menu. With no configured providers, the practical first action is adding a provider. The add wizard asks for:

1. `providerId`
2. provider API base URL
3. API key source: store in `auth.json`, enter once, use an environment variable, or no auth
4. provider API type: `openai_responses`, `openai`, or `anthropic`
5. model list source: empty for provider default, URL for `remote_url`, or local path for `local_file`
6. model IDs to include
7. future update mode: `merge` or `overwrite`
8. whether to start the registry server immediately

After a provider exists, the interactive update menu can change provider name, base URL, API key source, provider type, model source, included models, update mode, or refresh the registry.

### Command-Mode Commands

#### `add`

```sh
kra add <providerId> --base-url <url> [options]
```

Important options:

- `--type <openai_responses|openai|anthropic>`; default is `openai_responses`.
- `--model-source <openai_models|anthropic_models|local_file|remote_url>`.
- `--model-source-path <path>` for `local_file`.
- `--model-source-url <url>` for `remote_url`, or as a full endpoint override for endpoint sources.
- `--models-metadata-path <url-or-file>`; default metadata source is `https://models.dev/models.json`.
- `--name <display-name>` and `--npm <package>` set optional generated provider metadata.
- `--api-key-env <ENV_NAME>` stores an environment variable reference in `config.json`.
- `--api-key <key>` supplies a transient key for this run only; it is not written to `config.json`.
- `--include` and `--exclude` accept repeated, comma-separated, or space-separated model ID patterns.
- `--update-mode <merge|overwrite>` controls and persists future update behavior on the default update path. With `--no-update`, the current command implementation saves provider config only and does not persist `--update-mode`.
- `--no-update` saves config only and skips registry generation.
- `--state-dir <path>`, `--host <host>`, and `--port <port>` affect output paths or printed import URLs.

Default `add` behavior saves provider config, updates the registry, commits state changes when git is available, and prints JSON containing the provider result, import URL, and recommended `serve` command. With `--no-update`, it only writes config and prints the config path plus option summary.

#### `auth`

```sh
kra auth <providerId> --api-key-env <ENV_NAME>
kra auth <providerId> --api-key <key>
kra auth <providerId> --clear
```

Exactly one auth action is expected in normal use. `auth.json` is intentionally excluded from KRA's state git history by `.gitignore`.

#### `update`

```sh
kra update <providerId> [options]
```

Important options:

- `--models-file <path>` reads an OpenAI-compatible payload from a local file instead of fetching the configured model source.
- `--api-key <key>` supplies a transient key for this update only.
- `--dry-run` computes the result without writing files or persisting `--update-mode`.
- `--force` overwrites the editable registry for this run.
- `--update-mode <merge|overwrite>` controls the run and, unless `--dry-run` is used, persists to provider config.

The command prints JSON with the editable registry path, model count, metadata match summary, update-state counts, and optional commit hash.

#### `list`

```sh
kra list
```

Prints JSON with configured provider IDs and count:

```json
{ "providers": ["moonshot"], "count": 1 }
```

#### `remove`

```sh
kra remove <providerId>
kra remove <providerId> --keep-files
```

`remove` deletes matching provider config and stored auth when present. Without `--keep-files`, it also removes `registries/<providerId>/`, including a local-only registry whose provider entry is no longer present in `config.json`. Missing config, auth, or registry entries are ignored. The operation commits the resulting state change when git is available.

#### `serve`

```sh
kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

Important options:

- `--no-update` skips the startup update pass.
- `--update-interval <duration>` schedules repeated updates. Supported units are `m`, `h`, and `d`; the minimum interval is `1m`.
- `--update-concurrency <n>` controls how many provider updates run in parallel. Default is `1`.
- `--update-timeout-ms <ms>` controls the per-provider update timeout. Default is `30000`.
- `--state-dir <path>`, `--host <host>`, and `--port <port>` select the served state and bind address.

Scheduled updates skip a run if the previous scheduled run is still active.

### HTTP Endpoints

`kra serve` exposes:

- `GET /healthz` — HTTP `200` JSON snapshot with state directory, loaded provider count, provider IDs, optional invalid-registry count, and optional scheduled-update health. Top-level `status` covers serving readiness; nested `updates.status` is independent.
- `GET /api.json` — HTTP `200` aggregate registry built from all currently loaded valid provider registries; it can be `{}` when none are loaded.
- `GET /:providerId/api.json` — one provider registry; returns `400` for an invalid provider ID and `503` when no valid registry is currently available for that provider.

The server scans `registries/*/api.json` at startup and watches those files for add, change, and unlink events. Each provider registry file must contain exactly one provider entry matching the directory name. Invalid files are excluded from the cache and reported through degraded health. If a previously valid file becomes invalid, the last valid cached version remains served until the file is fixed or removed. Health consumers must inspect the JSON body rather than treating HTTP `200` alone as readiness.

### Diagnostics Handoff

`KRA_DEBUG=1` and `KRA_LOG=1` enable structured diagnostics; `KRA_LOG_LEVEL` controls the minimum level and `KRA_LOG_FILE` overrides the destination. The default active path is `~/.kimi-registry-adapter/logs/kra-debug.log`, independent of a command-level `--state-dir` override.

Use `KRA_DEBUG=1` for routine diagnosis. In interactive mode, `KRA_LOG=1` also emits raw stdin bytes at debug level and can capture secrets entered at prompts. KRA appends without rotation. See `docs/operations.md` for the complete security boundary, health interpretation, supervision, and recovery playbooks.

## Code Consistency Check

This document was checked against:

- `packages/cli/package.json` for binary metadata.
- `packages/cli/src/commands/index.ts` and `command-mode.ts` for registered commands and interactive default behavior.
- `packages/cli/src/commands/command-mode-args.ts`, `command-mode-handlers.ts`, and `args.ts` for flags, defaults, parsing, and JSON output shape.
- `packages/cli/src/commands/interactive-add.ts` and `interactive-update-action.ts` for prompt flow and editable provider actions.
- `packages/cli/src/commands/server-runtime.ts`, `duration.ts`, and `packages/cli/src/server/index.ts` for serve behavior, update scheduling, health tracking, and HTTP endpoints.
- `packages/core/src/logger.ts` and `packages/cli/src/prompts/terminal-session.ts` for diagnostics flags and interactive raw-input behavior.
