import { parseProviderType, providerTypeOptions, type ProviderType } from '@kastral/kra-core';

import { isInteractiveHome } from '../prompts/navigation';
import type { UpdateMode } from './args';
import {
  saveAndUpdateInteractiveProvider,
  type FinalizedInteractiveProvider,
} from './interactive-add-action';
import { ensureInteractiveModels, promptModelIncludeSelection } from './interactive-add-models';
import {
  createInitialAddProviderState,
  defaultInteractiveModelSourceLabel,
  defaultInteractiveModelSourcePlaceholder,
  resetAddProviderStateAfterStep,
} from './interactive-add-state';
import {
  createAddProviderWizardActor,
  type AddProviderAuthMode,
  type AddProviderState,
  type AddProviderStepId,
  type AddProviderWizardActor,
} from './interactive-add-wizard';
import {
  listConfiguredProviderIds,
  defaultProviderApiKeyEnvName,
  requiredText,
  unwrapCustomSelect,
  unwrapSubmenuPrompt,
  validateNewProviderId,
} from './interactive-shared';
import { confirmPrompt, inputPrompt, selectPrompt } from './prompt-adapters';
import { providerSetupDraftFromInteractiveState } from './provider-setup-input';
import { importUrl, printServeStartupSummary, showNote } from './render';
import { getServeCommand } from './serve-command';
import {
  assertValidTcpPort,
  findAvailablePort,
  startRegistryServerOnDemand,
  waitForServerClose,
} from './server-runtime';

export {
  createAddProviderWizardActor,
  getNextAddProviderStepId,
  getPreviousAddProviderStepId,
  type AddProviderState,
} from './interactive-add-wizard';

const getAddProviderWizardStepId = (actor: AddProviderWizardActor): AddProviderStepId =>
  actor.state.context.currentStepId;

const sendAddProviderWizardEvent = (
  actor: AddProviderWizardActor,
  type: 'NEXT' | 'BACK',
  state: AddProviderState,
): void => {
  actor.send({ type, state });
};

type AddProviderStepHandlerResult = 'continue' | 'done' | 'cancel';
type AddProviderStepHandlers = Record<
  AddProviderStepId,
  () => Promise<AddProviderStepHandlerResult>
>;

export type InteractiveAddProviderRuntime = {
  listConfiguredProviderIds: typeof listConfiguredProviderIds;
  createAddProviderWizardActor: typeof createAddProviderWizardActor;
  inputPrompt: typeof inputPrompt;
  selectPrompt: typeof selectPrompt;
  confirmPrompt: typeof confirmPrompt;
  ensureInteractiveModels: typeof ensureInteractiveModels;
  promptModelIncludeSelection: typeof promptModelIncludeSelection;
  saveAndUpdateInteractiveProvider: typeof saveAndUpdateInteractiveProvider;
  assertValidTcpPort: typeof assertValidTcpPort;
  findAvailablePort: typeof findAvailablePort;
  getServeCommand: typeof getServeCommand;
  importUrl: typeof importUrl;
  showNote: typeof showNote;
  printServeStartupSummary: typeof printServeStartupSummary;
  startRegistryServerOnDemand: typeof startRegistryServerOnDemand;
  waitForServerClose: typeof waitForServerClose;
};

const defaultInteractiveAddProviderRuntime: InteractiveAddProviderRuntime = {
  listConfiguredProviderIds,
  createAddProviderWizardActor,
  inputPrompt,
  selectPrompt,
  confirmPrompt,
  ensureInteractiveModels,
  promptModelIncludeSelection,
  saveAndUpdateInteractiveProvider,
  assertValidTcpPort,
  findAvailablePort,
  getServeCommand,
  importUrl,
  showNote,
  printServeStartupSummary,
  startRegistryServerOnDemand,
  waitForServerClose,
};

