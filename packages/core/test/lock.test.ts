import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  acquireStateDirLock,
  providerLockPath,
  stateDirLockPath,
  withProviderLock,
  withStateDirLock,
} from '../src/lock';

const createStateDir = (): string => mkdtempSync(join(tmpdir(), 'kra-lock-'));

const waitUntil = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

describe('state directory lock', () => {
  it('serializes concurrent lock holders for one state directory', async () => {
    const stateDir = createStateDir();
    const events: string[] = [];
    let releaseFirst!: () => Promise<void>;

    const first = withStateDirLock(stateDir, async () => {
      events.push('first acquired');
      await new Promise<void>((resolvePromise) => {
        releaseFirst = async () => resolvePromise();
      });
      events.push('first released');
    });

    await waitUntil(() => events.includes('first acquired'));

    const second = withStateDirLock(
      stateDir,
      async () => {
        events.push('second acquired');
      },
      { retryMs: 10 },
    );

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    expect(events).toEqual(['first acquired']);

    await releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first acquired', 'first released', 'second acquired']);
    expect(existsSync(stateDirLockPath(stateDir))).toBe(false);
  });

  it('queues same-process lock attempts before taking the filesystem lock', async () => {
    const stateDir = createStateDir();
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = withStateDirLock(stateDir, async () => {
      events.push('first acquired');
      await new Promise<void>((resolvePromise) => {
        releaseFirst = resolvePromise;
      });
      events.push('first released');
    });

    await waitUntil(() => events.includes('first acquired'));

    const second = withStateDirLock(
      stateDir,
      async () => {
        events.push('second acquired');
      },
      { timeoutMs: 10, retryMs: 5 },
    );

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    expect(events).toEqual(['first acquired']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first acquired', 'first released', 'second acquired']);
  });

  it('allows same-process reentrant lock use', async () => {
    const stateDir = createStateDir();
    const events: string[] = [];

    await withStateDirLock(stateDir, async () => {
      events.push('outer');
      await withStateDirLock(stateDir, async () => {
        events.push('inner');
      });
    });

    expect(events).toEqual(['outer', 'inner']);
    expect(existsSync(stateDirLockPath(stateDir))).toBe(false);
  });

  it('allows different provider locks to be held concurrently', async () => {
    const stateDir = createStateDir();
    const events: string[] = [];
    let releaseA!: () => void;

    const first = withProviderLock(stateDir, 'provider-a', async () => {
      events.push('a acquired');
      await new Promise<void>((resolvePromise) => {
        releaseA = resolvePromise;
      });
      events.push('a released');
    });

    await waitUntil(() => events.includes('a acquired'));

    await withProviderLock(stateDir, 'provider-b', async () => {
      events.push('b acquired');
    });

    expect(events).toEqual(['a acquired', 'b acquired']);
    releaseA();
    await first;
    expect(existsSync(providerLockPath(stateDir, 'provider-a'))).toBe(false);
    expect(existsSync(providerLockPath(stateDir, 'provider-b'))).toBe(false);
  });

  it('removes stale same-host lock owners', async () => {
    const stateDir = createStateDir();
    const lockPath = stateDirLockPath(stateDir);
    mkdirSync(lockPath);
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      `${JSON.stringify({ pid: 999_999_999, hostname: hostname(), acquiredAt: new Date().toISOString() })}\n`,
      'utf8',
    );

    const release = await acquireStateDirLock(stateDir, { retryMs: 10 });
    await release();

    expect(existsSync(lockPath)).toBe(false);
  });

  it('releases a stale remote-host lock after the stale timeout', async () => {
    // Scenario: a stale remote-host owner is cleaned up so the new holder can acquire the lock.
    const stateDir = createStateDir();
    const lockPath = stateDirLockPath(stateDir);
    mkdirSync(lockPath);
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      `${JSON.stringify({
        token: 'remote-stale-owner',
        pid: 12345,
        hostname: 'remote-host.example',
        acquiredAt: new Date(Date.now() - 60_000).toISOString(),
      })}\n`,
      'utf8',
    );

    const release = await acquireStateDirLock(stateDir, { staleMs: 1, retryMs: 5 });
    await release();

    expect(existsSync(lockPath)).toBe(false);
  });

  it('retries filesystem lock contention until the current owner releases it', async () => {
    // Scenario: filesystem contention is retried until the current owner releases the lock.
    const stateDir = createStateDir();
    const events: string[] = [];
    const releaseFirst = await acquireStateDirLock(stateDir);

    const second = acquireStateDirLock(stateDir, { timeoutMs: 200, retryMs: 5 }).then(
      async (releaseSecond) => {
        events.push('second acquired');
        await releaseSecond();
      },
    );

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    expect(events).toEqual([]);

    await releaseFirst();
    await second;

    expect(events).toEqual(['second acquired']);
    expect(existsSync(stateDirLockPath(stateDir))).toBe(false);
  });

  it('does not immediately reap a lock before owner metadata is written', async () => {
    const stateDir = createStateDir();
    const lockPath = stateDirLockPath(stateDir);
    mkdirSync(lockPath);

    await expect(acquireStateDirLock(stateDir, { timeoutMs: 20, retryMs: 5 })).rejects.toThrow(
      'Timed out waiting for kra state lock',
    );
    expect(existsSync(lockPath)).toBe(true);
  });

  it('does not let an old release delete a newer owner lock', async () => {
    const stateDir = createStateDir();
    const lockPath = stateDirLockPath(stateDir);
    const releaseOld = await acquireStateDirLock(stateDir);

    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath);
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      `${JSON.stringify({ token: 'new-owner', pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString() })}\n`,
      'utf8',
    );

    await releaseOld();
    expect(existsSync(lockPath)).toBe(true);

    rmSync(lockPath, { recursive: true, force: true });
  });

  it('treats permission-denied pid checks as alive', async () => {
    const stateDir = createStateDir();
    const lockPath = stateDirLockPath(stateDir);
    mkdirSync(lockPath);
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      `${JSON.stringify({ token: 'other-user', pid: 12345, hostname: hostname(), acquiredAt: new Date().toISOString() })}\n`,
      'utf8',
    );
    const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error;
    });

    await expect(acquireStateDirLock(stateDir, { timeoutMs: 20, retryMs: 5 })).rejects.toThrow(
      'Timed out waiting for kra state lock',
    );
    expect(existsSync(lockPath)).toBe(true);

    kill.mockRestore();
    rmSync(lockPath, { recursive: true, force: true });
  });
});
