import * as readline from 'node:readline';

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

export const exitPrompt = (): never => {
  promptOutput().write('\nBye!\n');
  return promptRuntime.exit(0);
};

let rawModeLeaseCount = 0;

const acquireRawMode = (): void => {
  const input = promptInput();
  if (!input.isTTY) return;
  if (rawModeLeaseCount === 0) {
    input.setRawMode(true);
  }
  rawModeLeaseCount += 1;
};

const releaseRawMode = (): void => {
  const input = promptInput();
  if (!input.isTTY || rawModeLeaseCount === 0) return;
  rawModeLeaseCount -= 1;
  if (rawModeLeaseCount === 0) {
    input.setRawMode(false);
  }
};

export const preparePromptInput = (readlineInterface?: readline.Interface): void => {
  acquireRawMode();
  readline.emitKeypressEvents(promptInput(), readlineInterface);
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
    options.readlineInterface?.close();
  };
};
