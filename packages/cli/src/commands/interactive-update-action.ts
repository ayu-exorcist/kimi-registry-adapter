import {
  defaultModelSourceLabelForProvider,
  deriveDefaultProviderModelsUrl,
  fetchConfiguredProviderModels,
  getProviderConfig,
  parseProviderType,
  providerTypeOptions,
  setProviderModelInclude,
  updateProviderConfig,
  updateProviderOperation,
  type ProviderConfig,
  type ProviderType,
} from '@kastral/kra-core';

import type { UpdateMode } from './args';
import {
  modelIdsFromPayload,
  modelIdsMatchingInclude,
  promptModelIncludeSelection,
} from './interactive-add-models';
import { configureProviderAuthForSelectedProvider } from './interactive-auth-action';
import {
  requiredText,
  selectExistingProviderId,
  unwrapCustomSelect,
  unwrapSubmenuPrompt,
} from './interactive-shared';
import {
  formatProviderUpdateModeNote,
  formatProviderUpdateNote,
} from './interactive-update-presenter';
import { inputPrompt, selectPrompt, withLoadingIndicator } from './prompt-adapters';
import { showNote } from './render';

type ProviderManageAction =
  | 'name'
  | 'baseUrl'
  | 'type'
  | 'modelSource'
  | 'models'
  | 'auth'
  | 'updateMode'
  | 'refresh';

type ProviderActionResult = 'done' | 'back';

export type InteractiveUpdateProviderRuntime = {
  defaultModelSourceLabelForProvider: typeof defaultModelSourceLabelForProvider;
  deriveDefaultProviderModelsUrl: typeof deriveDefaultProviderModelsUrl;
  fetchConfiguredProviderModels: typeof fetchConfiguredProviderModels;
  getProviderConfig: typeof getProviderConfig;
  parseProviderType: typeof parseProviderType;
  providerTypeOptions: typeof providerTypeOptions;
  setProviderModelInclude: typeof setProviderModelInclude;
  updateProviderConfig: typeof updateProviderConfig;
  updateProviderOperation: typeof updateProviderOperation;
  modelIdsFromPayload: typeof modelIdsFromPayload;
  modelIdsMatchingInclude: typeof modelIdsMatchingInclude;
  promptModelIncludeSelection: typeof promptModelIncludeSelection;
  configureProviderAuthForSelectedProvider: typeof configureProviderAuthForSelectedProvider;
  selectExistingProviderId: typeof selectExistingProviderId;
  inputPrompt: typeof inputPrompt;
  selectPrompt: typeof selectPrompt;
  withLoadingIndicator: typeof withLoadingIndicator;
  showNote: typeof showNote;
};

const defaultInteractiveUpdateProviderRuntime: InteractiveUpdateProviderRuntime = {
  defaultModelSourceLabelForProvider,
  deriveDefaultProviderModelsUrl,
  fetchConfiguredProviderModels,
  getProviderConfig,
  parseProviderType,
  providerTypeOptions,
  setProviderModelInclude,
  updateProviderConfig,
  updateProviderOperation,
  modelIdsFromPayload,
  modelIdsMatchingInclude,
  promptModelIncludeSelection,
  configureProviderAuthForSelectedProvider,
  selectExistingProviderId,
  inputPrompt,
  selectPrompt,
  withLoadingIndicator,
  showNote,
};

const providerManageOptions: Array<{ value: ProviderManageAction; label: string; hint?: string }> =
  [
    { value: 'name', label: 'Provider name' },
    { value: 'baseUrl', label: 'API base URL' },
    { value: 'auth', label: 'API key source' },
    { value: 'type', label: 'API type' },
    { value: 'modelSource', label: 'Model source' },
    { value: 'models', label: 'Models to include' },
    { value: 'updateMode', label: 'Update mode' },
    { value: 'refresh', label: 'Refresh registry' },
  ];

const emptyToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
};

const describeModelSourceInput = (provider: ProviderConfig): string => {
  const modelSource = provider.modelSource;
  if (!modelSource) return '';
  if (modelSource.kind === 'remote_url') return modelSource.url;
  if (modelSource.kind === 'local_file') return modelSource.path;
  return modelSource.modelsUrl ?? '';
};

const defaultModelSourcePlaceholder = (
  provider: ProviderConfig,
  runtime: Pick<InteractiveUpdateProviderRuntime, 'deriveDefaultProviderModelsUrl'>,
): string => {
  try {
    return runtime.deriveDefaultProviderModelsUrl(provider.type, provider.baseUrl);
  } catch {
    return 'Leave empty to derive from base URL';
  }
};

