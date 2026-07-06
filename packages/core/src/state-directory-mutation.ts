import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readAuthConfig, removeProviderAuth, setProviderAuth, writeAuthConfigAsync } from './auth';
import {
  addProviderToConfig,
  createDefaultConfig,
  readConfig,
  removeProviderFromConfig,
  writeConfigAsync,
  type KraConfig,
} from './config';
import { isFileNotFoundError } from './fs-error';
import { commitStateChangesAsync } from './git';
import type { ProviderDefinitionInput } from './provider-definition';
import { assertPathInside, normalizeProviderId, providerRegistryGitPath } from './provider-id';
import { createStatePaths, type UpdateState } from './state';
import type { UpdateMode } from './update';

export type SaveProviderDefinitionInput = {
  stateDir: string;
} & ProviderDefinitionInput;

export type SaveProviderDefinitionResult = {
  configPath: string;
  stateDir: string;
};

export type CommitProviderUpdateInput = {
  stateDir: string;
  providerId: string;
  modelCount: number;
  conflicts: UpdateState['conflicts'];
  action?: 'update' | 'remove';
  includeRegistry?: boolean;
};

export type CommitProviderConfigChangeInput = {
  stateDir: string;
  providerId: string;
  action: 'add' | 'remove';
};

export type ConfigureProviderAuthInput = {
  stateDir: string;
  providerId: string;
  apiKey?: string;
  apiKeyEnv?: string;
  clear?: boolean;
};

export type ConfigureProviderAuthResult = {
  providerId: string;
  authPath: string;
  stored: 'apiKey' | 'apiKeyEnv' | 'none';
};

export type RemoveProviderDefinitionInput = {
  stateDir: string;
  providerId: string;
  keepFiles?: boolean;
};

export type RemoveProviderDefinitionResult = {
  providerId: string;
  configPath: string;
  authPath: string;
  deletedFiles: boolean;
  commit?: string;
};

export const readExistingOrDefaultConfig = (configPath: string): KraConfig => {
  try {
    return readConfig(configPath);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
    return createDefaultConfig();
  }
};

const formatConflictValue = (value: unknown): string => JSON.stringify(value);

const providerConfigPaths = ['config.json', '.gitignore'];

const providerCommitPaths = (providerId: string, includeRegistry = true): string[] => [
  ...providerConfigPaths,
  ...(includeRegistry ? [providerRegistryGitPath(providerId)] : []),
];

const formatConflictMessages = (conflicts: UpdateState['conflicts']): string[] =>
  conflicts.map((conflict) =>
    [
      `- ${conflict.providerId}.${conflict.modelId}.${conflict.field}`,
      `  before: ${formatConflictValue(conflict.before)}`,
      `  current: ${formatConflictValue(conflict.current)}`,
      `  incoming: ${formatConflictValue(conflict.incoming)}`,
      `  after: ${formatConflictValue(conflict.after)}`,
    ].join('\n'),
  );

const formatProviderChangeSubject = (
  action: 'update' | 'remove',
  providerId: string,
  modelCount: number,
  conflictCount: number,
): string =>
  `${action} ${providerId}: ${modelCount} models${conflictCount ? `, ${conflictCount} conflicts kept user values` : ''}`;

const formatProviderChangeBody = (conflictMessages: string[]): string =>
  ['Conflicts kept user values:', '', ...conflictMessages].join('\n');

export const commitProviderConfigChangeAsync = async ({
  stateDir,
  providerId,
  action,
}: CommitProviderConfigChangeInput): Promise<string | undefined> => {
  const safeProviderId = normalizeProviderId(providerId);
  return commitStateChangesAsync({
    stateDir,
    paths: providerConfigPaths,
    subject: `${action} ${safeProviderId}`,
  });
};

export const commitProviderUpdateAsync = async ({
  stateDir,
  providerId,
  modelCount,
  conflicts,
  action = 'update',
  includeRegistry = true,
}: CommitProviderUpdateInput): Promise<string | undefined> => {
  const safeProviderId = normalizeProviderId(providerId);
  const conflictMessages = formatConflictMessages(conflicts);
  return commitStateChangesAsync({
    stateDir,
    paths: providerCommitPaths(safeProviderId, includeRegistry),
    subject: formatProviderChangeSubject(
      action,
      safeProviderId,
      modelCount,
      conflictMessages.length,
    ),
    ...(conflictMessages.length > 0 ? { body: formatProviderChangeBody(conflictMessages) } : {}),
  });
};

