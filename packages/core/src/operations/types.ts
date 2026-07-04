import type { ProviderConfig } from '../config';
import type { ProviderType } from '../provider-descriptor';

export type StateDirInput = {
  stateDir: string;
};

export type ProviderIdInput = {
  providerId: string;
};

export type ProviderDefinitionInput = ProviderIdInput & {
  baseUrl: string;
  type: ProviderType;
  modelSource?: ProviderConfig['modelSource'];
  modelsMetadataPath?: string;
  apiKeyEnv?: string;
  npm?: string;
  name?: string;
  include?: string[];
  exclude?: string[];
};
