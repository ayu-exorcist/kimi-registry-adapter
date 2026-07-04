import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-atomic-fault-'));

const tempFilesIn = (dirPath: string): string[] =>
  readdirSync(dirPath).filter((entry) => entry.endsWith('.tmp'));

describe('atomic file write fault handling', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs');
    vi.restoreAllMocks();
  });

  it('retries a transient atomic replace failure and commits the final content', async () => {
    // Scenario: a transient EBUSY during replace still commits final content and leaves no temp files.
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'config.json');
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const failOnce = () => {
        throw Object.assign(new Error('temporarily busy'), { code: 'EBUSY' });
      };
      const renameAttempts = [failOnce, actual.renameSync];
      return {
        ...actual,
        renameSync: (fromPath: string, toPath: string) => {
          const renameAttempt = renameAttempts.shift() as typeof actual.renameSync;
          renameAttempt(fromPath, toPath);
        },
      };
    });

    const { writeAtomicText } = await import('../src/atomic-file');

    writeAtomicText(filePath, '{"ok":true}\n', { retries: 1, retryDelayMs: 0 });

    expect(readFileSync(filePath, 'utf8')).toBe('{"ok":true}\n');
    expect(tempFilesIn(tempDir)).toEqual([]);
  });

  it('keeps the previous file content when the atomic replace fails', async () => {
    // Scenario: a non-retryable replace failure keeps the previous file content intact.
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, '{"version":1}\n', 'utf8');

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        renameSync: () => {
          throw Object.assign(new Error('replace failed'), { code: 'EINVAL' });
        },
      };
    });

    const { writeAtomicText } = await import('../src/atomic-file');

    expect(() => writeAtomicText(filePath, '{"version":2}\n', { retryDelayMs: 0 })).toThrow(
      'replace failed',
    );
    expect(readFileSync(filePath, 'utf8')).toBe('{"version":1}\n');
    expect(tempFilesIn(tempDir)).toEqual([]);
  });

  it('reports the final error after retryable atomic replace failures are exhausted', async () => {
    // Scenario: repeated EBUSY failures surface an error while preserving the old file.
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'config.json');
    writeFileSync(filePath, '{"version":1}\n', 'utf8');

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        renameSync: () => {
          throw Object.assign(new Error('still busy'), { code: 'EBUSY' });
        },
      };
    });

    const { writeAtomicText } = await import('../src/atomic-file');

    expect(() =>
      writeAtomicText(filePath, '{"version":2}\n', { retries: 1, retryDelayMs: 0 }),
    ).toThrow('still busy');
    expect(readFileSync(filePath, 'utf8')).toBe('{"version":1}\n');
    expect(existsSync(filePath)).toBe(true);
    expect(tempFilesIn(tempDir)).toEqual([]);
  });
});
