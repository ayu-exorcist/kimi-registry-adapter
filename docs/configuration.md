# Configuration And Registry Reference

## Top-Level Positioning

KRA configuration describes where upstream model data comes from, how discovered models become Kimi registry entries, and how future updates should treat local edits. The main user-editable durable file is `config.json`; the main Kimi-facing editable file is `registries/<providerId>/api.json`.

Objective facts:

- Runtime config is parsed by the schema in `packages/core/src/config.ts`.
- The generated JSON Schema artifact is `schemas/config.schema.json`.
- The default provider type is `openai_responses`.
- Supported provider types are `openai_responses`, `openai`, and `anthropic`.
- Supported model sources are `openai_models`, `anthropic_models`, `local_file`, and `remote_url`.
- Unknown extra fields are allowed in editable registry providers and models, but not in `config.json` provider definitions.

Implicit assumptions:

- Users normally change config through `kra` commands or interactive mode instead of hand-editing `config.json`.
- Users may hand-edit `registries/<providerId>/api.json` after KRA generates it, especially to add Kimi-specific metadata or adjust exposed model fields.
- KRA's config schema is the contract for automation; narrative examples in docs should be treated as illustrations, not a replacement for schema validation.

## Middle-Layer Logic

Configuration is split by concern:

| Concern               | File / field                                 | Purpose                                                  |
| --------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Server defaults       | `config.json.server`                         | Default host and port for URL generation and `serve`.    |
| Update defaults       | `config.json.update.mode`                    | Global default update mode when a provider has no mode.  |
| Provider definition   | `config.json.providers[providerId]`          | Upstream API, model source, filters, metadata, defaults. |
| Auth storage          | `auth.json.providers[providerId]`            | Optional local API key or env-var name.                  |
| Editable registry     | `registries/<providerId>/api.json`           | Registry imported by Kimi and safe for manual edits.     |
| Generated baseline    | `.internal/state.json.lastGeneratedRegistry` | Primary three-way merge baseline for later updates.      |
| Source model snapshot | `.internal/models.json`                      | Last discovered raw models as `{ "data": [...] }`.       |

If the internal generated baseline is unavailable, update recovery falls back to the git-committed editable registry and then to the newly generated registry.

The transformation pipeline is:

```text
configured provider + resolved auth
  -> model source payload
  -> discovered models with IDs
  -> include/exclude filtering
  -> metadata and source-field capability inference
  -> per-model overrides
  -> generated registry
  -> merge or overwrite editable registry
```

## Bottom-Layer Details

### `config.json` Shape

A minimal config looks like:

```json
{
  "$schema": "https://raw.githubusercontent.com/ayu-exorcist/kimi-registry-adapter/refs/heads/main/schemas/config.schema.json",
  "server": { "host": "127.0.0.1", "port": 2727 },
  "update": { "mode": "merge" },
  "providers": {
    "moonshot": {
      "name": "moonshot",
      "baseUrl": "https://api.moonshot.cn/v1",
      "type": "openai_responses",
      "apiKeyEnv": "MOONSHOT_API_KEY"
    }
  }
}
```

Top-level defaults:

- `$schema` defaults to the repository schema URL when KRA writes config.
- `server.host` defaults to `127.0.0.1`.
- `server.port` defaults to `2727`.
- `update.mode` defaults to `merge`.
- `providers` defaults to an empty object.

### Provider IDs

A provider ID is used as a config key, filesystem directory name, git path segment, and URL path segment. It must be non-empty, must not be `.` or `..`, and must not contain:

- `/` or `\`
- Windows drive prefixes such as `C:`
- null bytes
- ASCII control characters

KRA normalizes and validates provider IDs before path access. Invalid provider IDs are rejected rather than sanitized into another value.

### Provider Fields

A provider config supports:

- `name` — display name and generated registry provider name.
- `baseUrl` — upstream API base URL and generated registry `api` value.
- `type` — `openai_responses`, `openai`, or `anthropic`; default is `openai_responses`.
- `modelSource` — optional explicit model discovery source.
- `modelsMetadataPath` — optional metadata URL or local file; default is `https://models.dev/models.json`.
- `apiKeyEnv` — environment variable reference for provider auth.
- `updateMode` — provider-level `merge` or `overwrite` behavior.
- `preserveUnknownModels` — keep editable models no longer generated during merge updates.
- `npm` — optional provider package metadata copied into the generated registry provider.
- `fallbackContext` — context-window default when neither source nor metadata provides one; transform default is `131072`.
- `fallbackToolCall` — tool-calling default when neither source nor metadata provides one; transform default is `false`.
- `include` — model ID wildcard patterns to include; default is `*`.
- `exclude` — model ID wildcard patterns to exclude.
- `overrides` — per-model generated field overrides.

`config.json` provider definitions are strict: unknown provider fields are rejected by the runtime schema and generated JSON Schema.

