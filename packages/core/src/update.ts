import { readAuthConfig } from './auth';
import { readConfig, type KraConfig } from './config';
import { createEditableRegistryStore } from './editable-registry-store';
import { readCommittedText } from './git';
import { createDeterministicJsonSnapshot } from './json';
import { normalizeProviderId, providerApiRegistryGitPath } from './provider-id';
import {
  fetchProviderModels,
  readModelsMetadata,
  registryHasConflictMarkers,
  resolveProviderModelSource,
  type DiscoveredModel,
} from './provider-model-source';
import { validateEditableRegistry, type EditableRegistry, type GeneratedRegistry } from './schema';
import type { UpdateState } from './state';
import {
  transformDiscoveredModelsToRegistryDetailed,
  type MetadataMatchSummary,
  type TransformProviderConfig,
} from './transform';

export type UpdateMode = 'merge' | 'overwrite';

export type UpdateProviderOptions = {
  stateDir: string;
  providerId: string;
  models?: DiscoveredModel[];
  apiKey?: string;
  dryRun?: boolean;
  force?: boolean;
  updateMode?: UpdateMode;
  now?: () => Date;
  signal?: AbortSignal;
  runtime?: Partial<UpdateProviderRuntime>;
};

export type UpdateProviderResult = {
  config: KraConfig;
  editablePath: string;
  updateState: UpdateState;
  generated: GeneratedRegistry;
  editable: EditableRegistry;
  metadataMatchSummary: MetadataMatchSummary;
};

const loadCommittedRegistry = (stateDir: string, providerId: string) => {
  const content = readCommittedText(stateDir, providerApiRegistryGitPath(providerId));
  if (!content) {
    return undefined;
  }

  return validateEditableRegistry(JSON.parse(content));
};

export type UpdateProviderRuntime = {
  now: () => Date;
  fetchProviderModels: typeof fetchProviderModels;
  readModelsMetadata: typeof readModelsMetadata;
};

const defaultUpdateProviderRuntime: UpdateProviderRuntime = {
  now: () => new Date(),
  fetchProviderModels,
  readModelsMetadata,
};

export type PreparedProviderUpdate = {
  sourceModels: DiscoveredModel[];
  modelsMetadata: Awaited<ReturnType<typeof readModelsMetadata>>;
  providerSnapshot: string;
  authSnapshot: string;
  signal?: AbortSignal;
  runtime: UpdateProviderRuntime;
};

const createUpdateRuntime = (
  now: (() => Date) | undefined,
  runtime: Partial<UpdateProviderRuntime> | undefined,
): UpdateProviderRuntime => ({
  ...defaultUpdateProviderRuntime,
  ...runtime,
  ...(now ? { now } : {}),
});

const authProviderSnapshot = (authPath: string, providerId: string): string => {
  return createDeterministicJsonSnapshot(readAuthConfig(authPath).providers[providerId] ?? null);
};

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted();
};

