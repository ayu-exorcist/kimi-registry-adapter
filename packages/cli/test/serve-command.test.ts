import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    output: () => output,
  };
};

describe('serve command options', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('rejects ports outside the TCP range', async () => {
    const { resolveServeOptions } = await import('../src/commands/command-mode-handlers');

    expect(() =>
      resolveServeOptions(
        { stateDir: 'C:/tmp/kra-state', port: '70000' },
        { stateDir: 'C:/tmp/kra-state', host: '127.0.0.1', port: 2727 },
      ),
    ).toThrow('Invalid port');
  });

  it('passes update concurrency and timeout options to the serve scheduler', async () => {
    const updateConfiguredProviders = vi.fn().mockResolvedValue(undefined);
    const findAvailablePort = vi.fn().mockResolvedValue(2727);
    const startRegistryServerOnDemand = vi.fn().mockResolvedValue({});
    const waitForServerClose = vi.fn().mockResolvedValue(undefined);
    const stdout = captureStdout();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const updateTracker = { health: vi.fn(() => ({ status: 'ok' as const })) };

    vi.doMock('../src/commands/server-runtime', () => ({
      assertValidTcpPort: (port: number) => port,
      createServeUpdateTracker: () => updateTracker,
      findAvailablePort,
      startRegistryServerOnDemand,
      updateConfiguredProviders,
      waitForServerClose,
    }));

    const { runCli } = await import('../src/index');
    await runCli([
      'serve',
      '--state-dir',
      'C:/tmp/kra-state',
      '--host',
      '127.0.0.1',
      '--port',
      '2727',
      '--update-concurrency',
      '3',
      '--update-timeout-ms',
      '1234',
    ]);

    const expectedStateDir = resolve('C:/tmp/kra-state');
    expect(updateConfiguredProviders).toHaveBeenCalledWith(expectedStateDir, {
      concurrency: 3,
      timeoutMs: 1234,
      updateTracker,
    });
    expect(findAvailablePort).toHaveBeenCalledWith('127.0.0.1', 2727);
    expect(startRegistryServerOnDemand).toHaveBeenCalledWith({
      stateDir: expectedStateDir,
      host: '127.0.0.1',
      port: 2727,
      updateHealth: updateTracker.health,
    });
    expect(waitForServerClose).toHaveBeenCalled();
    expect(stdout.output()).toContain('Registry:');
    stdout.spy.mockRestore();
  });
});
