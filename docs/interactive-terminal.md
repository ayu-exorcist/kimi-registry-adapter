# Interactive Terminal Lifecycle

## Scope

KRA interactive mode owns terminal input for the lifetime of the complete wizard, not for the lifetime of an individual prompt. This boundary covers menus, text inputs, searchable model selection, loading indicators, result screens, and server controls.

The session-level ownership is required on Windows terminals. Releasing raw mode and removing the last stable stdin data route between a loading screen and the next prompt can leave Node's JavaScript flags reporting `isRaw=true` and `isPaused=false` while the console no longer delivers input reliably.

## Input flow

Interactive startup establishes this flow before the first prompt creates its shared readline interface:

```text
process.stdin
  -> one session-level data listener
    -> optional terminal-theme report filtering
      -> stable PassThrough key input
        -> shared readline key decoder
          -> current prompt keypress handler
```

The active theme does not change this ownership model. `auto` adds terminal-report filtering to the stable route; fixed and custom themes use a direct forwarding route.

## Lifecycle contract

At interactive startup KRA:

1. resolves the initial Kimi palette;
2. installs terminal-theme tracking when the palette is `auto`;
3. installs the prompt input session, creating a direct route when theme tracking did not create one;
4. acquires raw mode once;
5. creates the shared readline interface on the stable key input when the first prompt starts.

During the session:

- prompts add and remove only their own keypress and resize handlers;
- loading indicators do not release raw mode;
- transitions never remove the session-level stdin data listener;
- raw mode remains enabled across prompt/loading/prompt sequences;
- a loading indicator retains ownership until filtered keyboard input is idle, so held keys and incomplete terminal escape sequences cannot control the next prompt;
- loading input is discarded except for `Ctrl+C`, which displays the existing busy warning without interrupting the operation;
- the input-idle boundary applies to both resolved and rejected loading actions;
- diagnostics report `inputSessionActive`, `readableFlowing`, and physical stdin data-listener counts.

A `TerminalSession` instance owns the runtime streams, filtered input router, shared readline state, raw-mode lease, and active prompt input session. Existing prompt helpers delegate to the default instance so command and test call sites keep the same API.

At interactive shutdown KRA:

1. closes the shared readline interface;
2. disposes the prompt input session and releases raw mode;
3. removes the direct input route when the session owns it;
4. disables and removes dynamic terminal-theme tracking when active.

All disposal operations are idempotent. Standalone prompt tests and non-interactive consumers retain the previous prompt-scoped raw-mode lease as a compatibility fallback when no input session is installed.

## Regression contract

Automated tests must cover repeated `loading -> prompt` transitions through the real prompt primitives with an input stream, not only direct synthetic `keypress` events. The invariant is:

- one physical stdin data route remains installed for the session;
- `setRawMode(true)` occurs once at session startup;
- prompt cleanup does not call `setRawMode(false)`;
- input remains usable after repeated transitions;
- loading input, including a terminal escape sequence split across chunks, cannot control the next prompt;
- repeated input cannot cross the loading boundary when an action rejects and the interaction recovers;
- loading input drain waits for a short idle period but has a fixed total wait bound;
- the first `Ctrl+C` aborts the current loading action, and repeated interrupts do not extend cleanup indefinitely;
- the busy warning renders below the animated operation line;
- session shutdown removes its route and calls `setRawMode(false)` once.

A release smoke test on Windows Terminal should also update a provider's selected model list repeatedly and verify that the returned provider menu accepts an arrow key immediately. In-memory `PassThrough` tests protect ownership and listener counts but cannot fully emulate the Windows console handle.

## Diagnostics

Use `KRA_DEBUG=1` for normal diagnosis. Prompt lifecycle snapshots include whether the session is active, whether stdin is flowing, the physical stdin data-listener count, the filtered keypress-listener count, raw mode, and the raw-mode lease count.

`KRA_LOG=1` additionally records raw input bytes and can capture secrets typed at prompts. Use it only in a controlled menu-only reproduction, protect the log file, and delete it after review.
