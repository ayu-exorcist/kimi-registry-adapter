import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmPrompt } from '../src/prompts/confirm';
import { inputPrompt } from '../src/prompts/input';
import { createPromptReadline } from '../src/prompts/prompt-core';
import { FrameRenderer, stringDisplayWidth } from '../src/prompts/screen';
import { searchMultiselect } from '../src/prompts/search-multiselect';
import { selectPrompt } from '../src/prompts/select';
import {
  createPromptCleanup,
  disposePromptReadline,
  exitPrompt,
  preparePromptInput,
  setPromptRuntime,
  subscribeTerminalResize,
} from '../src/prompts/terminal-session';

const nextTick = async (): Promise<void> => {
  await new Promise<void>((resolvePromise) => {
    setImmediate(resolvePromise);
  });
};

const emitKey = (char: string, key: Partial<readline.Key>): void => {
  process.stdin.emit('keypress', char, key as readline.Key);
};

describe('prompt screen helpers', () => {
  it('measures ansi-stripped wide text using terminal display width', () => {
    expect(stringDisplayWidth('abc')).toBe(3);
    expect(stringDisplayWidth('中文')).toBe(4);
    expect(stringDisplayWidth('😀')).toBe(2);
    expect(stringDisplayWidth('\u001B[31m中文\u001B[39m')).toBe(4);
  });

  it('clears the previous frame before rendering the next one', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const frame = new FrameRenderer();

    frame.render(['one']);
    frame.render(['two']);

    const output = write.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('one\n');
    expect(output).toContain('\u001B[1A');
    expect(output).toContain('two\n');
  });
});

