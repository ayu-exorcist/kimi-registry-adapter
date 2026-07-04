# Documentation Map

This document is the documentation inventory and review record for Kimi Registry Adapter. It uses a MECE split by module and document type so future changes have an obvious place to land.

## Processing Inventory

### Module × Document Type Matrix

| Module                            | User guide                                                 | Developer / architecture                            | Operations / release     | Testing / verification | Package / generated reference   | Processing class  |
| --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------ | ---------------------- | ------------------------------- | ----------------- |
| Product overview                  | `README.md`, `README.zh-CN.md`                             | `docs/architecture.md`                              | `docs/release.md`        | `docs/testing.md`      | n/a                             | Update            |
| CLI package and command mode      | `packages/cli/README.md`, `packages/cli/README.zh-CN.md`   | `docs/architecture.md`, `docs/cli-and-server.md`    | `docs/cli-and-server.md` | CLI tests              | `packages/cli/package.json`     | New + update      |
| HTTP registry server              | Root/CLI READMEs                                           | `docs/architecture.md`, `docs/cli-and-server.md`    | `docs/cli-and-server.md` | CLI server tests       | n/a                             | New + update      |
| Core package                      | `packages/core/README.md`, `packages/core/README.zh-CN.md` | `docs/state-and-update.md`, `docs/configuration.md` | n/a                      | Core tests             | `packages/core/package.json`    | New + update      |
| Configuration and registry schema | Root/package READMEs                                       | `docs/configuration.md`, `docs/state-and-update.md` | n/a                      | Schema/config tests    | `schemas/config.schema.json`    | New + preserve    |
| State directory and update engine | Covered in root and package READMEs                        | `docs/state-and-update.md`                          | n/a                      | Core tests             | State files under `registries/` | Preserve + update |
| Release and npm publishing        | Root README, `.changeset/README.md`                        | n/a                                                 | `docs/release.md`        | `docs/testing.md`      | `.github/workflows/release.yml` | Update            |

### New-Class Documents

- `docs/cli-and-server.md` describes the published CLI boundary, interactive mode, command-mode flags, server scheduling, and HTTP endpoints.
- `docs/configuration.md` describes `config.json`, provider fields, model sources, auth precedence, metadata, filters, overrides, and editable registry shape.

### Update-Class Documents

- `README.md` and `README.zh-CN.md`: keep usage modes, state layout, config highlights, docs links, development checks, and publishing summary aligned with current code.
- `packages/cli/README.md` and `packages/cli/README.zh-CN.md`: keep command examples aligned with registered commands: default interactive mode plus `add`, `list`, `auth`, `update`, `remove`, and `serve`.
- `packages/core/README.md` and `packages/core/README.zh-CN.md`: keep operation descriptions, config model, state/update behavior, and exported surface aligned with `packages/core/src/index.ts` and `operations`.
- `docs/architecture.md`, `docs/state-and-update.md`, `docs/release.md`, and `docs/testing.md`: preserve the existing structure while adding cross-links or correcting stale behavior descriptions when code changes.
- `.changeset/README.md`: keep release language aligned with root scripts, Changesets config, and the release workflow.

### Preserve-Class Documents And Artifacts

- `schemas/config.schema.json` remains a generated artifact. Regenerate with `pnpm config-schema:generate`; do not hand-edit.
- `LICENSE` remains the license source.
- Package manifests remain package metadata references, not narrative docs.
- Existing detailed docs keep their role unless the code moves their module boundary.

## Cross-Document Terms

Use these names consistently:

- `provider` for one configured upstream API source.
- `providerId` for the local identifier used in paths and URLs.
- `editable registry` for `registries/<providerId>/api.json`, the file users may edit and Kimi imports.
- `generated registry` for the latest registry generated from discovery results.
- `state directory` for the root containing `config.json`, `auth.json`, `registries/`, and optional git metadata.
- `model source` for `openai_models`, `anthropic_models`, `local_file`, or `remote_url`.
- `metadata source` for `modelsMetadataPath` or the default `https://models.dev/models.json`.
- `update mode` for `merge` or `overwrite` registry write behavior.
- `provider type` for `openai_responses`, `openai`, or `anthropic`.

## Cross-Document Review Checklist

- New developer view: start at the root README, then read `docs/architecture.md`, `docs/configuration.md`, `docs/state-and-update.md`, and `docs/testing.md` before editing code.
- Operations view: read server-mode notes in the root/CLI READMEs, then `docs/cli-and-server.md`, `docs/release.md`, and `docs/testing.md` for runtime and release gates.
- Test view: map changes to `docs/testing.md`, then use the package README and architecture/configuration docs to choose the right seam.

## Review Notes

Objective facts in the detailed docs were traced to the current source files in `packages/cli/src`, `packages/core/src`, package manifests, tests, scripts, and GitHub workflows. Assumptions are explicitly labeled inside the detailed docs. The main corrections made during review were replacing stale `setup`, `init`, `validate`, and `print-url` user-facing command references with the commands currently registered by the CLI; documenting that standalone `validateRegistry` and `printUrl` are core operations, not registered CLI commands; splitting CLI/server and configuration details into dedicated references; correcting operation return-value descriptions; and keeping release wording aligned with the actual root scripts.