const defaultModelSourceLabel = (
  provider: ProviderConfig,
  runtime: Pick<
    InteractiveUpdateProviderRuntime,
    'defaultModelSourceLabelForProvider' | 'deriveDefaultProviderModelsUrl'
  >,
): string =>
  `${runtime.defaultModelSourceLabelForProvider(provider.type)} ${defaultModelSourcePlaceholder(provider, runtime)}`;

const resolveModelSourceInput = (
  input: string,
): { modelSource?: ProviderConfig['modelSource']; clearModelSource?: boolean } => {
  const value = emptyToUndefined(input);
  if (!value) {
    return { clearModelSource: true };
  }

  if (/^https?:\/\//iu.test(value)) {
    return { modelSource: { kind: 'remote_url', url: value } };
  }

  return { modelSource: { kind: 'local_file', path: value } };
};

const updateProviderModelsToExpose = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const fetched = await options.runtime.withLoadingIndicator('Fetching models...', () =>
    options.runtime.fetchConfiguredProviderModels({
      stateDir: options.stateDir,
      providerId: options.providerId,
    }),
  );
  const modelIds = options.runtime.modelIdsFromPayload(fetched.models);

  if (modelIds.length === 0) {
    options.runtime.showNote(
      'The model source responded, but no model ids were found. Fix the provider settings and try again.',
      'No models found',
    );
    return 'done';
  }

  const selectedInclude = await options.runtime.promptModelIncludeSelection({
    modelIds,
    initialSelectFromList: true,
    initialInclude: options.runtime.modelIdsMatchingInclude(modelIds, fetched.provider.include),
    startInList: true,
    backFromList: 'back',
  });

  if (selectedInclude.status === 'back') {
    return 'back';
  }

  await options.runtime.setProviderModelInclude({
    stateDir: options.stateDir,
    providerId: options.providerId,
    include: selectedInclude.include,
  });

  const result = await options.runtime.withLoadingIndicator('Updating provider...', () =>
    options.runtime.updateProviderOperation({
      stateDir: options.stateDir,
      providerId: options.providerId,
      models: fetched.models,
    }),
  );

  options.runtime.showNote(
    formatProviderUpdateNote({
      providerId: options.providerId,
      editablePath: result.editablePath,
      modelCount: result.modelCount,
      include: selectedInclude.include,
      metadataMatchSummary: result.metadataMatchSummary,
      ...(result.commit ? { commit: result.commit } : {}),
    }),
    'Provider updated',
  );
  return 'done';
};

const refreshProviderRegistry = async (options: {
  stateDir: string;
  providerId: string;
  configPath?: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<void> => {
  const result = await options.runtime.withLoadingIndicator('Updating provider...', () =>
    options.runtime.updateProviderOperation({
      stateDir: options.stateDir,
      providerId: options.providerId,
    }),
  );

  options.runtime.showNote(
    formatProviderUpdateNote({
      providerId: options.providerId,
      ...(options.configPath ? { configPath: options.configPath } : {}),
      editablePath: result.editablePath,
      modelCount: result.modelCount,
      metadataMatchSummary: result.metadataMatchSummary,
      ...(result.commit ? { commit: result.commit } : {}),
    }),
    'Provider updated',
  );
};

const updateProviderName = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const current = options.runtime.getProviderConfig(options).provider;
  const name = unwrapSubmenuPrompt(
    await options.runtime.inputPrompt({
      message: 'Provider name',
      initialValue: current.name,
      validate: requiredText,
    }),
  );

  if (name === undefined) return 'back';

  const result = await options.runtime.updateProviderConfig({
    stateDir: options.stateDir,
    providerId: options.providerId,
    name: name.trim(),
  });
  await refreshProviderRegistry({ ...options, configPath: result.configPath });
  return 'done';
};

const updateProviderBaseUrl = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const current = options.runtime.getProviderConfig(options).provider;
  const baseUrl = unwrapSubmenuPrompt(
    await options.runtime.inputPrompt({
      message: 'Provider API base URL',
      placeholder: 'https://api.example.com',
      initialValue: current.baseUrl,
      validate: requiredText,
    }),
  );

  if (baseUrl === undefined) return 'back';

  const result = await options.runtime.updateProviderConfig({
    stateDir: options.stateDir,
    providerId: options.providerId,
    baseUrl: baseUrl.trim(),
  });
  await refreshProviderRegistry({ ...options, configPath: result.configPath });
  return 'done';
};

