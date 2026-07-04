import * as readline from 'node:readline';
import { Writable } from 'node:stream';

import pc from 'picocolors';

import { interactiveHomeSymbol, isHomeKey } from './navigation';
import { exitPrompt, preparePromptInput, promptInput } from './terminal-session';

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export const promptSymbols = {
  stepActive: pc.green('◆'),
  stepCancel: pc.red('■'),
  stepSubmit: pc.green('◇'),
  radioActive: pc.green('●'),
  radioInactive: pc.dim('○'),
  checkboxActive: pc.green('■'),
  checkboxInactive: pc.dim('□'),
  bar: pc.dim('│'),
};

export type PromptRenderState = 'active' | 'submit' | 'cancel';
export type PromptDetailTone = 'current' | 'info' | 'danger';

export type PromptDetail = {
  text: string;
  tone?: PromptDetailTone;
};

export const createPromptReadline = (): readline.Interface => {
  const rl = readline.createInterface({
    input: promptInput(),
    output: silentOutput,
    terminal: false,
  });
  preparePromptInput(rl);
  return rl;
};

export const renderPromptDetail = (detail: PromptDetail): string => {
  if (detail.tone === 'danger') {
    return pc.red(detail.text);
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
  options: { submitOnRight?: boolean; cancelOnLeft?: boolean } = {},
): boolean => {
  const { submitOnRight = true, cancelOnLeft = true } = options;

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
  if (key.name === 'escape' || (cancelOnLeft && key.name === 'left')) {
    handlers.cancel();
    return true;
  }

  return false;
};

export { interactiveHomeSymbol };
