# @kastral/kra

[English](./README.md) | [简体中文](./README.zh-CN.md)

Command-line interface for Kimi Registry Adapter. It creates and maintains editable Kimi provider registry files from OpenAI-compatible, Anthropic-compatible, local, or remote model sources, then serves URLs that Kimi can import.

## Requirements

- Node.js `>=22.18 <25`
- pnpm or `npx`

## Install / run

Run the published CLI without installing it into a project:

```sh
npx @kastral/kra --help
```

For local development in this repository:

```sh
pnpm dev -- --help
```

## Recommended: interactive mode

Interactive mode is the primary user experience for local setup:

```sh
npx @kastral/kra
```

Use it when you want KRA to guide the workflow instead of remembering flags. It is especially useful for the first provider because it opens a minimal setup flow when no providers exist.

After at least one provider exists, the interactive home menu supports:

- adding another provider
- listing configured providers and import URLs
- updating provider settings, including auth source and registry refresh
- removing a provider
- starting the local registry server

A typical interactive flow is:

1. Start `npx @kastral/kra`.
2. Add a provider.
3. Choose a model source and the models to include.
4. Configure auth with an environment variable name.
5. Update the registry.
6. Start the server or list the import URL.
7. Import `http://127.0.0.1:2727/<providerId>/api.json` in Kimi.

## CLI command mode

Command mode is best for repeatable shell scripts, CI jobs, and users who already know the provider settings.

### Add a provider definition

`add` writes provider config, updates the editable registry by default, commits state changes when git is available, and prints the Kimi import URL. Pass `--no-update` to only write provider config:

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY
```

### Add a provider and update immediately

The default `add` behavior saves config, updates the editable registry, commits state changes when git is available, and prints the Kimi import URL plus a recommended serve command:

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY \
  --update-mode merge
```

### Configure auth

Prefer storing an environment variable name instead of a raw key:

```sh
npx @kastral/kra auth moonshot --api-key-env MOONSHOT_API_KEY
```

For one-off add or update runs, `--api-key <key>` may be passed; command implementations do not write that transient value to `config.json`. Use `auth --clear` to remove stored auth for a provider.

### Update

```sh
npx @kastral/kra update moonshot --update-mode merge
```

Use `update --dry-run` to preview an update without writing files. When combined with `--update-mode`, dry-run does not persist that mode to `config.json`. Use `update --force` to overwrite the editable registry for that run.

### List providers and import URLs

```sh
npx @kastral/kra list
```

`list` returns the configured provider IDs. Interactive mode's list view also renders import URLs for the configured host and port.

### Serve registries over HTTP

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

`serve` can update configured providers before startup unless `--no-update` is passed. Scheduled updates refresh the configured provider list each run. Use `--update-concurrency <n>` to update multiple providers at once and `--update-timeout-ms <ms>` to set the per-provider timeout; defaults are concurrency `1` and timeout `30000ms`.

### Remove a provider

```sh
npx @kastral/kra remove moonshot --keep-files
```

Omit `--keep-files` to remove local registry files too.

## One-off `npx` mode

Every CLI example above can be run as a one-off `npx` command. This is useful when:

- trying KRA without installing it globally
- running on a temporary machine
- scripting CI or local bootstrap tasks
- sharing a copy-paste bootstrap command

Examples:

```sh
npx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
npx @kastral/kra update moonshot
npx @kastral/kra serve --host 127.0.0.1 --port 2727
```

State is still persisted under `~/.kimi-registry-adapter` unless `--state-dir <path>` is provided.

## State directory

By default KRA stores state in `~/.kimi-registry-adapter`:

```text
config.json                              # providers, server defaults, update defaults
registries/<providerId>/api.json          # editable registry served to Kimi
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json
auth.json                                # optional local credentials or env-var names
.git/                                    # state changes are committed for review/rollback when git is available
```

Only edit `registries/<providerId>/api.json`. Do not edit files under `.internal/`; KRA uses them for source snapshots and update merge baselines. If git is unavailable, KRA still updates and merges registries without creating commits.

Use `--state-dir <path>` on commands to override it.

## Model sources

Provider discovery supports these sources:

- `openai_models` — fetch an OpenAI-compatible models endpoint. This is the default for OpenAI-style providers.
- `anthropic_models` — fetch an Anthropic-compatible models endpoint.
- `local_file` — read a local models payload.
- `remote_url` — fetch a models payload from an arbitrary URL. Provider API keys are not sent to `remote_url` sources unless config explicitly sets `modelSource.auth` to `provider`.

In interactive add/update, an empty model-source input uses the provider-type default endpoint, an `http://` or `https://` input is stored as `remote_url`, and any other input is stored as `local_file`.

For `--base-url`, OpenAI-style provider types (`openai_responses` and `openai`) usually end in `/v1`; Anthropic-compatible providers usually use a `baseUrl` that does not end in `/v1`.

Examples:

```sh
npx @kastral/kra add local-provider \
  --base-url http://localhost:4000/v1 \
  --model-source local_file \
  --model-source-path ./models.json

npx @kastral/kra add remote-provider \
  --base-url https://api.example.com/v1 \
  --model-source remote_url \
  --model-source-url https://example.com/models.json
```

For endpoint-based sources, pass `--model-source-url <url>` with `--model-source openai_models` or `--model-source anthropic_models` to override the full models endpoint. Metadata enrichment defaults to `https://models.dev/models.json`; use `--models-metadata-path <url-or-file>` to override it.

## Filtering and update modes

Use `--include` and `--exclude` in command mode to control which model IDs are written to the editable registry. Interactive mode asks which fetched models to include and omits the separate exclude prompt to keep guided setup short. Patterns can be repeated, space-separated, or comma-separated.

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --include "kimi-*" \
  --exclude "*-preview,*-deprecated"
```

Update modes:

- `merge` preserves local edits where possible and records conflicts in `.internal/state.json` while keeping current editable values when upstream and local edits cannot be reconciled.
- `overwrite` regenerates application data from discovery results.

## HTTP endpoints from `serve`

- `GET /healthz` — runtime health and loaded provider IDs.
- `GET /api.json` — aggregate registry across all loaded providers.
- `GET /:providerId/api.json` — registry for one provider; this is the URL printed for Kimi imports.

## Related docs

- [Architecture](../../docs/architecture.md)
- [CLI and server reference](../../docs/cli-and-server.md)
- [Configuration and registry reference](../../docs/configuration.md)
- [State and update design](../../docs/state-and-update.md)
- [Release and publishing](../../docs/release.md)
- [Testing and verification](../../docs/testing.md)

## License

MIT.
