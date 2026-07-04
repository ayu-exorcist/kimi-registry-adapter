import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { commitStateChanges, readCommittedText } from '../src/internal';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-git-'));
const git = (stateDir: string, args: string[]): string =>
  execFileSync('git', ['-C', stateDir, ...args], { encoding: 'utf8' }).trim();

describe('git-backed state', () => {
  it('commits allowlisted state files and stores conflict details in the commit message', () => {
    const stateDir = createTempDir();
    const providerDir = join(stateDir, 'registries', 'provider');
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(join(stateDir, 'config.json'), '{"providers":{}}\n', 'utf8');
    writeFileSync(
      join(stateDir, 'auth.json'),
      '{"providers":{"provider":{"apiKey":"test-token"}}}\n',
      'utf8',
    );
    writeFileSync(join(providerDir, 'models.json'), '{"data":[]}\n', 'utf8');
    writeFileSync(
      join(providerDir, 'api.json'),
      '{"provider":{"id":"provider","name":"Provider","api":"https://gateway.example.com/v1","type":"openai","models":{}}}\n',
      'utf8',
    );

    const commit = commitStateChanges({
      stateDir,
      paths: ['config.json', '.gitignore', 'registries/provider'],
      subject: 'update provider: 0 models, 1 conflicts kept user values',
      body: [
        'Conflicts kept user values:',
        '',
        '- provider.gpt-4.1.name\n  before: "gpt-4.1"\n  current: "Manual Name"\n  incoming: "Upstream Name"\n  after: "Manual Name"',
      ].join('\n'),
    });

    expect(commit).toBeDefined();
    expect(readCommittedText(stateDir, 'registries/provider/api.json')).toContain('Provider');
    expect(git(stateDir, ['log', '-1', '--pretty=%B'])).toContain('Conflicts kept user values:');
    expect(git(stateDir, ['ls-files'])).not.toContain('auth.json');
  });

  it('commits only the requested paths', () => {
    const stateDir = createTempDir();
    const providerDir = join(stateDir, 'registries', 'provider');
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(join(stateDir, 'config.json'), '{"providers":{}}\n', 'utf8');
    writeFileSync(join(providerDir, 'api.json'), '{"manual":true}\n', 'utf8');

    const commit = commitStateChanges({
      stateDir,
      paths: ['config.json', '.gitignore'],
      subject: 'add provider',
    });

    expect(commit).toBeDefined();
    expect(git(stateDir, ['ls-files'])).not.toContain('registries/provider/api.json');
    expect(readFileSync(join(providerDir, 'api.json'), 'utf8')).toContain('manual');
  });
});
