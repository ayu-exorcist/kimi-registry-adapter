import * as readline from 'node:readline';
import { Writable } from 'node:stream';

import { logDebug } from '@kastral/kra-core';

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

export const setPromptRuntime = (runtime: Partial<PromptRuntime>): (() => void) => {
  const previous = promptRuntime;
  promptRuntime = { ...promptRuntime, ...runtime };
  return () => {
    promptRuntime = previous;
  };
};

export const promptInput = (): typeof process.stdin => promptRuntime.input;

export const promptOutput = (): typeof process.stdout => promptRuntime.output;

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export const sharedPromptReadline = (): readline.Interface => {
  const state = promptReadlineState();
  if (!state.readlineInterface) {
    const input = promptInput();
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
    keypressListeners: input.listenerCount('keypress'),
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

export const preparePromptInput = (
  readlineInterface: readline.Interface = sharedPromptReadline(),
): void => {
  installRawDataObserver();
  logDebug('prompt.terminal', 'prepare.before', inputSnapshot());
  acquireRawMode();
  const state = promptReadlineState();
  if (!state.keypressEventsPrepared) {
    readline.emitKeypressEvents(promptInput(), readlineInterface);
    state.keypressEventsPrepared = true;
    logDebug('prompt.terminal', 'keypress.prepare');
  }
  promptInput().resume();
  logDebug('prompt.terminal', 'prepare.after', inputSnapshot());
  process.nextTick(() => {
    logDebug('prompt.terminal', 'prepare.nextTick', inputSnapshot());
  });
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
    promptInput().removeListener('keypress', options.keypressHandler());
    options.resizeSubscription?.();
    const resizeHandler = options.resizeHandler?.();
    if (resizeHandler) {
      promptOutput().removeListener('resize', resizeHandler);
    }
    const sigwinchHandler = options.sigwinchHandler?.();
    if (sigwinchHandler) {
      process.removeListener('SIGWINCH', sigwinchHandler);
    }
    releaseRawMode();
    logDebug('prompt.terminal', 'cleanup.after', inputSnapshot());
  };
};
