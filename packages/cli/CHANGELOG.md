# @kastral/kra

## 0.1.5

### Patch Changes

- [`722bab2`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/722bab2c77f3d736f9f303483672ba8f2288fe41) - Stabilize interactive prompt shutdown by reusing the shared readline session across prompts and disposing it when interactive mode exits.

## 0.1.4

### Patch Changes

- [`a6ed1f5`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/a6ed1f50c0d3c0772d172ed1c651ca2495f137fd) - Add opt-in structured diagnostics logging and stabilize interactive prompt input handling.

  The CLI now keeps a shared readline keypress lifecycle across prompt transitions, preventing intermittent Windows/PowerShell menu freezes caused by repeated readline create/close cycles. Diagnostics can be enabled with `KRA_LOG=1` or `KRA_DEBUG=1` and are written to the KRA state directory by default.

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
