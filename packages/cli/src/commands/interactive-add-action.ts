import { configureProviderAuth, updateProviderOperation } from '@kastral/kra-core';

import type { AddProviderState } from './interactive-add-wizard';
import { withLoadingIndicator } from './prompt-adapters';
import { saveProviderDefinition } from './provider-setup';
import {
  providerDefinitionOptionsFromDraft,
  providerSetupDraftFromInteractiveState,
} from './provider-setup-input';

export type FinalizedInteractiveProvider = {
  configPath: string;
  stateDir: string;
  editablePath: string;
  modelCount: number;
  commit: string | undefined;
};

export type SaveAndUpdateInteractiveProviderRuntime = {
  saveProviderDefinition: typeof saveProviderDefinition;
  configureProviderAuth: typeof configureProviderAuth;
  updateProviderOperation: typeof updateProviderOperation;
  withLoadingIndicator: typeof withLoadingIndicator;
};

const defaultRuntime: SaveAndUpdateInteractiveProviderRuntime = {
  saveProviderDefinition,
  configureProviderAuth,
  updateProviderOperation,
  withLoadingIndicator,
};

export { interactiveProviderApiKey, interactiveProviderApiKeyEnv } from './provider-setup-input';

export const saveAndUpdateInteractiveProvider = async (options: {
  stateDir: string;
  state: AddProviderState;
  runtime?: Partial<SaveAndUpdateInteractiveProviderRuntime>;
}): Promise<FinalizedInteractiveProvider> => {
  const runtime = { ...defaultRuntime, ...options.runtime };
  const state = options.state;
  const draft = providerSetupDraftFromInteractiveState(options.stateDir, state);
  const apiKey = draft.apiKey;
  const saveOptions = providerDefinitionOptionsFromDraft(draft);

  const { configPath, stateDir } = await runtime.saveProviderDefinition(
    state.providerId,
    saveOptions,
  );

  if (state.authMode === 'store' && apiKey) {
    await runtime.configureProviderAuth({ stateDir, providerId: state.providerId, apiKey });
  }

  const result = await runtime.withLoadingIndicator('Updating registry...', () =>
    runtime.updateProviderOperation({
      stateDir,
      providerId: state.providerId,
      ...(draft.cachedModels ? { models: draft.cachedModels } : {}),
      updateMode: state.updateMode,
      ...(state.authMode === 'once' && apiKey ? { apiKey } : {}),
    }),
  );

  return {
    configPath,
    stateDir,
    editablePath: result.editablePath,
    modelCount: result.modelCount,
    commit: result.commit,
  };
};
