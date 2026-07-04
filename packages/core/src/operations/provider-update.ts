import { resolve } from 'node:path';

import { readAuthConfig, resolveProviderApiKey } from '../auth';
import type { ProviderConfig } from '../config';
import { withProviderLock, withStateDirLock } from '../lock';
import { normalizeProviderId } from '../provider-id';
import {
  fetchProviderModels,
  type DiscoveredModel,
  type ProviderModelSourceRuntime,
} from '../provider-model-source';
import { createStatePaths } from '../state';
import { persistUpdateModeAsync, readExistingOrDefaultConfig } from '../state-directory-mutation';
import type { MetadataMatchSummary } from '../transform';
import {
  applyPreparedProviderUpdate,
  prepareProviderUpdate,
  type UpdateMode,
  type UpdateProviderRuntime,
} from '../update';
import type { ProviderIdInput, StateDirInput } from './types';
import {
  commitAppliedProviderUpdate,
  countGeneratedModels,
  summarizeUpdateState,
  type UpdateStateSummary,
} from './update-helpers';

export type UpdateProviderInput = StateDirInput &
  ProviderIdInput & {
    models?: DiscoveredModel[];
    apiKey?: string;
    dryRun?: boolean;
    force?: boolean;
    updateMode?: UpdateMode;
    now?: () => Date;
    signal?: AbortSignal;
    runtime?: Partial<UpdateProviderRuntime>;
  };

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
  const stateDir = resolve(input.stateDir);
  const providerId = normalizeProviderId(input.providerId);
  const paths = createStatePaths(stateDir, providerId);
  const config = readExistingOrDefaultConfig(paths.configPath);
  const provider = config.providers[providerId];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

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
  const prepared = await prepareProviderUpdate({
    stateDir,
    providerId,
    ...(inputModels ? { models: inputModels } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
  });

  return withProviderLock(stateDir, providerId, async () => {
    input.signal?.throwIfAborted();
    const result = applyPreparedProviderUpdate({
      stateDir,
      providerId,
      prepared,
      ...(input.dryRun ? { dryRun: true } : {}),
      ...(input.force ? { force: true } : {}),
      ...(input.updateMode ? { updateMode: input.updateMode } : {}),
    });
    input.signal?.throwIfAborted();
    const modelCount = countGeneratedModels(result, providerId);
    const commit = input.dryRun
      ? undefined
      : await commitAppliedProviderUpdate({
          stateDir,
          providerId,
          modelCount,
          updateState: result.updateState,
          ...(input.signal ? { signal: input.signal } : {}),
        });

    return {
      editablePath: result.editablePath,
      modelCount,
      updateStateSummary: summarizeUpdateState(result.updateState),
      metadataMatchSummary: result.metadataMatchSummary,
      ...(commit ? { commit } : {}),
    };
  });
};
