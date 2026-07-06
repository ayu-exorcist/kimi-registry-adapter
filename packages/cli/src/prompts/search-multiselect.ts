import type * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

import {
  createPromptFinisher,
  createPromptReadline,
  deletePreviousWord,
  finishPromptHome,
  handleCommonPromptKey,
  hiddenItemsLine,
  interactiveHomeSymbol,
  promptLinePrefix,
  promptStateIcon,
  promptSymbols,
  renderPromptDetails,
  renderPromptHint,
  visibleWindow,
  type PromptDetail,
} from './prompt-core';
import { FrameRenderer, terminalContentWidth, wrapPlainText } from './screen';
import { formatShortcutHint } from './shortcut-hints';
import { createPromptCleanup, promptInput, subscribeTerminalResize } from './terminal-session';

interface SearchItem<T> {
  value: T;
  label: string;
  hint?: string;
  indent?: number;
}

export interface SearchMultiselectOptions<T> {
  message: string;
  items: SearchItem<T>[];
  maxVisible?: number;
  initialSelected?: T[];
  details?: PromptDetail[];
  required?: boolean;
  selectAllValue?: T;
  clearOnExit?: boolean;
}

const S_CHECKBOX_ACTIVE = promptSymbols.checkboxActive;
const S_CHECKBOX_INACTIVE = promptSymbols.checkboxInactive;
const S_BAR = promptSymbols.bar;

const cancelSymbol = Symbol('cancel');

const wrapPromptText = (value: string): string[] =>
  wrapPlainText(value, terminalContentWidth(promptLinePrefix()));

const normalizeSearchText = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '');

const isSubsequence = (query: string, value: string): boolean => {
  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
};

const matchesSearchQuery = (query: string, value: string): boolean => {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedValue = normalizeSearchText(value);
  return (
    value.toLowerCase().includes(query.toLowerCase()) ||
    normalizedValue.includes(normalizedQuery) ||
    isSubsequence(normalizedQuery, normalizedValue)
  );
};

