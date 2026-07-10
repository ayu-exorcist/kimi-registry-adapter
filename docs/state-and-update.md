# State And Update Design

## Top-Level Positioning

The state directory is KRA's durable source of truth. It stores provider definitions, optional auth references, editable registries, source snapshots, update metadata, and optional git history. The update engine turns current discovery input into a generated registry and then writes the user-facing editable registry.

Objective facts:

- The default state directory is `~/.kimi-registry-adapter`.
- `registries/<providerId>/api.json` is the editable registry served to Kimi.
- `registries/<providerId>/.internal/models.json` stores the last discovered source models as `{ "data": [...] }`.
- `registries/<providerId>/.internal/state.json` stores KRA metadata, including `lastGeneratedRegistry` and update state.
- The merge baseline normally comes from that internal state; if it is unavailable, KRA falls back to the committed editable registry and then the newly generated registry.
- `config.json` and `auth.json` are separate files.
- Detailed configuration and editable registry field references are documented in `docs/configuration.md`.

Implicit assumptions:

- Users edit only `registries/<providerId>/api.json`.
- Files under `.internal/` are KRA-owned implementation state.
- Git is optional. When unavailable or unconfigured, KRA still writes state and uses `.internal/state.json` as the update baseline.

## Middle-Layer Logic

An update has two phases:

1. Prepare outside the provider write lock where possible: read config, resolve auth, fetch or parse models, and read metadata.
2. Apply under the provider lock: re-read config/auth snapshots, transform models, merge or overwrite the editable registry, write files, and optionally commit.

This split keeps long-running network discovery out of the critical write section while still detecting provider or auth changes before writing.

## Bottom-Layer Details

### State Layout

```text
config.json
auth.json
.git/
.kra.lock
.kra.locks/<providerId>.lock
registries/<providerId>/api.json
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json
```

`createStatePaths(stateDir, providerId)` derives canonical paths and validates that provider IDs cannot escape the state directory.

### Config Model

`config.json` has these top-level areas:

- `$schema`: defaults to the repository schema URL.
- `server`: defaults to host `127.0.0.1` and port `2727`.
- `update`: defaults to mode `merge`.
- `providers`: map of `providerId` to provider config.

A provider config includes `name`, `baseUrl`, `type`, optional `modelSource`, optional `modelsMetadataPath`, optional `apiKeyEnv`, optional `updateMode`, optional `preserveUnknownModels`, optional package metadata, fallback capability defaults, include/exclude filters, and per-model overrides.

Provider IDs are validated before use in config keys or filesystem paths. They must be non-empty, must not be `.` or `..`, and must not contain path separators, Windows drive prefixes, null bytes, or control characters.

### Auth Precedence

`auth.json` stores optional local credentials or environment variable names per provider. Runtime API key resolution uses this order:

1. `auth.providers[providerId].apiKey`
2. `auth.providers[providerId].apiKeyEnv`
3. `config.providers[providerId].apiKeyEnv`
4. `KIMI_PROVIDERS_<PROVIDER_ID>_API_KEY`
5. `KIMI_PROVIDERS_API_KEY`

The `<PROVIDER_ID>` portion is uppercased and non-alphanumeric characters are replaced with underscores.

### Model Source Resolution

A provider can use these model sources:

- `openai_models`: fetch an OpenAI-compatible models endpoint.
- `anthropic_models`: fetch an Anthropic-compatible models endpoint.
- `local_file`: parse models from a local JSON payload.
- `remote_url`: fetch and parse models from an arbitrary URL. Provider API keys are not sent to this source unless `modelSource.auth` is explicitly set to `provider`.

If `modelSource` is omitted, KRA derives a provider default from the provider type. Endpoint-based model sources can set `modelSource.modelsUrl` as a full models endpoint override.

Metadata defaults to `https://models.dev/models.json` unless `modelsMetadataPath` is configured. Metadata can match exactly by model ID or by normalized ID after lowercasing, trimming, and removing a vendor prefix such as `vendor/model`. If multiple metadata entries collapse to the same normalized ID, the normalized match is treated as ambiguous and not used.

### Transform Rules

The transform layer filters and enriches discovered models before writing a registry:

- Default include is `*`.
- Default exclude patterns are `*embedding*`, `*embed*`, `*rerank*`, `*tts*`, and `*whisper*`.
- Default fallback context is `131072`.
- Default fallback tool calling is `false`.
- Metadata can fill name, family, limits, tool calling, reasoning, interleaved support, and modalities when source model fields do not already provide those values.
- Per-model overrides can override `id`, `name`, `family`, `limit`, `tool_call`, `reasoning`, `interleaved`, and `modalities` after inference.
- Unknown extra fields are allowed in editable registry providers and models, so user metadata can survive validation when it is added to `api.json`.

### Merge And Overwrite

`overwrite` replaces editable application data with the latest generated data. It is selected when `--force` is passed, when the effective update mode is `overwrite`, or when the provider/global config says `overwrite`.

`merge` performs a three-way merge across generated provider-level fields and each generated model field:

- The old side is `.internal/state.json.lastGeneratedRegistry` when available, otherwise the git-committed `api.json`, otherwise the new generated registry.
- If the current editable value still equals the old generated value, KRA takes the new generated value.
- If the new generated value still equals the old generated value, KRA keeps the current editable value.
- If all sides are plain objects, KRA recurses by key.
- Otherwise KRA keeps the current editable value and records a conflict entry in `.internal/state.json.updateState.conflicts` plus a warning summary. Provider-level conflicts use `modelId: "__provider__"` in the stored conflict record.

Generated provider fields such as `name`, `api`, `type`, `env`, and `npm` therefore receive upstream/config changes under the same preservation rules as model fields. Unknown extra editable fields are not traversed because no incoming generated key targets them.

By default, models that are no longer generated are removed from the editable registry. Setting provider `preserveUnknownModels` keeps those unknown models. Before update, KRA refuses to proceed when the editable `api.json` already contains git conflict markers.

### Writes And Locks

KRA uses two lock scopes:

- Global state lock: config/auth changes and git commits.
- Provider lock: one provider's registry write path.

`updateProviderOperation` persists a non-dry-run `--update-mode` under the global state lock before discovery, prepares discovery outside the provider lock, then applies the prepared result under the provider lock. During apply, it re-reads provider config and provider auth snapshots; if either changed during discovery, the update aborts and asks the caller to retry.

Registry writes use temporary files plus `write-transaction.json` so a later run can recover from a partial write. Config and auth writes are atomic text writes. Lock directories contain owner metadata and stale lock handling; locks coordinate KRA processes on one local host/state directory, not arbitrary external writers. Operational timeout, stale-lock, and interrupted-write recovery guidance is in `docs/operations.md`.

## Code Consistency Check

This document was checked against:

- `packages/core/src/config.ts` for config schema and defaults.
- `packages/core/src/auth.ts` for auth precedence.
- `packages/core/src/provider-model-source.ts` for model source resolution.
- `packages/core/src/transform.ts` for filtering, defaults, metadata matching, and overrides.
- `packages/core/src/model-capability.ts` for source-field, metadata, and override precedence.
- `packages/core/src/update.ts`, `packages/core/src/registry-merge.ts`, and `packages/core/src/state.ts` for merge/overwrite behavior, unknown-model handling, conflict tracking, and transaction recovery.
- `packages/core/src/provider-id.ts` for provider ID and path safety.
- `packages/core/src/operations/provider-update.ts` for operation-level update-mode persistence and lock order.
- `packages/core/src/lock.ts` for lock behavior.

Related reference: `docs/configuration.md` for the full config and registry schema narrative.
