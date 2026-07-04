import {
  saveProvider as saveProviderOperation,
  type ProviderConfig,
  type ProviderType,
} from '@kastral/kra-core';

export type AddProviderOptions = {
  baseUrl: string;
  modelSource?: NonNullable<ProviderConfig['modelSource']>['kind'];
  modelSourcePath?: string;
  modelSourceUrl?: string;
  modelsMetadataPath?: string;
  apiKeyEnv?: string;
  npm?: string;
  name?: string;
  include?: string[];
  exclude?: string[];
  type: ProviderType;
  stateDir: string;
};

export type SaveProviderOptions = AddProviderOptions & {
  modelSourceConfig?: ProviderConfig['modelSource'];
  commit?: boolean;
};

export const saveProviderDefinition = async (
  providerId: string,
  options: SaveProviderOptions,
): Promise<{ configPath: string; stateDir: string; commit?: string }> => {
  return saveProviderOperation({
    stateDir: options.stateDir,
    providerId,
    baseUrl: options.baseUrl,
    type: options.type,
    ...(options.modelSourceConfig ? { modelSource: options.modelSourceConfig } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.modelsMetadataPath ? { modelsMetadataPath: options.modelsMetadataPath } : {}),
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    ...(options.npm ? { npm: options.npm } : {}),
    ...(options.include ? { include: options.include } : {}),
    ...(options.exclude ? { exclude: options.exclude } : {}),
    ...(options.commit ? { commit: true } : {}),
  });
};
