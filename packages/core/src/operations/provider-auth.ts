import { resolve } from 'node:path';

import { readAuthConfig, type AuthConfig } from '../auth';
import type { ProviderConfig } from '../config';
import { ensureStateGitRepoAsync } from '../git';
import { withStateDirLock } from '../lock';
import { normalizeProviderId } from '../provider-id';
import { createStatePaths } from '../state';
import {
  configureProviderAuthAsync as configureProviderAuthMutationAsync,
  readExistingOrDefaultConfig,
} from '../state-directory-mutation';
import type { ProviderIdInput, StateDirInput } from './types';

export type ConfigureProviderAuthInput = StateDirInput &
  ProviderIdInput & {
    apiKey?: string;
    apiKeyEnv?: string;
    clear?: boolean;
  };

export type ConfigureProviderAuthResult = ProviderIdInput & {
  authPath: string;
  stored: 'apiKey' | 'apiKeyEnv' | 'none';
};

export const configureProviderAuth = async (
  input: ConfigureProviderAuthInput,
): Promise<ConfigureProviderAuthResult> => {
  const providerId = normalizeProviderId(input.providerId);
  return withStateDirLock(input.stateDir, async () => {
    const paths = createStatePaths(resolve(input.stateDir), providerId);
    await ensureStateGitRepoAsync(paths.stateDir);
    return configureProviderAuthMutationAsync({ ...input, providerId });
  });
};

export type ProviderAuthStateResult = ProviderIdInput & {
  configPath: string;
  authPath: string;
  currentAuth: AuthConfig['providers'][string] | undefined;
  currentProviderConfig: Pick<ProviderConfig, 'apiKeyEnv'> | undefined;
};

export const getProviderAuthState = (
  input: StateDirInput & ProviderIdInput,
): ProviderAuthStateResult => {
  const stateDir = resolve(input.stateDir);
  const providerId = normalizeProviderId(input.providerId);
  const paths = createStatePaths(stateDir, providerId);
  const config = readExistingOrDefaultConfig(paths.configPath);
  const currentProvider = config.providers[providerId];
  const apiKeyEnv = currentProvider?.apiKeyEnv;

  return {
    providerId,
    configPath: paths.configPath,
    authPath: paths.authPath,
    currentAuth: readAuthConfig(paths.authPath).providers[providerId],
    currentProviderConfig: apiKeyEnv ? { apiKeyEnv } : currentProvider ? {} : undefined,
  };
};
