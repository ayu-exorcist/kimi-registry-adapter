import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-git-fault-'));

describe('git-backed state fault handling', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:child_process');
    vi.restoreAllMocks();
  });

  it('skips git-backed commits when the git command is unavailable', async () => {
    // Scenario: a missing git binary degrades commits to no result instead of crashing.
    vi.doMock('node:child_process', async () => {
      const actual =
        await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: () => {
          throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
        },
      };
    });

    const { commitStateChanges } = await import('../src/git');

    expect(
      commitStateChanges({
        stateDir: createTempDir(),
        paths: ['config.json'],
        subject: 'update config',
      }),
    ).toBeUndefined();
  });
});
