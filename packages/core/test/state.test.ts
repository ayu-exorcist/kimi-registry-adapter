import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createStatePaths,
  hasConflictMarkers,
  loadLastKnownGoodRegistry,
  loadProviderState,
  mergeEditableRegistry,
  writeRegistryArtifacts,
} from '../src/internal';
import { expectRecordValue } from './test-helpers';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-core-'));

describe('state layout', () => {
  it('builds the expected provider paths', () => {
    const paths = createStatePaths('C:/work/.kimi-registry-adapter', 'provider');

    expect(paths.providerDir).toContain('registries');
    expect(paths.internalDir).toContain('.internal');
    expect(paths.modelsPath).toContain('.internal');
    expect(paths.modelsPath).toContain('models.json');
    expect(paths.apiPath).toContain('api.json');
    expect(paths.statePath).toContain('.internal');
    expect(paths.statePath).toContain('state.json');
  });
});

describe('registry writes', () => {
  it('recovers unfinished registry artifact writes before loading provider state', () => {
    const tempDir = createTempDir();
    const paths = {
      apiPath: join(tempDir, 'api.json'),
      statePath: join(tempDir, 'state.json'),
    };
    const updateState = {
      updatedAt: '2026-07-01T00:00:00.000Z',
      lastUpdateStatus: 'ok' as const,
      warnings: [],
      errors: [],
      conflicts: [],
    };
    const oldGenerated = {
      provider: {
        id: 'provider',
        name: 'Old Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {},
      },
    };
    const newGenerated = {
      provider: {
        id: 'provider',
        name: 'New Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {},
      },
    };

    writeRegistryArtifacts(paths, oldGenerated, oldGenerated, updateState);

    const apiTempPath = `${paths.apiPath}.pending.tmp`;
    const stateTempPath = `${paths.statePath}.pending.tmp`;
    const transactionPath = join(tempDir, 'write-transaction.json');
    writeFileSync(apiTempPath, `${JSON.stringify(newGenerated, null, 2)}\n`);
    writeFileSync(
      stateTempPath,
      `${JSON.stringify({ lastGeneratedRegistry: newGenerated, updateState }, null, 2)}\n`,
    );
    writeFileSync(
      transactionPath,
      `${JSON.stringify(
        {
          apiPath: paths.apiPath,
          apiTempPath,
          statePath: paths.statePath,
          stateTempPath,
        },
        null,
        2,
      )}\n`,
    );
    renameSync(apiTempPath, paths.apiPath);

    expect(loadProviderState(paths.statePath)?.lastGeneratedRegistry).toEqual(newGenerated);
    expect(JSON.parse(readFileSync(paths.apiPath, 'utf8'))).toEqual(newGenerated);
    expect(existsSync(transactionPath)).toBe(false);
  });

  it('writes generated and editable registry artifacts atomically', () => {
    const tempDir = createTempDir();
    const paths = {
      apiPath: join(tempDir, 'api.json'),
      statePath: join(tempDir, 'state.json'),
    };

    const generated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 131072,
            },
            tool_call: true,
          },
        },
      },
    };

    const updateState = {
      updatedAt: '2026-07-01T00:00:00.000Z',
      lastUpdateStatus: 'ok' as const,
      warnings: [],
      errors: [],
      conflicts: [],
    };

    writeRegistryArtifacts(paths, generated, generated, updateState);

    expect(JSON.parse(readFileSync(paths.apiPath, 'utf8'))).toEqual(generated);
    expect(loadProviderState(paths.statePath)).toEqual({
      lastGeneratedRegistry: generated,
      updateState,
    });
  });

  it('rejects invalid provider state files instead of falling back to a stale baseline', () => {
    const tempDir = createTempDir();
    const statePath = join(tempDir, 'state.json');

    writeFileSync(
      statePath,
      JSON.stringify({ lastGeneratedRegistry: {}, updateState: { lastUpdateStatus: 'ok' } }),
      'utf8',
    );

    expect(() => loadProviderState(statePath)).toThrow(/Invalid provider update state/u);
  });
});

