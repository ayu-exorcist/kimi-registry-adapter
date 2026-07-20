# Terminal Theme Integration

KRA's interactive CLI follows the effective Kimi Code palette so selection, success, warning, and error states remain visually consistent with the agent users run alongside it. This is a presentation feature only: it does not change provider configuration, registry contents, network requests, or command output data.

## Resolution flow

At entry to interactive mode, KRA resolves Kimi Code's data directory as `KIMI_CODE_HOME` when it is non-empty, otherwise `~/.kimi-code`.

1. Read `<KIMI_CODE_HOME>/tui.toml` using the same TOML format Kimi Code uses.
2. `theme = "dark"` selects Kimi's dark palette; `theme = "light"` selects its light palette.
3. A custom theme reads `<KIMI_CODE_HOME>/themes/<name>.json`. Valid `colors` tokens override its `base` (`dark` by default or `light`). KRA uses all palette tokens it renders, including `primary`, `success`, `warning`, and `error`.
4. Missing, malformed, unsafe, or unreadable Kimi configuration is treated as `auto` for KRA's fallback behavior.
5. `auto` queries the terminal background through OSC 11, falls back to `COLORFGBG`, then defaults to dark. The built-in fallback primaries are `#4FA8FF` for dark and `#1565C0` for light.

No KRA-specific theme file or command option is introduced. Kimi Code remains the source of user customization.

## Dynamic `auto` behavior

For `auto`, KRA matches Kimi Code's runtime protocol. Theme filtering is an optional transform on the same session-level input route used by fixed and custom themes; it does not own prompt or raw-mode lifetimes.

- it enables terminal theme reporting (`CSI ? 2031 h`), sends the OSC 11 background query and the terminal-theme query;
- it removes those terminal-control replies before they reach the prompt key parser;
- when an OSC 11 reply reports a changed background, it swaps between the Kimi dark and light palettes and redraws the active prompt or persistent result view;
- on exit it removes the stdin listener, restores the normal prompt input channel, and disables terminal theme reporting.

The initial OSC 11 probe is capped at 250 ms and restores raw mode/listeners on every outcome. Non-TTY operation, `NO_COLOR`, `FORCE_COLOR=0`, and CI skip that initial probe and settle on the dark fallback; normal ANSI color styling remains disabled by the existing `picocolors` policy.

## Type and test contract

`ColorPalette` mirrors Kimi Code's semantic palette tokens. `ColorToken` prevents renderers from referencing an undefined color role. `ResolvedTheme` is the strict `'dark' | 'light'` result of terminal detection.

Vitest coverage verifies built-in and custom palette resolution, invalid/missing config fallback, OSC 11 precedence, `COLORFGBG` fallback, color opt-out, fragmented terminal replies, and runtime input filtering/recoloring.

Interactive stdin and raw mode are owned by the complete CLI session so prompt/loading transitions cannot deactivate the Windows console input channel. See [Interactive Terminal Lifecycle](./interactive-terminal.md) for the ownership and regression contract.
