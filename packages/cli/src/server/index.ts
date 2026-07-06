import { join } from 'node:path';

import { serve, type ServerType } from '@hono/node-server';
import {
  normalizeProviderId,
  providerIdFromRegistryPath,
  type EditableRegistry,
} from '@kastral/kra-core';
import { Hono } from 'hono';

import { inspectRegistries, loadProviderRegistry, type ServerHealth } from './registry-listing';

export { createHealthSnapshot } from './registry-listing';

export type UpdateHealthSnapshot = {
  status: 'idle' | 'running' | 'ok' | 'degraded';
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  providerCount?: number;
  runningProviderIds?: string[];
  failedProviderIds?: string[];
};

type RuntimeHealth = ServerHealth & {
  stateDir: string;
  updates?: UpdateHealthSnapshot;
};

export type StartRegistryServerOptions = {
  stateDir: string;
  host: string;
  port: number;
  updateHealth?: () => UpdateHealthSnapshot;
};

export type RegistryCache = {
  registries: Map<string, EditableRegistry>;
  invalidRegistries: Map<string, string>;
  aggregate?: EditableRegistry;
};

export type RegistryRuntime = {
  stateDir: string;
  cache: RegistryCache;
  app: Hono;
  health: () => RuntimeHealth;
  loadFile: (filePath: string) => void;
  deleteFile: (filePath: string) => void;
};

const loadAllRegistries = (stateDir: string): RegistryCache => {
  const inspection = inspectRegistries(stateDir);
  const registries = new Map<string, EditableRegistry>();
  const invalidRegistries = new Map<string, string>();

  for (const registry of inspection.available) {
    registries.set(
      registry.providerId,
      loadProviderRegistry(registry.registryPath, registry.providerId),
    );
  }

  for (const invalid of inspection.invalid) {
    invalidRegistries.set(invalid.providerId, invalid.error);
  }

  return { registries, invalidRegistries };
};

const createRegistryCache = (stateDir: string): RegistryCache => loadAllRegistries(stateDir);

const aggregateRegistries = (cache: RegistryCache): EditableRegistry => {
  const aggregate = cache.aggregate ?? Object.assign({}, ...Array.from(cache.registries.values()));
  cache.aggregate = aggregate;
  return aggregate;
};

const invalidateAggregateRegistry = (cache: RegistryCache): void => {
  delete cache.aggregate;
};

export const createRegistryRuntime = (
  stateDir: string,
  cache: RegistryCache = createRegistryCache(stateDir),
  options: { updateHealth?: () => UpdateHealthSnapshot } = {},
): RegistryRuntime => {
  const app = new Hono();

  const health = (): RuntimeHealth => ({
    status: cache.registries.size > 0 && cache.invalidRegistries.size === 0 ? 'ok' : 'degraded',
    stateDir,
    providerCount: cache.registries.size,
    providerIds: Array.from(cache.registries.keys()).toSorted(),
    ...(cache.invalidRegistries.size > 0
      ? { invalidRegistryCount: cache.invalidRegistries.size }
      : {}),
    ...(options.updateHealth ? { updates: options.updateHealth() } : {}),
  });

  const loadFile = (filePath: string): void => {
    const providerId = providerIdFromRegistryPath(stateDir, filePath);

    if (!providerId) {
      return;
    }

    try {
      cache.registries.set(providerId, loadProviderRegistry(filePath, providerId));
      cache.invalidRegistries.delete(providerId);
      invalidateAggregateRegistry(cache);
    } catch (error) {
      cache.invalidRegistries.set(
        providerId,
        error instanceof Error ? error.message : 'Unknown registry validation error',
      );
      return;
    }
  };

  const deleteFile = (filePath: string): void => {
    const providerId = providerIdFromRegistryPath(stateDir, filePath);

    if (!providerId) {
      return;
    }

    cache.invalidRegistries.delete(providerId);
    if (cache.registries.delete(providerId)) {
      invalidateAggregateRegistry(cache);
    }
  };

  app.get('/healthz', (context) => context.json(health()));

  app.get('/api.json', (context) => {
    return context.json(aggregateRegistries(cache));
  });

  app.get('/:providerId/api.json', (context) => {
    let providerId: string;
    try {
      providerId = normalizeProviderId(context.req.param('providerId'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid providerId.';
      return context.json({ error: message }, 400);
    }

    const registry = cache.registries.get(providerId);

    if (!registry) {
      return context.json({ error: 'registry not available' }, 503);
    }

    return context.json(registry);
  });

  return {
    stateDir,
    cache,
    app,
    health,
    loadFile,
    deleteFile,
  };
};

type Watcher = {
  on: (event: 'add' | 'change' | 'unlink', listener: (filePath: string) => void) => void;
  close: () => Promise<void>;
};

type WatcherModule = {
  watch: (pattern: string, options: { ignoreInitial: boolean }) => Watcher;
};

const watcherSpecifier = '@rabbx/watcher';

const isWatcherModule = (value: unknown): value is WatcherModule => {
  return (
    value !== null &&
    typeof value === 'object' &&
    'watch' in value &&
    typeof value.watch === 'function'
  );
};

const loadWatcherModule = async (): Promise<WatcherModule> => {
  const mod = await import(watcherSpecifier);

  if (!isWatcherModule(mod)) {
    throw new Error('Failed to load @rabbx/watcher.');
  }

  return mod;
};

const watchRegistries = async (stateDir: string, runtime: RegistryRuntime): Promise<Watcher> => {
  const { watch } = await loadWatcherModule();
  const watcher = watch(join(stateDir, 'registries', '*', 'api.json'), {
    ignoreInitial: true,
  });

  watcher.on('add', runtime.loadFile);
  watcher.on('change', runtime.loadFile);
  watcher.on('unlink', runtime.deleteFile);
  return watcher;
};

export const startRegistryServer = async ({
  stateDir,
  host,
  port,
  updateHealth,
}: StartRegistryServerOptions): Promise<ServerType> => {
  const runtime = createRegistryRuntime(stateDir, undefined, updateHealth ? { updateHealth } : {});
  const watcher = await watchRegistries(stateDir, runtime);

  return new Promise<ServerType>((resolvePromise, reject) => {
    const server = serve(
      {
        fetch: runtime.app.fetch,
        hostname: host,
        port,
      },
      () => resolvePromise(server),
    );
    const originalClose = server.close.bind(server);
    server.close = ((callback?: Parameters<typeof server.close>[0]) => {
      void watcher.close().finally(() => {
        originalClose(callback);
      });
      return server;
    }) as typeof server.close;
    server.once('error', reject);
  });
};
