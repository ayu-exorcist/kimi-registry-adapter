import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findAvailablePort,
  scheduleServeUpdates,
  waitForServerClose,
  type RegistryServer,
} from '../src/commands/server-runtime';
import { interactiveHomeSymbol } from '../src/prompts/navigation';
import { setPromptRuntime } from '../src/prompts/terminal-session';
import { createHealthSnapshot, createRegistryRuntime, startRegistryServer } from '../src/server';

const createStateDir = (): string => mkdtempSync(join(tmpdir(), 'kra-server-'));

afterEach(() => {
  vi.restoreAllMocks();
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
});

const registry = (providerId: string) => ({
  [providerId]: {
    id: providerId,
    name: providerId,
    api: 'https://api.example.com/v1',
    type: 'openai_responses',
    models: {
      'model-a': {
        id: 'model-a',
        name: 'Model A',
        limit: { context: 4096 },
      },
    },
  },
});

const writeRegistry = (stateDir: string, providerId: string): string => {
  const providerDir = join(stateDir, 'registries', providerId);
  mkdirSync(providerDir, { recursive: true });
  const filePath = join(providerDir, 'api.json');
  writeFileSync(filePath, `${JSON.stringify(registry(providerId), null, 2)}\n`);
  return filePath;
};

const expectTcpAddress = (address: AddressInfo | string | null): AddressInfo => {
  expect(address).toMatchObject({ address: '127.0.0.1' });
  if (typeof address === 'string' || address === null) {
    throw new Error('Expected TCP server address');
  }
  return address;
};

const closeServer = async (
  server: Awaited<ReturnType<typeof startRegistryServer>>,
): Promise<void> => {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
};