const createAddProviderStepHandlers = (options: {
  state: AddProviderState;
  wizardActor: AddProviderWizardActor;
  existingProviderIds: string[];
  finalizeProvider: () => Promise<FinalizedInteractiveProvider>;
  runtime: InteractiveAddProviderRuntime;
}): AddProviderStepHandlers => {
  const { state, wizardActor, existingProviderIds, finalizeProvider, runtime } = options;
  let modelSourceError: string | undefined;
  const next = (stepId: AddProviderStepId): AddProviderStepHandlerResult => {
    if (stepId === 'modelSource') {
      modelSourceError = undefined;
    }
    resetAddProviderStateAfterStep(state, stepId);
    sendAddProviderWizardEvent(wizardActor, 'NEXT', state);
    return 'continue';
  };
  const back = (): AddProviderStepHandlerResult => {
    sendAddProviderWizardEvent(wizardActor, 'BACK', state);
    return 'continue';
  };

  return {
    providerId: async () => {
      const providerIdInput = unwrapSubmenuPrompt(
        await runtime.inputPrompt({
          message: 'Provider ID',
          placeholder: 'PROVIDER_ID',
          initialValue: state.providerId,
          validate: validateNewProviderId(existingProviderIds),
        }),
      );
      if (providerIdInput === undefined) return 'cancel';
      state.providerId = providerIdInput.trim();
      return next('providerId');
    },
    baseUrl: async () => {
      const baseUrlInput = unwrapSubmenuPrompt(
        await runtime.inputPrompt({
          message: 'Provider API base URL',
          placeholder: 'https://api.example.com',
          initialValue: state.baseUrl,
          validate: requiredText,
        }),
      );
      if (baseUrlInput === undefined) return back();
      state.baseUrl = baseUrlInput.trim();
      return next('baseUrl');
    },
    authMode: async () => {
      const authModeInput = unwrapCustomSelect(
        await runtime.selectPrompt<AddProviderAuthMode>({
          message: 'API key source',
          options: [
            { value: 'store', label: 'Store key in auth.json' },
            { value: 'once', label: 'Enter key for this update only' },
            { value: 'env', label: 'Use environment variable' },
            { value: 'none', label: 'No auth' },
          ],
          initialValue: state.authMode,
        }),
      );
      if (authModeInput === undefined) return back();
      state.authMode = authModeInput;
      return next('authMode');
    },
    apiKey: async () => {
      if (state.authMode === 'once' || state.authMode === 'store') {
        const apiKeyInput = unwrapSubmenuPrompt(
          await runtime.inputPrompt({
            message: 'API key',
            initialValue: state.apiKey,
            validate: requiredText,
            mask: true,
          }),
        );
        if (apiKeyInput === undefined) return back();
        state.apiKey = apiKeyInput.trim();
      }
      return next('apiKey');
    },
    apiKeyEnv: async () => {
      if (state.authMode === 'env') {
        const apiKeyEnvInput = unwrapSubmenuPrompt(
          await runtime.inputPrompt({
            message: 'API key environment variable',
            placeholder: defaultProviderApiKeyEnvName(state.providerId),
            initialValue: state.apiKeyEnv,
            validate: requiredText,
          }),
        );
        if (apiKeyEnvInput === undefined) return back();
        state.apiKeyEnv = apiKeyEnvInput.trim();
      }
      return next('apiKeyEnv');
    },
    providerType: async () => {
      const providerTypeInput = unwrapCustomSelect(
        await runtime.selectPrompt<ProviderType>({
          message: 'Provider API type',
          options: providerTypeOptions(),
          initialValue: state.providerType,
        }),
      );
      if (providerTypeInput === undefined) return back();
      state.providerType = parseProviderType(providerTypeInput);
      return next('providerType');
    },
    modelSource: async () => {
      const modelSourceInput = unwrapSubmenuPrompt(
        await runtime.inputPrompt({
          message:
            'Model list source (empty = default, URL = custom remote URL, path = local file)',
          ...(modelSourceError
            ? {
                details: [
                  {
                    tone: 'danger',
                    text: modelSourceError,
                  },
                ],
              }
            : {}),
          placeholder: defaultInteractiveModelSourcePlaceholder(state),
          initialValue: state.modelSourceInput,
        }),
      );
      if (modelSourceInput === undefined) return back();
      state.modelSourceInput = modelSourceInput.trim();
      return next('modelSource');
    },
    modelInclude: async () => {
      const fetchedModels = await runtime.ensureInteractiveModels(state);
      if (fetchedModels.status === 'fix_models_endpoint') {
        modelSourceError = fetchedModels.message;
        return back();
      }

      const selectedInclude = await runtime.promptModelIncludeSelection({
        modelIds: fetchedModels.modelIds,
        initialSelectFromList: state.selectModelsFromFetchedList,
        ...(state.include ? { initialInclude: state.include } : {}),
        startInList: state.includeSource === 'selection' && state.selectModelsFromFetchedList,
      });

      if (selectedInclude.status === 'back') return back();

      state.include = selectedInclude.include;
      state.includeSource = 'selection';
      state.selectModelsFromFetchedList = selectedInclude.selectFromList;
      return next('modelInclude');
    },
    updateMode: async () => {
      const updateModeInput = unwrapCustomSelect(
        await runtime.selectPrompt<UpdateMode>({
          message: 'Future update behavior',
          details: [
            {
              tone: 'info',
              text: 'When models refresh, what happens to manual edits in api.json?',
            },
          ],
          options: [
            { value: 'merge', label: 'Keep my edits', hint: 'recommended' },
            {
              value: 'overwrite',
              label: 'Rebuild api.json',
              hint: 'overwrite generated fields',
            },
          ],
          initialValue: state.updateMode,
        }),
      );
      if (updateModeInput === undefined) return back();
      state.updateMode = updateModeInput;
      return next('updateMode');
    },
    startServer: async () => {
      await finalizeProvider();

      const startServerNow = unwrapSubmenuPrompt(
        await runtime.confirmPrompt({
          message: 'Start registry server now?',
          initialValue: state.startServerNow,
        }),
      );
      if (startServerNow === undefined) return back();
      state.startServerNow = startServerNow;
      return 'done';
    },
  };
};

