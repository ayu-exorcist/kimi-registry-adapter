import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { renameWithRetrySync, writeAtomicText } from './atomic-file';
import { isFileNotFoundError } from './fs-error';
import { serializeDeterministicJson } from './json';
import type { DiscoveredModel } from './model-payload';
import { normalizeProviderId, resolveProviderStatePath, resolveStatePath } from './provider-id';
import type { MergeConflict } from './registry-merge';
import {
  validateEditableRegistry,
  validateGeneratedRegistry,
  validateKimiImportSubset,
  type EditableRegistry,
  type GeneratedRegistry,
} from './schema';
import { isUnknownRecord } from './type-guards';

export type StatePaths = {
  stateDir: string;
  registriesDir: string;
  providerDir: string;
  internalDir: string;
  configPath: string;
  authPath: string;
  gitignorePath: string;
  modelsPath: string;
  apiPath: string;
  statePath: string;
};

export {
  mergeEditableRegistry,
  type MergeEditableRegistryResult,
  type ThreeWayMergeInput,
} from './registry-merge';

export type UpdateState = {
  updatedAt: string;
  lastUpdateStatus: 'ok' | 'failed';
  warnings: string[];
  errors: string[];
  conflicts: MergeConflict[];
};

export type RegistryWriteResult = {
  generated: GeneratedRegistry;
  editable: EditableRegistry;
};

export type ProviderState = {
  lastGeneratedRegistry: GeneratedRegistry;
  updateState: UpdateState;
};

export const createStatePaths = (stateDir: string, providerId: string): StatePaths => {
  const safeProviderId = normalizeProviderId(providerId);
  const resolvedStateDir = resolve(stateDir);
  const registriesDir = resolveStatePath(resolvedStateDir, 'registries');
  const providerDir = resolveProviderStatePath(resolvedStateDir, safeProviderId);
  const internalDir = resolveStatePath(resolvedStateDir, 'registries', safeProviderId, '.internal');

  return {
    stateDir: resolvedStateDir,
    registriesDir,
    providerDir,
    internalDir,
    configPath: resolveStatePath(resolvedStateDir, 'config.json'),
    authPath: resolveStatePath(resolvedStateDir, 'auth.json'),
    gitignorePath: resolveStatePath(resolvedStateDir, '.gitignore'),
    modelsPath: resolveStatePath(
      resolvedStateDir,
      'registries',
      safeProviderId,
      '.internal',
      'models.json',
    ),
    apiPath: resolveStatePath(resolvedStateDir, 'registries', safeProviderId, 'api.json'),
    statePath: resolveStatePath(
      resolvedStateDir,
      'registries',
      safeProviderId,
      '.internal',
      'state.json',
    ),
  };
};

const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

type RegistryWriteTransaction = {
  apiPath: string;
  apiTempPath: string;
  statePath: string;
  stateTempPath: string;
};

const registryWriteTransactionPath = (statePath: string): string =>
  resolve(dirname(statePath), 'write-transaction.json');

const isRegistryWriteTransaction = (value: unknown): value is RegistryWriteTransaction =>
  isUnknownRecord(value) &&
  typeof value['apiPath'] === 'string' &&
  typeof value['apiTempPath'] === 'string' &&
  typeof value['statePath'] === 'string' &&
  typeof value['stateTempPath'] === 'string';

const readRegistryWriteTransaction = (
  transactionPath: string,
): RegistryWriteTransaction | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(transactionPath, 'utf8'));
    return isRegistryWriteTransaction(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const isPathInside = (filePath: string, directoryPath: string): boolean => {
  const pathFromDirectory = relative(resolve(directoryPath), resolve(filePath));
  return (
    pathFromDirectory === '' ||
    (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory))
  );
};

const isRecoverableRegistryWriteTransaction = (
  transaction: RegistryWriteTransaction,
  statePath: string,
): boolean => {
  const internalDir = dirname(statePath);
  const providerDir = resolve(internalDir, '..');
  return (
    resolve(transaction.statePath) === resolve(statePath) &&
    isPathInside(transaction.stateTempPath, internalDir) &&
    isPathInside(transaction.apiPath, providerDir) &&
    isPathInside(transaction.apiTempPath, providerDir)
  );
};

