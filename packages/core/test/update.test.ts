import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addProviderToConfig,
  clearModelsMetadataCache,
  createDefaultConfig,
  fetchAnthropicModelsPayload,
  fetchModelsPayload,
  fetchProviderModels,
  readModelsMetadata,
  readModelsPayloadContent,
  resolveModelsUrl,
  updateProvider,
  updateProviderConfig,
  writeConfig,
} from '../src/internal';
import { expectRecordValue } from './test-helpers';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-update-'));
const git = (stateDir: string, args: string[]): string =>
  execFileSync('git', ['-C', stateDir, ...args], { encoding: 'utf8' }).trim();
const commitAll = (stateDir: string, subject: string): void => {
  git(stateDir, ['init']);
  git(stateDir, ['config', 'user.name', 'test']);
  git(stateDir, ['config', 'user.email', 'test@example.invalid']);
  git(stateDir, ['add', '-A']);
  git(stateDir, ['commit', '-m', subject]);
};
const writeMetadataFixture = (stateDir: string): string => {
  const filePath = join(stateDir, 'models.json');
  writeFileSync(filePath, JSON.stringify({}, null, 2));
  return filePath;
};

describe('updateProvider', () => {
  afterEach(() => {
    clearModelsMetadataCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes cached local metadata when the source file changes', async () => {
    const stateDir = createTempDir();
    const metadataPath = join(stateDir, 'metadata.json');
    writeFileSync(
      metadataPath,
      JSON.stringify({ 'model-a': { id: 'model-a', name: 'Model A' } }, null, 2),
    );

    expect(await readModelsMetadata(metadataPath)).toHaveProperty('model-a');

    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          'model-b': {
            id: 'model-b',
            name: 'Model B',
            family: 'family-b',
          },
        },
        null,
        2,
      ),
    );

    const refreshed = await readModelsMetadata(metadataPath);

    expect(refreshed).not.toHaveProperty('model-a');
    expect(refreshed).toHaveProperty('model-b');
  });

  it('uses the default models.dev metadata URL when no override is configured', async () => {
    const stateDir = createTempDir();
    const configPath = join(stateDir, 'config.json');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        gpt: {
          id: 'gpt',
          name: 'GPT',
          limit: { context: 400000 },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {},
    });

    writeConfig(configPath, config);

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt' }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.dev/models.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const provider = expectRecordValue(result.generated, 'provider');
    expect(expectRecordValue(provider.models, 'gpt').name).toBe('GPT');

    vi.unstubAllGlobals();
  });

  it('falls back when remote metadata is unavailable and logs a warning', async () => {
    const stateDir = createTempDir();
    const configPath = join(stateDir, 'config.json');
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubGlobal('fetch', fetchMock);

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: [],
      overrides: {},
    });

    writeConfig(configPath, config);

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt' }],
    });

    const provider = expectRecordValue(result.generated, 'provider');
    expect(expectRecordValue(provider.models, 'gpt').name).toBe('gpt');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[kra:network] warn'));

    vi.unstubAllGlobals();
  });

  it('does not write artifacts when an update signal is already aborted', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');
    const controller = new AbortController();

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      include: ['*'],
      exclude: [],
    });

    writeConfig(configPath, config);
    controller.abort(new Error('stop update'));

    await expect(
      updateProvider({
        stateDir,
        providerId: 'provider',
        models: [{ id: 'gpt-4.1' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('stop update');
    expect(() =>
      readFileSync(join(stateDir, 'registries', 'provider', 'api.json'), 'utf8'),
    ).toThrow(/ENOENT/u);
  });

  it('writes generated and editable artifacts for a configured provider', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {},
    });

    writeConfig(configPath, config);

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [
        {
          id: 'gpt-4.1',
          max_output_tokens: 8192,
        },
      ],
    });

    expect(result.editablePath).toContain('api.json');
    expect(
      JSON.parse(
        readFileSync(join(stateDir, 'registries', 'provider', '.internal', 'models.json'), 'utf8'),
      ),
    ).toEqual({
      data: [
        {
          id: 'gpt-4.1',
          max_output_tokens: 8192,
        },
      ],
    });
    expect(result.updateState).toMatchObject({
      lastUpdateStatus: 'ok',
      warnings: [],
      conflicts: [],
    });
    expect(
      JSON.parse(
        readFileSync(join(stateDir, 'registries', 'provider', '.internal', 'state.json'), 'utf8'),
      ),
    ).toMatchObject({
      lastGeneratedRegistry: result.generated,
      updateState: {
        lastUpdateStatus: 'ok',
        warnings: [],
        conflicts: [],
      },
    });
  });

  it('updates api.json provider fields when the config changes and merge has a baseline', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {},
    });

    writeConfig(configPath, config);

    await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt-4.1' }],
    });

    await updateProviderConfig({
      stateDir,
      providerId: 'provider',
      type: 'anthropic',
    });

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'claude-sonnet-4-5' }],
    });

    expect(result.generated).toMatchObject({
      provider: {
        type: 'anthropic',
      },
    });
    expect(
      JSON.parse(readFileSync(join(stateDir, 'registries', 'provider', 'api.json'), 'utf8')),
    ).toMatchObject({
      provider: {
        type: 'anthropic',
      },
    });
  });

  it('uses state.json lastGeneratedRegistry even when api.json was manually committed', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: [],
      overrides: {},
    });

    writeConfig(configPath, config);

    await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt-4.1', max_output_tokens: 8192 }],
    });
    commitAll(stateDir, 'initial generated registry');

    const apiPath = join(stateDir, 'registries', 'provider', 'api.json');
    const edited = JSON.parse(readFileSync(apiPath, 'utf8'));
    edited.provider.models['gpt-4.1'].name = 'Manual Name';
    writeFileSync(apiPath, `${JSON.stringify(edited, null, 2)}\n`);
    commitAll(stateDir, 'manual checkpoint');

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt-4.1', max_output_tokens: 16384 }],
    });

    const provider = expectRecordValue(result.editable, 'provider');
    const updatedModel = expectRecordValue(provider.models, 'gpt-4.1');
    expect(updatedModel.name).toBe('Manual Name');
    expect(updatedModel.limit?.output).toBe(16384);
  });

  it('rejects invalid editable registry content instead of overwriting user edits', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      include: ['*'],
      exclude: [],
    });

    writeConfig(configPath, config);
    await updateProvider({
      stateDir,
      providerId: 'provider',
      models: [{ id: 'gpt-4.1' }],
    });

    const apiPath = join(stateDir, 'registries', 'provider', 'api.json');
    writeFileSync(apiPath, '{ invalid json', 'utf8');

    await expect(
      updateProvider({
        stateDir,
        providerId: 'provider',
        models: [{ id: 'gpt-4.2' }],
      }),
    ).rejects.toThrow(/./u);
    expect(readFileSync(apiPath, 'utf8')).toBe('{ invalid json');
  });

  it('supports dry-run without writing files', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const configPath = join(stateDir, 'config.json');

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      modelsMetadataPath: metadataPath,
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {
        'gpt-4.1': {
          name: 'Custom Name',
        },
      },
    });

    writeConfig(configPath, config);

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
      dryRun: true,
      force: true,
      models: [{ id: 'gpt-4.1' }, { id: 'text-embedding-3-small' }],
    });

    const provider = expectRecordValue(result.generated, 'provider');
    expect(expectRecordValue(provider.models, 'gpt-4.1').name).toBe('Custom Name');
    expect(provider.models['text-embedding-3-small']).toBeUndefined();
  });

  it('resolves the exact /models URL used for upstream model fetching', () => {
    expect(resolveModelsUrl('https://gateway.example.com/v1')).toBe(
      'https://gateway.example.com/v1/models',
    );
    expect(resolveModelsUrl('https://gateway.example.com')).toBe(
      'https://gateway.example.com/v1/models',
    );
    expect(
      resolveModelsUrl(
        'https://gateway.example.com/v1',
        'https://gateway.example.com/custom/models',
      ),
    ).toBe('https://gateway.example.com/custom/models');
  });

  it('sends authorization from explicit API key override when fetching models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4.1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchModelsPayload('https://gateway.example.com/v1', undefined, 'test-token'),
    ).resolves.toEqual([{ id: 'gpt-4.1' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
        },
        signal: expect.any(AbortSignal),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('adds an auth setup hint when upstream models returns 401', async () => {
    const stateDir = createTempDir();
    const configPath = join(stateDir, 'config.json');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'openai',
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: [],
      overrides: {},
    });
    writeConfig(configPath, config);

    await expect(updateProvider({ stateDir, providerId: 'provider' })).rejects.toThrow(
      'kra auth provider --api-key <key>',
    );

    vi.unstubAllGlobals();
  });

  it('fetches anthropic-native model listings with x-api-key auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAnthropicModelsPayload('https://api.anthropic.example', undefined, 'test-token'),
    ).resolves.toEqual([{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.example/v1/models',
      expect.objectContaining({
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': 'test-token',
        },
        signal: expect.any(AbortSignal),
      }),
    );

    vi.unstubAllGlobals();
  });

  // Covers mixed remote payload rows so only valid model records are kept and ids are normalized.
  it('parses remote model payload content and ignores malformed model rows', () => {
    expect(
      readModelsPayloadContent(
        JSON.stringify({
          data: [
            { id: '  model-a  ', max_output_tokens: 4096 },
            { name: 'missing id' },
            null,
            { id: '   ' },
          ],
        }),
      ),
    ).toEqual([{ id: 'model-a', max_output_tokens: 4096 }]);
  });

  // Covers remote_url model discovery without implicit provider credential forwarding.
  it('fetches provider models from a remote_url model source without bearer auth by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'remote-model', name: 'Remote Model' }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchProviderModels(
        {
          name: 'Provider',
          baseUrl: 'https://gateway.example.com/v1',
          type: 'openai',
          modelSource: { kind: 'remote_url', url: 'https://models.example.com/list.json' },
          fallbackContext: 131072,
          fallbackToolCall: true,
          include: ['*'],
          exclude: [],
          overrides: {},
        },
        'provider',
        'test-token',
      ),
    ).resolves.toEqual([{ id: 'remote-model', name: 'Remote Model' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.example.com/list.json',
      expect.objectContaining({
        headers: {},
        signal: expect.any(AbortSignal),
      }),
    );

    vi.unstubAllGlobals();
  });

  // Covers the explicit opt-in for trusted remote_url payload endpoints that require provider auth.
  it('fetches provider models from a remote_url model source with bearer auth when opted in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'remote-model', name: 'Remote Model' }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchProviderModels(
        {
          name: 'Provider',
          baseUrl: 'https://gateway.example.com/v1',
          type: 'openai',
          modelSource: {
            kind: 'remote_url',
            url: 'https://models.example.com/list.json',
            auth: 'provider',
          },
          fallbackContext: 131072,
          fallbackToolCall: true,
          include: ['*'],
          exclude: [],
          overrides: {},
        },
        'provider',
        'test-token',
      ),
    ).resolves.toEqual([{ id: 'remote-model', name: 'Remote Model' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.example.com/list.json',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        signal: expect.any(AbortSignal),
      }),
    );

    vi.unstubAllGlobals();
  });

  // Covers invalid remote_url payloads so malformed JSON is reported as a parse fetch error.
  it('classifies invalid remote_url model payloads as parse errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchProviderModels(
        {
          name: 'Provider',
          baseUrl: 'https://gateway.example.com/v1',
          type: 'openai',
          modelSource: { kind: 'remote_url', url: 'https://models.example.com/list.json' },
          fallbackContext: 131072,
          fallbackToolCall: true,
          include: ['*'],
          exclude: [],
          overrides: {},
        },
        'provider',
      ),
    ).rejects.toMatchObject({
      kind: 'parse',
      message: 'Fetch remote models payload failed: invalid models payload.',
    });

    vi.unstubAllGlobals();
  });

  it('updates a provider from a local_file model source', async () => {
    const stateDir = createTempDir();
    const metadataPath = writeMetadataFixture(stateDir);
    const modelsPath = join(stateDir, 'source-models.json');
    const configPath = join(stateDir, 'config.json');

    writeFileSync(
      modelsPath,
      JSON.stringify(
        [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', max_output_tokens: 64000 }],
        null,
        2,
      ),
    );

    const config = addProviderToConfig(createDefaultConfig(), 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      type: 'anthropic',
      modelSource: {
        kind: 'local_file',
        path: modelsPath,
      },
      modelsMetadataPath: metadataPath,
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {},
    });

    writeConfig(configPath, config);

    const result = await updateProvider({
      stateDir,
      providerId: 'provider',
    });

    const provider = expectRecordValue(result.generated, 'provider');
    const model = expectRecordValue(provider.models, 'claude-sonnet-4-5');
    expect(provider.type).toBe('anthropic');
    expect(model.name).toBe('Claude Sonnet 4.5');
    expect(model.limit?.output).toBe(64000);
  });
});
