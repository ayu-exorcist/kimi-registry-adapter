import { resolve } from 'node:path';

import { normalizeProviderId } from '../provider-id';
import type { EditableRegistry } from '../schema';
import { createStatePaths, validateRegistryFile } from '../state';
import { readExistingOrDefaultConfig } from '../state-directory-mutation';
import type { ProviderIdInput, StateDirInput } from './types';

export type ListProvidersInput = StateDirInput;

export type ListProvidersResult = {
  providers: string[];
  count: number;
  configPath: string;
};

export type StateConfigSummary = {
  configPath: string;
  server: { host: string; port: number };
  providers: string[];
};

export const listProviders = (input: ListProvidersInput): ListProvidersResult => {
  const stateDir = resolve(input.stateDir);
  const configPath = createStatePaths(stateDir, 'placeholder').configPath;
  const config = readExistingOrDefaultConfig(configPath);
  const providers = Object.keys(config.providers);
  return { providers, count: providers.length, configPath };
};

export const getStateConfigSummary = (input: StateDirInput): StateConfigSummary => {
  const stateDir = resolve(input.stateDir);
  const configPath = createStatePaths(stateDir, 'placeholder').configPath;
  const config = readExistingOrDefaultConfig(configPath);
  return {
    configPath,
    server: config.server,
    providers: Object.keys(config.providers),
  };
};

export type ProviderRegistryPathInput = StateDirInput & ProviderIdInput;

export const getProviderRegistryPath = (input: ProviderRegistryPathInput): string => {
  const providerId = normalizeProviderId(input.providerId);
  return createStatePaths(resolve(input.stateDir), providerId).apiPath;
};

export type ValidateRegistryInput = StateDirInput & ProviderIdInput;

export type ValidateRegistryResult =
  | (ProviderIdInput & {
      registryPath: string;
      ok: true;
      registry: EditableRegistry;
      providerCount: number;
    })
  | (ProviderIdInput & { registryPath: string; ok: false; error: string });

export const validateRegistry = (input: ValidateRegistryInput): ValidateRegistryResult => {
  const providerId = normalizeProviderId(input.providerId);
  const registryPath = createStatePaths(resolve(input.stateDir), providerId).apiPath;
  const validation = validateRegistryFile(registryPath);
  if (!validation.ok) {
    return {
      providerId,
      registryPath,
      ok: false,
      error: validation.error,
    };
  }

  return {
    providerId,
    registryPath,
    ok: true,
    registry: validation.registry,
    providerCount: Object.keys(validation.registry).length,
  };
};
