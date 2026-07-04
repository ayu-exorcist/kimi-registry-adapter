import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const binaryPath = resolve(process.cwd(), 'packages/cli/dist/index.js');
const hasBuiltBinary = existsSync(binaryPath);

describe('built CLI binary', () => {
  it.skipIf(!hasBuiltBinary)('prints command help after build', () => {
    const output = execFileSync(process.execPath, [binaryPath, '--help'], {
      encoding: 'utf8',
    });

    expect(output).toContain('kra');
    expect(output).toContain('add');
    expect(output).toContain('serve');
  });
});
