import { dirname } from 'node:path';

import { setupProviderOperation } from '@kastral/kra-core';

import type { AddProviderState } from './interactive-add-wizard';
import { withLoadingIndicator } from './prompt-adapters';
import {
  providerSetupDraftFromInteractiveState,
  providerSetupOperationInputFromDraft,
} from './provider-setup-input';

export type FinalizedInteractiveProvider = {
  configPath: string;
  stateDir: string;
  editablePath: string;
  modelCount: number;
  commit: string | undefined;
};

export type SaveAndUpdateInteractiveProviderRuntime = {
  setupProviderOperation: typeof setupProviderOperation;
  withLoadingIndicator: typeof withLoadingIndicator;
};

const defaultRuntime: SaveAndUpdateInteractiveProviderRuntime = {
  setupProviderOperation,
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
  const result = await runtime.withLoadingIndicator('Updating registry...', () =>
    runtime.setupProviderOperation({
      ...providerSetupOperationInputFromDraft(draft),
      ...(state.authMode === 'store' ? { storeApiKey: true } : {}),
    }),
  );

  if (result.editablePath === undefined || result.modelCount === undefined) {
    throw new Error('Interactive add requires provider setup to update the registry.');
  }

  return {
    configPath: result.configPath,
    stateDir: dirname(result.configPath),
    editablePath: result.editablePath,
    modelCount: result.modelCount,
    commit: result.commit,
  };
};
