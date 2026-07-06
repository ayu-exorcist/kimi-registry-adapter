import { resolve } from 'node:path';

import { writeConfigAsync, type ProviderConfig } from '../config';
import { withStateDirLock } from '../lock';
import type { ProviderType } from '../provider-descriptor';
import { normalizeProviderId } from '../provider-id';
import { createStatePaths } from '../state';
import { readExistingOrDefaultConfig } from '../state-directory-mutation';
import type { UpdateMode } from '../update';
import { readConfiguredProvider } from './provider-state';
import type { ProviderIdInput, StateDirInput } from './types';

export type SetProviderConfigApiKeyEnvInput = StateDirInput &
  ProviderIdInput & {
    apiKeyEnv?: string;
  };

export type SetProviderModelIncludeInput = StateDirInput &
  ProviderIdInput & {
    include: string[];
  };

export type GetProviderConfigResult = ProviderIdInput & {
  configPath: string;
  provider: ProviderConfig;
};

export type UpdateProviderConfigInput = StateDirInput &
  ProviderIdInput & {
    name?: string;
    baseUrl?: string;
    type?: ProviderType;
    modelSource?: ProviderConfig['modelSource'];
    clearModelSource?: boolean;
    updateMode?: UpdateMode;
  };

type ProviderConfigPatchResult<T> = {
  providerId: string;
  configPath: string;
  provider: ProviderConfig;
} & T;

const patchProviderConfig = async <T>(
  input: StateDirInput & ProviderIdInput,
  patch: (provider: ProviderConfig) => { provider: ProviderConfig; result: T },
): Promise<ProviderConfigPatchResult<T>> => {
  const stateDir = resolve(input.stateDir);
  const providerId = normalizeProviderId(input.providerId);
  return withStateDirLock(stateDir, async () => {
    const paths = createStatePaths(stateDir, providerId);
    const config = readExistingOrDefaultConfig(paths.configPath);
    const providerConfig = config.providers[providerId];

    if (!providerConfig) {
      throw new Error(`Provider not found in config: ${providerId}`);
    }

    const { provider, result } = patch(providerConfig);
    await writeConfigAsync(paths.configPath, {
      ...config,
      providers: {
        ...config.providers,
        [providerId]: provider,
      },
    });

    return { providerId, configPath: paths.configPath, provider, ...result };
  });
};

export const setProviderModelInclude = async (
  input: SetProviderModelIncludeInput,
): Promise<{ providerId: string; configPath: string; include: string[] }> => {
  const result = await patchProviderConfig(input, (providerConfig) => {
    const include = [...input.include];
    return {
      provider: {
        ...providerConfig,
        include,
      },
      result: { include },
    };
  });

  return { providerId: result.providerId, configPath: result.configPath, include: result.include };
};

export const getProviderConfig = (
  input: StateDirInput & ProviderIdInput,
): GetProviderConfigResult => {
  const { providerId, paths, provider } = readConfiguredProvider(input);
  return {
    providerId,
    configPath: paths.configPath,
    provider: structuredClone(provider),
  };
};

export const setProviderConfigApiKeyEnv = async (
  input: SetProviderConfigApiKeyEnvInput,
): Promise<{ providerId: string; configPath: string }> => {
  const result = await patchProviderConfig(input, (providerConfig) => {
    const nextProviderConfig = input.apiKeyEnv
      ? {
          ...providerConfig,
          apiKeyEnv: input.apiKeyEnv,
        }
      : (() => {
          const { apiKeyEnv: _removed, ...rest } = providerConfig;
          return rest;
        })();

    return { provider: nextProviderConfig, result: {} };
  });

  return { providerId: result.providerId, configPath: result.configPath };
};

export const updateProviderConfig = async (
  input: UpdateProviderConfigInput,
): Promise<{ providerId: string; configPath: string; provider: ProviderConfig }> => {
  return patchProviderConfig(input, (providerConfig) => {
    const modelSourcePatch =
      input.clearModelSource || input.modelSource
        ? input.clearModelSource
          ? (() => {
              const { modelSource: _removed, ...rest } = providerConfig;
              return rest;
            })()
          : { ...providerConfig, modelSource: input.modelSource }
        : providerConfig;

    const nextProviderConfig = {
      ...modelSourcePatch,
      ...(input.name ? { name: input.name } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.updateMode ? { updateMode: input.updateMode } : {}),
    };

    return { provider: nextProviderConfig, result: {} };
  });
};
