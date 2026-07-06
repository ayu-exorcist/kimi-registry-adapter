import type { ProviderConfig } from './config';
import type { ProviderType } from './provider-descriptor';

export type ProviderDefinitionFields = {
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

export type ProviderDefinitionInput = ProviderDefinitionFields & {
  providerId: string;
};
