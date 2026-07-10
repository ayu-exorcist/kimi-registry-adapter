import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/index';

type MetadataMatchSummary = {
  exact: number;
  normalized: number;
  unmatched: number;
};

type SetupCommandResult = {
  providerId: string;
  modelCount: number;
  metadataMatchSummary: MetadataMatchSummary;
  url: string;
  npm?: string;
  include?: string[];
  exclude?: string[];
};

type AddCommandResult = {
  providerId: string;
  configPath: string;
  commit?: string;
};

type UpdateCommandResult = {
  providerId: string;
  dryRun: boolean;
  metadataMatchSummary: MetadataMatchSummary;
  updateState: {
    lastUpdateStatus: string;
  };
};

type RemoveCommandResult = {
  providerId: string;
  deletedFiles: boolean;
};

const captureStdout = () => {
  let output = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write);

  return {
    spy,
    readJson: () => JSON.parse(output.trim()),
  };
};

const runCliJson = async <T>(argv: string[]): Promise<T> => {
  const stdout = captureStdout();
  await runCli(argv);
  stdout.spy.mockRestore();
  return stdout.readJson() as T;
};

describe('CLI command flows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs add and commits only provider config', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));

    const result = await runCliJson<AddCommandResult>([
      'add',
      'provider-a',
      '--base-url',
      'https://api.example.com/v1',
      '--state-dir',
      stateDir,
      '--no-update',
    ]);

    expect(result.providerId).toBe('provider-a');
    expect(result.configPath).toBe(join(stateDir, 'config.json'));
    expect(result.commit).toBeDefined();
    expect(
      execFileSync('git', ['-C', stateDir, 'log', '-1', '--pretty=%s'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('add provider-a');
  });

  it('runs setup with metadata summary and writes provider state', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }] }),
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
      });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runCliJson<SetupCommandResult>([
      'add',
      'provider-a',
      '--base-url',
      'https://api.example.com/v1',
      '--state-dir',
      stateDir,
      '--models-metadata-path',
      'https://models.dev/models.json',
      '--npm',
      '@ai-sdk/openai',
      '--include',
      'model-a',
      'model-c',
      '--exclude',
      'model-b',
      '--host',
      '127.0.0.1',
      '--port',
      '2727',
    ]);

    expect(result.providerId).toBe('provider-a');
    expect(result.modelCount).toBe(2);
    expect(result.metadataMatchSummary).toEqual({ exact: 1, normalized: 0, unmatched: 1 });
    expect(result.npm).toBe('@ai-sdk/openai');
    expect(result.include).toEqual(['model-a', 'model-c']);
    expect(result.exclude).toEqual(['model-b']);
    expect(result.url).toBe('http://127.0.0.1:2727/provider-a/api.json');
    expect(existsSync(join(stateDir, 'registries', 'provider-a', 'api.json'))).toBe(true);
    expect(existsSync(join(stateDir, 'registries', 'provider-a', '.internal', 'models.json'))).toBe(
      true,
    );
    expect(
      JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')).providers['provider-a'].npm,
    ).toBe('@ai-sdk/openai');
  });

  it('runs update in dry-run mode and reports metadata summary', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'model-a': { id: 'model-a', name: 'Model A' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'model-a': { id: 'model-a', name: 'Model A' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await runCliJson<SetupCommandResult>([
      'add',
      'provider-a',
      '--base-url',
      'https://api.example.com/v1',
      '--state-dir',
      stateDir,
      '--models-metadata-path',
      'https://models.dev/models.json',
    ]);

    const result = await runCliJson<UpdateCommandResult>([
      'update',
      'provider-a',
      '--state-dir',
      stateDir,
      '--dry-run',
      '--update-mode',
      'overwrite',
    ]);

    expect(
      JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')).providers['provider-a']
        .updateMode,
    ).toBeUndefined();
    expect(result.providerId).toBe('provider-a');
    expect(result.dryRun).toBe(true);
    expect(result.metadataMatchSummary).toEqual({ exact: 1, normalized: 0, unmatched: 0 });
    expect(result.updateState.lastUpdateStatus).toBe('ok');
  });

  it('clears provider auth from command mode', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));

    await runCliJson<Record<string, unknown>>([
      'auth',
      'provider-a',
      '--api-key-env',
      'PROVIDER_A_KEY',
      '--state-dir',
      stateDir,
    ]);
    const result = await runCliJson<{ stored: string }>([
      'auth',
      'provider-a',
      '--clear',
      '--state-dir',
      stateDir,
    ]);

    expect(result.stored).toBe('none');
    expect(
      JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8')).providers['provider-a'],
    ).toBeUndefined();
  });

  it('removes a local-only registry without a configured provider', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));
    const providerDir = join(stateDir, 'registries', 'orphan-provider');
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(join(providerDir, 'api.json'), '{}\n');

    const result = await runCliJson<RemoveCommandResult>([
      'remove',
      'orphan-provider',
      '--state-dir',
      stateDir,
    ]);

    expect(result.providerId).toBe('orphan-provider');
    expect(result.deletedFiles).toBe(true);
    expect(existsSync(providerDir)).toBe(false);
  });

  it('removes provider config, auth, and registry files', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'kra-cli-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'model-a': { id: 'model-a', name: 'Model A' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await runCliJson<SetupCommandResult>([
      'add',
      'provider-a',
      '--base-url',
      'https://api.example.com/v1',
      '--state-dir',
      stateDir,
      '--models-metadata-path',
      'https://models.dev/models.json',
    ]);
    await runCliJson<Record<string, unknown>>([
      'auth',
      'provider-a',
      '--api-key-env',
      'PROVIDER_A_KEY',
      '--state-dir',
      stateDir,
    ]);

    const result = await runCliJson<RemoveCommandResult>([
      'remove',
      'provider-a',
      '--state-dir',
      stateDir,
    ]);

    expect(result.providerId).toBe('provider-a');
    expect(result.deletedFiles).toBe(true);
    expect(existsSync(join(stateDir, 'registries', 'provider-a'))).toBe(false);

    const config = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')) as {
      providers: Record<string, unknown>;
    };
    expect(config.providers['provider-a']).toBeUndefined();

    const auth = JSON.parse(readFileSync(join(stateDir, 'auth.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(auth['provider-a']).toBeUndefined();
  });
});
