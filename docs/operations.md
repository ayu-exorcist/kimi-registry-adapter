# Operations And Troubleshooting

## Top-Level Positioning

KRA is a local long-running HTTP service only when `kra serve` is running. Operators are responsible for starting it before Kimi, keeping the process alive, protecting its state and diagnostics, and monitoring both registry availability and update freshness.

Objective facts:

- The default listener is `127.0.0.1:2727`.
- `kra serve` updates configured providers before listening unless `--no-update` is passed.
- If the requested port is unavailable, KRA probes upward until it finds an available TCP port and prints the selected port.
- Registry availability is reported by the top-level `/healthz.status`; scheduled update status is reported separately under `/healthz.updates`.
- Structured diagnostics are opt-in and append JSON Lines to `~/.kimi-registry-adapter/logs/kra-debug.log` by default.
- The HTTP server does not implement authentication or TLS.

Implicit assumptions:

- KRA normally runs on the same machine as Kimi and remains bound to loopback.
- A terminal, startup script, process manager, or OS service restarts KRA after a host reboot or process failure.
- Operators back up credentials separately from git because `auth.json` is intentionally excluded from the state repository.

## Middle-Layer Logic

Operate KRA as three related but distinct planes:

| Plane       | Source of truth                                          | Healthy condition                                                   | Primary recovery action                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Serving     | Valid `registries/*/api.json` files loaded in memory     | `/healthz.status` is `ok` and the required provider ID is present   | Repair or regenerate the affected editable registry          |
| Updating    | Provider config, auth, model sources, and update tracker | `/healthz.updates.status` is `ok` after a run                       | Fix auth/source failures, then run `kra update <providerId>` |
| Persistence | State directory, internal baselines, optional local git  | State writes and commits complete without lock or filesystem errors | Stop competing writers, inspect disk/permissions, then retry |

A serving process can remain available while an update is degraded. Conversely, `/healthz` can report degraded serving even when the most recent update run succeeded, for example when no valid registry is loaded.

## Bottom-Layer Details

### Startup And Supervision

Use an explicit state directory in supervised environments:

```sh
npx @kastral/kra serve \
  --state-dir /path/to/kra-state \
  --host 127.0.0.1 \
  --port 2727 \
  --update-interval 1h \
  --update-concurrency 1 \
  --update-timeout-ms 30000
```

Startup order is:

1. Resolve the state directory, bind host, and first candidate port.
2. Find an available port at or above the requested port.
3. Run the startup provider update pass unless `--no-update` is set.
4. Start scheduled updates when `--update-interval` is configured.
5. Load valid registries, start the file watcher, and begin listening.

A failing provider update is reported as a warning and does not prevent other providers from updating or the server from starting. The per-provider timeout defaults to `30000ms`; update concurrency defaults to `1`. A scheduled tick is skipped when the previous scheduled run is still active.

KRA handles `SIGINT` and `SIGTERM` by closing the registry watcher and HTTP server. Supervisors should send one of those signals and allow graceful shutdown before forcing termination.

### Readiness And Health

Check:

```sh
curl http://127.0.0.1:2727/healthz
```

The endpoint returns HTTP `200` with a JSON snapshot. Consumers must inspect the JSON fields rather than treating the HTTP status alone as readiness.

Top-level fields:

- `status`: `ok` only when at least one valid registry is loaded and no registry is currently marked invalid; otherwise `degraded`.
- `stateDir`: state directory served by this process.
- `providerCount` and `providerIds`: currently loaded valid registries.
- `invalidRegistryCount`: present when one or more registry directories cannot be loaded or validated.
- `updates`: present when `kra serve` supplies the update tracker.

`updates.status` is one of `idle`, `running`, `ok`, or `degraded`. The nested object can also report run timestamps, provider count, running provider IDs, and failed provider IDs. A degraded nested update status does not change the top-level serving status.

Endpoint behavior at degraded or empty state:

- `GET /api.json` still returns HTTP `200`; it can return `{}` when no valid registry is loaded.
- `GET /:providerId/api.json` returns `503` when that provider has no valid cached registry.
- An invalid provider ID returns `400`.
- If a previously valid watched file becomes invalid, KRA keeps serving its last valid in-memory value while marking health degraded. Deleting the file removes that cached provider.

### Diagnostics

Enable structured diagnostics for one process:

```sh
KRA_DEBUG=1 npx @kastral/kra serve
```

Environment variables:

