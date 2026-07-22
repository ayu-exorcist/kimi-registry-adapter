import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireStateDirLock,
  clearModelsMetadataCache,
  configureProviderAuth,
  createStatePaths,
  getProviderAuthState,
  getProviderConfig,
  getServeCommand,
  getStateConfigSummary,
  listProviders,
  printUrl,
  readAuthConfig,
  readConfig,
  removeProvider,
  saveProvider,
  fetchConfiguredProviderModels,
  setProviderConfigApiKeyEnv,
  setProviderModelInclude,
  setupProviderOperation,
  updateProviderConfig,
  updateProviderOperation,
  validateRegistry,
  withProviderLock,
} from '../src/internal';
import { expectRecordValue } from './test-helpers';

const createStateDir = (): string => mkdtempSync(join(tmpdir(), 'kra-ops-'));
const git = (stateDir: string, args: string[]): string =>
  execFileSync('git', ['-C', stateDir, ...args], { encoding: 'utf8' }).trim();

const stubModelsAndMetadataFetch = (): void => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'model-a': {
            id: 'model-a',
            name: 'Model A',
            limit: { context: 4096 },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'model-b': {
            id: 'model-b',
            name: 'Model B',
            limit: { context: 8192 },
          },
        }),
      }),
  );
};

const waitUntil = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

