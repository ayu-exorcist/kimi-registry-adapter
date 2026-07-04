import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  providerModelEndpointSourceKinds,
  providerTypes,
  type ProviderModelEndpointSourceKind,
  type ProviderType,
} from '../src/internal';

type JsonSchemaObject = {
  properties?: Record<string, JsonSchemaObject>;
  additionalProperties?: JsonSchemaObject | boolean;
  oneOf?: JsonSchemaObject[];
  enum?: unknown[];
  const?: unknown;
};

const readConfigSchema = (): JsonSchemaObject => {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'schemas/config.schema.json'), 'utf8'),
  ) as JsonSchemaObject;
};

const providerProperties = (schema: JsonSchemaObject): Record<string, JsonSchemaObject> => {
  const providers = schema.properties?.['providers'];
  const provider = providers?.additionalProperties;
  if (!provider || typeof provider === 'boolean' || !provider.properties) {
    throw new Error('Invalid config schema providers shape.');
  }
  return provider.properties;
};

describe('config JSON schema consistency', () => {
  it('keeps provider type enum in sync with provider descriptors', () => {
    const providerTypeSchema = providerProperties(readConfigSchema())['type'];

    expect(providerTypeSchema?.enum?.toSorted()).toEqual(
      [...providerTypes].toSorted() satisfies ProviderType[],
    );
  });

  it('keeps endpoint model source enum in sync with provider descriptors', () => {
    const modelSourceSchema = providerProperties(readConfigSchema())['modelSource'];
    const endpointModelSourceSchema = modelSourceSchema?.oneOf?.find((candidate) =>
      candidate.properties?.['kind']?.enum?.includes('openai_models'),
    );

    expect(endpointModelSourceSchema?.properties?.['kind']?.enum?.toSorted()).toEqual(
      [...providerModelEndpointSourceKinds].toSorted() satisfies ProviderModelEndpointSourceKind[],
    );
  });

  it('documents the remote_url credential policy', () => {
    const modelSourceSchema = providerProperties(readConfigSchema())['modelSource'];
    const remoteUrlSchema = modelSourceSchema?.oneOf?.find(
      (candidate) => candidate.properties?.['kind']?.const === 'remote_url',
    );

    expect(remoteUrlSchema?.properties?.['auth']?.enum).toEqual(['none', 'provider']);
    expect(remoteUrlSchema?.properties?.['auth']).toMatchObject({ default: 'none' });
  });
});
