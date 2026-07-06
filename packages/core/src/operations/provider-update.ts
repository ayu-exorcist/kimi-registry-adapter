import { resolve } from 'node:path';

import { readAuthConfig, resolveProviderApiKey } from '../auth';
import type { ProviderConfig } from '../config';
import { withStateDirLock } from '../lock';
import { normalizeProviderId } from '../provider-id';
import {
  fetchProviderModels,
  type DiscoveredModel,
  type ProviderModelSourceRuntime,
} from '../provider-model-source';
import { persistUpdateModeAsync } from '../state-directory-mutation';
import type { MetadataMatchSummary } from '../transform';
import { prepareProviderUpdate, type UpdateProviderOptions } from '../update';
import { readConfiguredProvider } from './provider-state';
import type { ProviderIdInput, StateDirInput } from './types';
import {
  applyPreparedProviderUpdateOperation,
  providerUpdatePreparationInput,
  type UpdateStateSummary,
} from './update-helpers';

export type UpdateProviderInput = UpdateProviderOptions;

export type FetchConfiguredProviderModelsInput = StateDirInput &
  ProviderIdInput & {
    apiKey?: string;
    signal?: AbortSignal;
    runtime?: Partial<Pick<ProviderModelSourceRuntime, 'fetchProviderModels'>>;
  };

export type FetchConfiguredProviderModelsResult = ProviderIdInput & {
  configPath: string;
  provider: ProviderConfig;
  models: DiscoveredModel[];
};

export type { UpdateStateSummary } from './update-helpers';

export type UpdateProviderOperationResult = {
  editablePath: string;
  modelCount: number;
  updateStateSummary: UpdateStateSummary;
  metadataMatchSummary: MetadataMatchSummary;
  commit?: string;
};

export const fetchConfiguredProviderModels = async (
  input: FetchConfiguredProviderModelsInput,
): Promise<FetchConfiguredProviderModelsResult> => {
  const { providerId, paths, provider } = readConfiguredProvider(input, 'Unknown provider');

  input.signal?.throwIfAborted();
  const apiKey =
    input.apiKey ??
    resolveProviderApiKey(readAuthConfig(paths.authPath), providerId, provider.apiKeyEnv);
  const models = await (input.runtime?.fetchProviderModels ?? fetchProviderModels)(
    provider,
    providerId,
    apiKey,
    input.signal,
  );

  return {
    providerId,
    configPath: paths.configPath,
    provider: structuredClone(provider),
    models,
  };
};

export const updateProviderOperation = async (
  input: UpdateProviderInput,
): Promise<UpdateProviderOperationResult> => {
  const providerId = normalizeProviderId(input.providerId);
  const stateDir = resolve(input.stateDir);
  const inputModels = input.models ? structuredClone(input.models) : undefined;
  if (!input.dryRun) {
    await withStateDirLock(stateDir, () =>
      persistUpdateModeAsync(stateDir, providerId, input.updateMode),
    );
  }
  const prepared = await prepareProviderUpdate(
    providerUpdatePreparationInput({
      ...input,
      stateDir,
      providerId,
      ...(inputModels ? { models: inputModels } : {}),
    }),
  );

  return applyPreparedProviderUpdateOperation({
    stateDir,
    providerId,
    prepared,
    ...(input.dryRun ? { dryRun: true } : {}),
    ...(input.force ? { force: true } : {}),
    ...(input.updateMode ? { updateMode: input.updateMode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
};
