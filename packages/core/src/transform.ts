import * as z from 'zod/mini';

import type { ProviderConfig } from './config';
import {
  inferEditableModel,
  type ModelModalities,
  type ModelsMetadataEntry,
} from './model-capability';
import { allowedMetadataModalities } from './model-capability-definition';
import type { ProviderType } from './provider-descriptor';
import { normalizeProviderId } from './provider-id';
import { sourceModelSchema, type GeneratedRegistry, type SourceModel } from './schema';
import type { Modality } from './schema-primitives';
import { isUnknownRecord } from './type-guards';

const isMetadataModality = (value: unknown): value is Modality => {
  return typeof value === 'string' && allowedMetadataModalities.has(value);
};

const sanitizeMetadataModalities = (value: unknown): ModelModalities | undefined => {
  if (!isUnknownRecord(value)) {
    return undefined;
  }

  const input = Array.isArray(value['input'])
    ? value['input'].filter(isMetadataModality)
    : undefined;
  const output = Array.isArray(value['output'])
    ? value['output'].filter(isMetadataModality)
    : undefined;

  if ((!input || input.length === 0) && (!output || output.length === 0)) {
    return undefined;
  }

  return {
    ...(input && input.length > 0 ? { input } : {}),
    ...(output && output.length > 0 ? { output } : {}),
  };
};

const sanitizeMetadataEntry = (value: unknown): ModelsMetadataEntry | undefined => {
  if (!isUnknownRecord(value)) {
    return undefined;
  }

  const entry = value;
  const id =
    typeof entry['id'] === 'string' && entry['id'].trim().length > 0 ? entry['id'] : undefined;

  if (!id) {
    return undefined;
  }

  const rawLimit = entry['limit'];
  const rawLimitRecord = isUnknownRecord(rawLimit) ? rawLimit : undefined;
  const limit = rawLimitRecord
    ? {
        ...(typeof rawLimitRecord['context'] === 'number' &&
        Number.isInteger(rawLimitRecord['context']) &&
        rawLimitRecord['context'] > 0
          ? { context: rawLimitRecord['context'] }
          : {}),
        ...(typeof rawLimitRecord['output'] === 'number' &&
        Number.isInteger(rawLimitRecord['output']) &&
        rawLimitRecord['output'] > 0
          ? { output: rawLimitRecord['output'] }
          : {}),
      }
    : undefined;
  const modalities = sanitizeMetadataModalities(entry['modalities']);

  return {
    id,
    ...(typeof entry['name'] === 'string' && entry['name'].trim().length > 0
      ? { name: entry['name'] }
      : {}),
    ...(typeof entry['family'] === 'string' && entry['family'].trim().length > 0
      ? { family: entry['family'] }
      : {}),
    ...(limit && (limit.context || limit.output) ? { limit } : {}),
    ...(typeof entry['tool_call'] === 'boolean' ? { tool_call: entry['tool_call'] } : {}),
    ...(typeof entry['reasoning'] === 'boolean' ? { reasoning: entry['reasoning'] } : {}),
    ...(typeof entry['interleaved'] === 'boolean' ? { interleaved: entry['interleaved'] } : {}),
    ...(modalities ? { modalities } : {}),
  };
};

const modelsMetadataInputSchema = z.custom<Record<string, unknown>>(
  (candidate) => Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
  { message: 'models metadata must be an object' },
);

export const parseModelsMetadata = (value: unknown): Record<string, ModelsMetadataEntry> => {
  const metadata = modelsMetadataInputSchema.parse(value);

  const out: Record<string, ModelsMetadataEntry> = {};
  for (const [key, raw] of Object.entries(metadata)) {
    const parsed = sanitizeMetadataEntry(raw);
    if (parsed) {
      out[key] = parsed;
    }
  }
  return out;
};

export type TransformProviderConfig = {
  providerId: string;
  providerName: string;
  baseUrl: string;
  type: ProviderType;
  apiKeyEnv?: string;
  npm?: string;
  fallbackContext?: number;
  fallbackToolCall?: boolean;
  include?: string[];
  exclude?: string[];
  overrides?: ProviderConfig['overrides'];
  modelsMetadata?: Record<string, ModelsMetadataEntry>;
};

export type TransformInput = {
  config: TransformProviderConfig;
  models: SourceModel[];
};

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'iu');
};

const compilePatterns = (patterns: string[]): RegExp[] => patterns.map(wildcardToRegExp);

const matchesPatterns = (value: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(value));
};