describe('prompt interactions', () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    Object.defineProperty(process.stdin, 'setRawMode', {
      configurable: true,
      value: originalSetRawMode,
    });
    process.stdin.removeAllListeners('keypress');
  });

  it('moves through select options and confirms the highlighted value', async () => {
    const resultPromise = selectPrompt({
      message: 'Choose provider',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'bravo', label: 'Bravo' },
      ],
      clearOnExit: false,
    });
    await nextTick();

    emitKey('', { name: 'down' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toBe('bravo');
  });

  it('keeps input active after validation errors and resolves after corrected text', async () => {
    let settled = false;
    const resultPromise = inputPrompt({
      message: 'Provider ID',
      validate: (value) =>
        new Map<string | undefined, string>([
          [undefined, 'Required.'],
          ['', 'Required.'],
        ]).get(value),
      clearOnExit: false,
    }).then((value) => {
      settled = true;
      return value;
    });
    await nextTick();

    emitKey('', { name: 'return' });
    await nextTick();
    expect(settled).toBe(false);

    emitKey('o', { name: 'o' });
    emitKey('k', { name: 'k' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toBe('ok');
  });

  it('toggles confirm choices with keyboard shortcuts', async () => {
    const resultPromise = confirmPrompt({
      message: 'Start server now?',
      initialValue: true,
      clearOnExit: false,
    });
    await nextTick();

    emitKey('n', { name: 'n' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toBe(false);
  });

  it('selects only filtered multiselect items with ctrl+a even when other items were selected', async () => {
    const resultPromise = searchMultiselect({
      message: 'Models to include',
      items: [
        { value: '__all__', label: 'All' },
        { value: 'model-a', label: 'Model A' },
        { value: 'model-b', label: 'Model B' },
        { value: 'other', label: 'Other' },
      ],
      selectAllValue: '__all__',
      initialSelected: ['other'],
      clearOnExit: false,
    });
    await nextTick();

    emitKey('m', { name: 'm' });
    emitKey('', { ctrl: true, name: 'a' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toEqual(['model-a', 'model-b']);
  });

  it('selects only filtered multiselect items when toggling the visible All item', async () => {
    const resultPromise = searchMultiselect({
      message: 'Models to include',
      items: [
        { value: '__all__', label: 'All' },
        { value: 'gpt-a', label: 'gpt-a' },
        { value: 'gpt-b', label: 'gpt-b' },
        { value: 'claude-a', label: 'claude-a' },
      ],
      selectAllValue: '__all__',
      initialSelected: ['claude-a'],
      clearOnExit: false,
    });
    await nextTick();

    emitKey('g', { name: 'g' });
    emitKey('p', { name: 'p' });
    emitKey('t', { name: 't' });
    emitKey('', { name: 'space' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toEqual(['gpt-a', 'gpt-b']);
  });

  it('enforces required multiselect selection, then selects all visible items', async () => {
    let settled = false;
    const resultPromise = searchMultiselect({
      message: 'Models to include',
      items: [
        { value: '__all__', label: 'All' },
        { value: 'model-a', label: 'Model A' },
        { value: 'model-b', label: 'Model B' },
      ],
      selectAllValue: '__all__',
      required: true,
      clearOnExit: false,
    }).then((value) => {
      settled = true;
      return value;
    });
    await nextTick();

    emitKey('', { name: 'return' });
    await nextTick();
    expect(settled).toBe(false);

    emitKey('', { name: 'space' });
    emitKey('', { name: 'return' });

    await expect(resultPromise).resolves.toEqual(['model-a', 'model-b']);
  });
});

describe('prompt terminal session', () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    Object.defineProperty(process.stdin, 'setRawMode', {
      configurable: true,
      value: originalSetRawMode,
    });
  });

  it('keeps raw mode enabled until the outermost lease is released', () => {
    const setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });

    const outerKeypressHandler = vi.fn();
    const innerKeypressHandler = vi.fn();

    preparePromptInput();
    const cleanupOuter = createPromptCleanup({
      keypressHandler: () => outerKeypressHandler,
    });

    preparePromptInput();
    const cleanupInner = createPromptCleanup({
      keypressHandler: () => innerKeypressHandler,
    });

    expect(setRawMode).toHaveBeenCalledTimes(1);
    expect(setRawMode).toHaveBeenLastCalledWith(true);

    cleanupInner();
    expect(setRawMode).toHaveBeenCalledTimes(1);

    cleanupOuter();
    expect(setRawMode).toHaveBeenCalledTimes(2);
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('subscribes to terminal resize sources and disposes them once', () => {
    const handler = vi.fn();
    const stdoutOn = vi.spyOn(process.stdout, 'on');
    const processOn = vi.spyOn(process, 'on');
    const removeStdoutListener = vi.spyOn(process.stdout, 'removeListener');
    const removeProcessListener = vi.spyOn(process, 'removeListener');

    const dispose = subscribeTerminalResize(handler);
    dispose();
    dispose();

    expect(stdoutOn).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(processOn).toHaveBeenCalledWith('SIGWINCH', expect.any(Function));
    expect(removeStdoutListener).toHaveBeenCalledTimes(1);
    expect(removeProcessListener).toHaveBeenCalledTimes(1);
  });

  it('routes prompt exits through the prompt runtime', () => {
    const write = vi.fn(() => true);
    const exit = vi.fn((code?: number): never => {
      throw new Error(`exit ${code}`);
    });
    const restore = setPromptRuntime({
      output: { write } as unknown as typeof process.stdout,
      exit,
    });

    try {
      expect(() => exitPrompt()).toThrow('exit 0');
      expect(write).toHaveBeenCalledWith('\nBye!\n');
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      restore();
    }
  });

  it('reuses shared readline without accumulating stdin listeners across prompts', () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    const setRawMode = vi.fn((enabled: boolean) => {
      Object.defineProperty(input, 'isRaw', { configurable: true, value: enabled });
      return input;
    });
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(input, 'isRaw', { configurable: true, value: false });
    Object.defineProperty(input, 'setRawMode', { configurable: true, value: setRawMode });
    const restore = setPromptRuntime({ input });

    try {
      disposePromptReadline();
      const dataListenerCounts: number[] = [];
      const endListenerCounts: number[] = [];

      for (let index = 0; index < 6; index += 1) {
        const readlineInterface = createPromptReadline();
        const keypressHandler = vi.fn();
        input.on('keypress', keypressHandler);
        createPromptCleanup({
          readlineInterface,
          keypressHandler: () => keypressHandler,
        })();
        dataListenerCounts.push(input.listenerCount('data'));
        endListenerCounts.push(input.listenerCount('end'));
      }

      expect(new Set(dataListenerCounts).size).toBe(1);
      expect(new Set(endListenerCounts).size).toBe(1);
    } finally {
      disposePromptReadline();
      restore();
    }
  });

  it('runs prompt cleanup only once without closing shared readline', () => {
    const setRawMode = vi.fn();
    const close = vi.fn();
    const keypressHandler = vi.fn();
    const resizeHandler = vi.fn();
    const sigwinchHandler = vi.fn();
    const removeStdinListener = vi.spyOn(process.stdin, 'removeListener');
    const removeStdoutListener = vi.spyOn(process.stdout, 'removeListener');
    const removeProcessListener = vi.spyOn(process, 'removeListener');

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });

    preparePromptInput();
    const cleanup = createPromptCleanup({
      readlineInterface: { close } as unknown as readline.Interface,
      keypressHandler: () => keypressHandler,
      resizeHandler: () => resizeHandler,
      sigwinchHandler: () => sigwinchHandler,
    });

    cleanup();
    cleanup();

    expect(removeStdinListener).toHaveBeenCalledTimes(1);
    expect(removeStdoutListener).toHaveBeenCalledTimes(1);
    expect(removeProcessListener).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(setRawMode).toHaveBeenCalledTimes(2);
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });
});
