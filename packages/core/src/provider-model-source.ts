import { existsSync, readFileSync } from 'node:fs';

import { readAuthConfig, resolveProviderApiKey } from './auth';
import type { KraConfig, ProviderConfig } from './config';
import {
  createBusinessFetchError,
  createParseFetchError,
  KraFetchError,
  fetchResponse,
  readJsonResponse,
  readTextResponse,
} from './fetch-client';
import {
  parseDiscoveredModels,
  readModelsPayload,
  readModelsPayloadContent,
  type DiscoveredModel,
  type ModelsPayload,
} from './model-payload';
import {
  DEFAULT_MODELS_METADATA_URL,
  clearModelsMetadataCache,
  readModelsMetadata,
} from './models-metadata';
import {
  defaultModelSourceKindForProvider,
  deriveDefaultProviderModelsUrl,
  getProviderDescriptor,
} from './provider-descriptor';
import { normalizeProviderId } from './provider-id';

export {
  DEFAULT_MODELS_METADATA_URL,
  clearModelsMetadataCache,
  readModelsMetadata,
  readModelsPayload,
  readModelsPayloadContent,
  type DiscoveredModel,
};

type ModelSourceConfig = ProviderConfig['modelSource'];
type ModelSourceKind = NonNullable<ModelSourceConfig>['kind'];

type DiscoveryContext = {
  provider: KraConfig['providers'][string];
  providerId: string;
  apiKey?: string;
  signal?: AbortSignal;
};

type DiscoveryHandler = (context: DiscoveryContext) => Promise<DiscoveredModel[]>;

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted();
};

export const resolveModelsUrl = (baseUrl: string, modelsUrl?: string): string =>
  deriveDefaultProviderModelsUrl('openai', baseUrl, modelsUrl);

