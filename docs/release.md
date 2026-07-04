# Release And Publishing

## Top-Level Positioning

KRA publishes one npm package: `@kastral/kra`. The repository root and `@kastral/kra-core` package are private and are not published independently. Versioning and changelog generation are managed by Changesets, and CI publishing is designed to use npm Trusted Publishing through GitHub Actions OIDC.

Objective facts:

- `@kastral/kra` lives in `packages/cli` and provides the `kra` binary.
- `@kastral/kra-core` is private and ignored by Changesets.
- The CI and release workflows use `jdx/mise-action@v4` and `mise.toml` for Node.js and pnpm versions.
- `@kastral/kra` has `publishConfig.access = public` and `publishConfig.provenance = true`.
- The config schema URL points at the current `main` branch schema file.

Implicit assumptions:

- The npm account used for the first publish owns or can publish to the `@kastral` scope.
- The GitHub repository path for Trusted Publishing is `ayu-exorcist/kimi-registry-adapter`.
- Trusted Publishing can only be configured on npm after the package page exists, so an unpublished package needs one initial manual publish.

## Middle-Layer Logic

Release flow has two paths:

1. First publish bootstrap: publish the current `@kastral/kra` version locally with provenance disabled so npm creates the package page.
2. Normal releases: add Changesets, merge them to `main`, let the GitHub workflow create a release PR, merge the release PR, then let the workflow publish through Trusted Publishing.

## Bottom-Layer Details

### Package Versions

Only `packages/cli/package.json` carries the publishable package version. The current `@kastral/kra` version is `0.1.0`.

The root `package.json` and `packages/core/package.json` are private workspace manifests and are not published independently.

### Changesets Configuration

`.changeset/config.json` is configured for public access and ignores `@kastral/kra-core`. User-visible changes in core behavior should still select `@kastral/kra` when running:

```sh
pnpm changeset
```

Use bump levels this way:

- `patch`: bug fixes and small behavior changes.
- `minor`: backward-compatible features.
- `major`: breaking changes.

### First Manual Publish

Use this path only while `@kastral/kra` has never been published:

```sh
pnpm install
pnpm check
pnpm build
npm login
cd packages/cli
npm publish --access public --provenance=false
```

`--provenance=false` is intentional for the first local publish because provenance is intended for the GitHub Actions OIDC workflow.

After this succeeds, configure Trusted Publishing on npm for `@kastral/kra`:

```text
Publisher type: GitHub Actions
GitHub organization/user: ayu-exorcist
Repository: kimi-registry-adapter
Workflow filename: release.yml
Environment: leave empty
```

### Normal CI Release

The release-related root scripts are:

```sh
pnpm changeset
pnpm version-packages
pnpm release:dry
pnpm release
pnpm release:manual
```

The supporting schema scripts are:

```sh
pnpm config-schema:generate
pnpm config-schema:check
```

`pnpm version-packages` runs `changeset version`, regenerates `schemas/config.schema.json`, and updates the lockfile. `pnpm release` runs checks, coverage, build, config schema check, and publishes with `changeset publish`. `pnpm release:manual` is the local one-command publish path for an already committed release version: it runs `pnpm release`.

The GitHub release workflow:

1. Checks out the repository with full history.
2. Installs Node.js and pnpm through mise.
3. Configures the npm registry and upgrades npm for Trusted Publishing support.
4. Installs dependencies with `pnpm install --frozen-lockfile`.
5. Runs `changesets/action@v1` with `version: pnpm version-packages` and `publish: pnpm release`.

When there are pending changesets, the action creates or updates the release PR. When the release PR has consumed the changesets and is merged to `main`, the action publishes packages.

### Manual Release

For normal local publishing after the release version changes are already committed:

```sh
pnpm release:manual
```

For local versioning from pending changesets, run the version step first, commit the generated release changes, then publish:

```sh
pnpm version-packages
git add . && git commit -m "chore(release): version packages"
pnpm release:manual
```

### Local Dry Run

Use this to preview the release status without publishing:

```sh
pnpm release:dry
```

It runs checks, coverage, builds packages, verifies the generated config schema, and prints `changeset status --verbose`.

## Code Consistency Check

This document was checked against:

- `package.json` for release scripts, schema scripts, and `@changesets/cli`.
- `packages/cli/package.json` for `bin`, `files`, and publish config.
- `packages/core/package.json` for private package status.
- `.changeset/config.json` for Changesets behavior.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `mise.toml` for CI tool installation and publishing.
- `scripts/generate-config-schema.ts` for generated config schema checks.
