import * as readline from 'node:readline';
import { PassThrough, Writable } from 'node:stream';

import { logDebug } from '@kastral/kra-core';

import {
  DISABLE_TERMINAL_THEME_REPORTING,
  ENABLE_TERMINAL_THEME_REPORTING,
  OSC11_QUERY,
  QUERY_TERMINAL_THEME,
  TERMINAL_THEME_INPUT_BUFFER_TIMEOUT_MS,
  createTerminalThemeInputState,
  handleTerminalThemeInput,
  type ResolvedTheme,
} from '../theme/terminal-theme';

export interface PromptLifecycleOptions {
  readlineInterface?: readline.Interface;
  keypressHandler: () => (char: string, key: readline.Key) => void;
  resizeHandler?: () => () => void;
  sigwinchHandler?: () => () => void;
  resizeSubscription?: () => void;
}

export interface TerminalResizeOptions {
  poll?: boolean;
  pollMs?: number;
}

export interface PromptInputBoundary {
  waitForIdle: () => Promise<void>;
  dispose: () => void;
}

export type PromptRuntime = {
  input: typeof process.stdin;
  output: typeof process.stdout;
  exit: (code?: number) => never;
};

type PromptReadlineState = {
  readlineInterface: readline.Interface | undefined;
  keypressEventsPrepared: boolean;
};

const promptReadlineStateSymbol = Symbol.for('kimi-registry-adapter.promptReadlineState');

const promptReadlineState = (): PromptReadlineState => {
  const globalScope = globalThis as typeof globalThis & {
    [promptReadlineStateSymbol]?: PromptReadlineState;
  };
  globalScope[promptReadlineStateSymbol] ??= {
    readlineInterface: undefined,
    keypressEventsPrepared: false,
  };
  return globalScope[promptReadlineStateSymbol] as PromptReadlineState;
};

let promptRuntime: PromptRuntime = {
  input: process.stdin,
  output: process.stdout,
  exit: (code = 0) => process.exit(code),
};

type PromptInputRouter = {
  keyInput: PassThrough;
  handleData: (chunk: Buffer | string) => void;
};

type PromptInputSession = {
  dispose: () => void;
};

let promptInputRouter: PromptInputRouter | undefined;
let promptInputSession: PromptInputSession | undefined;

export const setPromptRuntime = (runtime: Partial<PromptRuntime>): (() => void) => {
  const previous = promptRuntime;
  promptRuntime = { ...promptRuntime, ...runtime };
  return () => {
    promptRuntime = previous;
  };
};

export const promptInput = (): typeof process.stdin => promptRuntime.input;

/** Input after terminal-control reports have been removed, when tracking is active. */
export const promptKeyInput = (): typeof process.stdin =>
  (promptInputRouter?.keyInput ?? promptRuntime.input) as typeof process.stdin;

export const promptOutput = (): typeof process.stdout => promptRuntime.output;

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export const sharedPromptReadline = (): readline.Interface => {
  const state = promptReadlineState();
  if (!state.readlineInterface) {
    const input = promptKeyInput();
    input.setMaxListeners(Math.max(input.getMaxListeners(), 50));
    state.readlineInterface = readline.createInterface({
      input,
      output: silentOutput,
      terminal: false,
    });
    logDebug('prompt.terminal', 'readline.create', inputSnapshot());
  }
  return state.readlineInterface;
};

export const disposePromptReadline = (): void => {
  const state = promptReadlineState();
  if (!state.readlineInterface) return;
  logDebug('prompt.terminal', 'readline.dispose');
  state.readlineInterface.close();
  state.readlineInterface = undefined;
  state.keypressEventsPrepared = false;
};

export const exitPrompt = (): never => {
  disposePromptReadline();
  disposePromptInputSession();
  promptOutput().write('\nBye!\n');
  return promptRuntime.exit(0);
};

let rawModeLeaseCount = 0;
let rawDataObserverInstalled = false;

const inputSnapshot = (): Record<string, unknown> => {
  const input = promptInput();
  return {
    isTTY: input.isTTY,
    isPaused: typeof input.isPaused === 'function' ? input.isPaused() : undefined,
    isRaw: input.isRaw,
    readableFlowing: input.readableFlowing,
    dataListeners: input.listenerCount('data'),
    keypressListeners: promptKeyInput().listenerCount('keypress'),
    inputSessionActive: promptInputSession !== undefined,
    rawModeLeaseCount,
  };
};

const installRawDataObserver = (): void => {
  if (rawDataObserverInstalled || process.env['KRA_LOG'] !== '1') return;
  rawDataObserverInstalled = true;
  promptInput().on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    logDebug('prompt.terminal', 'stdin.data', {
      bytes: buffer.length,
      hex: buffer.toString('hex'),
      ...inputSnapshot(),
    });
  });
};

