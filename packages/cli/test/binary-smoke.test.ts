import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const binaryPath = resolve(process.cwd(), 'packages/cli/dist/index.js');
const hasBuiltBinary = existsSync(binaryPath);

describe('built CLI binary', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  const expectHelpOutput = (output: string): void => {
    expect(output).toContain('kra');
    expect(output).toContain('add');
    expect(output).toContain('serve');
  };

  it.skipIf(!hasBuiltBinary)('prints command help after build', () => {
    expect.hasAssertions();

    const output = execFileSync(process.execPath, [binaryPath, '--help'], {
      encoding: 'utf8',
    });

    expectHelpOutput(output);
  });

  it.skipIf(!hasBuiltBinary)('prints command help when launched through a .bin symlink', () => {
    expect.hasAssertions();

    const tempDir = mkdtempSync(join(tmpdir(), 'kra-bin-'));
    tempDirs.push(tempDir);
    const symlinkPath = join(tempDir, 'kra');
    symlinkSync(binaryPath, symlinkPath);

    const output = execFileSync(process.execPath, [symlinkPath, '--help'], {
      encoding: 'utf8',
    });

    expectHelpOutput(output);
  });
});
