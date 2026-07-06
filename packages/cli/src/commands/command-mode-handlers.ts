import { resolve } from 'node:path';

import {
  getStateConfigSummary,
  parseProviderType,
  readModelsPayload,
  setupProviderOperation,
  updateProviderOperation,
  type ProviderConfig,
} from '@kastral/kra-core';

import { parseUpdateIntervalMs } from '../duration';
import { parseModelSource, parseUpdateMode, requireCliString, withPatternOptions } from './args';
import type { CommandModeDefaults } from './command-mode-args';
import { saveProviderDefinition } from './provider-setup';
import {
  providerDefinitionOptionsFromDraft,
  providerSetupOperationInputFromDraft,
  type ProviderSetupDraft,
} from './provider-setup-input';
import { printJson, printServeStartupSummary } from './render';
import { getServeCommand, importUrl } from './serve-command';
import {
  assertValidTcpPort,
  findAvailablePort,
  createServeUpdateTracker,
  startRegistryServerOnDemand,
  updateConfiguredProviders,
  waitForServerClose,
} from './server-runtime';

type OptionalCliValue<T> = T | undefined;

type RawProviderSetupCliArgs = {
  providerId: string;
  baseUrl: string;
  modelSource: OptionalCliValue<string>;
  modelSourcePath: OptionalCliValue<string>;
  modelSourceUrl: OptionalCliValue<string>;
  modelsMetadataPath: OptionalCliValue<string>;
  apiKeyEnv: OptionalCliValue<string>;
  npm: OptionalCliValue<string>;
  name: OptionalCliValue<string>;
  include: OptionalCliValue<string | string[]>;
  exclude: OptionalCliValue<string | string[]>;
  type: string;
  stateDir: string;
};

export type SetupProviderCliArgs = RawProviderSetupCliArgs & {
  apiKey: OptionalCliValue<string>;
  host: string;
  port: string;
  update: OptionalCliValue<boolean>;
  updateMode: OptionalCliValue<string>;
};

export type UpdateCliArgs = {
  providerId: OptionalCliValue<string>;
  modelsFile: OptionalCliValue<string>;
  apiKey: OptionalCliValue<string>;
  stateDir: OptionalCliValue<string>;
  dryRun: OptionalCliValue<boolean>;
  force: OptionalCliValue<boolean>;
  updateMode: OptionalCliValue<string>;
};

export type ServeCliArgs = Partial<{
  stateDir: OptionalCliValue<string>;
  host: OptionalCliValue<string>;
  port: OptionalCliValue<string>;
  update: OptionalCliValue<boolean>;
  updateInterval: OptionalCliValue<string>;
  updateConcurrency: OptionalCliValue<string>;
  updateTimeoutMs: OptionalCliValue<string>;
}>;

type NormalizedSetupProviderCliArgs = Omit<SetupProviderCliArgs, 'include' | 'exclude'> & {
  include?: string[];
  exclude?: string[];
};

type ProviderOptionFields = Pick<
  ProviderSetupDraft,
  'modelsMetadataPath' | 'apiKeyEnv' | 'npm' | 'include' | 'exclude' | 'name'
>;

type ProviderOptionInput = {
  [Key in keyof ProviderOptionFields]?: ProviderOptionFields[Key] | undefined;
};

const pickProviderOptionFields = (options: ProviderOptionInput): ProviderOptionFields => ({
  ...(options.name ? { name: options.name } : {}),
  ...(options.modelsMetadataPath ? { modelsMetadataPath: options.modelsMetadataPath } : {}),
  ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
  ...(options.npm ? { npm: options.npm } : {}),
  ...(options.include ? { include: options.include } : {}),
  ...(options.exclude ? { exclude: options.exclude } : {}),
});

const providerOptionSummary = (
  options: ProviderOptionInput & { modelSource?: ProviderConfig['modelSource'] },
): Record<string, string | string[] | ProviderConfig['modelSource']> => {
  const { name: _name, ...fields } = pickProviderOptionFields(options);
  return {
    ...(options.modelSource ? { modelSource: options.modelSource } : {}),
    ...fields,
  };
};

const providerOptionFieldsFromCli = (
  options: NormalizedSetupProviderCliArgs,
): ProviderOptionFields => pickProviderOptionFields(options);

