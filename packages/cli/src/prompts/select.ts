import type * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

import {
  createPromptReadline,
  handleCommonPromptKey,
  interactiveHomeSymbol,
  promptStateIcon,
  promptSymbols,
  renderPromptDetail,
  type PromptDetail,
  type PromptDetailTone,
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

export interface SelectItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export type { PromptDetail, PromptDetailTone };

export interface SelectPromptOptions<T> {
  message: string;
  details?: PromptDetail[];
  options: SelectItem<T>[];
  initialValue?: T;
  maxVisible?: number;
  cancelHint?: string;
  clearOnExit?: boolean;
}

const S_RADIO_ACTIVE = promptSymbols.radioActive;
const S_RADIO_INACTIVE = promptSymbols.radioInactive;
const S_BAR = promptSymbols.bar;

export const selectCancelSymbol = Symbol('select-cancel');

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
    clearOnExit = true,
  } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let cursor = findInitialCursor(items, initialValue);
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
      const lines: string[] = [];
      const icon = promptStateIcon(state);
      lines.push(`${icon}  ${pc.bold(message)}`);
      for (const detail of details) {
        const prefix = `${S_BAR}  `;
        for (const line of wrapPlainText(detail.text, terminalContentWidth(prefix))) {
          lines.push(`${prefix}${renderPromptDetail({ ...detail, text: line })}`);
        }
      }

      const pushWrappedLine = (line: string): void => {
        const wrapped = wrapRenderedLine(line, terminalContentWidth());
        lines.push(...wrapped);
      };

      if (state === 'active') {
        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), items.length - maxVisible),
        );
        const visibleEnd = Math.min(items.length, visibleStart + maxVisible);
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

        const hiddenBefore = visibleStart;
        const hiddenAfter = items.length - visibleEnd;
        if (hiddenBefore > 0 || hiddenAfter > 0) {
          const parts: string[] = [];
          if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
          if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
          lines.push(`${S_BAR}  ${pc.dim(parts.join('  '))}`);
        }
        lines.push(`${pc.dim('╰')}`);
      } else if (state === 'submit') {
        lines.push(`${S_BAR}  ${pc.dim(items[cursor]?.label ?? '')}`);
      } else {
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim('Cancelled'))}`);
      }

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
      resolve(items[cursor]?.value ?? selectCancelSymbol);
    };

    const cancel = (): void => {
      if (clearOnExit) {
        clearRender();
      } else {
        render('cancel');
      }
      cleanup();
      resolve(selectCancelSymbol);
    };

    const goHome = (): void => {
      if (clearOnExit) {
        clearRender();
      }
      cleanup();
      resolve(interactiveHomeSymbol);
    };

    const keypressHandler = (_char: string, key: readline.Key): void => {
      if (!key) return;
      if (handleCommonPromptKey(key, { submit, cancel, goHome, cleanup })) return;
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
