import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addProviderToConfig,
  createDefaultConfig,
  readAuthConfig,
  removeProviderAuth,
  removeProviderFromConfig,
  writeAuthConfig,
  writeConfig,
} from '../src/internal';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-remove-'));

describe('provider removal', () => {
  it('removes providers from config and auth files', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, 'config.json');
    const authPath = join(tempDir, 'auth.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
    });

    writeConfig(configPath, config);
    writeAuthConfig(authPath, {
      providers: {
        provider: {
          apiKey: 'test-token',
        },
      },
    });

    expect(removeProviderFromConfig(config, 'provider').providers['provider']).toBeUndefined();
    expect(
      removeProviderAuth(readAuthConfig(authPath), 'provider').providers['provider'],
    ).toBeUndefined();
  });
});
