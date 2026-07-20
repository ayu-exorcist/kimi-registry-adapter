import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withLoadingIndicator } from '../src/prompts/loading';
import { selectPrompt } from '../src/prompts/select';
import {
  disposePromptInputSession,
  disposePromptReadline,
  installPromptInputSession,
  setPromptRuntime,
} from '../src/prompts/terminal-session';

const nextTick = async (): Promise<void> => {
  await new Promise<void>((resolvePromise) => {
    setImmediate(resolvePromise);
  });
};

const createRawInput = (): {
  input: typeof process.stdin;
  setRawMode: ReturnType<typeof vi.fn>;
} => {
  const stream = new PassThrough();
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(stream, 'isRaw', { configurable: true, value: false });
  const setRawMode = vi.fn((enabled: boolean) => {
    Object.defineProperty(stream, 'isRaw', { configurable: true, value: enabled });
    return stream;
  });
  Object.defineProperty(stream, 'setRawMode', { configurable: true, value: setRawMode });
  return { input: stream as unknown as typeof process.stdin, setRawMode };
};

const createOutput = (): typeof process.stdout => {
  const stream = new PassThrough();
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(stream, 'columns', { configurable: true, value: 100 });
  return stream as unknown as typeof process.stdout;
};

afterEach(() => {
  disposePromptReadline();
  disposePromptInputSession();
  vi.restoreAllMocks();
});

describe('interactive prompt input session', () => {
  it('keeps one data route and one raw-mode lease across loading and prompt transitions', async () => {
    const { input, setRawMode } = createRawInput();
    const restore = setPromptRuntime({ input, output: createOutput() });
    let disposeSession: (() => void) | undefined;

    try {
      disposeSession = installPromptInputSession();

      expect(input.listenerCount('data')).toBe(1);
      expect(setRawMode.mock.calls).toEqual([[true]]);

      for (let index = 0; index < 6; index += 1) {
        await withLoadingIndicator('Updating provider...', async () => undefined, {
          delayMs: 1_000,
        });

        const selected = selectPrompt({
          message: `Update provider ${String(index)}`,
          options: [
            { value: 'alpha', label: 'Alpha' },
            { value: 'bravo', label: 'Bravo' },
          ],
        });
        await nextTick();
        input.write(Buffer.from('\u001B[B\r'));
        await expect(selected).resolves.toBe('bravo');

        expect(input.listenerCount('data')).toBe(1);
        expect(input.isRaw).toBe(true);
        expect(setRawMode.mock.calls).toEqual([[true]]);
      }
    } finally {
      disposePromptReadline();
      disposeSession?.();
      disposePromptInputSession();
      restore();
    }

    expect(input.listenerCount('data')).toBe(0);
    expect(setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  it('disposes the session idempotently', () => {
    const { input, setRawMode } = createRawInput();
    const restore = setPromptRuntime({ input, output: createOutput() });

    try {
      const dispose = installPromptInputSession();
      dispose();
      dispose();
      disposePromptInputSession();

      expect(input.listenerCount('data')).toBe(0);
      expect(setRawMode.mock.calls).toEqual([[true], [false]]);
    } finally {
      disposePromptReadline();
      disposePromptInputSession();
      restore();
    }
  });
});