const acquireRawMode = (): void => {
  const input = promptInput();
  logDebug('prompt.terminal', 'raw.acquire.before', inputSnapshot());
  if (!input.isTTY) return;
  if (rawModeLeaseCount === 0) {
    input.setRawMode(true);
  }
  rawModeLeaseCount += 1;
  logDebug('prompt.terminal', 'raw.acquire.after', inputSnapshot());
};

const releaseRawMode = (): void => {
  const input = promptInput();
  logDebug('prompt.terminal', 'raw.release.before', inputSnapshot());
  if (!input.isTTY || rawModeLeaseCount === 0) return;
  rawModeLeaseCount -= 1;
  if (rawModeLeaseCount === 0) {
    input.setRawMode(false);
  }
  logDebug('prompt.terminal', 'raw.release.after', inputSnapshot());
};

/**
 * Own stdin routing and raw mode for the complete interactive CLI session.
 * Individual prompts only attach their key handlers, so transitions between a
 * prompt and a loading screen never leave the Windows TTY without a data
 * consumer or rapidly toggle the console mode.
 */
export const installPromptInputSession = (): (() => void) => {
  if (promptInputSession !== undefined) {
    return (): void => {};
  }

  const input = promptInput();
  let ownedRouter: PromptInputRouter | undefined;
  if (promptInputRouter === undefined) {
    const keyInput = new PassThrough();
    const handleData = (chunk: Buffer | string): void => {
      keyInput.write(chunk);
    };
    ownedRouter = { keyInput, handleData };
    promptInputRouter = ownedRouter;
    input.on('data', handleData);
  }

  let disposed = false;
  const session: PromptInputSession = {
    dispose: (): void => {
      if (disposed || promptInputSession !== session) return;
      disposed = true;
      promptInputSession = undefined;
      releaseRawMode();
      if (ownedRouter !== undefined && promptInputRouter === ownedRouter) {
        input.removeListener('data', ownedRouter.handleData);
        promptInputRouter = undefined;
        ownedRouter.keyInput.end();
      }
      logDebug('prompt.terminal', 'session.dispose', inputSnapshot());
    },
  };
  promptInputSession = session;

  try {
    acquireRawMode();
    input.resume();
    promptKeyInput().resume();
    logDebug('prompt.terminal', 'session.install', inputSnapshot());
  } catch (error) {
    session.dispose();
    throw error;
  }

  return session.dispose;
};

export const disposePromptInputSession = (): void => {
  promptInputSession?.dispose();
};

const PROMPT_INPUT_IDLE_MS = 500;

/**
 * Keep the current interaction active until filtered keyboard input is idle.
 * This drains held keys and incomplete escape sequences without pausing the
 * session-level stdin route or changing raw mode between interactions.
 */
export const createPromptInputBoundary = (
  options: { idleMs?: number } = {},
): PromptInputBoundary => {
  const idleMs = Math.max(0, options.idleMs ?? PROMPT_INPUT_IDLE_MS);
  const input = promptKeyInput();
  let disposed = false;
  let lastInputAt: number | undefined;
  let handoffImmediate: ReturnType<typeof setImmediate> | undefined;
  let resolveHandoff: (() => void) | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveIdle: (() => void) | undefined;
  let waitPromise: Promise<void> | undefined;

  const finishIdleWait = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    const resolve = resolveIdle;
    resolveIdle = undefined;
    resolve?.();
  };

  const scheduleIdleWait = (): void => {
    if (resolveIdle === undefined) return;
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    if (lastInputAt === undefined) {
      finishIdleWait();
      return;
    }

    const remainingMs = Math.max(0, idleMs - (Date.now() - lastInputAt));
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (lastInputAt !== undefined && Date.now() - lastInputAt < idleMs) {
        scheduleIdleWait();
        return;
      }
      finishIdleWait();
    }, remainingMs);
  };

  const handleData = (): void => {
    lastInputAt = Date.now();
    scheduleIdleWait();
  };
  input.on('data', handleData);

  const waitForHandoff = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (disposed) {
        resolve();
        return;
      }
      resolveHandoff = resolve;
      handoffImmediate = setImmediate(() => {
        handoffImmediate = undefined;
        resolveHandoff = undefined;
        resolve();
      });
    });

  const waitForIdle = (): Promise<void> => {
    waitPromise ??= (async () => {
      await waitForHandoff();
      if (disposed) return;
      await new Promise<void>((resolve) => {
        resolveIdle = resolve;
        scheduleIdleWait();
      });
    })();
    return waitPromise;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    input.removeListener('data', handleData);
    if (handoffImmediate !== undefined) {
      clearImmediate(handoffImmediate);
      handoffImmediate = undefined;
    }
    const handoffResolve = resolveHandoff;
    resolveHandoff = undefined;
    handoffResolve?.();
    finishIdleWait();
  };

  return { waitForIdle, dispose };
};

