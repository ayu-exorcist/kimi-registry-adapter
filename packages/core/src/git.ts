import { execFile, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const configuredStateGitRepos = new Set<string>();

const isCommandUnavailable = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const stateGitIgnoreContent = (): string =>
  [
    '*',
    '!/.gitignore',
    '!/config.json',
    '!/registries/',
    '!/registries/**/',
    '!/registries/**/api.json',
    '!/registries/**/.internal/',
    '!/registries/**/.internal/models.json',
    '!/registries/**/.internal/state.json',
    '',
  ].join('\n');

export const ensureStateGitIgnore = (stateDir: string): string => {
  const gitignorePath = resolve(stateDir, '.gitignore');
  writeFileSync(gitignorePath, stateGitIgnoreContent(), 'utf8');
  return gitignorePath;
};

export const ensureStateGitIgnoreAsync = async (stateDir: string): Promise<string> => {
  const gitignorePath = resolve(stateDir, '.gitignore');
  await writeFile(gitignorePath, stateGitIgnoreContent(), 'utf8');
  return gitignorePath;
};

const runGit = (stateDir: string, args: string[]): string => {
  return execFileSync('git', ['-C', stateDir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
};

const runGitAsync = async (stateDir: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', stateDir, ...args], {
    encoding: 'utf8',
  });
  return stdout.trim();
};

export const readCommittedText = (stateDir: string, relativePath: string): string | undefined => {
  try {
    return runGit(stateDir, ['show', `HEAD:${relativePath}`]);
  } catch {
    return undefined;
  }
};

const markStateGitRepoConfigured = (stateDir: string): void => {
  configuredStateGitRepos.add(resolve(stateDir));
};

const isStateGitRepoConfigured = (stateDir: string): boolean =>
  configuredStateGitRepos.has(resolve(stateDir));

export const ensureStateGitRepo = (stateDir: string): boolean => {
  try {
    let initialized = false;
    if (!existsSync(resolve(stateDir, '.git'))) {
      execFileSync('git', ['init', stateDir], { stdio: ['ignore', 'pipe', 'pipe'] });
      initialized = true;
    }

    ensureStateGitIgnore(stateDir);
    if (initialized || !isStateGitRepoConfigured(stateDir)) {
      runGit(stateDir, ['config', 'user.name', 'kimi-registry-adapter']);
      runGit(stateDir, ['config', 'user.email', 'kimi-registry-adapter@example.invalid']);
      markStateGitRepoConfigured(stateDir);
    }
    return true;
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return false;
    }
    throw error;
  }
};

export const ensureStateGitRepoAsync = async (stateDir: string): Promise<boolean> => {
  try {
    let initialized = false;
    if (!existsSync(resolve(stateDir, '.git'))) {
      await execFileAsync('git', ['init', stateDir], { encoding: 'utf8' });
      initialized = true;
    }

    await ensureStateGitIgnoreAsync(stateDir);
    if (initialized || !isStateGitRepoConfigured(stateDir)) {
      await runGitAsync(stateDir, ['config', 'user.name', 'kimi-registry-adapter']);
      await runGitAsync(stateDir, [
        'config',
        'user.email',
        'kimi-registry-adapter@example.invalid',
      ]);
      markStateGitRepoConfigured(stateDir);
    }
    return true;
  } catch (error) {
    if (isCommandUnavailable(error)) {
      return false;
    }
    throw error;
  }
};

export type StateCommitInput = {
  stateDir: string;
  paths: string[];
  subject: string;
  body?: string;
};

export const commitStateChanges = ({
  stateDir,
  paths,
  subject,
  body,
}: StateCommitInput): string | undefined => {
  if (!ensureStateGitRepo(stateDir)) {
    return undefined;
  }

  for (const path of paths) {
    try {
      runGit(stateDir, ['add', '-A', path]);
    } catch {
      // A path may not exist yet, or may have been removed before it was ever tracked.
    }
  }

  const staged = runGit(stateDir, ['diff', '--cached', '--name-only', '--', ...paths]);
  if (!staged) {
    return undefined;
  }

  const stagedPaths = staged.split(/\r?\n/u).filter(Boolean);
  const args = body
    ? ['commit', '-m', subject, '-m', body, '--', ...stagedPaths]
    : ['commit', '-m', subject, '--', ...stagedPaths];
  runGit(stateDir, args);
  return runGit(stateDir, ['rev-parse', '--short', 'HEAD']);
};

export const commitStateChangesAsync = async ({
  stateDir,
  paths,
  subject,
  body,
}: StateCommitInput): Promise<string | undefined> => {
  if (!(await ensureStateGitRepoAsync(stateDir))) {
    return undefined;
  }

  for (const path of paths) {
    try {
      await runGitAsync(stateDir, ['add', '-A', path]);
    } catch {
      // A path may not exist yet, or may have been removed before it was ever tracked.
    }
  }

  const staged = await runGitAsync(stateDir, ['diff', '--cached', '--name-only', '--', ...paths]);
  if (!staged) {
    return undefined;
  }

  const stagedPaths = staged.split(/\r?\n/u).filter(Boolean);
  const args = body
    ? ['commit', '-m', subject, '-m', body, '--', ...stagedPaths]
    : ['commit', '-m', subject, '--', ...stagedPaths];
  await runGitAsync(stateDir, args);
  return runGitAsync(stateDir, ['rev-parse', '--short', 'HEAD']);
};
