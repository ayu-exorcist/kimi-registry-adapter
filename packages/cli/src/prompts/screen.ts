import * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

import { subscribeColorPalette } from '../theme';
import { interactiveHomeSymbol, isHomeKey } from './navigation';
import {
  createPromptCleanup,
  exitPrompt,
  preparePromptInput,
  promptKeyInput,
  promptOutput,
  subscribeTerminalResize,
} from './terminal-session';

export const clearTerminalScreen = (): void => {
  const output = promptOutput();
  if (!output.isTTY) {
    return;
  }

  readline.cursorTo(output, 0, 0);
  readline.clearScreenDown(output);
};

export const stringDisplayWidth = (value: string): number => {
  const plain = stripVTControlCharacters(value);
  let width = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x231a && code <= 0x231b) ||
      (code >= 0x2329 && code <= 0x232a) ||
      (code >= 0x23e9 && code <= 0x23ec) ||
      code === 0x23f0 ||
      code === 0x23f3 ||
      (code >= 0x25fd && code <= 0x25fe) ||
      (code >= 0x2614 && code <= 0x2615) ||
      (code >= 0x2648 && code <= 0x2653) ||
      (code >= 0x267f && code <= 0x267f) ||
      (code >= 0x2693 && code <= 0x2693) ||
      (code >= 0x26a1 && code <= 0x26a1) ||
      (code >= 0x26aa && code <= 0x26ab) ||
      (code >= 0x26bd && code <= 0x26be) ||
      (code >= 0x26c4 && code <= 0x26c5) ||
      (code >= 0x26ce && code <= 0x26ce) ||
      (code >= 0x26d4 && code <= 0x26d4) ||
      (code >= 0x26ea && code <= 0x26ea) ||
      (code >= 0x26f2 && code <= 0x26f3) ||
      (code >= 0x26f5 && code <= 0x26f5) ||
      (code >= 0x26fa && code <= 0x26fa) ||
      (code >= 0x26fd && code <= 0x26fd) ||
      (code >= 0x2705 && code <= 0x2705) ||
      (code >= 0x270a && code <= 0x270b) ||
      (code >= 0x2728 && code <= 0x2728) ||
      (code >= 0x274c && code <= 0x274c) ||
      (code >= 0x274e && code <= 0x274e) ||
      (code >= 0x2753 && code <= 0x2755) ||
      (code >= 0x2757 && code <= 0x2757) ||
      (code >= 0x2795 && code <= 0x2797) ||
      (code >= 0x27b0 && code <= 0x27b0) ||
      (code >= 0x27bf && code <= 0x27bf) ||
      (code >= 0x2b1b && code <= 0x2b1c) ||
      (code >= 0x2b50 && code <= 0x2b50) ||
      (code >= 0x2b55 && code <= 0x2b55) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xa960 && code <= 0xa97c) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f000 && code <= 0x1f9ff);
    width += wide ? 2 : 1;
  }
  return width;
};

const visualRowsForLine = (line: string, columns: number): number =>
  Math.max(1, Math.ceil(stringDisplayWidth(line) / Math.max(1, columns)));

const countVisualRowsForLines = (lines: string[], columns: number | undefined): number => {
  const cols = columns && columns > 0 ? columns : 80;
  return lines.reduce(
    (sum, line) =>
      sum +
      line.split('\n').reduce((lineSum, segment) => lineSum + visualRowsForLine(segment, cols), 0),
    0,
  );
};

export class FrameRenderer {
  private lastRenderHeight = 0;
  private lastRenderedLines: string[] = [];

  clear(): void {
    const output = promptOutput();
    const clearHeight = Math.max(
      this.lastRenderHeight,
      countVisualRowsForLines(this.lastRenderedLines, output.columns),
    );
    if (clearHeight === 0) return;
    output.write(`\u001B[${clearHeight}A`);
    for (let i = 0; i < clearHeight; i += 1) {
      output.write('\u001B[2K\u001B[1B');
    }
    output.write(`\u001B[${clearHeight}A`);
    this.lastRenderHeight = 0;
    this.lastRenderedLines = [];
  }

  render(lines: string[]): void {
    const output = promptOutput();
    this.clear();
    output.write(`${lines.join('\n')}\n`);
    this.lastRenderedLines = lines;
    this.lastRenderHeight = countVisualRowsForLines(lines, output.columns);
  }

  reset(): void {
    this.lastRenderHeight = 0;
    this.lastRenderedLines = [];
  }
}

export const terminalContentWidth = (prefix = ''): number => {
  const output = promptOutput();
  const columns = output.columns && output.columns > 0 ? output.columns : 80;
  return Math.max(1, columns - stringDisplayWidth(prefix) - 1);
};

export const wrapPlainText = (value: string, width: number): string[] => {
  if (value.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  for (const ch of value) {
    const chWidth = stringDisplayWidth(ch);
    if (line.length > 0 && lineWidth + chWidth > width) {
      lines.push(line);
      line = '';
      lineWidth = 0;
    }
    line += ch;
    lineWidth += chWidth;
  }
  lines.push(line);
  return lines;
};

export const renderAppHeader = (options: { spacer?: boolean } = {}): void => {
  const { spacer = true } = options;
  const output = promptOutput();
  output.write(`${pc.dim('╭')}  ${pc.bold('Kimi Registry Adapter')}\n`);
  if (spacer) {
    output.write(`${pc.dim('│')}\n`);
  }
};

export const waitForScreenExit = async (
  onResize?: () => void,
): Promise<typeof interactiveHomeSymbol | undefined> => {
  return new Promise((resolve) => {
    const resizeHandler = (): void => {
      onResize?.();
    };

    const resizeSubscription = subscribeTerminalResize(resizeHandler);

    const cleanupPrompt = createPromptCleanup({
      keypressHandler: () => keypressHandler,
      resizeSubscription,
    });
    const unsubscribeTheme = subscribeColorPalette(() => {
      onResize?.();
    });
    const cleanup = (): void => {
      unsubscribeTheme();
      cleanupPrompt();
    };

    const keypressHandler = (_char: string, key: readline.Key): void => {
      if (!key) {
        return;
      }

      if (isHomeKey(key)) {
        cleanup();
        resolve(interactiveHomeSymbol);
        return;
      }

      if (key.ctrl && key.name === 'c') {
        cleanup();
        exitPrompt();
      }

      if (
        key.name === 'return' ||
        key.name === 'enter' ||
        key.name === 'escape' ||
        key.name === 'left'
      ) {
        cleanup();
        resolve(undefined);
      }
    };

    preparePromptInput();
    promptKeyInput().resume();
    promptKeyInput().on('keypress', keypressHandler);
  });
};
