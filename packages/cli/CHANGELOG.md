# @kastral/kra

## 0.1.3

### Patch Changes

- [`d74ea33`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/d74ea331385091a09800fcd2e176d5d1aaaf59e8) - Fix registry updates so provider-level fields like `type` and `api` are merged back into `api.json` during refresh instead of staying stale.

## 0.1.2

### Patch Changes

- [`b947bf9`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/b947bf9b7ed8773c4c9addd201d8394602c2c688) - Loosen the published CLI Node.js engine range to support Node.js versions `>=22.18`
  without an upper bound, and refresh internal tooling metadata.

## 0.1.1

### Patch Changes

- [`6dca714`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/6dca71480202e6819f6c44bfae12f00d0182d283) - Fix CLI entrypoint detection when launched through package-runner symlinks such as `npx`, and document one-off execution with `pnpm dlx`, `npx`, `bunx`, and `yarn dlx`.
