import type {
  DiscoveredModel,
  ProviderConfig,
  ProviderDefinitionFields,
  ProviderType,
  SetupProviderInput,
} from '@kastral/kra-core';

import type { UpdateMode } from './args';
import {
  cachedModelsForCurrentState,
  resolvedInteractiveModelSource,
} from './interactive-add-state';
import type { AddProviderState } from './interactive-add-wizard';

export type ProviderSetupDraft = ProviderDefinitionFields & {
  stateDir: string;
  providerId: string;
  apiKey?: string;
  updateMode?: UpdateMode;
  cachedModels?: DiscoveredModel[];
};

export type ProviderDefinitionOptions = {
  stateDir: string;
  baseUrl: string;
  type: ProviderType;
  modelSourceConfig?: ProviderConfig['modelSource'];
  modelsMetadataPath?: string;
  apiKeyEnv?: string;
  npm?: string;
  name?: string;
  include?: string[];
  exclude?: string[];
};

const providerDefinitionFieldsFromDraft = (
  draft: ProviderSetupDraft,
): ProviderDefinitionFields => ({
  baseUrl: draft.baseUrl,
  type: draft.type,
  ...(draft.modelSource ? { modelSource: draft.modelSource } : {}),
  ...(draft.name ? { name: draft.name } : {}),
  ...(draft.modelsMetadataPath ? { modelsMetadataPath: draft.modelsMetadataPath } : {}),
  ...(draft.apiKeyEnv ? { apiKeyEnv: draft.apiKeyEnv } : {}),
  ...(draft.npm ? { npm: draft.npm } : {}),
  ...(draft.include ? { include: draft.include } : {}),
  ...(draft.exclude ? { exclude: draft.exclude } : {}),
});

export const providerDefinitionOptionsFromDraft = (
  draft: ProviderSetupDraft,
): ProviderDefinitionOptions => {
  const { modelSource, ...fields } = providerDefinitionFieldsFromDraft(draft);
  return {
    stateDir: draft.stateDir,
    ...fields,
    ...(modelSource ? { modelSourceConfig: modelSource } : {}),
  };
};

export const providerSetupOperationInputFromDraft = (
  draft: ProviderSetupDraft,
): SetupProviderInput => ({
  stateDir: draft.stateDir,
  providerId: draft.providerId,
  ...providerDefinitionFieldsFromDraft(draft),
  ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
  ...(draft.cachedModels ? { models: draft.cachedModels } : {}),
  ...(draft.updateMode ? { updateMode: draft.updateMode } : {}),
});

export const interactiveProviderApiKey = (state: AddProviderState): string | undefined => {
  return state.authMode === 'once' || state.authMode === 'store' ? state.apiKey : undefined;
};

export const interactiveProviderApiKeyEnv = (state: AddProviderState): string | undefined => {
  return state.authMode === 'env' ? state.apiKeyEnv : undefined;
};

export const providerSetupDraftFromInteractiveState = (
  stateDir: string,
  state: AddProviderState,
): ProviderSetupDraft => {
  const apiKey = interactiveProviderApiKey(state);
  const apiKeyEnv = interactiveProviderApiKeyEnv(state);
  const modelSource = resolvedInteractiveModelSource(state);
  const cachedModels = cachedModelsForCurrentState(state);

  return {
    stateDir,
    providerId: state.providerId,
    baseUrl: state.baseUrl,
    type: state.providerType,
    ...(modelSource ? { modelSource } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(state.include ? { include: state.include } : {}),
    ...(apiKey ? { apiKey } : {}),
    updateMode: state.updateMode,
    ...(cachedModels ? { cachedModels } : {}),
  };
};