export const prepareProviderUpdate = async ({
  stateDir,
  providerId,
  models,
  apiKey,
  now,
  signal,
  runtime,
}: Pick<
  UpdateProviderOptions,
  'stateDir' | 'providerId' | 'models' | 'apiKey' | 'now' | 'signal' | 'runtime'
>): Promise<PreparedProviderUpdate> => {
  const safeProviderId = normalizeProviderId(providerId);
  const updateRuntime = createUpdateRuntime(now, runtime);
  throwIfAborted(signal);
  const store = createEditableRegistryStore(stateDir, safeProviderId);
  const config = readConfig(store.paths.configPath);
  const provider = config.providers[safeProviderId];

  if (!provider) {
    throw new Error(`Unknown provider: ${safeProviderId}`);
  }

  const authSnapshot = authProviderSnapshot(store.paths.authPath, safeProviderId);
  const { sourceModels, modelsMetadata } = await resolveProviderModelSource({
    provider,
    providerId: safeProviderId,
    authPath: store.paths.authPath,
    ...(models ? { models: structuredClone(models) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(signal ? { signal } : {}),
    runtime: updateRuntime,
  });

  return {
    sourceModels,
    modelsMetadata,
    providerSnapshot: createDeterministicJsonSnapshot(provider),
    authSnapshot,
    ...(signal ? { signal } : {}),
    runtime: updateRuntime,
  };
};

export const applyPreparedProviderUpdate = ({
  stateDir,
  providerId,
  prepared,
  dryRun = false,
  force = false,
  updateMode,
}: Pick<UpdateProviderOptions, 'stateDir' | 'providerId' | 'dryRun' | 'force' | 'updateMode'> & {
  prepared: PreparedProviderUpdate;
}): UpdateProviderResult => {
  const safeProviderId = normalizeProviderId(providerId);
  throwIfAborted(prepared.signal);
  const store = createEditableRegistryStore(stateDir, safeProviderId);
  const config = readConfig(store.paths.configPath);
  const provider = config.providers[safeProviderId];

  if (!provider) {
    throw new Error(`Unknown provider: ${safeProviderId}`);
  }

  if (createDeterministicJsonSnapshot(provider) !== prepared.providerSnapshot) {
    throw new Error(`Provider changed during update: ${safeProviderId}. Retry the update.`);
  }

  if (authProviderSnapshot(store.paths.authPath, safeProviderId) !== prepared.authSnapshot) {
    throw new Error(`Provider auth changed during update: ${safeProviderId}. Retry the update.`);
  }

  if (registryHasConflictMarkers(store.paths.apiPath, store.hasConflictMarkers)) {
    throw new Error(
      `api.json contains git conflict markers. Resolve ${store.paths.apiPath} manually before update.`,
    );
  }

  const transformConfig: TransformProviderConfig = {
    providerId: safeProviderId,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    type: provider.type,
    ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    ...(provider.npm ? { npm: provider.npm } : {}),
    ...(provider.fallbackContext ? { fallbackContext: provider.fallbackContext } : {}),
    ...(provider.include ? { include: provider.include } : {}),
    ...(provider.exclude ? { exclude: provider.exclude } : {}),
    ...(provider.overrides ? { overrides: provider.overrides } : {}),
    ...(prepared.modelsMetadata ? { modelsMetadata: prepared.modelsMetadata } : {}),
  };
  if (provider.fallbackToolCall !== undefined) {
    transformConfig.fallbackToolCall = provider.fallbackToolCall;
  }

  const transformResult = transformDiscoveredModelsToRegistryDetailed({
    config: transformConfig,
    models: prepared.sourceModels,
  });
  throwIfAborted(prepared.signal);
  const generated = transformResult.registry;

  const oldGenerated =
    store.loadProviderState()?.lastGeneratedRegistry ??
    loadCommittedRegistry(stateDir, safeProviderId) ??
    generated;
  const currentEditable = store.loadLastKnownGoodRegistry() ?? generated;
  const shouldOverwrite =
    force ||
    updateMode === 'overwrite' ||
    (updateMode === undefined && provider.updateMode === 'overwrite') ||
    (updateMode === undefined &&
      provider.updateMode === undefined &&
      config.update.mode === 'overwrite');
  const mergeResult = shouldOverwrite
    ? { editable: generated, conflicts: [] }
    : store.mergeEditableRegistry({
        oldGenerated,
        currentEditable,
        newGenerated: generated,
        ...(provider.preserveUnknownModels ? { preserveUnknownModels: true } : {}),
      });

  const updateState = {
    updatedAt: prepared.runtime.now().toISOString(),
    lastUpdateStatus: 'ok' as const,
    warnings: mergeResult.conflicts.map(
      (conflict) =>
        `Conflict preserved at ${conflict.providerId}/${conflict.modelId}.${conflict.field}`,
    ),
    errors: [],
    conflicts: mergeResult.conflicts,
  };

  if (!dryRun) {
    throwIfAborted(prepared.signal);
    store.writeModelsSnapshot(prepared.sourceModels);
    throwIfAborted(prepared.signal);
    store.writeRegistryArtifacts(generated, mergeResult.editable, updateState);
  }

  return {
    config,
    editablePath: store.paths.apiPath,
    updateState,
    generated,
    editable: mergeResult.editable,
    metadataMatchSummary: transformResult.metadataMatchSummary,
  };
};

export const updateProvider = async ({
  stateDir,
  providerId,
  models,
  apiKey,
  dryRun = false,
  force = false,
  updateMode,
  now,
  signal,
  runtime,
}: UpdateProviderOptions): Promise<UpdateProviderResult> => {
  const safeProviderId = normalizeProviderId(providerId);
  const prepared = await prepareProviderUpdate({
    stateDir,
    providerId: safeProviderId,
    ...(models ? { models } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(now ? { now } : {}),
    ...(signal ? { signal } : {}),
    ...(runtime ? { runtime } : {}),
  });
  return applyPreparedProviderUpdate({
    stateDir,
    providerId: safeProviderId,
    prepared,
    ...(dryRun ? { dryRun: true } : {}),
    ...(force ? { force: true } : {}),
    ...(updateMode ? { updateMode } : {}),
  });
};
