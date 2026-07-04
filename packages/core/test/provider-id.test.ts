import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createStatePaths,
  encodeProviderIdForUrl,
  isValidProviderId,
  normalizeProviderId,
  printUrl,
  providerIdFromRegistryPath,
  removeProvider,
  resolveStatePath,
} from '../src/internal';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-provider-id-'));

const invalidProviderIds = [
  '../../outside',
  'C:\\windows',
  '../a\\b',
  '',
  '   ',
  '.',
  '..',
  './a',
  'a/b',
  'a\\b',
  'C:windows',
  'bad\0id',
  'bad\nid',
];

describe('providerId safety', () => {
  it('accepts existing safe provider id shapes and rejects path-capable values', () => {
    expect(isValidProviderId('provider-a')).toBe(true);
    expect(isValidProviderId('moonshot')).toBe(true);
    expect(isValidProviderId('provider.a')).toBe(true);
    expect(isValidProviderId('provider a')).toBe(true);

    for (const providerId of invalidProviderIds) {
      expect(isValidProviderId(providerId), providerId).toBe(false);
      expect(() => normalizeProviderId(providerId), providerId).toThrow(/Invalid providerId/u);
    }
  });

  it('keeps generated state paths inside the state directory', () => {
    const stateDir = createTempDir();
    const paths = createStatePaths(stateDir, 'provider-a');

    expect(paths.providerDir).toBe(resolve(stateDir, 'registries', 'provider-a'));
    expect(paths.apiPath).toBe(resolve(stateDir, 'registries', 'provider-a', 'api.json'));

    for (const providerId of invalidProviderIds) {
      expect(() => createStatePaths(stateDir, providerId), providerId).toThrow(
        /Invalid providerId/u,
      );
    }

    expect(() => resolveStatePath(stateDir, '..', 'outside')).toThrow(
      /outside the state directory/u,
    );
  });

  it('does not remove paths outside the state directory for invalid provider ids', async () => {
    const parentDir = createTempDir();
    const stateDir = join(parentDir, 'state');
    const outsideDir = join(parentDir, 'outside');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    await expect(removeProvider({ stateDir, providerId: '../outside' })).rejects.toThrow(
      /Invalid providerId/u,
    );
    expect(existsSync(outsideDir)).toBe(true);
  });

  it('encodes provider ids in URL paths without changing safe ids', () => {
    expect(encodeProviderIdForUrl('provider-a')).toBe('provider-a');
    expect(printUrl({ providerId: 'provider-a', host: '127.0.0.1', port: 2727 }).url).toBe(
      'http://127.0.0.1:2727/provider-a/api.json',
    );
    expect(printUrl({ providerId: 'provider a', host: '127.0.0.1', port: 2727 }).url).toBe(
      'http://127.0.0.1:2727/provider%20a/api.json',
    );
  });

  it('extracts provider ids from registry paths only when the path is contained and direct', () => {
    const stateDir = createTempDir();
    const registryPath = resolve(stateDir, 'registries', 'provider-a', 'api.json');

    expect(providerIdFromRegistryPath(stateDir, registryPath)).toBe('provider-a');
    expect(
      providerIdFromRegistryPath(stateDir, resolve(stateDir, '..', 'provider-a', 'api.json')),
    ).toBeUndefined();
    expect(
      providerIdFromRegistryPath(stateDir, resolve(stateDir, 'registries', 'a', 'b', 'api.json')),
    ).toBeUndefined();
  });
});