export const persistUpdateModeAsync = async (
  stateDir: string,
  providerId: string,
  updateMode: UpdateMode | undefined,
): Promise<void> => {
  const safeProviderId = normalizeProviderId(providerId);
  if (!updateMode) {
    return;
  }

  const resolvedStateDir = resolve(stateDir);
  const configPath = createStatePaths(resolvedStateDir, safeProviderId).configPath;
  const config = readExistingOrDefaultConfig(configPath);
  const provider = config.providers[safeProviderId];
  if (!provider) {
    return;
  }

  await writeConfigAsync(configPath, {
    ...config,
    providers: {
      ...config.providers,
      [safeProviderId]: {
        ...provider,
        updateMode,
      },
    },
  });
};

export const saveProviderDefinitionAsync = async (
  input: SaveProviderDefinitionInput,
): Promise<SaveProviderDefinitionResult> => {
  const safeProviderId = normalizeProviderId(input.providerId);
  const stateDir = resolve(input.stateDir);
  const configPath = createStatePaths(stateDir, safeProviderId).configPath;
  const nextConfig = addProviderToConfig(readExistingOrDefaultConfig(configPath), safeProviderId, {
    name: input.name ?? safeProviderId,
    baseUrl: input.baseUrl,
    ...(input.modelSource ? { modelSource: input.modelSource } : {}),
    ...(input.modelsMetadataPath ? { modelsMetadataPath: input.modelsMetadataPath } : {}),
    ...(input.apiKeyEnv ? { apiKeyEnv: input.apiKeyEnv } : {}),
    ...(input.npm ? { npm: input.npm } : {}),
    ...(input.include ? { include: input.include } : {}),
    ...(input.exclude ? { exclude: input.exclude } : {}),
    type: input.type,
  });
  await writeConfigAsync(configPath, nextConfig);
  return { configPath, stateDir };
};

const resolveProviderAuthStorage = (
  input: ConfigureProviderAuthInput,
): {
  auth: { apiKey?: string; apiKeyEnv?: string };
  stored: ConfigureProviderAuthResult['stored'];
} => {
  if (input.clear) {
    return { auth: {}, stored: 'none' };
  }
  if (input.apiKey) {
    return { auth: { apiKey: input.apiKey }, stored: 'apiKey' };
  }
  if (input.apiKeyEnv) {
    return { auth: { apiKeyEnv: input.apiKeyEnv }, stored: 'apiKeyEnv' };
  }

  throw new Error('Provide apiKey or apiKeyEnv, or set clear to true.');
};

export const configureProviderAuthAsync = async (
  input: ConfigureProviderAuthInput,
): Promise<ConfigureProviderAuthResult> => {
  const safeProviderId = normalizeProviderId(input.providerId);
  const paths = createStatePaths(resolve(input.stateDir), safeProviderId);
  const auth = readAuthConfig(paths.authPath);
  const storage = resolveProviderAuthStorage(input);
  const nextAuth = input.clear
    ? removeProviderAuth(auth, safeProviderId)
    : setProviderAuth(auth, safeProviderId, storage.auth);

  await writeAuthConfigAsync(paths.authPath, nextAuth);

  return {
    providerId: safeProviderId,
    authPath: paths.authPath,
    stored: storage.stored,
  };
};

export const removeProviderDefinitionAsync = async (
  input: RemoveProviderDefinitionInput,
): Promise<RemoveProviderDefinitionResult> => {
  const safeProviderId = normalizeProviderId(input.providerId);
  const stateDir = resolve(input.stateDir);
  const paths = createStatePaths(stateDir, safeProviderId);
  const config = readExistingOrDefaultConfig(paths.configPath);
  const auth = readAuthConfig(paths.authPath);

  await writeConfigAsync(paths.configPath, removeProviderFromConfig(config, safeProviderId));
  await writeAuthConfigAsync(paths.authPath, removeProviderAuth(auth, safeProviderId));

  if (!input.keepFiles) {
    await rm(assertPathInside(stateDir, paths.providerDir), { recursive: true, force: true });
  }

  const commit = await commitProviderUpdateAsync({
    stateDir,
    providerId: safeProviderId,
    modelCount: 0,
    conflicts: [],
    action: 'remove',
    includeRegistry: !input.keepFiles,
  });

  return {
    providerId: safeProviderId,
    configPath: paths.configPath,
    authPath: paths.authPath,
    deletedFiles: !input.keepFiles,
    ...(commit ? { commit } : {}),
  };
};
