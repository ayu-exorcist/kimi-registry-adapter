import { DEFAULT_PROVIDER_TYPE, providerModelSourceKindDescription } from '@kastral/kra-core';
import type { ArgsDef } from 'citty';

export type CliArgs = ArgsDef;
export type CommandModeDefaults = {
  stateDir: string;
  host: string;
  port: number;
};

export const createSharedArgs = (defaults: CommandModeDefaults) => {
  const providerIdArg = {
    type: 'positional' as const,
    description: 'Provider identifier',
    required: true as const,
  };
  const stateDirArg = {
    type: 'string' as const,
    description: 'State directory',
    default: defaults.stateDir,
  };
  const hostArg = { type: 'string' as const, description: 'Registry host', default: defaults.host };
  const portArg = {
    type: 'string' as const,
    description: 'Registry port',
    default: `${defaults.port}`,
  };

  return { providerIdArg, stateDirArg, hostArg, portArg };
};

export type SharedArgs = ReturnType<typeof createSharedArgs>;

export const createAddProviderArgs = ({
  providerIdArg,
  stateDirArg,
}: Pick<SharedArgs, 'providerIdArg' | 'stateDirArg'>) =>
  ({
    providerId: providerIdArg,
    baseUrl: {
      type: 'string' as const,
      description: 'Provider API base URL',
      required: true as const,
    },
    modelSource: {
      type: 'string' as const,
      description: `Model discovery source: ${providerModelSourceKindDescription}`,
    },
    modelSourcePath: {
      type: 'string' as const,
      description: 'Local model source file path for --model-source local_file',
    },
    modelSourceUrl: {
      type: 'string' as const,
      description: 'Model source URL for endpoint sources or --model-source remote_url',
    },
    modelsMetadataPath: {
      type: 'string' as const,
      description: 'Optional models metadata source; defaults to https://models.dev/models.json',
    },
    apiKeyEnv: {
      type: 'string' as const,
      description: 'Environment variable name containing the provider API key',
    },
    npm: { type: 'string' as const, description: 'Optional provider npm package metadata' },
    name: { type: 'string' as const, description: 'Provider display name' },
    include: {
      type: 'string' as const,
      description: 'Model ids/patterns to include; repeat, space-separate, or comma-separate',
    },
    exclude: {
      type: 'string' as const,
      description: 'Model ids/patterns to exclude; repeat, space-separate, or comma-separate',
    },
    type: { type: 'string' as const, description: 'Provider type', default: DEFAULT_PROVIDER_TYPE },
    stateDir: stateDirArg,
  }) satisfies CliArgs;
