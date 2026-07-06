import {
  saveProvider as saveProviderOperation,
  type ProviderConfig,
  type ProviderType,
  type SaveProviderInput,
} from '@kastral/kra-core';

type AddProviderOptions = {
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
  const input: SaveProviderInput = {
    stateDir: options.stateDir,
    providerId,
    baseUrl: options.baseUrl,
    type: options.type,
  };

  if (options.modelSourceConfig) input.modelSource = options.modelSourceConfig;
  if (options.name) input.name = options.name;
  if (options.modelsMetadataPath) input.modelsMetadataPath = options.modelsMetadataPath;
  if (options.apiKeyEnv) input.apiKeyEnv = options.apiKeyEnv;
  if (options.npm) input.npm = options.npm;
  if (options.include) input.include = options.include;
  if (options.exclude) input.exclude = options.exclude;
  if (options.commit) input.commit = true;

  return saveProviderOperation(input);
};
