import { withStateDirLock } from '../lock';
import type { UpdateState } from '../state';
import { commitProviderUpdateAsync } from '../state-directory-mutation';
import type { UpdateProviderResult } from '../update';

export const countGeneratedModels = (result: UpdateProviderResult, providerId: string): number => {
  return Object.keys(result.generated[providerId]?.models ?? {}).length;
};

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
