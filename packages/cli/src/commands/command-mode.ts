import { resolve } from 'node:path';

import { configureProviderAuth, listProviders, removeProvider } from '@kastral/kra-core';
import { defineCommand } from 'citty';

import { requireCliString } from './args';
import {
  createAddProviderArgs,
  createSharedArgs,
  type CliArgs,
  type CommandModeDefaults,
  type SharedArgs,
} from './command-mode-args';
import { runAddCommand, runServeCommand, runUpdateCommand } from './command-mode-handlers';
import { printJson } from './render';

export type { CommandModeDefaults } from './command-mode-args';

const createAddCommand = (sharedArgs: SharedArgs) => {
  const addProviderArgs = createAddProviderArgs(sharedArgs);

  return defineCommand({
    meta: {
      name: 'add',
      description: 'Add a provider, update its registry, and print the Kimi import URL.',
    },
    args: {
      ...addProviderArgs,
      apiKey: {
        type: 'string' as const,
        description: 'Provider API key for this add run only; never written to config',
      },
      host: sharedArgs.hostArg,
      port: sharedArgs.portArg,
      update: {
        type: 'boolean' as const,
        description: 'Update the provider registry after saving config',
        default: true,
        negativeDescription: 'Only save provider config; skip registry update',
      },
      updateMode: {
        type: 'string' as const,
        description: 'Application data update mode: merge or overwrite',
      },
    } satisfies CliArgs,
    async run({ args, rawArgs }) {
      await runAddCommand(args, rawArgs);
    },
  });
};

const createRemoveCommand = ({ providerIdArg, stateDirArg }: SharedArgs) =>
  defineCommand({
    meta: {
      name: 'remove',
      description:
        'Remove matching provider config and auth when present, and delete its local registry files unless --keep-files is passed.',
    },
    args: {
      providerId: providerIdArg,
      stateDir: stateDirArg,
      keepFiles: {
        type: 'boolean' as const,
        description: 'Keep registries/<providerId> local files',
      },
    },
    async run({ args }) {
      const stateDir = requireCliString(args.stateDir, 'stateDir');
      const providerId = requireCliString(args.providerId, 'providerId');
      printJson({
        ok: true,
        ...(await removeProvider({
          stateDir,
          providerId,
          ...(args.keepFiles ? { keepFiles: args.keepFiles } : {}),
        })),
      });
    },
  });

const createListCommand = ({ stateDirArg }: SharedArgs) =>
  defineCommand({
    meta: { name: 'list', description: 'List configured provider IDs.' },
    args: { stateDir: stateDirArg },
    run({ args }) {
      const result = listProviders({ stateDir: requireCliString(args.stateDir, 'stateDir') });
      printJson({ providers: result.providers, count: result.count });
    },
  });

const createAuthCommand = ({ providerIdArg, stateDirArg }: SharedArgs) =>
  defineCommand({
    meta: {
      name: 'auth',
      description:
        'Store provider authentication in auth.json. auth.json is secret and must not be committed.',
    },
    args: {
      providerId: providerIdArg,
      apiKey: { type: 'string' as const, description: 'Provider API key to store in auth.json' },
      apiKeyEnv: {
        type: 'string' as const,
        description: 'Environment variable name containing the provider API key',
      },
      clear: {
        type: 'boolean' as const,
        description: 'Clear stored provider authentication from auth.json',
      },
      stateDir: stateDirArg,
    },
    async run({ args }) {
      if (!args.apiKey && !args.apiKeyEnv && !args.clear)
        throw new Error('Provide --api-key, --api-key-env, or --clear.');
      const stateDir = resolve(requireCliString(args.stateDir, 'stateDir'));
      const providerId = requireCliString(args.providerId, 'providerId');
      const result = await configureProviderAuth({
        stateDir,
        providerId,
        ...(args.apiKey ? { apiKey: args.apiKey } : {}),
        ...(args.apiKeyEnv ? { apiKeyEnv: args.apiKeyEnv } : {}),
        ...(args.clear ? { clear: true } : {}),
      });
      printJson({
        ok: true,
        providerId,
        authPath: result.authPath,
        stored: result.stored,
      });
    },
  });

const createUpdateCommand = ({ providerIdArg, stateDirArg }: SharedArgs) =>
  defineCommand({
    meta: {
      name: 'update',
      description:
        'Update generated and editable registry files from a models payload or upstream /models.',
    },
    args: {
      providerId: providerIdArg,
      modelsFile: {
        type: 'string' as const,
        description: 'Path to an OpenAI-compatible models payload',
      },
      apiKey: {
        type: 'string' as const,
        description: 'Provider API key for this update run only; never written to config',
      },
      stateDir: stateDirArg,
      dryRun: { type: 'boolean' as const, description: 'Do not write output files' },
      force: {
        type: 'boolean' as const,
        description: 'Overwrite editable registry instead of merging',
      },
      updateMode: {
        type: 'string' as const,
        description: 'Application data update mode: merge or overwrite',
      },
    },
    async run({ args }) {
      await runUpdateCommand(args);
    },
  });

const createServeCommand = (defaults: CommandModeDefaults, { stateDirArg }: SharedArgs) =>
  defineCommand({
    meta: {
      name: 'serve',
      description:
        'Update configured providers, then serve local provider registry files over HTTP.',
    },
    args: {
      stateDir: stateDirArg,
      host: { type: 'string' as const, description: 'Server host' },
      port: { type: 'string' as const, description: 'Server port' },
      update: {
        type: 'boolean' as const,
        description: 'Update configured providers before starting the server',
        default: true,
        negativeDescription: 'Skip updating configured providers before starting the server',
      },
      updateInterval: {
        type: 'string' as const,
        description:
          'Periodically update configured providers; use m, h, or d, for example 30m, 1h, or 1d',
      },
      updateConcurrency: {
        type: 'string' as const,
        description: 'Maximum number of provider updates to run at once',
      },
      updateTimeoutMs: {
        type: 'string' as const,
        description: 'Per-provider update timeout in milliseconds',
      },
    },
    async run({ args }) {
      await runServeCommand(args, defaults);
    },
  });

export const createCommandModeSubcommands = (defaults: CommandModeDefaults) => {
  const sharedArgs = createSharedArgs(defaults);

  return {
    add: createAddCommand(sharedArgs),
    remove: createRemoveCommand(sharedArgs),
    list: createListCommand(sharedArgs),
    auth: createAuthCommand(sharedArgs),
    update: createUpdateCommand(sharedArgs),
    serve: createServeCommand(defaults, sharedArgs),
  };
};
