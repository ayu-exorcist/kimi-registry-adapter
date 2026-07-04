import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeAtomicText, writeAtomicTextAsync } from '../src/internal';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-atomic-'));

describe('atomic file writes', () => {
  it('writes text atomically and cleans up temp files', () => {
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'nested', 'config.json');

    writeAtomicText(filePath, '{"ok":true}\n');

    expect(readFileSync(filePath, 'utf8')).toBe('{"ok":true}\n');
    expect(readdirSync(join(tempDir, 'nested')).filter((entry) => entry.endsWith('.tmp'))).toEqual(
      [],
    );
  });

  it('writes text atomically with the async path', async () => {
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'nested', 'auth.json');

    await writeAtomicTextAsync(filePath, '{"providers":{}}\n');

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe('{"providers":{}}\n');
  });
});
