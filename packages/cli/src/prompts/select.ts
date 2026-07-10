import type * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

import {
  createPromptFinisher,
  createPromptLifecycle,
  createPromptReadline,
  finishPromptHome,
  handleCommonPromptKey,
  hiddenItemsLine,
  interactiveHomeSymbol,
  promptStateIcon,
  promptSymbols,
  renderPromptDetails,
  visibleWindow,
  type PromptDetail,
} from './prompt-core';
import { FrameRenderer, terminalContentWidth } from './screen';
import { formatShortcutHint } from './shortcut-hints';
import { promptInput } from './terminal-session';

interface SelectItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectPromptOptions<T> {
  message: string;
  details?: PromptDetail[];
  options: SelectItem<T>[];
  initialValue?: T;
  maxVisible?: number;
  cancelHint?: string;
  cancelOnEscape?: boolean;
  cancelOnLeft?: boolean;
  clearOnExit?: boolean;
}

const S_RADIO_ACTIVE = promptSymbols.radioActive;
const S_RADIO_INACTIVE = promptSymbols.radioInactive;
const S_BAR = promptSymbols.bar;

const selectCancelSymbol = Symbol('select-cancel');

const wrapRenderedLine = (line: string, width: number): string[] => {
  const plain = stripVTControlCharacters(line);
  if (plain.length <= width) {
    return [line];
  }

  const prefixMatch = /^(\s*│\s+(?:❯\s+)?(?:●|○)?\s*)/u.exec(plain);
  const prefix = prefixMatch?.[1] ?? '';
  const content = plain.slice(prefix.length);
  const availableWidth = Math.max(8, width - prefix.length);
  const wrapped = Array.from({ length: Math.ceil(content.length / availableWidth) }, (_, index) =>
    content.slice(index * availableWidth, (index + 1) * availableWidth),
  );

  const continuationPrefix = prefix.startsWith('│')
    ? `│${' '.repeat(Math.max(0, prefix.length - 1))}`
    : ' '.repeat(prefix.length);
  return wrapped.map((segment, index) => `${index === 0 ? prefix : continuationPrefix}${segment}`);
};

const findInitialCursor = <T>(options: SelectItem<T>[], initialValue: T | undefined): number => {
  if (initialValue === undefined) return 0;
  const index = options.findIndex((option) => option.value === initialValue);
  return index === -1 ? 0 : index;
};

export const selectPrompt = async <T>(options: SelectPromptOptions<T>): Promise<T | symbol> => {
  const {
    message,
    details = [],
    options: items,
    initialValue,
    maxVisible = 8,
    cancelHint = 'esc/← back · alt+h main menu · ctrl+c exit',
    cancelOnEscape = true,
    cancelOnLeft = true,
    clearOnExit = true,
  } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let cursor = findInitialCursor(items, initialValue);
    const frame = new FrameRenderer();

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      clearRender();
      const icon = promptStateIcon(state);
      const lines: string[] = [`${icon}  ${pc.bold(message)}`, ...renderPromptDetails(details)];

      const pushWrappedLine = (line: string): void => {
        const wrapped = wrapRenderedLine(line, terminalContentWidth());
        lines.push(...wrapped);
      };

      if (state === 'active') {
        const { start: visibleStart, end: visibleEnd } = visibleWindow(
          cursor,
          items.length,
          maxVisible,
        );
        const visibleItems = items.slice(visibleStart, visibleEnd);

        pushWrappedLine(
          `${S_BAR}  ${pc.dim(formatShortcutHint(`↑↓ move · enter/→ confirm · ${cancelHint}`))}`,
        );
        lines.push(`${S_BAR}`);

        for (let i = 0; i < visibleItems.length; i += 1) {
          const item = visibleItems[i];
          if (!item) continue;
          const actualIndex = visibleStart + i;
          const isCursor = actualIndex === cursor;
          const radio = isCursor ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
          const label = isCursor ? pc.underline(item.label) : item.label;
          const hint = item.hint ? pc.dim(` (${item.hint})`) : '';
          const prefix = isCursor ? pc.green('❯') : ' ';
          pushWrappedLine(`${S_BAR} ${prefix} ${radio} ${label}${hint}`);
        }

        const hiddenLine = hiddenItemsLine(visibleStart, items.length - visibleEnd);
        if (hiddenLine) {
          lines.push(hiddenLine);
        }
        lines.push(`${pc.dim('╰')}`);
      } else if (state === 'submit') {
        lines.push(`${S_BAR}  ${pc.dim(items[cursor]?.label ?? '')}`);
      } else {
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim('Cancelled'))}`);
      }

      frame.render(lines);
    };

    const { clearRender, redrawScreen, cleanup } = createPromptLifecycle({
      readlineInterface: rl,
      frame,
      render,
      keypressHandler: () => keypressHandler,
    });

    const finish = createPromptFinisher<T>({
      clearOnExit,
      clearRender,
      render,
      cleanup,
      resolve,
    });

    const submit = (): void => finish(items[cursor]?.value ?? selectCancelSymbol, 'submit');

    const cancel = (): void => finish(selectCancelSymbol, 'cancel');

    const goHome = (): void =>
      finishPromptHome({
        clearOnExit,
        clearRender,
        cleanup,
        resolve,
        value: interactiveHomeSymbol,
      });

    const keypressHandler = (_char: string, key: readline.Key): void => {
      if (!key) return;
      if (
        handleCommonPromptKey(
          key,
          { submit, cancel, goHome, cleanup },
          { cancelOnEscape, cancelOnLeft },
        )
      )
        return;
      if (key.name === 'up') {
        cursor = cursor === 0 ? items.length - 1 : cursor - 1;
        render();
        return;
      }
      if (key.name === 'down') {
        cursor = cursor === items.length - 1 ? 0 : cursor + 1;
        render();
      }
    };

    promptInput().on('keypress', keypressHandler);
    redrawScreen();
  });
};
