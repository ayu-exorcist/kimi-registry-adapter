import type * as readline from 'node:readline';

import pc from 'picocolors';

import {
  createPromptReadline,
  deletePreviousWord,
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

export interface InputPromptOptions {
  message: string;
  details?: PromptDetail[];
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string | undefined) => string | undefined;
  mask?: boolean;
  clearOnExit?: boolean;
}

const S_BAR = promptSymbols.bar;

export const inputCancelSymbol = Symbol('input-cancel');

const inputLinePrefix = (): string => `${S_BAR}  `;

const inputValueWidth = (): number => Math.max(1, terminalContentWidth(inputLinePrefix()) - 1);

export const inputPrompt = async (options: InputPromptOptions): Promise<string | symbol> => {
  const {
    message,
    details = [],
    placeholder,
    initialValue = '',
    validate,
    mask = false,
    clearOnExit = true,
  } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let value = initialValue;
    let cursor = initialValue.length;
    let error: string | undefined;
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

    const wrapInputValue = (displayValue: string): string[] =>
      wrapPlainText(displayValue, inputValueWidth());

    const renderedValueLines = (active: boolean): string[] => {
      const displayValue = mask ? '*'.repeat(value.length) : value;
      if (!active) {
        return wrapInputValue(displayValue || (placeholder ?? ''));
      }
      if (displayValue.length === 0) {
        return [`${placeholder ? pc.dim(placeholder) : ''}${pc.inverse(' ')}`];
      }

      const width = inputValueWidth();
      const cursorLine = Math.floor(cursor / width);
      const cursorColumn = cursor % width;
      const lines = wrapInputValue(displayValue);

      if (cursor === displayValue.length && cursorColumn === 0) {
        lines.push(pc.inverse(' '));
        return lines;
      }

      const line = lines[cursorLine] ?? '';
      const beforeCursor = line.slice(0, cursorColumn);
      const cursorCharacter = line[cursorColumn] ?? ' ';
      const afterCursor = cursorColumn < line.length ? line.slice(cursorColumn + 1) : '';
      lines[cursorLine] = `${beforeCursor}${pc.inverse(cursorCharacter)}${afterCursor}`;
      return lines;
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      const icon = promptStateIcon(state);
      const hint = formatShortcutHint(
        'enter confirm · esc back · ←→ move · ctrl+a/e home/end · ctrl+u/k/w edit · alt+h main menu · ctrl+c exit',
      );
      const detailLines = details.flatMap((detail) =>
        wrapPlainText(detail.text, terminalContentWidth(inputLinePrefix())).map(
          (line) => `${inputLinePrefix()}${renderPromptDetail({ ...detail, text: line })}`,
        ),
      );
      const hintLines = wrapPlainText(hint, terminalContentWidth(inputLinePrefix())).map(
        (line) => `${inputLinePrefix()}${pc.dim(line)}`,
      );
      const valueLines = renderedValueLines(state === 'active');
      const lines = [
        `${icon}  ${pc.bold(message)}`,
        ...detailLines,
        ...hintLines,
        `${S_BAR}`,
        ...valueLines.map((line) => `${inputLinePrefix()}${line}`),
        ...(error ? [`${S_BAR}  ${pc.red(error)}`] : []),
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
      error = validate?.(value);
      if (error) {
        render();
        return;
      }
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
      resolve(inputCancelSymbol);
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
      error = undefined;
      if (
        handleCommonPromptKey(
          key,
          { submit, cancel, goHome, cleanup },
          { submitOnRight: false, cancelOnLeft: false },
        )
      ) {
        return;
      }
      if (key.ctrl && key.name === 'a') {
        cursor = 0;
        render();
        return;
      }
      if (key.ctrl && key.name === 'e') {
        cursor = value.length;
        render();
        return;
      }
      if (key.ctrl && key.name === 'u') {
        value = value.slice(cursor);
        cursor = 0;
        render();
        return;
      }
      if (key.ctrl && key.name === 'k') {
        value = value.slice(0, cursor);
        render();
        return;
      }
      if (key.ctrl && key.name === 'w') {
        const next = deletePreviousWord(value, cursor);
        value = next.value;
        cursor = next.cursor;
        render();
        return;
      }
      if (key.name === 'left') {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }
      if (key.name === 'right') {
        cursor = Math.min(value.length, cursor + 1);
        render();
        return;
      }
      if (key.ctrl && key.name === 'd') {
        if (cursor < value.length) {
          value = `${value.slice(0, cursor)}${value.slice(cursor + 1)}`;
        }
        render();
        return;
      }
      if (key.name === 'delete') {
        if (cursor < value.length) {
          value = `${value.slice(0, cursor)}${value.slice(cursor + 1)}`;
        }
        render();
        return;
      }
      if (key.name === 'backspace') {
        if (cursor > 0) {
          value = `${value.slice(0, cursor - 1)}${value.slice(cursor)}`;
          cursor -= 1;
        }
        render();
        return;
      }
      if (!key.ctrl && !key.meta && typeof char === 'string' && char.length === 1) {
        value = `${value.slice(0, cursor)}${char}${value.slice(cursor)}`;
        cursor += char.length;
        render();
      }
    };

    promptInput().on('keypress', keypressHandler);
    redrawScreen();
  });
};
