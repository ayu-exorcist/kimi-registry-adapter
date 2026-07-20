import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  setPromptDriver,
  inputPrompt,
  selectPrompt,
  withLoadingIndicator as driverLoading,
} from '../src/commands/prompt-adapters';
import { withLoadingIndicator } from '../src/prompts/loading';
import { setPromptRuntime } from '../src/prompts/terminal-session';

describe('prompt adapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes prompt calls through an injectable driver', async () => {
    const restore = setPromptDriver({
      inputPrompt: async () => 'typed',
      selectPrompt: async <T>() => 'choice' as T,
      withLoadingIndicator: async (_message, action) => action(new AbortController().signal),
    });

    try {
      await expect(inputPrompt({ message: 'Name' })).resolves.toBe('typed');
      await expect(
        selectPrompt({ message: 'Mode', options: [{ value: 'choice', label: 'Choice' }] }),
      ).resolves.toBe('choice');
      await expect(driverLoading('Loading', async () => 'done')).resolves.toBe('done');
    } finally {
      restore();
    }
  });

  it('renders and cleans up the loading indicator runtime', async () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    const output = new PassThrough() as unknown as typeof process.stdout;
    Object.assign(input, { isTTY: false });
    Object.assign(output, { columns: 80 });
    const chunks: string[] = [];
    output.on('data', (chunk) => chunks.push(String(chunk)));
    const restoreRuntime = setPromptRuntime({ input, output });
    let finish!: (value: string) => void;

    try {
      const promise = withLoadingIndicator(
        'Fetching models...',
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
        { delayMs: 1 },
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      input.emit('keypress', '', { ctrl: true, name: 'c' });
      finish('ok');
      await expect(promise).resolves.toBe('ok');
      const rendered = chunks.join('');
      expect(rendered).toContain('Fetching models...');
      expect(rendered).toContain('Busy, finishing current operation...');
      expect(rendered.indexOf('Fetching models...')).toBeLessThan(
        rendered.indexOf('Busy, finishing current operation...'),
      );
      expect(
        chunks.find((chunk) => chunk.includes('Busy, finishing current operation...')),
      ).toMatch(/^\n/u);
      expect(input.listenerCount('keypress')).toBe(0);
    } finally {
      restoreRuntime();
    }
  });

  it('aborts the loading action on the first ctrl+c', async () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    const output = new PassThrough() as unknown as typeof process.stdout;
    Object.assign(input, { isTTY: false });
    Object.assign(output, { columns: 80 });
    const restoreRuntime = setPromptRuntime({ input, output });

    try {
      const promise = withLoadingIndicator(
        'Updating provider...',
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
        { delayMs: 1_000 },
      );

      input.emit('keypress', '', { ctrl: true, name: 'c' });

      await expect(promise).rejects.toThrow('Operation cancelled by user.');
      expect(input.listenerCount('keypress')).toBe(0);
    } finally {
      restoreRuntime();
    }
  });
});