export const runInteractiveAddProvider = async (options: {
  stateDir: string;
  host: string;
  port: string;
  runtime?: Partial<InteractiveAddProviderRuntime>;
}): Promise<boolean> => {
  const runtime = { ...defaultInteractiveAddProviderRuntime, ...options.runtime };
  const existingProviderIds = runtime.listConfiguredProviderIds(options.stateDir);
  const state: AddProviderState = createInitialAddProviderState();

  const wizardActor = await runtime.createAddProviderWizardActor();
  wizardActor.start();

  let finalizedProvider: FinalizedInteractiveProvider | undefined;

  const finalizeProvider = async (): Promise<FinalizedInteractiveProvider> => {
    finalizedProvider = await runtime.saveAndUpdateInteractiveProvider({
      stateDir: options.stateDir,
      state,
    });
    return finalizedProvider;
  };

  const stepHandlers = createAddProviderStepHandlers({
    state,
    wizardActor,
    existingProviderIds,
    finalizeProvider,
    runtime,
  });

  while (true) {
    const currentStepId = getAddProviderWizardStepId(wizardActor);
    const result = await stepHandlers[currentStepId]();
    if (result === 'cancel') {
      return true;
    }
    if (result === 'done') {
      break;
    }
  }

  const providerResult = finalizedProvider ?? (await finalizeProvider());
  const draft = providerSetupDraftFromInteractiveState(options.stateDir, state);
  const modelSource = draft.modelSource;
  const include = draft.include;
  const providerId = state.providerId;
  const providerType = state.providerType;
  const startServerNow = state.startServerNow;
  const { configPath, stateDir, editablePath, modelCount, commit } = providerResult;

  let servePort = runtime.assertValidTcpPort(Number(options.port), 'port');

  if (startServerNow) {
    const availablePort = await runtime.findAvailablePort(options.host, servePort);
    if (availablePort !== servePort) {
      process.stderr.write(`port ${servePort} is unavailable, using ${availablePort}\n`);
      servePort = availablePort;
    }
  }

  const url = runtime.importUrl(providerId, options.host, `${servePort}`);
  const serveCommand = runtime.getServeCommand({
    stateDir: options.stateDir,
    host: options.host,
    port: servePort,
  }).command;
  const providerAddedNoteLines = [
    `provider: ${providerId}`,
    `provider type: ${providerType}`,
    ...(modelSource ? [`model source: ${modelSource.kind}`] : []),
    ...(modelSource?.kind === 'remote_url' ? [`source: ${modelSource.url}`] : []),
    ...(modelSource?.kind === 'local_file' ? [`source: ${modelSource.path}`] : []),
    ...(state.modelSourceInput
      ? []
      : [`default source: ${defaultInteractiveModelSourceLabel(state)}`]),
    `name: ${providerId}`,
    `config: ${configPath}`,
    ...(editablePath ? [`registry: ${editablePath}`] : []),
    ...(modelCount === undefined ? [] : [`models: ${modelCount}`]),
    ...(include ? [`include: ${include.join(',')}`] : []),
    `update mode: ${state.updateMode}`,
    ...(commit ? [`commit: ${commit}`] : []),
    `url: ${url}`,
    `serve: ${serveCommand}`,
  ];
  runtime.showNote(providerAddedNoteLines.join('\n'), 'Provider added');

  if (startServerNow) {
    const stopRenderingServeSummary = runtime.printServeStartupSummary(
      stateDir,
      options.host,
      `${servePort}`,
      { leadingSpacer: true },
    );
    const server = await runtime.startRegistryServerOnDemand({
      stateDir,
      host: options.host,
      port: servePort,
    });
    try {
      const closeResult = await runtime.waitForServerClose(server);
      if (isInteractiveHome(closeResult)) {
        return true;
      }
    } finally {
      stopRenderingServeSummary();
    }
    return false;
  }

  return true;
};
