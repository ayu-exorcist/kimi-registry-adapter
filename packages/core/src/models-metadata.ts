import { readFileSync, statSync } from 'node:fs';

import {
  assertOkResponse,
  currentFetchImplementation,
  fetchResponse,
  formatNetworkError,
  logNetworkWarning,
  readJsonResponse,
} from './fetch-client';
import { parseModelsMetadata } from './transform';

export const DEFAULT_MODELS_METADATA_URL = 'https://models.dev/models.json';
const MODELS_METADATA_CACHE_TTL_MS = 5 * 60_000;

type ModelsMetadata = ReturnType<typeof parseModelsMetadata>;

type ModelsMetadataCacheEntry =
  | {
      kind: 'remote';
      fetchRef: typeof fetch;
      expiresAt: number;
      metadata: ModelsMetadata;
    }
  | {
      kind: 'local';
      signature: string;
      metadata: ModelsMetadata;
    };

type ModelsMetadataInFlightEntry = {
  fetchRef: typeof fetch;
  promise: Promise<ModelsMetadata>;
};

const modelsMetadataCache = new Map<string, ModelsMetadataCacheEntry>();
const modelsMetadataInFlight = new Map<string, ModelsMetadataInFlightEntry>();

export const clearModelsMetadataCache = (): void => {
  modelsMetadataCache.clear();
  modelsMetadataInFlight.clear();
};

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted();
};

const readRemoteModelsMetadata = async (
  source: string,
  signal?: AbortSignal,
): Promise<ModelsMetadata> => {
  throwIfAborted(signal);
  const response = await fetchResponse(source, {
    operation: 'Fetch models metadata',
    ...(signal ? { signal } : {}),
  });

  assertOkResponse(response, 'Failed to fetch models metadata');

  return parseModelsMetadata(await readJsonResponse(response, 'Fetch models metadata'));
};

export const readModelsMetadata = async (
  source: string,
  signal?: AbortSignal,
): Promise<ModelsMetadata> => {
  throwIfAborted(signal);
  if (/^https?:\/\//iu.test(source)) {
    const fetchRef = currentFetchImplementation();
    const cached = modelsMetadataCache.get(source);
    if (
      cached?.kind === 'remote' &&
      cached.fetchRef === fetchRef &&
      cached.expiresAt > Date.now()
    ) {
      return cached.metadata;
    }

    const inFlight = signal ? undefined : modelsMetadataInFlight.get(source);
    if (inFlight?.fetchRef === fetchRef) {
      return inFlight.promise;
    }

    const promise = readRemoteModelsMetadata(source, signal)
      .then((metadata) => {
        modelsMetadataCache.set(source, {
          kind: 'remote',
          fetchRef,
          expiresAt: Date.now() + MODELS_METADATA_CACHE_TTL_MS,
          metadata,
        });
        return metadata;
      })
      .catch((error: unknown) => {
        throwIfAborted(signal);
        logNetworkWarning(
          `${formatNetworkError(error, 'models metadata unavailable')}. Continuing without remote metadata.`,
        );
        if (cached?.kind === 'remote') {
          return cached.metadata;
        }
        return {};
      });
    if (!signal) {
      modelsMetadataInFlight.set(source, { fetchRef, promise });
    }

    try {
      return await promise;
    } finally {
      if (!signal && modelsMetadataInFlight.get(source)?.promise === promise) {
        modelsMetadataInFlight.delete(source);
      }
    }
  }

  throwIfAborted(signal);
  const fileStat = statSync(source);
  const signature = `${fileStat.mtimeMs}:${fileStat.size}`;
  const cached = modelsMetadataCache.get(source);
  if (cached?.kind === 'local' && cached.signature === signature) {
    return cached.metadata;
  }

  throwIfAborted(signal);
  const metadata = parseModelsMetadata(JSON.parse(readFileSync(source, 'utf8')));
  modelsMetadataCache.set(source, { kind: 'local', signature, metadata });
  return metadata;
};
