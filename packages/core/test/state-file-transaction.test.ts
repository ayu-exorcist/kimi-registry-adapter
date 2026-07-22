import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createStateFileTransaction } from '../src/state-file-transaction';

const createTempFile = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'kra-state-transaction-')), 'state.json');
  writeFileSync(path, 'before\n');
  return path;
};

describe('state file transaction', () => {
  it('restores partial writes made before the transaction checkpoint', async () => {
    const path = createTempFile();
    const transaction = await createStateFileTransaction([path]);

    writeFileSync(path, 'partial\n');
    await transaction.rollback();

    expect(readFileSync(path, 'utf8')).toBe('before\n');
  });

  it('refuses to overwrite changes made after the transaction checkpoint', async () => {
    const path = createTempFile();
    const transaction = await createStateFileTransaction([path]);
    writeFileSync(path, 'owned\n');
    await transaction.checkpoint();
    writeFileSync(path, 'external\n');

    await expect(transaction.rollback()).rejects.toThrow('State changed while attempting rollback');
    expect(readFileSync(path, 'utf8')).toBe('external\n');
  });
});
