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

  it('keeps a split loading key sequence out of the following prompt', async () => {
    vi.useFakeTimers();
    const { input } = createRawInput();
    const restore = setPromptRuntime({ input, output: createOutput() });
    let disposeSession: (() => void) | undefined;
    let resolveAction: (() => void) | undefined;

    try {
      disposeSession = installPromptInputSession();
      const action = new Promise<void>((resolvePromise) => {
        resolveAction = resolvePromise;
      });
      let settled = false;
      const flow = (async () => {
        await withLoadingIndicator('Updating provider...', () => action, { delayMs: 1_000 });
        return selectPrompt({
          message: 'Next action',
          options: [
            { value: 'alpha', label: 'Alpha' },
            { value: 'bravo', label: 'Bravo' },
          ],
        });
      })().then((value) => {
        settled = true;
        return value;
      });

      input.write(Buffer.from('\u001B'));
      resolveAction?.();
      setTimeout(() => input.write(Buffer.from('[B\r')), 10);

      await vi.advanceTimersByTimeAsync(510);
      expect(settled).toBe(false);

      input.write(Buffer.from('\r'));
      await expect(flow).resolves.toBe('alpha');
    } finally {
      disposePromptReadline();
      disposeSession?.();
      disposePromptInputSession();
      restore();
      vi.useRealTimers();
    }
  });

  it('discards repeated loading input before recovering from an action error', async () => {
    vi.useFakeTimers();
    const { input } = createRawInput();
    const restore = setPromptRuntime({ input, output: createOutput() });
    let disposeSession: (() => void) | undefined;
    let rejectAction: ((reason: Error) => void) | undefined;

    try {
      disposeSession = installPromptInputSession();
      const actionError = new Error('update failed');
      const action = new Promise<void>((_resolvePromise, rejectPromise) => {
        rejectAction = rejectPromise;
      });
      let loadingError: unknown;
      const flow = (async () => {
        try {
          await withLoadingIndicator('Updating provider...', () => action, { delayMs: 1_000 });
        } catch (error) {
          loadingError = error;
        }
        return selectPrompt({
          message: 'Recover action',
          options: [
            { value: 'alpha', label: 'Alpha' },
            { value: 'bravo', label: 'Bravo' },
          ],
        });
      })();

      input.write(Buffer.from('\u001B[B'));
      rejectAction?.(actionError);
      setTimeout(() => input.write(Buffer.from('\u001B[B')), 10);
      setTimeout(() => input.write(Buffer.from('\u001B[B')), 50);
      setTimeout(() => input.write(Buffer.from('\u001B[B')), 90);

      await vi.advanceTimersByTimeAsync(600);
      expect(loadingError).toBe(actionError);

      input.write(Buffer.from('\r'));
      await expect(flow).resolves.toBe('alpha');
    } finally {
      disposePromptReadline();
      disposeSession?.();
      disposePromptInputSession();
      restore();
      vi.useRealTimers();
    }
  });

  it('bounds loading input drain time while keys continue arriving', async () => {
    vi.useFakeTimers();
    const { input } = createRawInput();
    const restore = setPromptRuntime({ input, output: createOutput() });
    let disposeSession: (() => void) | undefined;

    try {
      disposeSession = installPromptInputSession();
      let settled = false;
      const loading = withLoadingIndicator('Updating provider...', async () => undefined, {
        delayMs: 2_000,
      }).then(() => {
        settled = true;
      });

      for (let delay = 100; delay <= 1_100; delay += 100) {
        setTimeout(() => input.write(Buffer.from('x')), delay);
      }

      await vi.advanceTimersByTimeAsync(1_010);
      expect(settled).toBe(true);
      await loading;
    } finally {
      disposePromptReadline();
      disposeSession?.();
      disposePromptInputSession();
      restore();
      vi.useRealTimers();
    }
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
