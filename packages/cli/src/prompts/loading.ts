import * as readline from 'node:readline';

import { colorize } from '../theme';
import { clearTerminalScreen, renderAppHeader } from './screen';
import {
  createPromptCleanup,
  preparePromptInput,
  promptKeyInput,
  promptOutput,
} from './terminal-session';

export interface LoadingIndicatorOptions {
  delayMs?: number;
}

export const withLoadingIndicator = async <T>(
  message: string,
  action: () => Promise<T>,
  options: LoadingIndicatorOptions = {},
): Promise<T> => {
  const { delayMs = 200 } = options;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let didRender = false;
  let didWarnAboutInterrupt = false;
  const render = (): void => {
    didRender = true;
    promptOutput().write(`\r${frames[frameIndex % frames.length]}  ${message}`);
    frameIndex += 1;
  };

  const showBusyWarning = (): void => {
    if (didWarnAboutInterrupt) {
      return;
    }

    didWarnAboutInterrupt = true;
    if (didRender) {
      promptOutput().write(
        `\r\u001B[2K${colorize('warning', 'Busy, finishing current operation...')}\n`,
      );
      render();
      return;
    }

    promptOutput().write(`${colorize('warning', 'Busy, finishing current operation...')}\n`);
  };

  preparePromptInput();
  const keypressHandler = (_char: string, key: readline.Key): void => {
    if (!key) {
      return;
    }

    if (key.ctrl && key.name === 'c') {
      showBusyWarning();
    }
  };

  clearTerminalScreen();
  renderAppHeader();

  promptKeyInput().on('keypress', keypressHandler);
  const cleanup = createPromptCleanup({ keypressHandler: () => keypressHandler });

  const delayTimer = setTimeout(() => {
    render();
    timer = setInterval(render, 80);
  }, delayMs);

  try {
    return await action();
  } finally {
    clearTimeout(delayTimer);
    if (timer) {
      clearInterval(timer);
    }
    cleanup();
    if (didRender) {
      promptOutput().write('\r\u001B[2K');
    }
  }
};