export const fetchOpenAiModelsPayload = async (
  baseUrl: string,
  modelsUrl?: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> => {
  const descriptor = getProviderDescriptor('openai');
  throwIfAborted(signal);
  const response = await fetchResponse(descriptor.defaultModelsUrl(baseUrl, modelsUrl), {
    headers: descriptor.discovery.headers(apiKey),
    operation: descriptor.discovery.operation,
    ...(signal ? { signal } : {}),
  });

  assertOkResponse(response, 'Failed to fetch models');

  const payload = await readJsonResponse<ModelsPayload>(response, descriptor.discovery.operation);
  return parseDiscoveredModels(Array.isArray(payload) ? payload : (payload.data ?? []));
};

export const fetchAnthropicModelsPayload = async (
  baseUrl: string,
  modelsUrl?: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> => {
  const descriptor = getProviderDescriptor('anthropic');
  throwIfAborted(signal);
  const response = await fetchResponse(descriptor.defaultModelsUrl(baseUrl, modelsUrl), {
    headers: descriptor.discovery.headers(apiKey),
    operation: descriptor.discovery.operation,
    ...(signal ? { signal } : {}),
  });

  assertOkResponse(response, 'Failed to fetch models');

  const payload = await readJsonResponse<ModelsPayload>(response, descriptor.discovery.operation);
  return parseDiscoveredModels(Array.isArray(payload) ? payload : (payload.data ?? []));
};

const assertOkResponse = (response: Response, message: string): void => {
  if (!response.ok) {
    throw createBusinessFetchError(`${message}: ${response.status}`, {
      url: response.url,
      status: response.status,
    });
  }
};

const fetchRemoteModelsPayload = async (
  url: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> => {
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchResponse(url, {
    headers,
    operation: 'Fetch remote models payload',
    ...(signal ? { signal } : {}),
  });

  assertOkResponse(response, 'Failed to fetch models');

  try {
    return readModelsPayloadContent(
      await readTextResponse(response, 'Fetch remote models payload'),
    );
  } catch (error) {
    if (error instanceof KraFetchError) {
      throw error;
    }
    throw createParseFetchError('Fetch remote models payload failed: invalid models payload.', {
      url: response.url,
      cause: error,
    });
  }
};

export const fetchModelsPayload = fetchOpenAiModelsPayload;

const getAuthFailureHint = (providerId: string): string => {
  return [
    `Upstream model discovery requires authentication for provider "${providerId}".`,
    'Set it with:',
    `  kra auth ${providerId} --api-key <key>`,
    'or:',
    `  kra auth ${providerId} --api-key-env <ENV_NAME>`,
  ].join('\n');
};

const resolveProviderModelSourceConfig = (
  provider: ProviderConfig,
): NonNullable<ModelSourceConfig> => {
  if (provider.modelSource) {
    return provider.modelSource;
  }

  return {
    kind: defaultModelSourceKindForProvider(provider.type),
  };
};

const discoveryHandlers: Record<ModelSourceKind, DiscoveryHandler> = {
  openai_models: async ({ provider, apiKey, signal }) => {
    const source = provider.modelSource;
    if (!source || source.kind !== 'openai_models') {
      throw new Error('Invalid openai_models modelSource configuration.');
    }

    return fetchOpenAiModelsPayload(provider.baseUrl, source.modelsUrl, apiKey, signal);
  },
  anthropic_models: async ({ provider, apiKey, signal }) => {
    const source = provider.modelSource;
    if (!source || source.kind !== 'anthropic_models') {
      throw new Error('Invalid anthropic_models modelSource configuration.');
    }

    return fetchAnthropicModelsPayload(provider.baseUrl, source.modelsUrl, apiKey, signal);
  },
  local_file: async ({ provider, signal }) => {
    const source = provider.modelSource;
    if (!source || source.kind !== 'local_file') {
      throw new Error('Invalid local_file modelSource configuration.');
    }

    throwIfAborted(signal);
    return readModelsPayload(source.path);
  },
  remote_url: async ({ provider, apiKey, signal }) => {
    const source = provider.modelSource;
    if (!source || source.kind !== 'remote_url') {
      throw new Error('Invalid remote_url modelSource configuration.');
    }

    return fetchRemoteModelsPayload(
      source.url,
      source.auth === 'provider' ? apiKey : undefined,
      signal,
    );
  },
};

export const fetchProviderModels = async (
  provider: KraConfig['providers'][string],
  providerId: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> => {
  const safeProviderId = normalizeProviderId(providerId);
  try {
    throwIfAborted(signal);
    const source = resolveProviderModelSourceConfig(provider);
    const handler = discoveryHandlers[source.kind];
    return await handler({
      provider: { ...provider, modelSource: source },
      providerId: safeProviderId,
      ...(apiKey ? { apiKey } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown fetch error';

    if (error instanceof KraFetchError && (error.status === 401 || error.status === 403)) {
      throw new Error(`${message}\n${getAuthFailureHint(safeProviderId)}`, { cause: error });
    }

    throw error;
  }
};

export type ProviderModelSourceRuntime = {
  fetchProviderModels: typeof fetchProviderModels;
  readModelsMetadata: typeof readModelsMetadata;
};

export type ResolveProviderModelSourceInput = {
  provider: KraConfig['providers'][string];
  providerId: string;
  authPath: string;
  models?: DiscoveredModel[];
  apiKey?: string;
  signal?: AbortSignal;
  runtime: ProviderModelSourceRuntime;
};

export type ResolveProviderModelSourceResult = {
  sourceModels: DiscoveredModel[];
  modelsMetadata: Awaited<ReturnType<typeof readModelsMetadata>>;
};

export const resolveProviderModelSource = async ({
  provider,
  providerId,
  authPath,
  models,
  apiKey,
  signal,
  runtime,
}: ResolveProviderModelSourceInput): Promise<ResolveProviderModelSourceResult> => {
  const safeProviderId = normalizeProviderId(providerId);
  throwIfAborted(signal);
  const resolvedApiKey =
    apiKey ?? resolveProviderApiKey(readAuthConfig(authPath), safeProviderId, provider.apiKeyEnv);
  const sourceModels = models
    ? parseDiscoveredModels(models)
    : await runtime.fetchProviderModels(provider, safeProviderId, resolvedApiKey, signal);
  throwIfAborted(signal);
  const modelsMetadata = await runtime.readModelsMetadata(
    provider.modelsMetadataPath ?? DEFAULT_MODELS_METADATA_URL,
    signal,
  );

  return { sourceModels, modelsMetadata };
};

export const registryHasConflictMarkers = (
  filePath: string,
  hasConflictMarkers: (content: string) => boolean,
): boolean => {
  return existsSync(filePath) && hasConflictMarkers(readFileSync(filePath, 'utf8'));
};
