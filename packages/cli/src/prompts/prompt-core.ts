import * as readline from 'node:readline';

import pc from 'picocolors';

import { colorize, subscribeColorPalette } from '../theme';
import { interactiveHomeSymbol, isHomeKey } from './navigation';
import {
  clearTerminalScreen,
  FrameRenderer,
  renderAppHeader,
  terminalContentWidth,
  wrapPlainText,
} from './screen';
import {
  createPromptCleanup,
  exitPrompt,
  preparePromptInput,
  sharedPromptReadline,
  subscribeTerminalResize,
} from './terminal-session';

export const promptSymbols = {
  get stepActive(): string {
    return colorize('primary', '◆');
  },
  get stepCancel(): string {
    return colorize('error', '■');
  },
  get stepSubmit(): string {
    return colorize('success', '◇');
  },
  get radioActive(): string {
    return colorize('primary', '●');
  },
  radioInactive: pc.dim('○'),
  get checkboxActive(): string {
    return colorize('primary', '■');
  },
  checkboxInactive: pc.dim('□'),
  bar: pc.dim('│'),
};

export type PromptRenderState = 'active' | 'submit' | 'cancel';
type PromptDetailTone = 'current' | 'info' | 'danger';

export type PromptDetail = {
  text: string;
  tone?: PromptDetailTone;
};

export const createPromptReadline = (): readline.Interface => {
  const rl = sharedPromptReadline();
  preparePromptInput(rl);
  return rl;
};

export const promptLinePrefix = (): string => `${promptSymbols.bar}  `;

const renderPromptDetail = (detail: PromptDetail): string => {
  if (detail.tone === 'danger') {
    return colorize('error', detail.text);
  }

  if (detail.tone === 'current') {
    return detail.text;
  }

  return pc.dim(detail.text);
};

export const promptStateIcon = (state: PromptRenderState): string => {
  if (state === 'active') return promptSymbols.stepActive;
  if (state === 'cancel') return promptSymbols.stepCancel;
  return promptSymbols.stepSubmit;
};

export const renderPromptDetails = (
  details: PromptDetail[],
  prefix = promptLinePrefix(),
): string[] =>
  details.flatMap((detail) =>
    wrapPlainText(detail.text, terminalContentWidth(prefix)).map(
      (line) => `${prefix}${renderPromptDetail({ ...detail, text: line })}`,
    ),
  );

export const renderPromptHint = (hint: string, prefix = promptLinePrefix()): string[] =>
  wrapPlainText(hint, terminalContentWidth(prefix)).map((line) => `${prefix}${pc.dim(line)}`);

const createPromptFrameControls = (
  frame: FrameRenderer,
  render: () => void,
): { clearRender: () => void; redrawScreen: () => void; resizeHandler: () => void } => {
  const redrawScreen = (): void => {
    frame.reset();
    clearTerminalScreen();
    renderAppHeader();
    render();
  };

  return {
    clearRender: () => frame.clear(),
    redrawScreen,
    resizeHandler: redrawScreen,
  };
};

export type FinishPromptOptions<T> = {
  clearOnExit: boolean;
  clearRender: () => void;
  render: (state: Exclude<PromptRenderState, 'active'>) => void;
  cleanup: () => void;
  resolve: (value: T | symbol) => void;
};

export const createPromptLifecycle = (options: {
  readlineInterface: readline.Interface;
  frame: FrameRenderer;
  render: () => void;
  keypressHandler: () => (char: string, key: readline.Key) => void;
}): {
  clearRender: () => void;
  redrawScreen: () => void;
  cleanup: () => void;
} => {
  const { clearRender, redrawScreen, resizeHandler } = createPromptFrameControls(
    options.frame,
    options.render,
  );
  const resizeSubscription = subscribeTerminalResize(resizeHandler);
  const cleanupPrompt = createPromptCleanup({
    readlineInterface: options.readlineInterface,
    keypressHandler: options.keypressHandler,
    resizeSubscription,
  });
  const unsubscribeTheme = subscribeColorPalette(redrawScreen);
  const cleanup = (): void => {
    unsubscribeTheme();
    cleanupPrompt();
  };
  return { clearRender, redrawScreen, cleanup };
};