### Provider Types And Default Model Endpoints

Provider types affect generated registry `type`, default model source kind, and discovery headers:

| Provider type      | Default model source | Discovery auth header                        |
| ------------------ | -------------------- | -------------------------------------------- |
| `openai_responses` | `openai_models`      | `Authorization: Bearer <apiKey>`             |
| `openai`           | `openai_models`      | `Authorization: Bearer <apiKey>`             |
| `anthropic`        | `anthropic_models`   | `x-api-key: <apiKey>` plus Anthropic version |

For endpoint sources, KRA derives the models URL from `baseUrl` unless `modelsUrl` is set. If the base URL path already ends in `/v1`, the derived path is `./models`; otherwise it is `./v1/models` relative to the base URL.

### Model Sources

`modelSource` can be omitted. In that case, KRA uses the provider-type default endpoint source.

Explicit forms:

```json
{ "kind": "openai_models", "modelsUrl": "https://api.example.com/v1/models" }
{ "kind": "anthropic_models", "modelsUrl": "https://api.example.com/v1/models" }
{ "kind": "local_file", "path": "./models.json" }
{ "kind": "remote_url", "url": "https://example.com/models.json", "auth": "none" }
```

`local_file` and `remote_url` payloads may be either an array of model objects or an object with a `data` array. Entries without a non-empty string `id` are ignored during payload parsing.

`remote_url.auth` defaults to `none`. Provider API keys are sent to a remote URL only when `auth` is explicitly set to `provider`.

### Auth Resolution

At update time, KRA resolves provider API keys in this order:

1. `auth.json.providers[providerId].apiKey`
2. `auth.json.providers[providerId].apiKeyEnv`
3. `config.json.providers[providerId].apiKeyEnv`
4. `KIMI_PROVIDERS_<PROVIDER_ID>_API_KEY`
5. `KIMI_PROVIDERS_API_KEY`

For the provider-specific environment variable, the provider ID is uppercased and non-alphanumeric characters are replaced with underscores.

### Filters And Overrides

Filter patterns use `*` wildcards and are matched case-insensitively against model IDs.

Defaults:

- include: `*`
- exclude: `*embedding*`, `*embed*`, `*rerank*`, `*tts*`, `*whisper*`

Per-model overrides are keyed by source model ID and can set:

- `id`
- `name`
- `family`
- `limit.context`
- `limit.output`
- `tool_call`
- `reasoning`
- `interleaved`
- `modalities.input`
- `modalities.output`

Overrides are applied after source-field and metadata inference. `override.id` changes the model object's `id` field, but the containing `models` map key remains the original discovered model ID.

### Metadata Matching

`modelsMetadataPath` may point to an HTTP(S) URL or a local JSON file. The default `models.dev` metadata is cached for five minutes in memory and under `~/.kimi-registry-adapter/cache/` so separate CLI runs can reuse it; stale entries use ETag or Last-Modified conditional requests when the server provides those headers. Custom remote metadata stays in memory and is never persisted. Local metadata is cached by file mtime and size.

Metadata entries can fill model name, family, limits, tool calling, reasoning, interleaved support, and modalities. Matching happens first by exact model ID, then by normalized ID. Normalization trims, lowercases, and removes one vendor prefix such as `vendor/model`. If more than one metadata key normalizes to the same ID, that normalized match is considered ambiguous and is not used.

When remote metadata fetch fails, KRA logs a warning and continues without remote metadata, or with a cached remote value when one exists. Local metadata read or parse errors are not swallowed.

### Editable Registry Shape

A generated provider registry has this shape:

```json
{
  "moonshot": {
    "id": "moonshot",
    "name": "moonshot",
    "api": "https://api.moonshot.cn/v1",
    "type": "openai_responses",
    "env": ["MOONSHOT_API_KEY"],
    "models": {
      "kimi-k2": {
        "id": "kimi-k2",
        "name": "kimi-k2",
        "limit": { "context": 131072 },
        "tool_call": false
      }
    }
  }
}
```

Generated providers require `id`, `name`, `api`, `type`, and `models`. Generated models require `id` and `name`; capability fields are optional. Editable registry validation allows extra provider and model fields so users can add namespaced or Kimi-specific metadata to `api.json`.

## Code Consistency Check

This document was checked against:

- `packages/core/src/config.ts` and `schemas/config.schema.json` for config fields and defaults.
- `packages/core/src/provider-descriptor.ts` and `provider-model-source.ts` for provider types, model source kinds, default endpoint derivation, discovery headers, and remote auth behavior.
- `packages/core/src/auth.ts` and `provider-id.ts` for auth resolution and provider ID rules.
- `packages/core/src/model-payload.ts`, `models-metadata.ts`, `transform.ts`, and `model-capability.ts` for payload parsing, metadata behavior, filters, defaults, and overrides.
- `packages/core/src/schema.ts` for editable and generated registry shapes.
