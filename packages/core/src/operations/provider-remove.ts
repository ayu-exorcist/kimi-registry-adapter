import { withProviderLock, withStateDirLock } from '../lock';
import { normalizeProviderId } from '../provider-id';
import { removeProviderDefinitionAsync } from '../state-directory-mutation';
import type { ProviderIdInput, StateDirInput } from './types';

export type RemoveProviderInput = StateDirInput &
  ProviderIdInput & {
    keepFiles?: boolean;
  };

export type RemoveProviderResult = {
  providerId: string;
  configPath: string;
  authPath: string;
  deletedFiles: boolean;
  commit?: string;
};

export const removeProvider = async (input: RemoveProviderInput): Promise<RemoveProviderResult> => {
  const providerId = normalizeProviderId(input.providerId);
  return withProviderLock(input.stateDir, providerId, () =>
    withStateDirLock(input.stateDir, () => removeProviderDefinitionAsync({ ...input, providerId })),
  );
};
