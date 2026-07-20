import * as readline from 'node:readline';

import { colorize } from '../theme';
import { clearTerminalScreen, renderAppHeader } from './screen';
import {
  createPromptCleanup,
  createPromptInputBoundary,
  preparePromptInput,
  promptKeyInput,
  promptOutput,
} from './terminal-session';

export interface LoadingIndicatorOptions {
  delayMs?: number;
}

export const withLoadingIndicator = async <T>(
  message: string,
  action: (signal: AbortSignal) => Promise<T>,
  options: LoadingIndicatorOptions = {},
): Promise<T> => {
  const { delayMs = 200 } = options;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let didRender = false;
  let didWarnAboutInterrupt = false;
  const busyWarning = colorize('warning', 'Busy, finishing current operation...');
  const render = (): void => {
    didRender = true;
    const frame = `${frames[frameIndex % frames.length]}  ${message}`;
    promptOutput().write(
      didWarnAboutInterrupt ? `\u001B[1A\r\u001B[2K${frame}\u001B[1B\r` : `\r${frame}`,
    );
    frameIndex += 1;
  };

  const showBusyWarning = (): void => {
    if (didWarnAboutInterrupt) {
      return;
    }

    if (!didRender) {
      render();
    }
    didWarnAboutInterrupt = true;
    promptOutput().write(`\n${busyWarning}`);
  };

  preparePromptInput();
  const inputBoundary = createPromptInputBoundary();
  const controller = new AbortController();
  const keypressHandler = (_char: string, key: readline.Key): void => {
    if (!key) {
      return;
    }

    if (key.ctrl && key.name === 'c') {
      showBusyWarning();
      if (!controller.signal.aborted) {
        controller.abort(new Error('Operation cancelled by user.'));
      }
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
    return await action(controller.signal);
  } finally {
    try {
      await inputBoundary.waitForIdle();
    } finally {
      inputBoundary.dispose();
      clearTimeout(delayTimer);
      if (timer) {
        clearInterval(timer);
      }
      cleanup();
      if (didWarnAboutInterrupt) {
        promptOutput().write('\r\u001B[2K\u001B[1A\r\u001B[2K');
      } else if (didRender) {
        promptOutput().write('\r\u001B[2K');
      }
    }
  }
};
