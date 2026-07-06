import { withProviderLock, withStateDirLock } from '../lock';
import type { DiscoveredModel } from '../provider-model-source';
import type { UpdateState } from '../state';
import { commitProviderUpdateAsync } from '../state-directory-mutation';
import {
  applyPreparedProviderUpdate,
  type PreparedProviderUpdate,
  type UpdateMode,
  type UpdateProviderResult,
  type UpdateProviderRuntime,
} from '../update';

export const countGeneratedModels = (result: UpdateProviderResult, providerId: string): number => {
  return Object.keys(result.generated[providerId]?.models ?? {}).length;
};

export const providerUpdatePreparationInput = (input: {
  stateDir: string;
  providerId: string;
  models?: DiscoveredModel[];
  apiKey?: string;
  now?: () => Date;
  signal?: AbortSignal;
  runtime?: Partial<UpdateProviderRuntime>;
}) => ({
  stateDir: input.stateDir,
  providerId: input.providerId,
  ...(input.models ? { models: input.models } : {}),
  ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  ...(input.now ? { now: input.now } : {}),
  ...(input.signal ? { signal: input.signal } : {}),
  ...(input.runtime ? { runtime: input.runtime } : {}),
});

export type UpdateStateSummary = {
  updatedAt: string;
  lastUpdateStatus: UpdateState['lastUpdateStatus'];
  warnings: number;
  errors: number;
  conflicts: number;
};

export const summarizeUpdateState = (updateState: UpdateState): UpdateStateSummary => ({
  updatedAt: updateState.updatedAt,
  lastUpdateStatus: updateState.lastUpdateStatus,
  warnings: updateState.warnings.length,
  errors: updateState.errors.length,
  conflicts: updateState.conflicts.length,
});

export const commitAppliedProviderUpdate = async (input: {
  stateDir: string;
  providerId: string;
  modelCount: number;
  updateState: UpdateState;
  signal?: AbortSignal;
}): Promise<string | undefined> => {
  return withStateDirLock(input.stateDir, () => {
    input.signal?.throwIfAborted();
    return commitProviderUpdateAsync({
      stateDir: input.stateDir,
      providerId: input.providerId,
      modelCount: input.modelCount,
      conflicts: input.updateState.conflicts,
    });
  });
};

export type AppliedProviderUpdateOperationResult = {
  editablePath: string;
  modelCount: number;
  updateStateSummary: UpdateStateSummary;
  metadataMatchSummary: UpdateProviderResult['metadataMatchSummary'];
  commit?: string;
};

export const applyPreparedProviderUpdateOperation = async (input: {
  stateDir: string;
  providerId: string;
  prepared: PreparedProviderUpdate;
  dryRun?: boolean;
  force?: boolean;
  updateMode?: UpdateMode;
  signal?: AbortSignal;
  commit?: boolean;
}): Promise<AppliedProviderUpdateOperationResult> => {
  return withProviderLock(input.stateDir, input.providerId, async () => {
    input.signal?.throwIfAborted();
    const result = applyPreparedProviderUpdate({
      stateDir: input.stateDir,
      providerId: input.providerId,
      prepared: input.prepared,
      ...(input.dryRun ? { dryRun: true } : {}),
      ...(input.force ? { force: true } : {}),
      ...(input.updateMode ? { updateMode: input.updateMode } : {}),
    });
    input.signal?.throwIfAborted();

    const modelCount = countGeneratedModels(result, input.providerId);
    const commit =
      input.dryRun || input.commit === false
        ? undefined
        : await commitAppliedProviderUpdate({
            stateDir: input.stateDir,
            providerId: input.providerId,
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
