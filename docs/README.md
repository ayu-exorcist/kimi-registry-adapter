# Documentation Map

This document is the documentation inventory and review record for Kimi Registry Adapter. It uses a MECE split by module and document type so future changes have an obvious place to land.

## Processing Inventory

### Module × Document Type Matrix

| Module                            | Getting started / user guide                               | Architecture / reference                                 | Operations / release                           | Testing / governance                         | Package / generated reference                            | Processing class  |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- | ----------------- |
| Product and workspace             | `README.md`, `README.zh-CN.md`                             | `docs/architecture.md`                                   | n/a                                            | `docs/typescript-coding-standards.md`        | root `package.json`, `mise.toml`                         | Update            |
| CLI and interactive prompts       | `packages/cli/README.md`, `packages/cli/README.zh-CN.md`   | `docs/cli-and-server.md`, `docs/interactive-terminal.md` | diagnostics section in `docs/operations.md`    | CLI and prompt coverage in `docs/testing.md` | `packages/cli/package.json`, `packages/cli/CHANGELOG.md` | Update + preserve |
| HTTP server and diagnostics       | CLI/root README summaries                                  | server contract in `docs/cli-and-server.md`              | `docs/operations.md`                           | server/logger coverage in `docs/testing.md`  | runtime health JSON                                      | New + update      |
| Core domain engine                | `packages/core/README.md`, `packages/core/README.zh-CN.md` | public operations in package READMEs                     | persistence recovery in `docs/operations.md`   | core coverage in `docs/testing.md`           | `packages/core/package.json`                             | Update            |
| Configuration and registry schema | configuration highlights in root/package READMEs           | `docs/configuration.md`                                  | auth/security boundary in `docs/operations.md` | schema checks in `docs/testing.md`           | `schemas/config.schema.json`                             | Update + preserve |
| State and update engine           | state summaries in root/package READMEs                    | `docs/state-and-update.md`                               | recovery playbooks in `docs/operations.md`     | state/update tests in `docs/testing.md`      | files under `registries/`                                | Update            |
| Release and publishing            | release summary in root README                             | `.changeset/README.md`                                   | `docs/release.md`                              | release gates in `docs/testing.md`           | workflows, Changesets config, changelog                  | Update + preserve |
| Documentation governance          | `docs/README.md`                                           | cross-document terms and review record                   | n/a                                            | review checklist below                       | `LICENSE`                                                | Update + preserve |

### New-Class Documents

- `docs/operations.md` fills the missing operator view: startup ordering, supervision, health semantics, diagnostics, security boundaries, graceful shutdown, and recovery playbooks. It separates serving health from update health and calls out the raw-input risk of `KRA_LOG=1`.

### Update-Class Documents

- `README.md` and `README.zh-CN.md`: correct merge-baseline fallback behavior and link the new operations reference.
- `packages/cli/README.md` and `packages/cli/README.zh-CN.md`: add the supported diagnostics controls, log-location caveat, and operations link.
- `packages/core/README.md` and `packages/core/README.zh-CN.md`: align the documented export surface with the current diagnostics exports and add the operations boundary.
- `docs/architecture.md`: add diagnostics to the runtime boundary and failure model.
- `docs/cli-and-server.md`: document exact health semantics, diagnostics handoff, and the complete important `add` option set.
- `docs/configuration.md`: distinguish the primary generated baseline from its recovery fallbacks.
- `docs/state-and-update.md`: document provider-level three-way merge behavior and baseline fallback order.
- `docs/release.md`: make the package manifest the current-version authority and remove the obsolete first-publish bootstrap path.
- `docs/testing.md`: include diagnostics coverage and the colocated core diagnostics test.
- `docs/typescript-coding-standards.md`: include the enabled `noPropertyAccessFromIndexSignature` compiler rule.
- `docs/README.md`: replace the stale inventory and review record with this current MECE audit.

### Preserve-Class Documents And Artifacts

- `.changeset/README.md` remains the contributor release workflow; it matches the current scripts and GitHub action.
- `packages/cli/CHANGELOG.md` remains generated release history; historical version numbers belong there rather than in main-branch narrative docs.
- `schemas/config.schema.json` remains generated. Regenerate with `pnpm config-schema:generate`; do not hand-edit.
- `LICENSE`, package manifests, workflow files, and Changesets config remain source artifacts rather than narrative docs.

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

## Version Reference Policy

Main-branch narrative docs do not duplicate the current `@kastral/kra` package version. `packages/cli/package.json` is the current-version authority; `packages/cli/CHANGELOG.md` and git tags own historical versions. Runtime compatibility constraints such as the minimum Node.js version, protocol versions, and versioned external APIs remain in docs because they describe behavioral requirements rather than the repository's current release number.

## Cross-Document Review Checklist

- New developer view: start at the root README, then read `docs/architecture.md`, `docs/configuration.md`, `docs/state-and-update.md`, and `docs/testing.md` before editing code.
- Operations view: read server-mode notes in the root/CLI READMEs, then `docs/operations.md`, `docs/cli-and-server.md`, and `docs/release.md` for runtime, recovery, and release gates.
- Test view: map changes to `docs/testing.md`, then use the package README and architecture/configuration docs to choose the right seam.

## Review Notes

Objective facts in the detailed docs were traced to current source under `packages/cli/src` and `packages/core/src`, manifests, tests, scripts, generated schema, Changesets config, and GitHub workflows. Assumptions are explicitly labeled in the detailed design and operations docs.

The adversarial review corrected these code/document mismatches: current package version authority now points to the manifest instead of a duplicated literal; normal release flow replaces the obsolete first-publish bootstrap; provider-level fields participate in three-way merge; the committed registry is only a fallback when internal generated state is unavailable; top-level serving health remains independent from nested update health; `/healthz` requires JSON inspection despite HTTP `200`; and diagnostics flags, level, path, retention, and the secret-capture risk specific to interactive `KRA_LOG=1` are now documented. No standalone `validate` or `print-url` CLI command was introduced; those remain core operations.
