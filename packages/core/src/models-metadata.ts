import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { writeAtomicText } from './atomic-file';
import {
  assertOkResponse,
  currentFetchImplementation,
  fetchResponseBody,
  formatNetworkError,
  logNetworkWarning,
  readJsonResponse,
} from './fetch-client';
import { serializeDeterministicJson } from './json';
import { parseModelsMetadata } from './transform';
import { isUnknownRecord } from './type-guards';

export const DEFAULT_MODELS_METADATA_URL = 'https://models.dev/models.json';
const MODELS_METADATA_CACHE_TTL_MS = 5 * 60_000;
const defaultFetchImplementation = globalThis.fetch;

type ModelsMetadata = ReturnType<typeof parseModelsMetadata>;

type PersistentModelsMetadataCache = {
  source: typeof DEFAULT_MODELS_METADATA_URL;
  expiresAt: number;
  metadata: ModelsMetadata;
  etag?: string;
  lastModified?: string;
};

type RemoteModelsMetadataResult = {
  metadata: ModelsMetadata;
  etag?: string;
  lastModified?: string;
};

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

const persistentModelsMetadataCachePath = (): string =>
  resolve(homedir(), '.kimi-registry-adapter', 'cache', 'models-metadata.json');

const readPersistentModelsMetadataCache = (): PersistentModelsMetadataCache | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(persistentModelsMetadataCachePath(), 'utf8'));
    if (
      !isUnknownRecord(value) ||
      value['source'] !== DEFAULT_MODELS_METADATA_URL ||
      typeof value['expiresAt'] !== 'number'
    ) {
      return undefined;
    }

    return {
      source: DEFAULT_MODELS_METADATA_URL,
      expiresAt: value['expiresAt'],
      metadata: parseModelsMetadata(value['metadata']),
      ...(typeof value['etag'] === 'string' ? { etag: value['etag'] } : {}),
      ...(typeof value['lastModified'] === 'string' ? { lastModified: value['lastModified'] } : {}),
    };
  } catch {
    return undefined;
  }
};

const writePersistentModelsMetadataCache = (cache: PersistentModelsMetadataCache): void => {
  try {
    writeAtomicText(persistentModelsMetadataCachePath(), serializeDeterministicJson(cache));
  } catch {
    // A cache write must never fail provider updates.
  }
};

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
  persistent?: PersistentModelsMetadataCache,
): Promise<RemoteModelsMetadataResult> => {
  throwIfAborted(signal);
  const headers: Record<string, string> = {};
  if (persistent?.etag) {
    headers['If-None-Match'] = persistent.etag;
  }
  if (persistent?.lastModified) {
    headers['If-Modified-Since'] = persistent.lastModified;
  }

  return fetchResponseBody(
    source,
    {
      headers,
      operation: 'Fetch models metadata',
      ...(signal ? { signal } : {}),
    },
    async (response) => {
      if (response.status === 304 && persistent) {
        return {
          metadata: persistent.metadata,
          ...(persistent.etag ? { etag: persistent.etag } : {}),
          ...(persistent.lastModified ? { lastModified: persistent.lastModified } : {}),
        };
      }

      assertOkResponse(response, 'Failed to fetch models metadata');
      const metadata = parseModelsMetadata(
        await readJsonResponse(response, 'Fetch models metadata'),
      );
      const etag = response.headers?.get?.('etag') ?? null;
      const lastModified = response.headers?.get?.('last-modified') ?? null;
      return {
        metadata,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
      };
    },
  );
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

    const mayUsePersistentCache =
      source === DEFAULT_MODELS_METADATA_URL && fetchRef === defaultFetchImplementation;
    const persistent = mayUsePersistentCache ? readPersistentModelsMetadataCache() : undefined;
    if (persistent && persistent.expiresAt > Date.now()) {
      modelsMetadataCache.set(source, {
        kind: 'remote',
        fetchRef,
        expiresAt: persistent.expiresAt,
        metadata: persistent.metadata,
      });
      return persistent.metadata;
    }

    const inFlight = signal ? undefined : modelsMetadataInFlight.get(source);
    if (inFlight?.fetchRef === fetchRef) {
      return inFlight.promise;
    }

    const promise = readRemoteModelsMetadata(source, signal, persistent)
      .then((result) => {
        const expiresAt = Date.now() + MODELS_METADATA_CACHE_TTL_MS;
        modelsMetadataCache.set(source, {
          kind: 'remote',
          fetchRef,
          expiresAt,
          metadata: result.metadata,
        });
        if (mayUsePersistentCache) {
          writePersistentModelsMetadataCache({
            source: DEFAULT_MODELS_METADATA_URL,
            expiresAt,
            metadata: result.metadata,
            ...(result.etag ? { etag: result.etag } : {}),
            ...(result.lastModified ? { lastModified: result.lastModified } : {}),
          });
        }
        return result.metadata;
      })
      .catch((error: unknown) => {
        throwIfAborted(signal);
        logNetworkWarning(
          `${formatNetworkError(error, 'models metadata unavailable')}. Continuing without remote metadata.`,
        );
        if (cached?.kind === 'remote') {
          return cached.metadata;
        }
        if (persistent) {
          return persistent.metadata;
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
