import { withProviderLock, withStateDirLock } from '../lock';
import { normalizeProviderId } from '../provider-id';
import {
  commitProviderConfigChangeAsync,
  persistUpdateModeAsync,
  saveProviderDefinitionAsync,
} from '../state-directory-mutation';
import type { MetadataMatchSummary } from '../transform';
import {
  applyPreparedProviderUpdate,
  prepareProviderUpdate,
  type UpdateMode,
  type UpdateProviderRuntime,
} from '../update';
import type { ProviderDefinitionInput, StateDirInput } from './types';
import { commitAppliedProviderUpdate, countGeneratedModels } from './update-helpers';

export type SaveProviderInput = StateDirInput &
  ProviderDefinitionInput & {
    commit?: boolean;
  };

export type SaveProviderResult = {
  configPath: string;
  stateDir: string;
  commit?: string;
};

const saveProviderUnlocked = async (input: SaveProviderInput): Promise<SaveProviderResult> => {
  const saved = await saveProviderDefinitionAsync(input);
  const commit = input.commit
    ? await commitProviderConfigChangeAsync({
        stateDir: saved.stateDir,
        providerId: input.providerId,
        action: 'add',
      })
    : undefined;

  return {
    ...saved,
    ...(commit ? { commit } : {}),
  };
};

export const saveProvider = async (input: SaveProviderInput): Promise<SaveProviderResult> => {
  const providerId = normalizeProviderId(input.providerId);
  return withStateDirLock(input.stateDir, () => saveProviderUnlocked({ ...input, providerId }));
};

export type SetupProviderInput = SaveProviderInput & {
  apiKey?: string;
  updateMode?: UpdateMode;
  updateNow?: boolean;
  now?: () => Date;
  signal?: AbortSignal;
  runtime?: Partial<UpdateProviderRuntime>;
};

export type SetupProviderResult = {
  providerId: string;
  configPath: string;
  editablePath?: string;
  modelCount?: number;
  metadataMatchSummary?: MetadataMatchSummary;
  commit?: string;
};

export const setupProviderOperation = async (
  input: SetupProviderInput,
): Promise<SetupProviderResult> => {
  const providerId = normalizeProviderId(input.providerId);
  const safeInput = { ...input, providerId };
  const saved = await withStateDirLock(input.stateDir, async () => {
    const saved = await saveProviderUnlocked({ ...safeInput, commit: false });
    await persistUpdateModeAsync(saved.stateDir, providerId, input.updateMode);
    return saved;
  });

  let editablePath: string | undefined;
  let modelCount: number | undefined;
  let metadataMatchSummary: MetadataMatchSummary | undefined;
  let commit: string | undefined;

  if (input.updateNow !== false) {
    const prepared = await prepareProviderUpdate({
      stateDir: saved.stateDir,
      providerId,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.runtime ? { runtime: input.runtime } : {}),
    });
    const result = await applySetupProviderUpdate({
      stateDir: saved.stateDir,
      providerId,
      prepared,
      ...(input.updateMode ? { updateMode: input.updateMode } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    modelCount = result.modelCount;
    metadataMatchSummary = result.metadataMatchSummary;
    editablePath = result.editablePath;
    commit = result.commit;
  }

  const setupResult: SetupProviderResult = {
    providerId,
    configPath: saved.configPath,
    ...(editablePath ? { editablePath } : {}),
    ...(metadataMatchSummary ? { metadataMatchSummary } : {}),
    ...(commit ? { commit } : {}),
  };
  if (modelCount !== undefined) {
    setupResult.modelCount = modelCount;
  }
  return setupResult;
};

type ApplySetupProviderUpdateInput = Pick<
  SetupProviderInput,
  'stateDir' | 'providerId' | 'updateMode' | 'signal'
> & {
  prepared: Awaited<ReturnType<typeof prepareProviderUpdate>>;
};

const applySetupProviderUpdate = async ({
  stateDir,
  providerId,
  prepared,
  updateMode,
  signal,
}: ApplySetupProviderUpdateInput): Promise<{
  editablePath: string;
  modelCount: number;
  metadataMatchSummary: MetadataMatchSummary;
  commit?: string;
}> => {
  return withProviderLock(stateDir, providerId, async () => {
    const result = applyPreparedProviderUpdate({
      stateDir,
      providerId,
      prepared,
      ...(updateMode ? { updateMode } : {}),
    });
    const modelCount = countGeneratedModels(result, providerId);
    const commit = await commitAppliedProviderUpdate({
      stateDir,
      providerId,
      modelCount,
      updateState: result.updateState,
      ...(signal ? { signal } : {}),
    });
    return {
      editablePath: result.editablePath,
      modelCount,
      metadataMatchSummary: result.metadataMatchSummary,
      ...(commit ? { commit } : {}),
    };
  });
};