const parsePositiveIntegerOption = (
  value: string | undefined,
  name: string,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer.`);
  }
  return parsed;
};

export const runAddCommand = async (
  args: SetupProviderCliArgs,
  rawArgs: string[],
): Promise<void> => {
  const options = withPatternOptions(args, rawArgs);
  const updateMode = parseUpdateMode(options.updateMode);
  const modelSource = parseModelSource(options.modelSource, options);
  const providerType = parseProviderType(options.type);
  const providerOptionFields = providerOptionFieldsFromCli(options);
  const optionSummary = providerOptionSummary({
    ...(modelSource ? { modelSource } : {}),
    ...providerOptionFields,
  });
  const draft: ProviderSetupDraft = {
    stateDir: options.stateDir,
    providerId: options.providerId,
    baseUrl: options.baseUrl,
    type: providerType,
    ...(modelSource ? { modelSource } : {}),
    ...providerOptionFields,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(updateMode ? { updateMode } : {}),
  };

  if (options.update === false) {
    const { configPath, commit } = await saveProviderDefinition(options.providerId, {
      ...providerDefinitionOptionsFromDraft(draft),
      commit: true,
    });
    printJson({
      ok: true,
      providerId: options.providerId,
      configPath,
      ...(commit ? { commit } : {}),
      ...optionSummary,
    });
    return;
  }

  const result = await setupProviderOperation(providerSetupOperationInputFromDraft(draft));
  printJson({
    ok: true,
    ...result,
    url: importUrl(result.providerId, options.host, options.port),
    serveCommand: getServeCommand({
      stateDir: options.stateDir,
      host: options.host,
      port: options.port,
    }).command,
    ...optionSummary,
  });
};

export const runUpdateCommand = async (args: UpdateCliArgs): Promise<void> => {
  const updateArgs = args;
  const updateMode = parseUpdateMode(updateArgs.updateMode);
  const stateDir = resolve(requireCliString(updateArgs.stateDir, 'stateDir'));
  const providerId = requireCliString(updateArgs.providerId, 'providerId');
  const result = await updateProviderOperation({
    stateDir,
    providerId,
    ...(updateArgs.modelsFile ? { models: readModelsPayload(resolve(updateArgs.modelsFile)) } : {}),
    ...(updateArgs.apiKey ? { apiKey: updateArgs.apiKey } : {}),
    ...(updateArgs.dryRun ? { dryRun: true } : {}),
    ...(updateArgs.force ? { force: true } : {}),
    ...(updateMode ? { updateMode } : {}),
  });
  printJson({
    providerId,
    dryRun: Boolean(updateArgs.dryRun),
    force: Boolean(updateArgs.force),
    editablePath: result.editablePath,
    updateState: result.updateStateSummary,
    metadataMatchSummary: result.metadataMatchSummary,
    modelCount: result.modelCount,
    ...(result.commit ? { commit: result.commit } : {}),
  });
};

export const resolveServeOptions = (args: ServeCliArgs, defaults: CommandModeDefaults) => {
  const stateDir = resolve(requireCliString(args.stateDir, 'stateDir'));
  const config = getStateConfigSummary({ stateDir });
  const host = args.host ?? config.server.host ?? defaults.host;
  const requestedPort = assertValidTcpPort(
    Number(args.port ?? config.server.port ?? defaults.port),
    'port',
  );

  return { stateDir, host, requestedPort };
};

const createUpdateRunner = (
  stateDir: string,
  options: {
    concurrency?: number;
    timeoutMs?: number;
    updateTracker?: ReturnType<typeof createServeUpdateTracker>;
  },
): (() => Promise<void>) => {
  let updateInProgress = false;

  return async (): Promise<void> => {
    if (updateInProgress) {
      process.stderr.write('scheduled update skipped: previous update is still running\n');
      return;
    }
    updateInProgress = true;
    try {
      await updateConfiguredProviders(stateDir, {
        ...(options.concurrency ? { concurrency: options.concurrency } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.updateTracker ? { updateTracker: options.updateTracker } : {}),
      });
    } finally {
      updateInProgress = false;
    }
  };
};

export const runServeCommand = async (
  args: ServeCliArgs,
  defaults: CommandModeDefaults,
): Promise<void> => {
  const { stateDir, host, requestedPort } = resolveServeOptions(args, defaults);
  const port = await findAvailablePort(host, requestedPort);
  if (port !== requestedPort)
    process.stderr.write(`port ${requestedPort} is unavailable, using ${port}\n`);

  const updateIntervalMs = parseUpdateIntervalMs(args.updateInterval);
  const updateConcurrency = parsePositiveIntegerOption(
    args.updateConcurrency,
    '--update-concurrency',
  );
  const updateTimeoutMs = parsePositiveIntegerOption(args.updateTimeoutMs, '--update-timeout-ms');
  const updateTracker = createServeUpdateTracker();
  const runUpdates = createUpdateRunner(stateDir, {
    ...(updateConcurrency ? { concurrency: updateConcurrency } : {}),
    ...(updateTimeoutMs ? { timeoutMs: updateTimeoutMs } : {}),
    updateTracker,
  });

  if (args.update !== false) await runUpdates();
  if (updateIntervalMs !== undefined) {
    process.stderr.write(`scheduled updates every ${args.updateInterval}\n`);
    setInterval(() => {
      void runUpdates();
    }, updateIntervalMs);
  }
  printServeStartupSummary(stateDir, host, `${port}`);
  const server = await startRegistryServerOnDemand({
    stateDir,
    host,
    port,
    updateHealth: updateTracker.health,
  });
  await waitForServerClose(server);
};
