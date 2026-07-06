import {
  fetchProviderModels,
  type DiscoveredModel,
  type ProviderConfig,
  type ProviderType,
} from '@kastral/kra-core';

import type { PromptDetail } from '../prompts/prompt-core';
import {
  currentModelsCacheKey,
  rememberFetchedModels,
  resolvedInteractiveModelSource,
} from './interactive-add-state';
import type { AddProviderState } from './interactive-add-wizard';
import { unwrapCustomSelect } from './interactive-shared';
import { confirmPrompt, searchMultiselect, withLoadingIndicator } from './prompt-adapters';

export type InteractiveModelsResult =
  | { status: 'fix_models_endpoint'; message: string }
  | { status: 'ok'; modelIds: string[]; models: DiscoveredModel[] };

export type InteractiveModelIncludeSelection =
  | { status: 'back' }
  | { status: 'selected'; include: string[]; selectFromList: boolean };

export const modelIdsFromPayload = (models: DiscoveredModel[]): string[] => {
  return models
    .map((model) => model.id)
    .filter((id) => id.trim().length > 0)
    .toSorted((left, right) => left.localeCompare(right));
};

const SELECT_ALL_MODELS_VALUE = '__kra_select_all_models__';

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'iu');
};

export const modelIdsMatchingInclude = (
  modelIds: string[],
  include: string[] | undefined,
): string[] => {
  if (!include) {
    return modelIds;
  }

  const patterns = include.map(wildcardToRegExp);
  return modelIds.filter((modelId) => patterns.some((pattern) => pattern.test(modelId)));
};

const fetchModelIdsWithFeedback = async (options: {
  baseUrl: string;
  type: ProviderType;
  modelSource?: ProviderConfig['modelSource'];
  apiKey?: string;
}): Promise<InteractiveModelsResult> => {
  try {
    const models = await withLoadingIndicator('Fetching models...', () =>
      fetchProviderModels(
        {
          name: 'preview',
          baseUrl: options.baseUrl,
          type: options.type,
          ...(options.modelSource ? { modelSource: options.modelSource } : {}),
        },
        'preview',
        options.apiKey,
      ),
    );
    const modelIds = modelIdsFromPayload(models);

    if (modelIds.length === 0) {
      return {
        status: 'fix_models_endpoint',
        message:
          'The /models endpoint responded, but no model ids were found. Fix the provider settings and try again.',
      };
    }

    return { status: 'ok', modelIds, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown fetch error';
    return {
      status: 'fix_models_endpoint',
      message: message.split('\n')[0] ?? message,
    };
  }
};

export const promptModelIncludeSelection = async (options: {
  modelIds: string[];
  initialSelectFromList?: boolean;
  initialInclude?: string[];
  startInList?: boolean;
  backFromList?: 'mode' | 'back';
  details?: PromptDetail[];
}): Promise<InteractiveModelIncludeSelection> => {
  const {
    modelIds,
    initialSelectFromList = true,
    initialInclude = [],
    startInList = false,
    backFromList = 'mode',
    details = [],
  } = options;
  let selectFromList = initialSelectFromList;
  let shouldPromptSelectMode = !startInList;
  let shouldUseInitialInclude = startInList;

  while (true) {
    if (shouldPromptSelectMode) {
      const shouldSelectFromList = unwrapCustomSelect(
        await confirmPrompt({
          message: 'Choose models from fetched list?',
          ...(details.length > 0 ? { details } : {}),
          initialValue: selectFromList,
        }),
      );

      if (shouldSelectFromList === undefined) {
        return { status: 'back' };
      }

      selectFromList = shouldSelectFromList;
      shouldUseInitialInclude = false;

      if (!selectFromList) {
        return { status: 'selected', include: modelIds, selectFromList: false };
      }
    }

    shouldPromptSelectMode = true;

    const selected = await searchMultiselect({
      message: 'Models to include',
      ...(details.length > 0 ? { details } : {}),
      items: [
        { value: SELECT_ALL_MODELS_VALUE, label: 'All' },
        ...modelIds.map((modelId) => ({ value: modelId, label: modelId, indent: 2 })),
      ],
      maxVisible: 12,
      selectAllValue: SELECT_ALL_MODELS_VALUE,
      initialSelected: shouldUseInitialInclude ? initialInclude : [],
      required: true,
    });

    if (typeof selected === 'symbol') {
      if (backFromList === 'back') {
        return { status: 'back' };
      }
      selectFromList = true;
      continue;
    }

    return {
      status: 'selected',
      include: selected.includes(SELECT_ALL_MODELS_VALUE)
        ? modelIds
        : selected.filter((modelId: string) => modelId !== SELECT_ALL_MODELS_VALUE),
      selectFromList: true,
    };
  }
};

export const ensureInteractiveModels = async (
  state: AddProviderState,
): Promise<InteractiveModelsResult> => {
  const cacheKey = currentModelsCacheKey(state);
  if (
    state.cachedModelsKey === cacheKey &&
    state.cachedModelIds &&
    state.cachedModelIds.length > 0 &&
    state.cachedModels
  ) {
    return { status: 'ok', modelIds: state.cachedModelIds, models: state.cachedModels };
  }

  const promptModelsApiKey =
    state.apiKey || (state.apiKeyEnv ? process.env[state.apiKeyEnv] : undefined);
  const modelSource = resolvedInteractiveModelSource(state);
  const promptModelSelectionOptions: {
    baseUrl: string;
    type: ProviderType;
    modelSource?: ProviderConfig['modelSource'];
    apiKey?: string;
  } = {
    baseUrl: state.baseUrl,
    type: state.providerType,
    ...(modelSource ? { modelSource } : {}),
  };
  if (promptModelsApiKey) {
    promptModelSelectionOptions.apiKey = promptModelsApiKey;
  }

  const fetched = await fetchModelIdsWithFeedback(promptModelSelectionOptions);
  if (fetched.status === 'ok') {
    rememberFetchedModels(state, fetched);
  }
  return fetched;
};