export const searchMultiselect = async <T>(
  options: SearchMultiselectOptions<T>,
): Promise<T[] | symbol> => {
  const {
    message,
    items,
    maxVisible = 12,
    initialSelected = [],
    details = [],
    required = false,
    selectAllValue,
    clearOnExit = true,
  } = options;

  return new Promise((resolve) => {
    const rl = createPromptReadline();

    let query = '';
    let queryCursor = 0;
    let cursor = 0;
    const selected = new Set<T>(initialSelected);
    let error: string | undefined;
    const frame = new FrameRenderer();

    const regularItems = (): SearchItem<T>[] =>
      selectAllValue === undefined ? items : items.filter((item) => item.value !== selectAllValue);

    const matchesQuery = (item: SearchItem<T>): boolean =>
      !query ||
      matchesSearchQuery(query, item.label) ||
      matchesSearchQuery(query, String(item.value));

    const filteredRegularItems = (): SearchItem<T>[] => regularItems().filter(matchesQuery);

    const filteredRegularValues = (): T[] => filteredRegularItems().map((item) => item.value);

    const clearSelectionOutside = (values: T[]): void => {
      const allowed = new Set(values);
      for (const value of selected) {
        if (value !== selectAllValue && !allowed.has(value)) {
          selected.delete(value);
        }
      }
    };

    const syncSelectAll = (): void => {
      if (selectAllValue === undefined) return;
      const regularValues = filteredRegularValues();
      const hasAllRegularValues =
        regularValues.length > 0 && regularValues.every((value) => selected.has(value));
      if (hasAllRegularValues) {
        selected.add(selectAllValue);
      } else {
        selected.delete(selectAllValue);
      }
    };

    syncSelectAll();

    const getFiltered = (): SearchItem<T>[] => {
      const regularFiltered = filteredRegularItems();
      if (selectAllValue === undefined) {
        return regularFiltered;
      }
      const selectAllItem = items.find((item) => item.value === selectAllValue);
      return selectAllItem === undefined ? regularFiltered : [selectAllItem, ...regularFiltered];
    };

    const clearRender = (): void => {
      frame.clear();
    };

    const resizeHandler = (): void => {
      render();
    };

    const renderSearchLines = (): string[] => {
      const searchPrefix = 'Search: ';
      const searchText = `${searchPrefix}${query}`;
      const searchWidth = Math.max(1, terminalContentWidth(promptLinePrefix()) - 1);
      const searchLines = wrapPlainText(searchText, searchWidth);
      const cursorIndex = searchPrefix.length + queryCursor;
      const cursorLine = Math.floor(cursorIndex / searchWidth);
      const cursorColumn = cursorIndex % searchWidth;

      if (cursorIndex === searchText.length && cursorColumn === 0) {
        searchLines.push(pc.inverse(' '));
      } else {
        const line = searchLines[cursorLine] ?? '';
        const beforeCursor = line.slice(0, cursorColumn);
        const cursorCharacter = line[cursorColumn] ?? ' ';
        const afterCursor = cursorColumn < line.length ? line.slice(cursorColumn + 1) : '';
        searchLines[cursorLine] = `${beforeCursor}${pc.inverse(cursorCharacter)}${afterCursor}`;
      }

      return searchLines.map(
        (line) => `${promptLinePrefix()}${line.replace(/^Search:/u, pc.dim('Search:'))}`,
      );
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      syncSelectAll();
      clearRender();
      const filtered = getFiltered();
      const icon = promptStateIcon(state);
      const lines: string[] = [`${icon}  ${pc.bold(message)}`, ...renderPromptDetails(details)];

      if (state === 'active') {
        lines.push(...renderSearchLines());
        const hint = formatShortcutHint(
          '↑↓ move · space select · ctrl+a all · ctrl+n none · enter/→ confirm · esc/← back · alt+h main menu · ctrl+c exit',
        );
        lines.push(...renderPromptHint(hint), `${S_BAR}`);

        const { start: visibleStart, end: visibleEnd } = visibleWindow(
          cursor,
          filtered.length,
          maxVisible,
        );
        const visibleItems = filtered.slice(visibleStart, visibleEnd);

        if (filtered.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('No matches found')}`);
        } else {
          for (let i = 0; i < visibleItems.length; i += 1) {
            const item = visibleItems[i];
            if (!item) continue;
            const actualIndex = visibleStart + i;
            const isSelected = selected.has(item.value);
            const isCursor = actualIndex === cursor;
            const checkbox = isSelected ? S_CHECKBOX_ACTIVE : S_CHECKBOX_INACTIVE;
            const prefix = isCursor ? '❯' : ' ';
            const indent = ' '.repeat(item.indent ?? 0);
            const itemPrefix = `${S_BAR} ${prefix} ${indent}${checkbox} `;
            const itemContinuationPrefix = `│${' '.repeat(
              Math.max(0, stripVTControlCharacters(itemPrefix).length - 1),
            )}`;
            const itemLabel =
              selectAllValue !== undefined && item.value === selectAllValue && query
                ? 'All matching'
                : item.label;
            const itemText = `${itemLabel}${item.hint ? ` (${item.hint})` : ''}`;
            const itemLines = wrapPlainText(itemText, terminalContentWidth(itemPrefix));
            for (let lineIndex = 0; lineIndex < itemLines.length; lineIndex += 1) {
              const text = itemLines[lineIndex];
              if (text === undefined) continue;
              const renderedText = lineIndex === 0 && isCursor ? pc.underline(text) : text;
              lines.push(`${lineIndex === 0 ? itemPrefix : itemContinuationPrefix}${renderedText}`);
            }
          }

          const hiddenLine = hiddenItemsLine(visibleStart, filtered.length - visibleEnd);
          if (hiddenLine) {
            lines.push(hiddenLine);
          }
        }

        lines.push(`${S_BAR}`);
        const selectedLabels = items
          .filter((item) => item.value !== selectAllValue && selected.has(item.value))
          .map((item) => item.label);
        const allSelected =
          !query &&
          selectAllValue !== undefined &&
          filteredRegularItems().length > 0 &&
          filteredRegularItems().every((item) => selected.has(item.value));
        if (selectedLabels.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('Selected: (none)')}`);
        } else if (allSelected) {
          lines.push(`${S_BAR}  ${pc.green('Selected:')} All`);
        } else {
          const summary =
            selectedLabels.length <= 3
              ? selectedLabels.join(', ')
              : `${selectedLabels.slice(0, 3).join(', ')} +${selectedLabels.length - 3} more`;
          for (const line of wrapPromptText(`Selected: ${summary}`)) {
            lines.push(
              `${promptLinePrefix()}${line.replace(/^Selected:/u, pc.green('Selected:'))}`,
            );
          }
        }
        if (error) {
          for (const line of wrapPromptText(error)) {
            lines.push(`${promptLinePrefix()}${pc.red(line)}`);
          }
        }
        lines.push(`${pc.dim('╰')}`);
      } else if (state === 'submit') {
        const selectedLabels = items
          .filter((item) => item.value !== selectAllValue && selected.has(item.value))
          .map((item) => item.label);
        for (const line of wrapPromptText(selectedLabels.join(', '))) {
          lines.push(`${promptLinePrefix()}${pc.dim(line)}`);
        }
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
      if (required && selected.size === 0) {
        error = 'Required.';
        render();
        return;
      }
      error = undefined;
      finish(
        [...selected].filter((value) => value !== selectAllValue),
        'submit',
      );
    };

    const finish = createPromptFinisher<T[]>({
      clearOnExit,
      clearRender,
      render,
      cleanup,
      resolve,
    });

    const cancel = (): void => finish(cancelSymbol, 'cancel');

    const goHome = (): void =>
      finishPromptHome({
        clearOnExit,
        clearRender,
        cleanup,
        resolve,
        value: interactiveHomeSymbol,
      });

    const selectAll = (): void => {
      error = undefined;
      const targetItems = selectAllValue === undefined ? getFiltered() : filteredRegularItems();
      const targetValues = targetItems.map((item) => item.value);
      if (query) {
        clearSelectionOutside(targetValues);
      }
      for (const value of targetValues) {
        selected.add(value);
      }
      syncSelectAll();
      render();
    };

    const selectNone = (): void => {
      error = undefined;
      selected.clear();
      syncSelectAll();
      render();
    };

    const toggleCurrent = (): void => {
      error = undefined;
      const item = getFiltered()[cursor];
      if (!item) return;
      if (selectAllValue !== undefined && item.value === selectAllValue) {
        const targetValues = filteredRegularValues();
        const hasAllFiltered =
          targetValues.length > 0 && targetValues.every((value) => selected.has(value));
        const hasOutsideSelection = [...selected].some(
          (value) => value !== selectAllValue && !targetValues.includes(value),
        );
        if (hasAllFiltered && (!query || !hasOutsideSelection)) {
          for (const value of targetValues) {
            selected.delete(value);
          }
          selected.delete(selectAllValue);
        } else {
          if (query) {
            clearSelectionOutside(targetValues);
          }
          for (const value of targetValues) {
            selected.add(value);
          }
          if (targetValues.length > 0) {
            selected.add(selectAllValue);
          }
        }
        syncSelectAll();
        render();
        return;
      }
      if (selected.has(item.value)) {
        selected.delete(item.value);
      } else {
        selected.add(item.value);
      }
      syncSelectAll();
      render();
    };

    const keypressHandler = (char: string, key: readline.Key): void => {
      if (!key) return;
      const filtered = getFiltered();

      if (handleCommonPromptKey(key, { submit, cancel, goHome, cleanup })) return;

      if (key.name === 'up') {
        cursor = filtered.length === 0 ? 0 : cursor === 0 ? filtered.length - 1 : cursor - 1;
        render();
        return;
      }

      if (key.name === 'down') {
        cursor = filtered.length === 0 ? 0 : cursor === filtered.length - 1 ? 0 : cursor + 1;
        render();
        return;
      }

      if (key.name === 'space') {
        toggleCurrent();
        return;
      }

      if (key.name === 'backspace') {
        if (queryCursor > 0) {
          query = `${query.slice(0, queryCursor - 1)}${query.slice(queryCursor)}`;
          queryCursor -= 1;
          cursor = 0;
        }
        render();
        return;
      }

      if (key.name === 'home') {
        queryCursor = 0;
        render();
        return;
      }

      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        queryCursor = query.length;
        render();
        return;
      }

      if (key.ctrl && key.name === 'u') {
        query = query.slice(queryCursor);
        queryCursor = 0;
        cursor = 0;
        render();
        return;
      }

      if (key.ctrl && key.name === 'k') {
        query = query.slice(0, queryCursor);
        cursor = 0;
        render();
        return;
      }

      if (key.ctrl && key.name === 'w') {
        const next = deletePreviousWord(query, queryCursor);
        query = next.value;
        queryCursor = next.cursor;
        cursor = 0;
        render();
        return;
      }

      if (key.ctrl && key.name === 'a') {
        selectAll();
        return;
      }

      if (key.ctrl && key.name === 'n') {
        selectNone();
        return;
      }

      if (!key.ctrl && !key.meta && typeof char === 'string' && char.length === 1) {
        query = `${query.slice(0, queryCursor)}${char}${query.slice(queryCursor)}`;
        queryCursor += char.length;
        cursor = 0;
        render();
      }
    };

    promptInput().on('keypress', keypressHandler);
    render();
  });
};