describe('core operations', () => {
  afterEach(() => {
    clearModelsMetadataCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves and lists providers, and formats URLs and serve commands', async () => {
    const stateDir = createStateDir();

    const saved = await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      apiKeyEnv: 'PROVIDER_A_KEY',
      include: ['claude-*', 'gpt-4.1-mini'],
      exclude: ['*embedding*'],
    });

    expect(saved.stateDir).toBe(stateDir);
    expect(saved.configPath).toBe(join(stateDir, 'config.json'));
    expect(listProviders({ stateDir })).toMatchObject({
      providers: ['provider-a'],
      count: 1,
      configPath: join(stateDir, 'config.json'),
    });
    const savedConfig = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8'));
    expect(savedConfig.providers['provider-a'].include).toEqual(['claude-*', 'gpt-4.1-mini']);
    expect(savedConfig.providers['provider-a'].exclude).toEqual(['*embedding*']);
    expect(printUrl({ providerId: 'provider-a', host: '127.0.0.1', port: 2727 })).toEqual({
      providerId: 'provider-a',
      url: 'http://127.0.0.1:2727/provider-a/api.json',
    });
    expect(
      getServeCommand({ stateDir, host: '127.0.0.1', port: 2727, updateInterval: '1h' }),
    ).toEqual({
      command: `kra serve --state-dir ${stateDir} --host 127.0.0.1 --port 2727 --update-interval 1h`,
      argv: [
        'kra',
        'serve',
        '--state-dir',
        stateDir,
        '--host',
        '127.0.0.1',
        '--port',
        '2727',
        '--update-interval',
        '1h',
      ],
    });
    expect(
      getServeCommand({
        stateDir,
        host: '127.0.0.1',
        port: 2727,
        executable: '"C:\\Program Files\\kra\\kra.exe" serve',
      }).argv,
    ).toEqual([
      'C:\\Program Files\\kra\\kra.exe',
      'serve',
      '--state-dir',
      stateDir,
      '--host',
      '127.0.0.1',
      '--port',
      '2727',
    ]);
  });

  it('rejects invalid existing config instead of replacing it with defaults', async () => {
    const stateDir = createStateDir();
    const configPath = join(stateDir, 'config.json');
    writeFileSync(configPath, '{ invalid json', 'utf8');

    await expect(
      saveProvider({
        stateDir,
        providerId: 'provider-a',
        baseUrl: 'https://api.example.com/v1',
        type: 'openai_responses',
      }),
    ).rejects.toThrow(/./u);
    expect(readFileSync(configPath, 'utf8')).toBe('{ invalid json');
  });

  it('updates provider config fields and returns a defensive clone for readers', async () => {
    const stateDir = createStateDir();

    const saved = await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      name: 'Provider A',
      include: ['model-a'],
      modelSource: { kind: 'openai_models' },
    });

    await expect(
      setProviderModelInclude({
        stateDir,
        providerId: 'provider-a',
        include: ['model-b', 'model-c'],
      }),
    ).resolves.toEqual({
      providerId: 'provider-a',
      configPath: saved.configPath,
      include: ['model-b', 'model-c'],
    });

    await expect(
      updateProviderConfig({
        stateDir,
        providerId: 'provider-a',
        name: 'Provider A renamed',
        baseUrl: 'https://new.example.com/v1',
        type: 'anthropic',
        updateMode: 'overwrite',
        clearModelSource: true,
      }),
    ).resolves.toMatchObject({
      providerId: 'provider-a',
      configPath: saved.configPath,
      provider: {
        name: 'Provider A renamed',
        baseUrl: 'https://new.example.com/v1',
        type: 'anthropic',
        updateMode: 'overwrite',
        include: ['model-b', 'model-c'],
      },
    });

    const storedProvider = expectRecordValue(readConfig(saved.configPath).providers, 'provider-a');
    expect(storedProvider.modelSource).toBeUndefined();
    expect(storedProvider.include).toEqual(['model-b', 'model-c']);

    await expect(
      updateProviderConfig({
        stateDir,
        providerId: 'provider-a',
        modelSource: { kind: 'remote_url', url: 'https://models.example.com/models.json' },
      }),
    ).resolves.toMatchObject({
      provider: {
        modelSource: { kind: 'remote_url', url: 'https://models.example.com/models.json' },
      },
    });

    const configResult = getProviderConfig({ stateDir, providerId: 'provider-a' });
    configResult.provider.name = 'mutated outside';
    expect(getProviderConfig({ stateDir, providerId: 'provider-a' }).provider.name).toBe(
      'Provider A renamed',
    );
  });

  it('fetches configured provider models using stored auth context', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });
    await configureProviderAuth({ stateDir, providerId: 'provider-a', apiKey: 'secret-key' });
    const fetchProviderModels = vi.fn().mockResolvedValue([{ id: 'model-a' }]);

    await expect(
      fetchConfiguredProviderModels({
        stateDir,
        providerId: 'provider-a',
        runtime: { fetchProviderModels },
      }),
    ).resolves.toMatchObject({
      providerId: 'provider-a',
      configPath: join(stateDir, 'config.json'),
      models: [{ id: 'model-a' }],
    });
    expect(fetchProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.example.com/v1' }),
      'provider-a',
      'secret-key',
      undefined,
    );
  });

  it('serializes concurrent provider config saves without dropping providers', async () => {
    const stateDir = createStateDir();

    await Promise.all([
      saveProvider({
        stateDir,
        providerId: 'provider-a',
        baseUrl: 'https://a.example.com/v1',
        type: 'openai_responses',
      }),
      saveProvider({
        stateDir,
        providerId: 'provider-b',
        baseUrl: 'https://b.example.com/v1',
        type: 'openai_responses',
      }),
    ]);

    const config = readConfig(createStatePaths(stateDir, 'placeholder').configPath);
    expect(Object.keys(config.providers).toSorted()).toEqual(['provider-a', 'provider-b']);
  });

  it('rejects invalid existing auth instead of replacing it with empty auth', async () => {
    const stateDir = createStateDir();
    const authPath = join(stateDir, 'auth.json');
    writeFileSync(authPath, '{ invalid json', 'utf8');

    await expect(
      configureProviderAuth({ stateDir, providerId: 'provider-a', apiKeyEnv: 'PROVIDER_A_KEY' }),
    ).rejects.toThrow(/./u);
    expect(readFileSync(authPath, 'utf8')).toBe('{ invalid json');
  });

  it('serializes concurrent auth writes without dropping providers', async () => {
    const stateDir = createStateDir();

    await Promise.all([
      configureProviderAuth({ stateDir, providerId: 'provider-a', apiKeyEnv: 'PROVIDER_A_KEY' }),
      configureProviderAuth({ stateDir, providerId: 'provider-b', apiKeyEnv: 'PROVIDER_B_KEY' }),
    ]);

    const auth = readAuthConfig(createStatePaths(stateDir, 'placeholder').authPath);
    expect(Object.keys(auth.providers).toSorted()).toEqual(['provider-a', 'provider-b']);
  });

  it('does not hold the state lock while fetching update sources', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });

    let acquiredDuringFetch = false;
    await updateProviderOperation({
      stateDir,
      providerId: 'provider-a',
      runtime: {
        fetchProviderModels: async () => {
          const release = await acquireStateDirLock(stateDir, { timeoutMs: 20, retryMs: 5 });
          acquiredDuringFetch = true;
          await release();
          return [{ id: 'model-a' }];
        },
        readModelsMetadata: async () => ({}),
      },
    });

    expect(acquiredDuringFetch).toBe(true);
  });

  it('coalesces concurrent metadata fetches for provider updates', async () => {
    const stateDir = createStateDir();
    await Promise.all([
      saveProvider({
        stateDir,
        providerId: 'provider-a',
        baseUrl: 'https://a.example.com/v1',
        type: 'openai_responses',
      }),
      saveProvider({
        stateDir,
        providerId: 'provider-b',
        baseUrl: 'https://b.example.com/v1',
        type: 'openai_responses',
      }),
    ]);
    let releaseMetadata!: () => void;
    const metadataRelease = new Promise<void>((resolvePromise) => {
      releaseMetadata = resolvePromise;
    });
    const fetchMock = vi.fn(async () => {
      await metadataRelease;
      return {
        ok: true,
        json: async () => ({
          'model-a': {
            id: 'model-a',
            name: 'Model A',
            limit: { context: 4096 },
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const updates = Promise.all([
      updateProviderOperation({ stateDir, providerId: 'provider-a', models: [{ id: 'model-a' }] }),
      updateProviderOperation({ stateDir, providerId: 'provider-b', models: [{ id: 'model-a' }] }),
    ]);
    await waitUntil(() => fetchMock.mock.calls.length === 1);

    releaseMetadata();
    const [providerA, providerB] = await updates;

    expect(providerA.modelCount).toBe(1);
    expect(providerB.modelCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows different provider updates to proceed while another provider lock is held', async () => {
    const stateDir = createStateDir();
    await Promise.all([
      saveProvider({
        stateDir,
        providerId: 'provider-a',
        baseUrl: 'https://a.example.com/v1',
        type: 'openai_responses',
      }),
      saveProvider({
        stateDir,
        providerId: 'provider-b',
        baseUrl: 'https://b.example.com/v1',
        type: 'openai_responses',
      }),
    ]);
    let releaseProviderA!: () => void;
    const providerALock = withProviderLock(stateDir, 'provider-a', async () => {
      await new Promise<void>((resolvePromise) => {
        releaseProviderA = resolvePromise;
      });
    });
    await waitUntil(() => releaseProviderA !== undefined);

    const updateProviderB = await updateProviderOperation({
      stateDir,
      providerId: 'provider-b',
      models: [{ id: 'model-b' }],
      runtime: { readModelsMetadata: async () => ({}) },
    });

    expect(updateProviderB.modelCount).toBe(1);
    releaseProviderA();
    await providerALock;
  });

  it('serializes remove with an in-flight update for the same provider', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });
    let releaseProvider!: () => void;
    const events: string[] = [];
    const providerLock = withProviderLock(stateDir, 'provider-a', async () => {
      events.push('lock acquired');
      await new Promise<void>((resolvePromise) => {
        releaseProvider = resolvePromise;
      });
      events.push('lock released');
    });
    await waitUntil(() => events.includes('lock acquired'));

    const remove = removeProvider({ stateDir, providerId: 'provider-a' }).then(() => {
      events.push('remove completed');
    });

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    expect(events).toEqual(['lock acquired']);

    releaseProvider();
    await Promise.all([providerLock, remove]);
    expect(events).toEqual(['lock acquired', 'lock released', 'remove completed']);
  });

  it('retries instead of applying fetched data when auth changes during update', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });

    await expect(
      updateProviderOperation({
        stateDir,
        providerId: 'provider-a',
        runtime: {
          fetchProviderModels: async () => {
            await configureProviderAuth({
              stateDir,
              providerId: 'provider-a',
              apiKeyEnv: 'PROVIDER_A_KEY',
            });
            return [{ id: 'model-a' }];
          },
          readModelsMetadata: async () => ({}),
        },
      }),
    ).rejects.toThrow('Provider auth changed during update: provider-a. Retry the update.');
  });

  it('clones caller-provided models before updating', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });
    const models = [{ id: 'model-a' }];

    const update = updateProviderOperation({
      stateDir,
      providerId: 'provider-a',
      models,
      runtime: { readModelsMetadata: async () => ({}) },
    });
    models.push({ id: 'model-b' });

    await expect(update).resolves.toMatchObject({ modelCount: 1 });
  });

  it('commits provider config saves when requested without staging registry edits', async () => {
    const stateDir = createStateDir();
    mkdirSync(join(stateDir, 'registries', 'provider-a'), { recursive: true });
    writeFileSync(join(stateDir, 'registries', 'provider-a', 'api.json'), '{"manual":true}\n');

    const saved = await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      commit: true,
    });

    expect(saved.commit).toBeDefined();
    expect(git(stateDir, ['log', '-1', '--pretty=%s'])).toBe('add provider-a');
    expect(git(stateDir, ['ls-files'])).not.toContain('registries/provider-a/api.json');
  });

  it('sets up and updates a provider with stable operation summaries', async () => {
    const stateDir = createStateDir();
    stubModelsAndMetadataFetch();

    const setup = await setupProviderOperation({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      modelsMetadataPath: 'https://models.dev/models.json',
    });

    expect(setup).toMatchObject({
      providerId: 'provider-a',
      configPath: join(stateDir, 'config.json'),
      editablePath: join(stateDir, 'registries', 'provider-a', 'api.json'),
      modelCount: 1,
      metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
    });
    // Covers state summary and registry validation after setup writes a usable registry.
    expect(getStateConfigSummary({ stateDir })).toMatchObject({
      configPath: join(stateDir, 'config.json'),
      providers: ['provider-a'],
    });
    expect(validateRegistry({ stateDir, providerId: 'provider-a' })).toMatchObject({
      providerId: 'provider-a',
      ok: true,
      providerCount: 1,
    });

    const update = await updateProviderOperation({
      stateDir,
      providerId: 'provider-a',
      dryRun: true,
      models: [{ id: 'model-b' }],
      now: () => new Date('2026-06-25T00:00:00Z'),
    });

    expect(update).toMatchObject({
      editablePath: join(stateDir, 'registries', 'provider-a', 'api.json'),
      modelCount: 1,
      updateStateSummary: {
        updatedAt: '2026-06-25T00:00:00.000Z',
        lastUpdateStatus: 'ok',
        warnings: 0,
        errors: 0,
        conflicts: 0,
      },
    });
  });

  it('rolls back provider config and auth when setup discovery fails', async () => {
    const stateDir = createStateDir();

    await expect(
      setupProviderOperation({
        stateDir,
        providerId: 'provider-a',
        baseUrl: 'https://api.example.com/v1',
        type: 'openai_responses',
        apiKey: 'secret-key',
        storeApiKey: true,
        runtime: {
          fetchProviderModels: async () => {
            throw new Error('model discovery failed');
          },
          readModelsMetadata: async () => ({}),
        },
      }),
    ).rejects.toThrow('model discovery failed');

    expect(existsSync(join(stateDir, 'config.json'))).toBe(false);
    expect(existsSync(join(stateDir, 'auth.json'))).toBe(false);
    expect(existsSync(join(stateDir, 'registries', 'provider-a'))).toBe(false);
  });

  it('sets up a provider with stored auth and caller-supplied models', async () => {
    const stateDir = createStateDir();
    const fetchProviderModels = vi.fn().mockRejectedValue(new Error('should not fetch models'));
    const readModelsMetadata = vi.fn().mockResolvedValue(undefined);

    const setup = await setupProviderOperation({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      apiKey: 'secret-key',
      storeApiKey: true,
      models: [{ id: 'cached-model' }],
      runtime: { fetchProviderModels, readModelsMetadata },
    });

    expect(fetchProviderModels).not.toHaveBeenCalled();
    expect(readAuthConfig(join(stateDir, 'auth.json')).providers['provider-a']).toEqual({
      apiKey: 'secret-key',
    });
    expect(setup.editablePath).toBeDefined();
    expect(readFileSync(setup.editablePath as string, 'utf8')).toContain('cached-model');
  });

  it('replaces provider auth when switching between stored key and env reference', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      apiKeyEnv: 'PROVIDER_A_KEY',
    });

    const envResult = await configureProviderAuth({
      stateDir,
      providerId: 'provider-a',
      apiKeyEnv: 'PROVIDER_A_KEY',
    });
    expect(envResult.stored).toBe('apiKeyEnv');
    expect(JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8'))).toEqual({
      providers: {
        'provider-a': {
          apiKeyEnv: 'PROVIDER_A_KEY',
        },
      },
    });

    const keyResult = await configureProviderAuth({
      stateDir,
      providerId: 'provider-a',
      apiKey: 'secret',
    });
    expect(keyResult.stored).toBe('apiKey');
    expect(JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8'))).toEqual({
      providers: {
        'provider-a': {
          apiKey: 'secret',
        },
      },
    });
  });

  // Covers auth state reporting so auth.json secrets and config apiKeyEnv references stay distinct.
  it('reports auth state and updates provider config apiKeyEnv references', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      apiKeyEnv: 'PROVIDER_A_KEY',
    });
    await configureProviderAuth({ stateDir, providerId: 'provider-a', apiKey: 'secret' });

    expect(getProviderAuthState({ stateDir, providerId: 'provider-a' })).toMatchObject({
      providerId: 'provider-a',
      currentAuth: { apiKey: 'secret' },
      currentProviderConfig: { apiKeyEnv: 'PROVIDER_A_KEY' },
    });

    await setProviderConfigApiKeyEnv({ stateDir, providerId: 'provider-a' });
    expect(getProviderAuthState({ stateDir, providerId: 'provider-a' })).toMatchObject({
      currentAuth: { apiKey: 'secret' },
      currentProviderConfig: {},
    });
    expect(
      expectRecordValue(readConfig(join(stateDir, 'config.json')).providers, 'provider-a')
        .apiKeyEnv,
    ).toBe(undefined);

    await setProviderConfigApiKeyEnv({
      stateDir,
      providerId: 'provider-a',
      apiKeyEnv: 'PROVIDER_A_KEY_V2',
    });
    expect(
      getProviderAuthState({ stateDir, providerId: 'provider-a' }).currentProviderConfig,
    ).toEqual({ apiKeyEnv: 'PROVIDER_A_KEY_V2' });
  });

  // Covers missing-provider config edits so callers get a clear configuration error.
  it('rejects setting provider config apiKeyEnv for an unknown provider', async () => {
    await expect(
      setProviderConfigApiKeyEnv({
        stateDir: createStateDir(),
        providerId: 'missing-provider',
        apiKeyEnv: 'MISSING_KEY',
      }),
    ).rejects.toThrow('Provider not found in config: missing-provider');
  });

  it('rejects auth configuration without a stored key or env reference', async () => {
    await expect(
      configureProviderAuth({ stateDir: createStateDir(), providerId: 'provider-a' }),
    ).rejects.toThrow('Provide apiKey or apiKeyEnv, or set clear to true.');
  });

  it('removes provider config, auth, and local registry files', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });
    writeFileSync(
      join(stateDir, 'auth.json'),
      `${JSON.stringify({ providers: { 'provider-a': { apiKeyEnv: 'PROVIDER_A_KEY' } } }, null, 2)}\n`,
    );
    mkdirSync(join(stateDir, 'registries', 'provider-a'), { recursive: true });
    writeFileSync(join(stateDir, 'registries', 'provider-a', 'api.json'), '{}\n');

    const result = await removeProvider({ stateDir, providerId: 'provider-a' });

    expect(result).toMatchObject({
      providerId: 'provider-a',
      configPath: join(stateDir, 'config.json'),
      authPath: join(stateDir, 'auth.json'),
      deletedFiles: true,
    });
    expect(existsSync(join(stateDir, 'registries', 'provider-a'))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')).providers['provider-a'],
    ).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8')).providers['provider-a'],
    ).toBeUndefined();
  });

  it('restores provider state when removal fails before it can be committed', async () => {
    const stateDir = createStateDir();
    await saveProvider({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
    });
    writeFileSync(
      join(stateDir, 'auth.json'),
      `${JSON.stringify({ providers: { 'provider-a': { apiKeyEnv: 'PROVIDER_A_KEY' } } })}\n`,
    );
    const providerDir = join(stateDir, 'registries', 'provider-a');
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(join(providerDir, 'api.json'), '{}\n');
    writeFileSync(join(stateDir, '.git'), 'not a git repository');

    await expect(removeProvider({ stateDir, providerId: 'provider-a' })).rejects.toThrow(
      /git|repository/iu,
    );

    expect(readConfig(join(stateDir, 'config.json')).providers['provider-a']).toBeDefined();
    expect(readAuthConfig(join(stateDir, 'auth.json')).providers['provider-a']).toEqual({
      apiKeyEnv: 'PROVIDER_A_KEY',
    });
    expect(existsSync(join(providerDir, 'api.json'))).toBe(true);
  });

  it('removes a local-only registry without a configured provider', async () => {
    const stateDir = createStateDir();
    const providerDir = join(stateDir, 'registries', 'orphan-provider');
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(join(providerDir, 'api.json'), '{}\n');

    const result = await removeProvider({ stateDir, providerId: 'orphan-provider' });

    expect(result).toMatchObject({
      providerId: 'orphan-provider',
      deletedFiles: true,
    });
    expect(existsSync(providerDir)).toBe(false);
    expect(readConfig(join(stateDir, 'config.json')).providers).toEqual({});
    expect(readAuthConfig(join(stateDir, 'auth.json')).providers).toEqual({});
    await expect(
      removeProvider({ stateDir, providerId: 'orphan-provider' }),
    ).resolves.toMatchObject({ deletedFiles: true });
  });

  it('removes provider config without committing kept registry edits', async () => {
    const stateDir = createStateDir();
    stubModelsAndMetadataFetch();

    await setupProviderOperation({
      stateDir,
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      modelsMetadataPath: 'https://models.dev/models.json',
    });

    const apiPath = join(stateDir, 'registries', 'provider-a', 'api.json');
    const committedRegistry = git(stateDir, ['show', 'HEAD:registries/provider-a/api.json']);
    writeFileSync(apiPath, '{"manual":true}\n');

    const result = await removeProvider({ stateDir, providerId: 'provider-a', keepFiles: true });

    expect(result.deletedFiles).toBe(false);
    expect(git(stateDir, ['show', 'HEAD:registries/provider-a/api.json'])).toBe(committedRegistry);
    expect(readFileSync(apiPath, 'utf8')).toContain('manual');
    expect(git(stateDir, ['status', '--short', '--', 'registries/provider-a/api.json'])).toBe(
      'M registries/provider-a/api.json',
    );
  });
});
