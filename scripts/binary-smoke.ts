import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const binaryPath = resolve(process.cwd(), 'packages/cli/dist/index.js');

if (!existsSync(binaryPath)) {
  throw new Error('Missing packages/cli/dist/index.js. Run pnpm build before this smoke test.');
}

const output = execFileSync(process.execPath, [binaryPath, '--help'], {
  encoding: 'utf8',
});

for (const expectedText of ['kra', 'add', 'serve']) {
  if (!output.includes(expectedText)) {
    throw new Error(`Built CLI help output did not include ${JSON.stringify(expectedText)}.`);
  }
}

process.stdout.write(`Built CLI binary smoke test passed: ${binaryPath}\n`);