| Variable                                 | Behavior                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `KRA_DEBUG=1`                            | Enables structured diagnostics without installing the interactive raw-input observer.                                  |
| `KRA_LOG=1`                              | Enables structured diagnostics and, in interactive mode, records raw stdin chunks as byte counts and hexadecimal data. |
| `KRA_LOG_LEVEL=debug\|info\|warn\|error` | Sets the minimum level; missing or unrecognized values use `debug`.                                                    |
| `KRA_LOG_FILE=<path>`                    | Overrides the log file with an absolute or current-working-directory-relative path.                                    |

The active logger writes one JSON object per line with `ts`, `level`, `runId`, `scope`, `event`, and `context`. Keys matching common credential names are recursively replaced with `[REDACTED]`, and log-write failures are ignored so diagnostics cannot stop normal CLI behavior.

Security boundary: prefer `KRA_DEBUG=1` for general troubleshooting. `KRA_LOG=1` records raw interactive terminal bytes at debug level and can therefore capture text entered at prompts, including secrets, despite key-based field redaction. Restrict log permissions, delete sensitive captures after diagnosis, and do not attach a log to an issue without reviewing it. Setting `KRA_LOG_LEVEL=info` or higher suppresses those debug events.

The default active log path is `~/.kimi-registry-adapter/logs/kra-debug.log`. Passing `--state-dir` does not relocate it; set `KRA_LOG_FILE` when logs must live beside a custom state directory. KRA appends to the file and does not rotate it, so retention and rotation belong to the operator.

### Recovery Playbooks

**Registry health is degraded**

1. Read `providerIds` and `invalidRegistryCount` from `/healthz`.
2. Validate that each `registries/<providerId>/api.json` is valid JSON, contains exactly one provider, and that its key matches the directory name.
3. Run `kra update <providerId>` to regenerate when local edits can be merged safely.
4. If the file contains git conflict markers, resolve them manually before retrying; KRA refuses to update such a file.
5. Recheck `/healthz` after the watcher reloads the repaired file.

**Updates are degraded**

1. Inspect `updates.failedProviderIds` and stderr.
2. Run `kra update <providerId> --state-dir <path>` directly to surface the provider-specific error.
3. For `401` or `403`, verify the auth precedence and environment visible to the supervised process.
4. Verify the model source URL/file and metadata source. Remote metadata failure is non-fatal; provider model discovery failure is not.
5. Increase `--update-timeout-ms` only when the upstream is expected to take longer than the current limit.

**The requested port changes**

KRA deliberately selects the next available port. Use the port printed at startup and update the imported Kimi URL or remove the conflicting listener. Do not assume the requested port was retained.

**A state lock times out**

Global and provider locks are directories at `.kra.lock` and `.kra.locks/<providerId>.lock`, with owner metadata. The default acquisition timeout is five minutes, and the normal stale threshold is thirty minutes. Stop or wait for other KRA processes using the same state directory before retrying. Do not delete a lock that may still have a live owner; KRA performs stale-lock recovery itself.

**A process stops during a registry write**

Registry writes stage temporary files and a `.internal/write-transaction.json` manifest. A later state load/write attempts to finish a valid interrupted transaction. Preserve the provider directory for recovery; do not delete `.internal/` as routine cleanup.

### Security And Backup Boundaries

- Keep the default loopback bind unless another host must reach KRA. A non-loopback bind exposes unauthenticated registry and health endpoints; place an authenticated TLS reverse proxy or equivalent network control in front when exposure is required.
- Prefer environment-variable auth references over stored API keys. If `auth.json` contains keys, restrict filesystem permissions.
- Local git tracks config and registry state but excludes `auth.json`, locks, logs, and other unmatched files through the generated `.gitignore`.
- Git history alone is not a complete backup. Disaster recovery also needs a protected copy of `auth.json` when it stores credentials, or a record of the required environment variables.
- Do not hand-edit `.internal/models.json`, `.internal/state.json`, lock metadata, or write-transaction files.

## Code Consistency Check

This document was checked against:

- `packages/cli/src/commands/command-mode-handlers.ts` and `server-runtime.ts` for startup ordering, port selection, update scheduling, timeouts, concurrency, and signal handling.
- `packages/cli/src/server/index.ts` and `server/registry-listing.ts` for watcher behavior, endpoint status codes, cache fallback, and health semantics.
- `packages/core/src/logger.ts`, `packages/core/src/diagnostics.ts`, and `packages/cli/src/prompts/terminal-session.ts` for diagnostics flags, paths, levels, redaction, and raw-input behavior.
- `packages/core/src/lock.ts`, `state.ts`, and `git.ts` for lock defaults, transaction recovery, and tracked state.

Related references: `docs/cli-and-server.md` for command syntax, `docs/state-and-update.md` for merge and persistence design, and `docs/configuration.md` for auth and model-source fields.
