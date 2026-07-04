# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to manage npm package versions and releases.

## Published Packages

Only `@kastral/kra` is published to npm. It lives in `packages/cli` and provides the `kra` command.

`@kastral/kra-core` is a private workspace package. It is ignored by Changesets and is bundled into the CLI build. When a core change affects CLI users, add the changeset to `@kastral/kra` and describe the user-visible behavior.

## Development Workflow

Add a changeset for user-visible CLI behavior, public API, packaging, dependency, or release-artifact changes:

```sh
pnpm changeset
```

Choose `@kastral/kra`, select the bump level, and write a user-facing summary:

- `patch`: bug fixes and small behavior changes
- `minor`: backward-compatible features
- `major`: breaking changes

Commit the generated `.changeset/*.md` file with the implementation.

## Release Workflow

When changesets are merged to `main`, `.github/workflows/release.yml` creates or updates a release PR. That PR runs:

```sh
pnpm version-packages
```

The release PR bumps package versions, updates changelogs, removes consumed changeset files, and updates the lockfile when needed.

After the release PR is merged, the same workflow publishes to npm with:

```sh
pnpm release
```

The release command runs formatting, linting, typechecking, config schema checks, tests, coverage, build, a final config schema check, and then `changeset publish`.

## NPM Trusted Publishing

The workflow is configured for npm Trusted Publishing with GitHub Actions OIDC. Configure the npm package `@kastral/kra` once on npm:

- GitHub organization/user: `ayu-exorcist`
- GitHub repository: `kimi-registry-adapter`
- Workflow file: `release.yml`
- Environment: leave empty

No `NPM_TOKEN` is required for the GitHub release workflow after Trusted Publishing is configured.

## Manual Commands

Preview a release locally:

```sh
pnpm release:dry
```

Publish manually only when CI is unavailable. Local publishing may require `npm login`, and provenance publishing is intended for CI. For an already committed release version, use:

```sh
pnpm release:manual
```

For local versioning from pending changesets, run the version step first, commit the generated changes, then publish:

```sh
pnpm version-packages
git add . && git commit -m "chore(release): version packages"
pnpm release:manual
```
