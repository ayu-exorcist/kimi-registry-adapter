import { readFileSync } from 'node:fs';

import { isUnknownRecord } from './type-guards';

export type DiscoveredModel = {
  id: string;
  name?: string;
  family?: string;
  context_length?: number;
  max_output_tokens?: number;
  tool_call?: boolean;
  reasoning?: boolean;
  interleaved?: boolean;
  modalities?: import('./model-capability').ModelModalities;
  [key: string]: unknown;
};

export type ModelsPayload = { data?: unknown[] } | unknown[];

export const toDiscoveredModel = (value: unknown): DiscoveredModel | undefined => {
  if (!isUnknownRecord(value)) {
    return undefined;
  }

  const record = value;
  const id =
    typeof record['id'] === 'string' && record['id'].trim().length > 0
      ? record['id'].trim()
      : undefined;
  if (!id) {
    return undefined;
  }

  return {
    ...record,
    id,
  };
};

export const parseDiscoveredModels = (values: unknown[]): DiscoveredModel[] => {
  return values
    .map((value) => toDiscoveredModel(value))
    .filter((value): value is DiscoveredModel => value !== undefined);
};

const parseModelsPayload = (value: unknown): ModelsPayload => {
  if (Array.isArray(value)) {
    return value;
  }

  if (isUnknownRecord(value) && (value['data'] === undefined || Array.isArray(value['data']))) {
    return value;
  }

  return [];
};

export const readModelsPayloadContent = (content: string): DiscoveredModel[] => {
  const payload = parseModelsPayload(JSON.parse(content));
  if (Array.isArray(payload)) {
    return parseDiscoveredModels(payload);
  }

  return parseDiscoveredModels(payload.data ?? []);
};

export const readModelsPayload = (filePath: string): DiscoveredModel[] => {
  return readModelsPayloadContent(readFileSync(filePath, 'utf8'));
};