const finishPrompt = <T>(
  options: FinishPromptOptions<T> & {
    value: T | symbol;
    state: Exclude<PromptRenderState, 'active'>;
  },
): void => {
  if (options.clearOnExit) {
    options.clearRender();
  } else {
    options.render(options.state);
  }
  options.cleanup();
  options.resolve(options.value);
};

export const createPromptFinisher = <T>(options: FinishPromptOptions<T>) => {
  return (value: T | symbol, state: Exclude<PromptRenderState, 'active'>): void =>
    finishPrompt({ ...options, value, state });
};

export const finishPromptHome = <T>(
  options: Omit<FinishPromptOptions<T>, 'render'> & { value: symbol },
): void => {
  if (options.clearOnExit) {
    options.clearRender();
  }
  options.cleanup();
  options.resolve(options.value);
};

export const hiddenItemsLine = (hiddenBefore: number, hiddenAfter: number): string | undefined => {
  if (hiddenBefore === 0 && hiddenAfter === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
  if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
  return `${promptSymbols.bar}  ${pc.dim(parts.join('  '))}`;
};

export const visibleWindow = (
  cursor: number,
  itemCount: number,
  maxVisible: number,
): { start: number; end: number } => {
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), itemCount - maxVisible));
  return { start, end: Math.min(itemCount, start + maxVisible) };
};

export const createPromptSession = <T>(options: {
  readlineInterface: readline.Interface;
  frame: FrameRenderer;
  render: (state?: PromptRenderState) => void;
  keypressHandler: () => (char: string, key: readline.Key) => void;
  clearOnExit: boolean;
  resolve: (value: T | symbol) => void;
}): {
  redrawScreen: () => void;
  cleanup: () => void;
  finish: (value: T | symbol, state: Exclude<PromptRenderState, 'active'>) => void;
  goHome: () => void;
} => {
  const { clearRender, redrawScreen, cleanup } = createPromptLifecycle({
    readlineInterface: options.readlineInterface,
    frame: options.frame,
    render: options.render,
    keypressHandler: options.keypressHandler,
  });
  const finishOptions = {
    clearOnExit: options.clearOnExit,
    clearRender,
    render: options.render,
    cleanup,
    resolve: options.resolve,
  };
  return {
    redrawScreen,
    cleanup,
    finish: createPromptFinisher<T>(finishOptions),
    goHome: () => finishPromptHome({ ...finishOptions, value: interactiveHomeSymbol }),
  };
};

export const deletePreviousWord = (
  value: string,
  cursor: number,
): { value: string; cursor: number } => {
  let start = cursor;
  while (start > 0 && /\s/u.test(value[start - 1] ?? '')) {
    start -= 1;
  }
  while (start > 0 && !/\s/u.test(value[start - 1] ?? '')) {
    start -= 1;
  }
  return {
    value: `${value.slice(0, start)}${value.slice(cursor)}`,
    cursor: start,
  };
};

export type CommonPromptKeyHandlers = {
  submit: () => void;
  cancel: () => void;
  goHome: () => void;
  cleanup: () => void;
};

export const handleCommonPromptKey = (
  key: readline.Key,
  handlers: CommonPromptKeyHandlers,
  options: {
    submitOnRight?: boolean;
    cancelOnEscape?: boolean;
    cancelOnLeft?: boolean;
  } = {},
): boolean => {
  const { submitOnRight = true, cancelOnEscape = true, cancelOnLeft = true } = options;

  if (isHomeKey(key)) {
    handlers.goHome();
    return true;
  }
  if (key.name === 'return' || (submitOnRight && key.name === 'right')) {
    handlers.submit();
    return true;
  }
  if (key.ctrl && key.name === 'c') {
    handlers.cleanup();
    exitPrompt();
  }
  if ((cancelOnEscape && key.name === 'escape') || (cancelOnLeft && key.name === 'left')) {
    handlers.cancel();
    return true;
  }

  return false;
};

export { interactiveHomeSymbol };