const shouldIncludeModel = (modelId: string, include: RegExp[], exclude: RegExp[]): boolean => {
  if (!matchesPatterns(modelId, include)) {
    return false;
  }

  return !matchesPatterns(modelId, exclude);
};

export type MetadataMatchSummary = {
  exact: number;
  normalized: number;
  unmatched: number;
};

export type TransformResult = {
  registry: GeneratedRegistry;
  metadataMatchSummary: MetadataMatchSummary;
};

const normalizeModelId = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^/]+\//u, '');
};

type MetadataIndex = Map<string, ModelsMetadataEntry | undefined>;

const createMetadataIndex = (
  modelsMetadata: Record<string, ModelsMetadataEntry> | undefined,
): MetadataIndex => {
  const index = new Map<string, ModelsMetadataEntry | undefined>();
  if (!modelsMetadata) {
    return index;
  }

  for (const [candidateId, metadataModel] of Object.entries(modelsMetadata)) {
    const normalizedId = normalizeModelId(candidateId);
    if (index.has(normalizedId)) {
      index.set(normalizedId, undefined);
      continue;
    }
    index.set(normalizedId, metadataModel);
  }
  return index;
};

const findMetadataModel = (
  modelId: string,
  modelsMetadata: Record<string, ModelsMetadataEntry> | undefined,
  metadataIndex: MetadataIndex,
): {
  model: ModelsMetadataEntry | undefined;
  matchType: keyof Omit<MetadataMatchSummary, 'unmatched'> | 'unmatched';
} => {
  if (!modelsMetadata) {
    return { model: undefined, matchType: 'unmatched' };
  }

  const exact = modelsMetadata[modelId];
  if (exact) {
    return { model: exact, matchType: 'exact' };
  }

  const normalized = metadataIndex.get(normalizeModelId(modelId));
  if (!normalized) {
    return { model: undefined, matchType: 'unmatched' };
  }

  return { model: normalized, matchType: 'normalized' };
};

const DEFAULT_MODEL_INCLUDE_PATTERNS = ['*'];
const DEFAULT_MODEL_EXCLUDE_PATTERNS = ['*embedding*', '*embed*', '*rerank*', '*tts*', '*whisper*'];
const DEFAULT_FALLBACK_CONTEXT = 131072;
const DEFAULT_FALLBACK_TOOL_CALL = false;

export const transformDiscoveredModelsToRegistryDetailed = ({
  config,
  models,
}: TransformInput): TransformResult => {
  const providerId = normalizeProviderId(config.providerId);
  const include = compilePatterns(config.include ?? DEFAULT_MODEL_INCLUDE_PATTERNS);
  const exclude = compilePatterns(config.exclude ?? DEFAULT_MODEL_EXCLUDE_PATTERNS);
  const overrides = config.overrides ?? {};
  const metadataIndex = createMetadataIndex(config.modelsMetadata);
  const parsedModels = models
    .map((item) => sourceModelSchema.parse(item))
    .filter((model) => shouldIncludeModel(model.id, include, exclude));
  const metadataMatchSummary: MetadataMatchSummary = {
    exact: 0,
    normalized: 0,
    unmatched: 0,
  };

  return {
    registry: {
      [providerId]: {
        id: providerId,
        name: config.providerName,
        api: config.baseUrl,
        type: config.type,
        ...(config.apiKeyEnv ? { env: [config.apiKeyEnv] } : {}),
        ...(config.npm ? { npm: config.npm } : {}),
        models: Object.fromEntries(
          parsedModels.map((model) => {
            const metadataMatch = findMetadataModel(model.id, config.modelsMetadata, metadataIndex);
            metadataMatchSummary[metadataMatch.matchType] += 1;

            return [
              model.id,
              inferEditableModel({
                model,
                fallbackContext: config.fallbackContext ?? DEFAULT_FALLBACK_CONTEXT,
                fallbackToolCall: config.fallbackToolCall ?? DEFAULT_FALLBACK_TOOL_CALL,
                metadataModel: metadataMatch.model,
                override: overrides[model.id],
              }),
            ];
          }),
        ),
      },
    },
    metadataMatchSummary,
  };
};

export const transformDiscoveredModelsToRegistry = ({
  config,
  models,
}: TransformInput): GeneratedRegistry => {
  return transformDiscoveredModelsToRegistryDetailed({ config, models }).registry;
};

export const transformOpenAiModelsToRegistryDetailed = transformDiscoveredModelsToRegistryDetailed;
export const transformOpenAiModelsToRegistry = transformDiscoveredModelsToRegistry;
