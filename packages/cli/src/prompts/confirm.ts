import type * as readline from 'node:readline';

import pc from 'picocolors';

import {
  createPromptReadline,
  createPromptSession,
  handleCommonPromptKey,
  promptStateIcon,
  promptSymbols,
  renderPromptDetails,
  renderPromptHint,
  type PromptDetail,
} from './prompt-core';
import { FrameRenderer } from './screen';
import { formatShortcutHint } from './shortcut-hints';
import { promptInput } from './terminal-session';

export interface ConfirmPromptOptions {
  message: string;
  details?: PromptDetail[];
  initialValue?: boolean;
  clearOnExit?: boolean;
}

const S_RADIO_ACTIVE = promptSymbols.radioActive;
const S_RADIO_INACTIVE = promptSymbols.radioInactive;
const S_BAR = promptSymbols.bar;

const confirmCancelSymbol = Symbol('confirm-cancel');

export const confirmPrompt = async (options: ConfirmPromptOptions): Promise<boolean | symbol> => {
  const { message, details = [], initialValue = true, clearOnExit = true } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let value = initialValue;
    const frame = new FrameRenderer();

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      frame.clear();
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
        ...renderPromptDetails(details),
        ...renderPromptHint(hint),
        `${S_BAR}`,
        `${S_BAR} ${yesCursor} ${yesRadio} Yes`,
        `${S_BAR} ${noCursor} ${noRadio} No`,
        pc.dim('╰'),
      ];
      frame.render(lines);
    };

    const { redrawScreen, cleanup, finish, goHome } = createPromptSession<boolean>({
      readlineInterface: rl,
      frame,
      render,
      keypressHandler: () => keypressHandler,
      clearOnExit,
      resolve,
    });

    const submit = (): void => finish(value, 'submit');

    const cancel = (): void => finish(confirmCancelSymbol, 'cancel');

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