const finalizeRegistryWriteTransaction = (statePath: string): void => {
  const transactionPath = registryWriteTransactionPath(statePath);
  if (!existsSync(transactionPath)) {
    return;
  }

  const transaction = readRegistryWriteTransaction(transactionPath);
  if (!transaction || !isRecoverableRegistryWriteTransaction(transaction, statePath)) {
    rmSync(transactionPath, { force: true });
    return;
  }

  if (existsSync(transaction.apiTempPath)) {
    renameWithRetrySync(transaction.apiTempPath, transaction.apiPath);
  }
  if (existsSync(transaction.stateTempPath)) {
    renameWithRetrySync(transaction.stateTempPath, transaction.statePath);
  }
  rmSync(transactionPath, { force: true });
};

const writeJsonTemp = (filePath: string, value: unknown): string => {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, serializeDeterministicJson(value), 'utf8');
  return tempPath;
};

const writeAtomicJson = (filePath: string, value: unknown): void => {
  writeAtomicText(filePath, serializeDeterministicJson(value));
};

export const writeModelsSnapshot = (filePath: string, models: DiscoveredModel[]): void => {
  writeAtomicJson(filePath, { data: models });
};

export const loadProviderState = (filePath: string): ProviderState | undefined => {
  try {
    finalizeRegistryWriteTransaction(filePath);
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isUnknownRecord(value)) {
      throw new Error(`Invalid provider state file: ${filePath}`);
    }

    const updateState = value['updateState'];
    if (!isUpdateState(updateState)) {
      throw new Error(`Invalid provider update state in ${filePath}`);
    }

    return {
      lastGeneratedRegistry: validateGeneratedRegistry(value['lastGeneratedRegistry']),
      updateState,
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
};

export const writeRegistryArtifacts = (
  paths: Pick<StatePaths, 'apiPath' | 'statePath'>,
  generated: GeneratedRegistry,
  editable: EditableRegistry,
  updateState: UpdateState,
): RegistryWriteResult => {
  finalizeRegistryWriteTransaction(paths.statePath);
  validateGeneratedRegistry(generated);
  validateEditableRegistry(editable);
  validateKimiImportSubset(editable);

  const state: ProviderState = {
    lastGeneratedRegistry: generated,
    updateState,
  };
  let manifestWritten = false;
  let apiTempPath: string | undefined;
  let stateTempPath: string | undefined;

  try {
    apiTempPath = writeJsonTemp(paths.apiPath, editable);
    stateTempPath = writeJsonTemp(paths.statePath, state);
    writeAtomicJson(registryWriteTransactionPath(paths.statePath), {
      apiPath: paths.apiPath,
      apiTempPath,
      statePath: paths.statePath,
      stateTempPath,
    });
    manifestWritten = true;
    renameWithRetrySync(apiTempPath, paths.apiPath);
    renameWithRetrySync(stateTempPath, paths.statePath);
    rmSync(registryWriteTransactionPath(paths.statePath), { force: true });
  } catch (error) {
    if (!manifestWritten) {
      if (apiTempPath) {
        rmSync(apiTempPath, { force: true });
      }
      if (stateTempPath) {
        rmSync(stateTempPath, { force: true });
      }
    }
    throw error;
  }

  return { generated, editable };
};

const isMergeConflict = (value: unknown): value is MergeConflict => {
  if (!isUnknownRecord(value)) {
    return false;
  }

  return (
    typeof value['providerId'] === 'string' &&
    typeof value['modelId'] === 'string' &&
    typeof value['field'] === 'string' &&
    'before' in value &&
    'current' in value &&
    'incoming' in value &&
    'after' in value
  );
};

const isUpdateState = (value: unknown): value is UpdateState => {
  if (!isUnknownRecord(value)) {
    return false;
  }

  return (
    typeof value['updatedAt'] === 'string' &&
    (value['lastUpdateStatus'] === 'ok' || value['lastUpdateStatus'] === 'failed') &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every((warning) => typeof warning === 'string') &&
    Array.isArray(value['errors']) &&
    value['errors'].every((error) => typeof error === 'string') &&
    Array.isArray(value['conflicts']) &&
    value['conflicts'].every(isMergeConflict)
  );
};

const conflictMarkerPattern = /^(<<<<<<<|=======|>>>>>>>) /mu;

export const hasConflictMarkers = (content: string): boolean => conflictMarkerPattern.test(content);

export const loadLastKnownGoodRegistry = (filePath: string): EditableRegistry | undefined => {
  try {
    return validateEditableRegistry(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
};

export const validateRegistryFile = (
  filePath: string,
): { ok: true; registry: EditableRegistry } | { ok: false; error: string } => {
  try {
    return {
      ok: true,
      registry: validateEditableRegistry(JSON.parse(readFileSync(filePath, 'utf8'))),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
};