const updateProviderType = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const current = options.runtime.getProviderConfig(options).provider;
  const providerType = unwrapCustomSelect(
    await options.runtime.selectPrompt<ProviderType>({
      message: 'Provider API type',
      options: options.runtime.providerTypeOptions(),
      initialValue: current.type,
    }),
  );

  if (providerType === undefined) return 'back';

  const result = await options.runtime.updateProviderConfig({
    stateDir: options.stateDir,
    providerId: options.providerId,
    type: options.runtime.parseProviderType(providerType),
  });
  await refreshProviderRegistry({ ...options, configPath: result.configPath });
  return 'done';
};

const updateProviderModelSource = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const current = options.runtime.getProviderConfig(options).provider;
  const modelSourceInput = unwrapSubmenuPrompt(
    await options.runtime.inputPrompt({
      message: 'Model list source',
      details: [
        {
          tone: 'info',
          text: 'Empty = default; URL = remote payload; path = local file.',
        },
      ],
      placeholder: defaultModelSourceLabel(current, options.runtime),
      initialValue: describeModelSourceInput(current),
    }),
  );

  if (modelSourceInput === undefined) return 'back';

  const modelSourcePatch = resolveModelSourceInput(modelSourceInput);
  const result = await options.runtime.updateProviderConfig({
    stateDir: options.stateDir,
    providerId: options.providerId,
    ...modelSourcePatch,
  });
  await refreshProviderRegistry({ ...options, configPath: result.configPath });
  return 'done';
};

const updateProviderUpdateMode = async (options: {
  stateDir: string;
  providerId: string;
  runtime: InteractiveUpdateProviderRuntime;
}): Promise<ProviderActionResult> => {
  const current = options.runtime.getProviderConfig(options).provider;
  const updateMode = unwrapCustomSelect(
    await options.runtime.selectPrompt<UpdateMode>({
      message: 'Update mode',
      details: [
        {
          tone: 'info',
          text: 'When models refresh, what happens to manual edits in api.json?',
        },
      ],
      options: [
        { value: 'merge', label: 'merge', hint: 'keep manual edits' },
        {
          value: 'overwrite',
          label: 'overwrite',
          hint: 'rebuild api.json',
        },
      ],
      initialValue: current.updateMode ?? 'merge',
    }),
  );

  if (updateMode === undefined) return 'back';

  const result = await options.runtime.updateProviderConfig({
    stateDir: options.stateDir,
    providerId: options.providerId,
    updateMode,
  });

  options.runtime.showNote(
    formatProviderUpdateModeNote({
      providerId: options.providerId,
      configPath: result.configPath,
      updateMode,
    }),
    'Provider updated',
  );
  return 'done';
};

export const runInteractiveUpdateProvider = async (options: {
  stateDir: string;
  runtime?: Partial<InteractiveUpdateProviderRuntime>;
}): Promise<void> => {
  const runtime = { ...defaultInteractiveUpdateProviderRuntime, ...options.runtime };
  let selectedProviderId: string | undefined;
  let selectedProviderAction: ProviderManageAction | undefined;

  while (true) {
    const providerId = await runtime.selectExistingProviderId(
      options.stateDir,
      'Select provider',
      selectedProviderId,
    );

    if (!providerId) {
      runtime.showNote('No providers configured yet.', 'Update provider');
      return;
    }

    selectedProviderId = providerId;

    while (true) {
      const action = unwrapCustomSelect(
        await runtime.selectPrompt<ProviderManageAction>({
          message: `Update ${providerId}`,
          options: providerManageOptions,
          initialValue: selectedProviderAction ?? 'name',
        }),
      );

      if (action === undefined) {
        break;
      }

      selectedProviderAction = action;

      const actionHandlers: Record<
        Exclude<ProviderManageAction, 'refresh'>,
        () => Promise<ProviderActionResult>
      > = {
        name: () => updateProviderName({ stateDir: options.stateDir, providerId, runtime }),
        baseUrl: () => updateProviderBaseUrl({ stateDir: options.stateDir, providerId, runtime }),
        auth: () =>
          runtime.configureProviderAuthForSelectedProvider({
            stateDir: options.stateDir,
            providerId,
          }),
        type: () => updateProviderType({ stateDir: options.stateDir, providerId, runtime }),
        modelSource: () =>
          updateProviderModelSource({ stateDir: options.stateDir, providerId, runtime }),
        models: () =>
          updateProviderModelsToExpose({ stateDir: options.stateDir, providerId, runtime }),
        updateMode: () =>
          updateProviderUpdateMode({ stateDir: options.stateDir, providerId, runtime }),
      };

      if (action === 'refresh') {
        await refreshProviderRegistry({ stateDir: options.stateDir, providerId, runtime });
        continue;
      }

      await actionHandlers[action]();
      continue;
    }
  }
};
