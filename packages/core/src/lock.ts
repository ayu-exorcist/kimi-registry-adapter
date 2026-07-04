import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';

import { normalizeProviderId } from './provider-id';

export type StateDirLockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
};

type LockMetadata = {
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
};

const DEFAULT_LOCK_TIMEOUT_MS = 300_000;
const DEFAULT_STALE_MS = 30 * 60_000;
const DEFAULT_RETRY_MS = 100;
const LOCK_INITIALIZATION_STALE_MS = 5_000;
const heldLockContext = new AsyncLocalStorage<Set<string>>();
const inProcessLockQueues = new Map<string, Promise<void>>();

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
};

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return code !== 'ESRCH';
  }
};

const readLockMetadata = async (lockPath: string): Promise<LockMetadata | undefined> => {
  try {
    return JSON.parse(await readFile(resolve(lockPath, 'owner.json'), 'utf8')) as LockMetadata;
  } catch {
    return undefined;
  }
};

const isUninitializedLockStale = async (lockPath: string): Promise<boolean> => {
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs > LOCK_INITIALIZATION_STALE_MS;
  } catch {
    return false;
  }
};

const isStaleLock = async (lockPath: string, staleMs: number): Promise<boolean> => {
  const metadata = await readLockMetadata(lockPath);
  if (!metadata) {
    return isUninitializedLockStale(lockPath);
  }

  const acquiredAt = Date.parse(metadata.acquiredAt);
  if (!Number.isFinite(acquiredAt)) {
    return true;
  }

  if (metadata.hostname === hostname()) {
    return !isProcessAlive(metadata.pid);
  }

  return Date.now() - acquiredAt > staleMs;
};

const formatLockOwner = async (lockPath: string): Promise<string> => {
  const metadata = await readLockMetadata(lockPath);
  if (!metadata) {
    return 'unknown owner';
  }

  return `pid ${metadata.pid} on ${metadata.hostname}, acquired at ${metadata.acquiredAt}`;
};

const lockFileName = (value: string): string => encodeURIComponent(value).replaceAll('.', '%2E');

const lockContentionErrorCodes = new Set(['EEXIST', 'EPERM', 'EACCES']);

const isLockContentionError = async (error: unknown, lockPath: string): Promise<boolean> => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EEXIST') {
    return true;
  }
  if (!lockContentionErrorCodes.has(String(code))) {
    return false;
  }

  try {
    await stat(lockPath);
    return true;
  } catch {
    return false;
  }
};

export const stateDirLockPath = (stateDir: string): string => resolve(stateDir, '.kra.lock');

export const providerLockPath = (stateDir: string, providerId: string): string =>
  resolve(stateDir, '.kra.locks', `${lockFileName(normalizeProviderId(providerId))}.lock`);

const acquireLockPath = async (
  lockPath: string,
  options: StateDirLockOptions = {},
): Promise<() => Promise<void>> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath, { recursive: false });
      const token = randomUUID();
      const metadata: LockMetadata = {
        token,
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: new Date().toISOString(),
      };
      await writeFile(
        resolve(lockPath, 'owner.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8',
      );

      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        const currentMetadata = await readLockMetadata(lockPath);
        if (currentMetadata?.token === token) {
          await rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (!(await isLockContentionError(error, lockPath))) {
        throw error;
      }

      if (await isStaleLock(lockPath, staleMs)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out waiting for kra state lock at ${lockPath} held by ${await formatLockOwner(lockPath)}.`,
          { cause: error },
        );
      }

      await sleep(retryMs);
    }
  }
};

export const acquireStateDirLock = async (
  stateDir: string,
  options: StateDirLockOptions = {},
): Promise<() => Promise<void>> => acquireLockPath(stateDirLockPath(stateDir), options);

export const acquireProviderLock = async (
  stateDir: string,
  providerId: string,
  options: StateDirLockOptions = {},
): Promise<() => Promise<void>> => acquireLockPath(providerLockPath(stateDir, providerId), options);

const withLockPath = async <T>(
  lockPath: string,
  action: () => Promise<T>,
  options?: StateDirLockOptions,
): Promise<T> => {
  const heldLocks = heldLockContext.getStore();
  if (heldLocks?.has(lockPath)) {
    return action();
  }

  const previousQueuedAction = inProcessLockQueues.get(lockPath) ?? Promise.resolve();
  let releaseQueuedAction: (() => void) | undefined;
  const queuedAction = new Promise<void>((resolvePromise) => {
    releaseQueuedAction = resolvePromise;
  });
  const queueTail = previousQueuedAction.then(
    () => queuedAction,
    () => queuedAction,
  );
  inProcessLockQueues.set(lockPath, queueTail);

  await previousQueuedAction.catch(() => undefined);

  let release: (() => Promise<void>) | undefined;

  try {
    release = await acquireLockPath(lockPath, options);
    const nextHeldLocks = new Set([...(heldLocks ?? []), lockPath]);
    return await heldLockContext.run(nextHeldLocks, action);
  } finally {
    try {
      await release?.();
    } finally {
      releaseQueuedAction?.();
      if (inProcessLockQueues.get(lockPath) === queueTail) {
        inProcessLockQueues.delete(lockPath);
      }
    }
  }
};

export const withStateDirLock = async <T>(
  stateDir: string,
  action: () => Promise<T>,
  options?: StateDirLockOptions,
): Promise<T> => withLockPath(stateDirLockPath(stateDir), action, options);

export const withProviderLock = async <T>(
  stateDir: string,
  providerId: string,
  action: () => Promise<T>,
  options?: StateDirLockOptions,
): Promise<T> => withLockPath(providerLockPath(stateDir, providerId), action, options);
