# @kastral/kra

## 1.0.1

### Patch Changes

- [`7a4fe24`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/7a4fe24e71545f5eb3d015e0a53fde66eb07a437) - Stop npm package runners from warning about pnpm's strict peer dependency setting by storing it in `pnpm-workspace.yaml`.

- [`eb2291a`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/eb2291aba60c51adeb0f28c3ce3b1a8d47fd496e) - Prevent interactive menus from freezing when a terminal sends an incomplete or unsupported dynamic theme response. Prompt input, including Ctrl+C, now recovers after a bounded timeout while valid split theme responses continue to work.

- [`da38b8b`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/da38b8b197435627670d913ac1a8a6b1f25e6ec9) - Update the Hono runtime packages and refresh workspace development tooling to their latest available versions, while retaining the Node.js 22 type definitions.

## 1.0.0

### Major Changes

- [`e896c5e`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/e896c5e19c5a5e93290bc64c1fcc140defe0a526) - Remove the undocumented `testExports` public export. Tests now import internal interactive helpers directly.

### Patch Changes

- [`065061f`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/065061f9707854fe54e4ed272056bd8ef4f55a96) - Update runtime and build dependencies.

## 0.2.0

### Minor Changes

- [`104099d`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/104099d0b8b2156ac6b39ff2dbd736fdc1c331bf) - Make the interactive CLI follow Kimi Code palettes, including custom themes and dynamic terminal light/dark updates.

### Patch Changes

- [`5000014`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/50000141145fdfa98a586475c82a1ea4ec38ad54) - Keep the interactive main menu open when Escape or the left arrow is pressed, so only Ctrl+C exits from the main menu.

- [`d0e6a34`](https://github.com/ayu-exorcist/kimi-registry-adapter/commit/d0e6a340a7b91ee64780dd1838fd09ef81165e13) - Simplify interactive provider removal to always delete local registry files, and document command-mode removal of local-only registries.

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
