import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { serializeConfigJsonSchema } from '../packages/core/src/internal';

const checkOnly = process.argv.includes('--check');
const rootDir = process.cwd();
const schemaPath = resolve(rootDir, 'schemas/config.schema.json');

const formatJsonWithProjectFormatter = (content: string): string => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'kra-config-schema-'));
  const tempPath = resolve(tempDir, 'config.schema.json');
  try {
    writeFileSync(tempPath, content, 'utf8');
    execFileSync('pnpm', ['exec', 'oxfmt', '--write', tempPath], {
      cwd: rootDir,
      stdio: 'ignore',
    });
    return readFileSync(tempPath, 'utf8');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const nextSchema = formatJsonWithProjectFormatter(serializeConfigJsonSchema());
const currentSchema = readFileSync(schemaPath, 'utf8');

if (currentSchema === nextSchema) {
  process.stdout.write('Config JSON schema is up to date.\n');
  process.exit(0);
}

if (checkOnly) {
  throw new Error('Config JSON schema is out of date. Run pnpm config-schema:generate.');
}

writeFileSync(schemaPath, nextSchema, 'utf8');
process.stdout.write(`Updated ${schemaPath}.\n`);