const createCapturedStdout = (): {
  output: typeof process.stdout;
  text: () => string;
} => {
  const output = new PassThrough() as unknown as typeof process.stdout;
  let outputText = '';
  output.write = ((chunk: string | Uint8Array) => {
    outputText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof output.write;
  return { output, text: () => outputText };
};

describe('registry runtime', () => {
  it('only advances to another port when the requested port is already in use', async () => {
    const occupied = createServer();
    await new Promise<void>((resolvePromise) => occupied.listen(0, '127.0.0.1', resolvePromise));
    const occupiedPort = expectTcpAddress(occupied.address()).port;

    try {
      await expect(findAvailablePort('127.0.0.1', occupiedPort)).resolves.toBeGreaterThan(
        occupiedPort,
      );
    } finally {
      await new Promise<void>((resolvePromise) => occupied.close(() => resolvePromise()));
    }
  });

  it('preserves fatal listen errors instead of reporting them as port exhaustion', async () => {
    await expect(findAvailablePort('not-a-valid-host.invalid', 65_535)).rejects.not.toThrow(
      'Invalid port',
    );
  });

  it('disposes scheduled provider updates with the serve lifecycle', async () => {
    vi.useFakeTimers();
    const runUpdates = vi.fn(async () => undefined);
    const schedule = scheduleServeUpdates(runUpdates, 1_000);

    try {
      await vi.advanceTimersByTimeAsync(2_500);
      expect(runUpdates).toHaveBeenCalledTimes(2);
      schedule.dispose();
      await vi.advanceTimersByTimeAsync(2_500);
      expect(runUpdates).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads, serves, and removes editable registries through one runtime seam', async () => {
    const stateDir = createStateDir();
    const registryPath = writeRegistry(stateDir, 'provider-a');
    const runtime = createRegistryRuntime(stateDir);

    expect(runtime.health()).toMatchObject({
      status: 'ok',
      providerCount: 1,
      providerIds: ['provider-a'],
    });

    const response = await runtime.app.request('/provider-a/api.json');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(registry('provider-a'));

    runtime.deleteFile(registryPath);

    expect(runtime.health()).toMatchObject({
      status: 'degraded',
      providerCount: 0,
      providerIds: [],
    });
    expect((await runtime.app.request('/provider-a/api.json')).status).toBe(503);
  });

  it('serves cached aggregate registries and invalidates them on file changes', async () => {
    const stateDir = createStateDir();
    const providerAPath = writeRegistry(stateDir, 'provider-a');
    const runtime = createRegistryRuntime(stateDir);

    expect(await (await runtime.app.request('/api.json')).json()).toEqual(registry('provider-a'));

    const providerBPath = writeRegistry(stateDir, 'provider-b');
    runtime.loadFile(providerBPath);

    expect(await (await runtime.app.request('/api.json')).json()).toEqual({
      ...registry('provider-a'),
      ...registry('provider-b'),
    });

    runtime.deleteFile(providerAPath);

    expect(await (await runtime.app.request('/api.json')).json()).toEqual(registry('provider-b'));
  });

  it('includes serve update status in runtime health when provided', () => {
    const stateDir = createStateDir();
    writeRegistry(stateDir, 'provider-a');
    const runtime = createRegistryRuntime(stateDir, undefined, {
      updateHealth: () => ({
        status: 'degraded',
        failedProviderIds: ['provider-a'],
      }),
    });

    expect(runtime.health()).toMatchObject({
      status: 'ok',
      updates: {
        status: 'degraded',
        failedProviderIds: ['provider-a'],
      },
    });
  });

  it('reports a single registry file health snapshot by provider id', () => {
    const stateDir = createStateDir();
    const registryPath = writeRegistry(stateDir, 'provider-a');

    expect(createHealthSnapshot(registryPath)).toMatchObject({
      status: 'ok',
      providerCount: 1,
      providerIds: ['provider-a'],
      registryPath,
    });
  });

  it('keeps a started HTTP server alive until the caller closes it', async () => {
    const stateDir = createStateDir();
    writeRegistry(stateDir, 'provider-a');

    const server = await startRegistryServer({
      stateDir,
      host: '127.0.0.1',
      port: 0,
    });
    const address = server.address();

    try {
      const tcpAddress = expectTcpAddress(address);
      const response = await fetch(`http://127.0.0.1:${tcpAddress.port}/provider-a/api.json`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(registry('provider-a'));
    } finally {
      await closeServer(server);
    }
  });

  it('reports registry files whose top-level provider key does not match the path', async () => {
    const stateDir = createStateDir();
    writeRegistry(stateDir, 'provider-a');
    const wrongPath = writeRegistry(stateDir, 'provider-b');
    writeFileSync(wrongPath, `${JSON.stringify(registry('other-provider'), null, 2)}\n`);

    const runtime = createRegistryRuntime(stateDir);

    expect(runtime.health()).toMatchObject({
      status: 'degraded',
      providerCount: 1,
      providerIds: ['provider-a'],
      invalidRegistryCount: 1,
    });
    expect((await runtime.app.request('/provider-b/api.json')).status).toBe(503);
  });

  it('stops a waiting server cleanly on SIGINT', () => {
    const { output, text } = createCapturedStdout();
    const exit = vi.fn((() => {
      throw new Error('exit');
    }) as (code?: number) => never);
    const restoreRuntime = setPromptRuntime({ output, exit });
    const close = vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
    });
    const server = {
      close,
      once: vi.fn(),
    } as unknown as RegistryServer;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      waitForServerClose(server);
      expect(() => process.emit('SIGINT')).toThrow('exit');

      expect(close).toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith('\nStopping registry server...\n');
      expect(text()).toContain('Bye!');
    } finally {
      restoreRuntime();
    }
  });

  it('returns to the interactive main menu when a served screen receives back navigation', async () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    Object.assign(input, { isTTY: true, setRawMode: vi.fn() });
    const restoreRuntime = setPromptRuntime({ input });
    const close = vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
    });
    const server = {
      close,
      once: vi.fn(),
    } as unknown as RegistryServer;

    try {
      const wait = waitForServerClose(server);
      input.emit('keypress', '', { name: 'escape' });
      await expect(wait).resolves.toBe(interactiveHomeSymbol);
      expect(close).toHaveBeenCalled();
    } finally {
      restoreRuntime();
    }
  });

  it('prints Bye after closing a server with ctrl+c keypress', async () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    const { output, text } = createCapturedStdout();
    Object.assign(input, { isTTY: true, setRawMode: vi.fn() });
    const exit = vi.fn((() => {
      throw new Error('exit');
    }) as (code?: number) => never);
    const restoreRuntime = setPromptRuntime({ input, output, exit });
    const close = vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
    });
    const server = {
      close,
      once: vi.fn(),
    } as unknown as RegistryServer;

    try {
      waitForServerClose(server);
      expect(() => input.emit('keypress', '', { ctrl: true, name: 'c' })).toThrow('exit');
      expect(text()).toContain('Bye!');
    } finally {
      restoreRuntime();
    }
  });

  it('keeps the last known good registry and reports degraded health when a changed file is invalid', async () => {
    const stateDir = createStateDir();
    const registryPath = writeRegistry(stateDir, 'provider-a');
    const runtime = createRegistryRuntime(stateDir);

    writeFileSync(registryPath, '{ invalid json');
    runtime.loadFile(registryPath);

    expect(runtime.health()).toMatchObject({
      status: 'degraded',
      providerCount: 1,
      providerIds: ['provider-a'],
      invalidRegistryCount: 1,
    });
    expect(await (await runtime.app.request('/provider-a/api.json')).json()).toEqual(
      registry('provider-a'),
    );
  });
});
