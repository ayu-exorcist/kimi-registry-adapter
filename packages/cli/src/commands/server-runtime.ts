import { createServer } from 'node:net';
import type * as readline from 'node:readline';

import {
  formatNetworkError,
  KraFetchError,
  listProviders,
  updateProviderOperation,
} from '@kastral/kra-core';

import { interactiveHomeSymbol, isHomeKey } from '../prompts/navigation';
import { createPromptReadline } from '../prompts/prompt-core';
import {
  createPromptCleanup,
  exitPrompt,
  promptInput,
  promptKeyInput,
} from '../prompts/terminal-session';
import type { UpdateHealthSnapshot } from '../server';

export type RegistryServer = {
  close(callback?: (error?: Error) => void): unknown;
  once(event: 'close', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
};

const DEFAULT_SERVE_PROVIDER_UPDATE_TIMEOUT_MS = 30_000;
const DEFAULT_SERVE_UPDATE_CONCURRENCY = 1;

export const assertValidTcpPort = (port: number, name = 'port'): number => {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid ${name}: expected an integer from 1 to 65535.`);
  }
  return port;
};

export const findAvailablePort = async (host: string, startPort: number): Promise<number> => {
  assertValidTcpPort(startPort);
  const canListen = (port: number): Promise<boolean> =>
    new Promise((resolvePromise) => {
      const server = createServer();
      server.once('error', () => resolvePromise(false));
      server.once('listening', () => {
        server.close(() => resolvePromise(true));
      });
      server.listen(port, host);
    });

  let port = startPort;
  while (!(await canListen(port))) {
    port += 1;
    assertValidTcpPort(port);
  }

  return port;
};

export const startRegistryServerOnDemand = async (options: {
  stateDir: string;
  host: string;
  port: number;
  updateHealth?: () => UpdateHealthSnapshot;
}): Promise<RegistryServer> => {
  const serverModule = await import('../server');
  return serverModule.startRegistryServer(options);
};

export type ServerCloseResult = 'closed' | typeof interactiveHomeSymbol;

export const waitForServerClose = async (server: RegistryServer): Promise<ServerCloseResult> => {
  return new Promise<ServerCloseResult>((resolvePromise, reject) => {
    let settled = false;
    let closing = false;
    let promptCleanup: (() => void) | undefined;
    let requestedCloseResult: ServerCloseResult | undefined;
    let shouldExitAfterClose = false;

    const cleanup = (): void => {
      process.off('SIGINT', stopServerFromSignal);
      process.off('SIGTERM', stopServerFromSignal);
      promptCleanup?.();
    };

    const resolveOnce = (result: ServerCloseResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishClose = (result: ServerCloseResult): void => {
      if (shouldExitAfterClose) {
        cleanup();
        exitPrompt();
      }
      resolveOnce(result);
    };

    const stopServer = (result: ServerCloseResult, showMessage = false): void => {
      if (closing) return;
      closing = true;
      requestedCloseResult = result;
      if (showMessage) {
        process.stderr.write('\nStopping registry server...\n');
      }
      server.close((error?: Error) => {
        if (error) {
          rejectOnce(error);
          return;
        }
        finishClose(result);
      });
    };

    const stopServerFromSignal = (): void => {
      shouldExitAfterClose = true;
      stopServer('closed', true);
    };

    const keypressHandler = (_char: string, key: readline.Key): void => {
      if (!key) return;
      if (isHomeKey(key) || key.name === 'escape' || key.name === 'left') {
        stopServer(interactiveHomeSymbol);
        return;
      }
      if (key.ctrl && key.name === 'c') {
        shouldExitAfterClose = true;
        stopServer('closed');
      }
    };

    process.once('SIGINT', stopServerFromSignal);
    process.once('SIGTERM', stopServerFromSignal);
    if (promptInput().isTTY) {
      const readlineInterface = createPromptReadline();
      promptKeyInput().resume();
      promptKeyInput().on('keypress', keypressHandler);
      promptCleanup = createPromptCleanup({
        readlineInterface,
        keypressHandler: () => keypressHandler,
      });
    }
    server.once('close', () => finishClose(requestedCloseResult ?? 'closed'));
    server.once('error', rejectOnce);
  });
};

const withServeUpdateTimeout = async <T>(
  providerId: string,
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`Provider update timed out after ${timeoutMs}ms: ${providerId}`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export type ServeUpdateTracker = {
  health: () => UpdateHealthSnapshot;
  runStarted: (providerIds: string[]) => void;
  providerStarted: (providerId: string) => void;
  providerSucceeded: (providerId: string) => void;
  providerFailed: (providerId: string) => void;
  runFinished: () => void;
};

export const createServeUpdateTracker = (
  now: () => Date = () => new Date(),
): ServeUpdateTracker => {
  let status: UpdateHealthSnapshot['status'] = 'idle';
  let lastRunStartedAt: string | undefined;
  let lastRunFinishedAt: string | undefined;
  let lastSuccessAt: string | undefined;
  let lastFailureAt: string | undefined;
  let providerCount: number | undefined;
  const runningProviderIds = new Set<string>();
  const failedProviderIds = new Set<string>();

  const timestamp = (): string => now().toISOString();

  return {
    health: () => ({
      status,
      ...(lastRunStartedAt ? { lastRunStartedAt } : {}),
      ...(lastRunFinishedAt ? { lastRunFinishedAt } : {}),
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
      ...(lastFailureAt ? { lastFailureAt } : {}),
      ...(typeof providerCount === 'number' ? { providerCount } : {}),
      ...(runningProviderIds.size > 0
        ? { runningProviderIds: Array.from(runningProviderIds).toSorted() }
        : {}),
      ...(failedProviderIds.size > 0
        ? { failedProviderIds: Array.from(failedProviderIds).toSorted() }
        : {}),
    }),
    runStarted: (providerIds) => {
      lastRunStartedAt = timestamp();
      providerCount = providerIds.length;
      lastRunFinishedAt = undefined;
      status = 'running';
      runningProviderIds.clear();
      failedProviderIds.clear();
    },
    providerStarted: (providerId) => {
      runningProviderIds.add(providerId);
      status = 'running';
    },
    providerSucceeded: (providerId) => {
      runningProviderIds.delete(providerId);
      lastSuccessAt = timestamp();
    },
    providerFailed: (providerId) => {
      runningProviderIds.delete(providerId);
      failedProviderIds.add(providerId);
      lastFailureAt = timestamp();
    },
    runFinished: () => {
      lastRunFinishedAt = timestamp();
      runningProviderIds.clear();
      status = failedProviderIds.size > 0 ? 'degraded' : 'ok';
    },
  };
};

export type UpdateConfiguredProvidersOptions = {
  providerIds?: string[];
  concurrency?: number;
  timeoutMs?: number;
  updateTracker?: ServeUpdateTracker;
  runtime?: {
    updateProviderOperation: typeof updateProviderOperation;
  };
};

const normalizeServeUpdateConcurrency = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_SERVE_UPDATE_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Serve update concurrency must be a positive integer.');
  }
  return value;
};

const normalizeServeUpdateTimeoutMs = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_SERVE_PROVIDER_UPDATE_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Serve update timeout must be a positive number of milliseconds.');
  }
  return value;
};

export const updateConfiguredProviders = async (
  stateDir: string,
  options: UpdateConfiguredProvidersOptions = {},
): Promise<void> => {
  const providerIds = options.providerIds ?? listProviders({ stateDir }).providers;
  const concurrency = Math.min(
    normalizeServeUpdateConcurrency(options.concurrency),
    providerIds.length || 1,
  );
  const timeoutMs = normalizeServeUpdateTimeoutMs(options.timeoutMs);
  const runtime = options.runtime ?? { updateProviderOperation };
  const updateTracker = options.updateTracker;
  let nextProviderIndex = 0;

  updateTracker?.runStarted(providerIds);

  const updateOne = async (providerId: string): Promise<void> => {
    updateTracker?.providerStarted(providerId);
    try {
      const result = await withServeUpdateTimeout(
        providerId,
        (signal) => runtime.updateProviderOperation({ stateDir, providerId, signal }),
        timeoutMs,
      );
      process.stderr.write(
        `updated ${providerId}: ${result.modelCount} models${result.commit ? ` (${result.commit})` : ''}\n`,
      );
      updateTracker?.providerSucceeded(providerId);
    } catch (error) {
      updateTracker?.providerFailed(providerId);
      const channel = error instanceof KraFetchError ? 'network' : 'update';
      process.stderr.write(
        `[kra:${channel}] warn update skipped for ${providerId}: ${formatNetworkError(error)}\n`,
      );
    }
  };

  const worker = async (): Promise<void> => {
    while (nextProviderIndex < providerIds.length) {
      const providerId = providerIds[nextProviderIndex];
      nextProviderIndex += 1;
      if (providerId) {
        await updateOne(providerId);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    updateTracker?.runFinished();
  }
};
