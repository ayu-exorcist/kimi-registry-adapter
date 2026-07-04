import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readAuthConfig,
  resolveProviderApiKey,
  setProviderAuth,
  writeAuthConfig,
} from '../src/internal';
import { expectRecordValue } from './test-helpers';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-auth-'));

describe('auth config', () => {
  it('stores provider auth outside config', () => {
    const filePath = join(createTempDir(), 'auth.json');
    const auth = setProviderAuth(readAuthConfig(filePath), 'provider', { apiKey: 'test-token' });

    writeAuthConfig(filePath, auth);

    const storedProvider = expectRecordValue(readAuthConfig(filePath).providers, 'provider');
    expect(storedProvider.apiKey).toBe('test-token');
    expect(resolveProviderApiKey(readAuthConfig(filePath), 'provider')).toBe('test-token');
  });

  it('resolves env based auth when no stored key exists', () => {
    process.env['PROVIDER_API_KEY'] = 'env-token';
    const auth = setProviderAuth(readAuthConfig(join(createTempDir(), 'auth.json')), 'provider', {
      apiKeyEnv: 'PROVIDER_API_KEY',
    });

    expect(resolveProviderApiKey(auth, 'provider')).toBe('env-token');

    delete process.env['PROVIDER_API_KEY'];
  });
});