describe('mergeEditableRegistry', () => {
  it('preserves manual edits while adopting untouched generated fields', () => {
    const oldGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://old.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 131072,
            },
            tool_call: true,
          },
        },
      },
    };

    const currentEditable = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://old.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'Manual Name',
            limit: {
              context: 131072,
            },
            tool_call: true,
          },
          'gpt-4.2': {
            id: 'gpt-4.2',
            name: 'gpt-4.2',
            limit: {
              context: 131072,
            },
            tool_call: true,
          },
        },
      },
    };

    const newGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://new.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'Upstream Name',
            limit: {
              context: 262144,
            },
            tool_call: true,
          },
          'gpt-4.3': {
            id: 'gpt-4.3',
            name: 'gpt-4.3',
            limit: {
              context: 131072,
            },
            tool_call: true,
          },
        },
      },
    };

    const merged = mergeEditableRegistry({
      oldGenerated,
      currentEditable,
      newGenerated,
    });

    const provider = expectRecordValue(merged.editable, 'provider');
    const updatedModel = expectRecordValue(provider.models, 'gpt-4.1');
    expect(updatedModel.name).toBe('Manual Name');
    expect(updatedModel.limit?.context).toBe(262144);
    expect(expectRecordValue(provider.models, 'gpt-4.3')).toBeDefined();
    expect(provider.models['gpt-4.2']).toBeUndefined();
    expect(merged.conflicts).toEqual([
      {
        providerId: 'provider',
        modelId: 'gpt-4.1',
        field: 'name',
        before: 'gpt-4.1',
        current: 'Manual Name',
        incoming: 'Upstream Name',
        after: 'Manual Name',
      },
    ]);
  });
  it('can preserve locally added models that are absent from generated input', () => {
    const currentEditable = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          local: { id: 'local', name: 'Local Model' },
        },
      },
    };
    const newGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          upstream: { id: 'upstream', name: 'Upstream Model' },
        },
      },
    };

    const merged = mergeEditableRegistry({
      oldGenerated: undefined,
      currentEditable,
      newGenerated,
      preserveUnknownModels: true,
    });

    const provider = expectRecordValue(merged.editable, 'provider');
    expect(expectRecordValue(provider.models, 'local').name).toBe('Local Model');
    expect(expectRecordValue(provider.models, 'upstream').name).toBe('Upstream Model');
  });

  it('merges independent nested model fields without a parent-object conflict', () => {
    const oldGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 131072,
              output: 8192,
            },
          },
        },
      },
    };

    const currentEditable = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 200000,
              output: 8192,
            },
          },
        },
      },
    };

    const newGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 131072,
              output: 16384,
            },
          },
        },
      },
    };

    const merged = mergeEditableRegistry({
      oldGenerated,
      currentEditable,
      newGenerated,
    });

    const provider = expectRecordValue(merged.editable, 'provider');
    const updatedModel = expectRecordValue(provider.models, 'gpt-4.1');
    expect(updatedModel.limit).toEqual({
      context: 200000,
      output: 16384,
    });
    expect(merged.conflicts).toEqual([]);
  });

  it('records conflicts at the nested field path', () => {
    const oldGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 131072,
            },
          },
        },
      },
    };

    const currentEditable = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 200000,
            },
          },
        },
      },
    };

    const newGenerated = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai' as const,
        models: {
          'gpt-4.1': {
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            limit: {
              context: 262144,
            },
          },
        },
      },
    };

    const merged = mergeEditableRegistry({
      oldGenerated,
      currentEditable,
      newGenerated,
    });

    const provider = expectRecordValue(merged.editable, 'provider');
    const updatedModel = expectRecordValue(provider.models, 'gpt-4.1');
    expect(updatedModel.limit?.context).toBe(200000);
    expect(merged.conflicts).toEqual([
      {
        providerId: 'provider',
        modelId: 'gpt-4.1',
        field: 'limit.context',
        before: 131072,
        current: 200000,
        incoming: 262144,
        after: 200000,
      },
    ]);
  });
});

describe('conflict marker detection', () => {
  it('detects git conflict markers in api.json content', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch')).toBe(true);
    expect(hasConflictMarkers('{"ok":true}')).toBe(false);
  });
});

describe('last known good registry', () => {
  it('loads valid editable registries, treats missing files as absent, and rejects invalid content', () => {
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'api.json');

    expect(loadLastKnownGoodRegistry(filePath)).toBeUndefined();

    writeFileSync(
      filePath,
      JSON.stringify({
        provider: {
          id: 'provider',
          name: 'Provider',
          api: 'https://gateway.example.com/v1',
          type: 'openai',
          models: {},
        },
      }),
      'utf8',
    );

    expect(loadLastKnownGoodRegistry(filePath)).toBeDefined();

    writeFileSync(filePath, '{ invalid json', 'utf8');
    expect(() => loadLastKnownGoodRegistry(filePath)).toThrow(/./u);
  });
});
