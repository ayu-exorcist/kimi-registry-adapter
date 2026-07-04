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
      withLoadingIndicator: async (_message, action) => action(),
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
      expect(chunks.join('')).toContain('Fetching models...');
      expect(input.listenerCount('keypress')).toBe(0);
    } finally {
      restoreRuntime();
    }
  });
});
