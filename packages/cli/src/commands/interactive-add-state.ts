import {
  DEFAULT_PROVIDER_TYPE,
  defaultModelSourceKindForProvider,
  defaultModelSourceLabelForProvider,
  deriveDefaultProviderModelsUrl,
  type DiscoveredModel,
  type ProviderConfig,
} from '@kastral/kra-core';

import {
  getAddProviderStepOrder,
  type AddProviderState,
  type AddProviderStepId,
} from './interactive-add-wizard';
import { optionalText } from './interactive-shared';

export const createInitialAddProviderState = (): AddProviderState => ({
  providerId: '',
  baseUrl: '',
  modelSourceInput: '',
  authMode: 'store',
  apiKey: '',
  apiKeyEnv: '',
  providerType: DEFAULT_PROVIDER_TYPE,
  include: undefined,
  includeSource: 'manual',
  selectModelsFromFetchedList: true,
  cachedModelIds: undefined,
  cachedModels: undefined,
  cachedModelsKey: undefined,
  startServerNow: true,
});

const defaultInteractiveModelSourceKind = (state: AddProviderState) =>
  defaultModelSourceKindForProvider(state.providerType);

export const defaultInteractiveModelSourcePlaceholder = (state: AddProviderState): string => {
  try {
    return deriveDefaultProviderModelsUrl(state.providerType, state.baseUrl);
  } catch {
    return 'Leave empty to derive from base URL';
  }
};

export const defaultInteractiveModelSourceLabel = (state: AddProviderState): string =>
  `${defaultModelSourceLabelForProvider(state.providerType)} ${defaultInteractiveModelSourcePlaceholder(state)}`;

export const resolvedInteractiveModelSource = (
  state: AddProviderState,
): ProviderConfig['modelSource'] | undefined => {
  const modelSourceInput = optionalText(state.modelSourceInput);

  const defaultModelSource = (): ProviderConfig['modelSource'] => ({
    kind: defaultInteractiveModelSourceKind(state),
  });

  if (!modelSourceInput) {
    return defaultModelSource();
  }

  if (/^https?:\/\//iu.test(modelSourceInput)) {
    return {
      kind: 'remote_url',
      url: modelSourceInput,
    };
  }

  return {
    kind: 'local_file',
    path: modelSourceInput,
  };
};

export const currentModelsCacheKey = (state: AddProviderState): string => {
  const resolvedModelSourceInput = optionalText(state.modelSourceInput) ?? '';
  const resolvedApiKey =
    state.authMode === 'once' || state.authMode === 'store'
      ? state.apiKey
      : state.authMode === 'env'
        ? state.apiKeyEnv
        : '';
  return [
    state.baseUrl,
    state.providerType,
    resolvedModelSourceInput,
    state.authMode,
    resolvedApiKey,
  ].join('|');
};

const resetModelChoices = (state: AddProviderState): void => {
  state.include = undefined;
  state.includeSource = 'manual';
  state.selectModelsFromFetchedList = true;
};

const resetModelsCache = (state: AddProviderState): void => {
  state.cachedModelIds = undefined;
  state.cachedModels = undefined;
  state.cachedModelsKey = undefined;
};

export const resetAddProviderStateAfterStep = (
  state: AddProviderState,
  currentStepId: AddProviderStepId,
): void => {
  const currentStepOrder = getAddProviderStepOrder(currentStepId);
  const shouldReset = (stepId: AddProviderStepId): boolean =>
    currentStepOrder <= getAddProviderStepOrder(stepId);

  if (shouldReset('providerId')) {
    state.baseUrl = '';
  }
  if (shouldReset('apiKeyEnv')) {
    state.modelSourceInput = '';
  }
  if (shouldReset('baseUrl')) {
    state.authMode = 'store';
  }
  if (shouldReset('authMode')) {
    state.apiKey = '';
    state.apiKeyEnv = '';
  }
  if (shouldReset('apiKeyEnv')) {
    resetModelsCache(state);
  }
  if (shouldReset('providerType')) {
    resetModelChoices(state);
  }
  if (shouldReset('modelInclude')) {
    state.startServerNow = true;
  }
};

export const cachedModelsForCurrentState = (
  state: AddProviderState,
): DiscoveredModel[] | undefined => {
  return state.cachedModelsKey === currentModelsCacheKey(state) ? state.cachedModels : undefined;
};

export const rememberFetchedModels = (
  state: AddProviderState,
  fetched: { modelIds: string[]; models: DiscoveredModel[] },
): void => {
  state.cachedModelsKey = currentModelsCacheKey(state);
  state.cachedModelIds = fetched.modelIds;
  state.cachedModels = fetched.models;
};
