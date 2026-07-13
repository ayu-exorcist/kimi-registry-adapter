import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runInteractiveServe } from '../src/commands/interactive-actions';
import {
  describeInteractiveAuthState,
  formatInteractiveError,
  getInteractiveAuthOptions,
  getInteractiveMenuOptions,
  listConfiguredProviderIds,
  validateNewProviderId,
} from '../src/commands/interactive-shared';

describe('interactive CLI helpers', () => {
  it('shows only add provider when no providers exist', () => {
    expect(getInteractiveMenuOptions([])).toEqual([{ value: 'add', label: 'Add provider' }]);
  });

  it('shows provider actions before the server action when providers exist', () => {
    expect(getInteractiveMenuOptions(['provider-a'])).toEqual([
      { value: 'add', label: 'Add provider' },
      { value: 'remove', label: 'Remove provider' },
      { value: 'update', label: 'Update provider' },
      { value: 'list', label: 'List providers' },
      { value: 'serve', label: 'Start registry server' },
    ]);
  });

  it('lists configured provider ids in sorted order', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));
    writeFileSync(
      join(stateDir, 'config.json'),
      JSON.stringify(
        {
          server: { host: '127.0.0.1', port: 2727 },
          update: { mode: 'merge' },
          providers: {
            zebra: {
              name: 'zebra',
              baseUrl: 'https://zebra.example.com/v1',
              type: 'openai_responses',
              fallbackContext: 131072,
              fallbackToolCall: false,
              include: ['*'],
              exclude: ['*embedding*', '*embed*', '*rerank*', '*tts*', '*whisper*'],
              overrides: {},
            },
            alpha: {
              name: 'alpha',
              baseUrl: 'https://alpha.example.com/v1',
              type: 'openai_responses',
              fallbackContext: 131072,
              fallbackToolCall: false,
              include: ['*'],
              exclude: ['*embedding*', '*embed*', '*rerank*', '*tts*', '*whisper*'],
              overrides: {},
            },
          },
        },
        null,
        2,
      ),
    );

    expect(listConfiguredProviderIds(stateDir)).toEqual(['alpha', 'zebra']);
  });

  it('validates new provider ids are required, safe, and unique', () => {
    const validate = validateNewProviderId(['alpha']);

    expect(validate('')).toBe('Required.');
    expect(validate('../../outside')).toContain('must not contain path separators');
    expect(validate(' alpha ')).toBe('Provider id already exists.');
    expect(validate('bravo')).toBeUndefined();
  });

  it('describes auth state from stored key and env reference', () => {
    expect(
      describeInteractiveAuthState({
        currentAuth: { apiKey: 'secret' },
        currentProviderConfig: undefined,
      }),
    ).toEqual({
      hasStoredApiKey: true,
      hasEnvReference: false,
      currentApiKeyEnv: undefined,
      currentModeLabel: 'Stored API key',
    });

    expect(
      describeInteractiveAuthState({
        currentAuth: undefined,
        currentProviderConfig: { apiKeyEnv: 'PROVIDER_API_KEY' },
      }),
    ).toEqual({
      hasStoredApiKey: false,
      hasEnvReference: true,
      currentApiKeyEnv: 'PROVIDER_API_KEY',
      currentModeLabel: 'Environment variable (PROVIDER_API_KEY)',
    });
  });

  it('formats interactive errors as concise single-line messages', () => {
    expect(formatInteractiveError(new Error('Failed to fetch models: 401\nSet auth.'))).toBe(
      'Failed to fetch models: 401',
    );
    expect(formatInteractiveError('boom')).toBe('Unknown error');
  });

  it('rejects interactive serve ports outside the TCP range before starting a server', async () => {
    await expect(
      runInteractiveServe({ stateDir: '/state', host: '127.0.0.1', port: '70000' }),
    ).rejects.toThrow('Invalid port');
  });

  it('shows only meaningful auth actions for the current state', () => {
    expect(
      getInteractiveAuthOptions({
        hasStoredApiKey: false,
        hasEnvReference: false,
      }),
    ).toEqual({
      initialValue: 'store',
      options: [
        { value: 'store', label: 'Use stored API key' },
        { value: 'env', label: 'Use environment variable' },
      ],
    });

    expect(
      getInteractiveAuthOptions({
        hasStoredApiKey: true,
        hasEnvReference: true,
      }),
    ).toEqual({
      initialValue: 'store',
      options: [
        {
          value: 'store',
          label: 'Use stored API key',
          hint: 'Stops using the environment variable',
        },
        {
          value: 'env',
          label: 'Use environment variable',
          hint: 'Clears the stored API key',
        },
        { value: 'clearStoredKey', label: 'Clear stored API key' },
        { value: 'stopUsingEnv', label: 'Stop using environment variable' },
      ],
    });
  });
});
