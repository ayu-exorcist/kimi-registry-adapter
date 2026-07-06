import { resolve } from 'node:path';

import type { ProviderConfig } from '../config';
import { normalizeProviderId } from '../provider-id';
import { createStatePaths, type StatePaths } from '../state';
import { readExistingOrDefaultConfig } from '../state-directory-mutation';
import type { ProviderIdInput, StateDirInput } from './types';

export type ConfiguredProvider = {
  stateDir: string;
  providerId: string;
  paths: StatePaths;
  provider: ProviderConfig;
};

export const readConfiguredProvider = (
  input: StateDirInput & ProviderIdInput,
  notFoundLabel = 'Provider not found in config',
): ConfiguredProvider => {
  const stateDir = resolve(input.stateDir);
  const providerId = normalizeProviderId(input.providerId);
  const paths = createStatePaths(stateDir, providerId);
  const config = readExistingOrDefaultConfig(paths.configPath);
  const provider = config.providers[providerId];

  if (!provider) {
    throw new Error(`${notFoundLabel}: ${providerId}`);
  }

  return { stateDir, providerId, paths, provider };
};
