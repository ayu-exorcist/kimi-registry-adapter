import type * as readline from 'node:readline';

import pc from 'picocolors';

import {
  createPromptReadline,
  handleCommonPromptKey,
  interactiveHomeSymbol,
  promptStateIcon,
  promptSymbols,
  renderPromptDetail,
  type PromptDetail,
} from './prompt-core';
import {
  clearTerminalScreen,
  FrameRenderer,
  renderAppHeader,
  terminalContentWidth,
  wrapPlainText,
} from './screen';
import { formatShortcutHint } from './shortcut-hints';
import { createPromptCleanup, promptInput, subscribeTerminalResize } from './terminal-session';

export interface ConfirmPromptOptions {
  message: string;
  details?: PromptDetail[];
  initialValue?: boolean;
  clearOnExit?: boolean;
}

const S_RADIO_ACTIVE = promptSymbols.radioActive;
const S_RADIO_INACTIVE = promptSymbols.radioInactive;
const S_BAR = promptSymbols.bar;

export const confirmCancelSymbol = Symbol('confirm-cancel');

const promptLinePrefix = (): string => `${S_BAR}  `;

const renderWrappedPromptLine = (
  value: string,
  renderValue: (line: string) => string,
): string[] => {
  return wrapPlainText(value, terminalContentWidth(promptLinePrefix())).map(
    (line) => `${promptLinePrefix()}${renderValue(line)}`,
  );
};

export const confirmPrompt = async (options: ConfirmPromptOptions): Promise<boolean | symbol> => {
  const { message, details = [], initialValue = true, clearOnExit = true } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let value = initialValue;
    const frame = new FrameRenderer();

    const redrawScreen = (): void => {
      frame.reset();
      clearTerminalScreen();
      renderAppHeader();
      render();
    };

    const resizeHandler = (): void => {
      redrawScreen();
    };

    const clearRender = (): void => {
      frame.clear();
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      clearRender();
      const icon = promptStateIcon(state);
      const hint = formatShortcutHint(
        '↑↓ move · enter/→ confirm · esc/← back · alt+h main menu · ctrl+c exit',
      );
      const yesCursor = value ? pc.cyan('❯') : ' ';
      const yesRadio = value ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
      const noCursor = value ? ' ' : pc.cyan('❯');
      const noRadio = value ? S_RADIO_INACTIVE : S_RADIO_ACTIVE;
      const lines = [
        `${icon}  ${pc.bold(message)}`,
        ...details.flatMap((detail) =>
          renderWrappedPromptLine(detail.text, (line) =>
            renderPromptDetail({ ...detail, text: line }),
          ),
        ),
        ...renderWrappedPromptLine(hint, (line) => pc.dim(line)),
        `${S_BAR}`,
        `${S_BAR} ${yesCursor} ${yesRadio} Yes`,
        `${S_BAR} ${noCursor} ${noRadio} No`,
        pc.dim('╰'),
      ];
      frame.render(lines);
    };

    const resizeSubscription = subscribeTerminalResize(resizeHandler);

    const cleanup = createPromptCleanup({
      readlineInterface: rl,
      keypressHandler: () => keypressHandler,
      resizeSubscription,
    });

    const submit = (): void => {
      if (clearOnExit) {
        clearRender();
      } else {
        render('submit');
      }
      cleanup();
      resolve(value);
    };

    const cancel = (): void => {
      if (clearOnExit) {
        clearRender();
      } else {
        render('cancel');
      }
      cleanup();
      resolve(confirmCancelSymbol);
    };

    const goHome = (): void => {
      if (clearOnExit) {
        clearRender();
      }
      cleanup();
      resolve(interactiveHomeSymbol);
    };

    const keypressHandler = (char: string, key: readline.Key): void => {
      if (!key) return;
      if (handleCommonPromptKey(key, { submit, cancel, goHome, cleanup })) return;
      if (typeof char === 'string' && char.toLowerCase() === 'y') {
        value = true;
        render();
        return;
      }
      if (typeof char === 'string' && char.toLowerCase() === 'n') {
        value = false;
        render();
        return;
      }
      if (key.name === 'up' || key.name === 'down' || key.name === 'tab' || key.name === 'space') {
        value = !value;
        render();
      }
    };

    promptInput().on('keypress', keypressHandler);
    redrawScreen();
  });
};