export const preparePromptInput = (
  readlineInterface: readline.Interface = sharedPromptReadline(),
): void => {
  installRawDataObserver();
  const input = promptInput();
  const keyInput = promptKeyInput();
  logDebug('prompt.terminal', 'prepare.before', inputSnapshot());
  if (promptInputSession === undefined) {
    acquireRawMode();
  }
  const state = promptReadlineState();
  if (!state.keypressEventsPrepared) {
    readline.emitKeypressEvents(keyInput, readlineInterface);
    state.keypressEventsPrepared = true;
    logDebug('prompt.terminal', 'keypress.prepare');
  }
  input.resume();
  keyInput.resume();
  logDebug('prompt.terminal', 'prepare.after', inputSnapshot());
  process.nextTick(() => {
    logDebug('prompt.terminal', 'prepare.nextTick', inputSnapshot());
  });
};

export const installTerminalThemeTracking = (
  onTheme: (theme: ResolvedTheme) => void,
): (() => void) => {
  const input = promptInput();
  const output = promptOutput();
  if (!input.isTTY || !output.isTTY || promptInputRouter !== undefined) {
    return (): void => {};
  }

  const keyInput = new PassThrough();
  const inputState = createTerminalThemeInputState();
  let osc11BufferTimer: ReturnType<typeof setTimeout> | undefined;
  const clearOsc11BufferTimer = (): void => {
    if (osc11BufferTimer === undefined) return;
    clearTimeout(osc11BufferTimer);
    osc11BufferTimer = undefined;
  };
  const updateOsc11BufferTimer = (wasBuffering: boolean): void => {
    if (inputState.osc11Buffer.length === 0) {
      clearOsc11BufferTimer();
      return;
    }
    if (wasBuffering || osc11BufferTimer !== undefined) return;
    osc11BufferTimer = setTimeout(() => {
      const bufferedBytes = Buffer.byteLength(inputState.osc11Buffer);
      inputState.osc11Buffer = '';
      osc11BufferTimer = undefined;
      logDebug('prompt.terminal', 'theme.osc11.buffer.timeout', { bufferedBytes });
    }, TERMINAL_THEME_INPUT_BUFFER_TIMEOUT_MS);
  };
  const handleData = (chunk: Buffer | string): void => {
    const data = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    const wasBuffering = inputState.osc11Buffer.length > 0;
    const result = handleTerminalThemeInput(data, output, onTheme, inputState);
    updateOsc11BufferTimer(wasBuffering);
    if (result === undefined) {
      keyInput.write(data);
      return;
    }
    if (result.data !== undefined) {
      keyInput.write(result.data);
    }
  };
  const router: PromptInputRouter = { keyInput, handleData };
  promptInputRouter = router;
  input.on('data', handleData);
  input.resume();

  try {
    output.write(ENABLE_TERMINAL_THEME_REPORTING);
    output.write(OSC11_QUERY);
    output.write(QUERY_TERMINAL_THEME);
  } catch {
    // Theme tracking is visual enhancement only; forwarding keyboard input remains safe.
  }

  return (): void => {
    if (promptInputRouter !== router) return;
    input.removeListener('data', handleData);
    clearOsc11BufferTimer();
    inputState.osc11Buffer = '';
    promptInputRouter = undefined;
    keyInput.end();
    try {
      output.write(DISABLE_TERMINAL_THEME_REPORTING);
    } catch {
      // Best effort only, matching the query path above.
    }
  };
};

export const subscribeTerminalResize = (
  handler: () => void,
  options: TerminalResizeOptions = {},
): (() => void) => {
  const { poll = false, pollMs = 150 } = options;
  let disposed = false;
  const output = promptOutput();
  let lastColumns = output.columns ?? 80;

  const notify = (): void => {
    if (disposed) return;
    const nextColumns = output.columns ?? 80;
    if (nextColumns === lastColumns) return;
    lastColumns = nextColumns;
    handler();
  };

  const resizePoll = poll ? setInterval(notify, pollMs) : undefined;
  output.on('resize', notify);
  process.on('SIGWINCH', notify);

  return (): void => {
    if (disposed) return;
    disposed = true;
    if (resizePoll) {
      clearInterval(resizePoll);
    }
    output.removeListener('resize', notify);
    process.removeListener('SIGWINCH', notify);
  };
};

export const createPromptCleanup = (options: PromptLifecycleOptions): (() => void) => {
  let cleanedUp = false;

  return (): void => {
    if (cleanedUp) return;
    cleanedUp = true;

    logDebug('prompt.terminal', 'cleanup.before', inputSnapshot());
    promptKeyInput().removeListener('keypress', options.keypressHandler());
    options.resizeSubscription?.();
    const resizeHandler = options.resizeHandler?.();
    if (resizeHandler) {
      promptOutput().removeListener('resize', resizeHandler);
    }
    const sigwinchHandler = options.sigwinchHandler?.();
    if (sigwinchHandler) {
      process.removeListener('SIGWINCH', sigwinchHandler);
    }
    if (promptInputSession === undefined) {
      releaseRawMode();
    }
    logDebug('prompt.terminal', 'cleanup.after', inputSnapshot());
  };
};
