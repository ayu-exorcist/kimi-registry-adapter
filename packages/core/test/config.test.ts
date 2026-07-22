import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addProviderToConfig,
  configSchema,
  createDefaultConfig,
  nonEmptyStringSchema,
  readConfig,
  writeConfig,
} from '../src/internal';
import type { JsonSchemaObject } from '../src/internal';
import { expectRecordValue } from './test-helpers';

const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'kra-config-'));

const readPublishedConfigSchema = (): JsonSchemaObject =>
  JSON.parse(
    readFileSync(new URL('../../../schemas/config.schema.json', import.meta.url), 'utf8'),
  ) as JsonSchemaObject;

const requireJsonSchemaObject = (
  value: boolean | JsonSchemaObject | undefined,
  description: string,
): JsonSchemaObject => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid published config schema: ${description}.`);
  }
  return value;
};

const sortedKeys = (value: Record<string, unknown> | undefined): string[] =>
  Object.keys(value ?? {}).toSorted((left, right) => left.localeCompare(right));

const publishedProviderProperties = (): Record<string, JsonSchemaObject> => {
  const schema = readPublishedConfigSchema();
  const providers = schema.properties?.['providers'];
  const providerSchema = requireJsonSchemaObject(
    providers?.additionalProperties,
    'provider additionalProperties must be an object',
  );
  if (!providerSchema.properties) {
    throw new Error('Invalid published config schema provider shape.');
  }
  return providerSchema.properties;
};

describe('config', () => {
  it('keeps schema defaults and string trimming stable', () => {
    expect(configSchema.parse({})).toEqual({
      server: {
        host: '127.0.0.1',
        port: 2727,
      },
      update: {
        mode: 'merge',
      },
      providers: {},
    });
    expect(nonEmptyStringSchema.parse('  provider  ')).toBe('provider');
    expect(() => nonEmptyStringSchema.parse('   ')).toThrow(/./u);
  });

  it('rejects unknown top-level config fields', () => {
    expect(() => configSchema.parse({ providers: {}, unknown: true })).toThrow(/./u);
  });

  it('keeps the published JSON schema aligned with provider config fields', () => {
    const schema = readPublishedConfigSchema();
    expect(sortedKeys(schema.properties)).toEqual(['$schema', 'providers', 'server', 'update']);
    expect(schema.required).toEqual([]);

    const providerProperties = publishedProviderProperties();
    expect(sortedKeys(providerProperties)).toEqual(
      [
        'apiKeyEnv',
        'baseUrl',
        'exclude',
        'fallbackContext',
        'fallbackToolCall',
        'include',
        'modelSource',
        'modelsMetadataPath',
        'name',
        'npm',
        'overrides',
        'preserveUnknownModels',
        'type',
        'updateMode',
      ].toSorted((left, right) => left.localeCompare(right)),
    );
    expect(providerProperties['updateMode']).toEqual({
      type: 'string',
      enum: ['merge', 'overwrite'],
    });
    expect(providerProperties['modelSource']?.oneOf).toHaveLength(3);
    const overrideSchema = requireJsonSchemaObject(
      providerProperties['overrides']?.additionalProperties,
      'overrides additionalProperties must be an object',
    );
    expect(overrideSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(overrideSchema.properties?.['modalities']?.properties?.['input']?.items?.enum).toEqual([
      'text',
      'image',
      'audio',
      'video',
    ]);
    expect(overrideSchema.properties?.['support_efforts']).toMatchObject({
      type: 'array',
      minItems: 1,
    });
    expect(overrideSchema.properties?.['support_efforts']?.items).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(overrideSchema.properties?.['default_effort']).toMatchObject({
      type: 'string',
      minLength: 1,
    });
  });

  it('creates, writes, and reads the default config', () => {
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'config.json');

    const config = writeConfig(filePath, createDefaultConfig());

    expect(config.providers).toEqual({});
    expect(readConfig(filePath)).toEqual(config);
  });

  it('adds a provider to config', () => {
    const tempDir = createTempDir();
    const filePath = join(tempDir, 'config.json');
    const config = writeConfig(filePath, createDefaultConfig());

    const nextConfig = addProviderToConfig(config, 'provider', {
      name: 'Provider',
      baseUrl: 'https://gateway.example.com/v1',
      modelSource: {
        kind: 'openai_models',
        modelsUrl: 'https://gateway.example.com/custom/models',
      },
      apiKeyEnv: 'PROVIDER_API_KEY',
      npm: '@ai-sdk/openai',
      type: 'openai',
      fallbackContext: 131072,
      fallbackToolCall: true,
      include: ['*'],
      exclude: ['*embedding*'],
      overrides: {},
    });

    writeConfig(filePath, nextConfig);

    expect(readFileSync(filePath, 'utf8')).toContain('"name": "Provider"');
    const savedProvider = expectRecordValue(readConfig(filePath).providers, 'provider');
    expect(savedProvider.baseUrl).toBe('https://gateway.example.com/v1');
    expect(savedProvider.modelSource).toEqual({
      kind: 'openai_models',
      modelsUrl: 'https://gateway.example.com/custom/models',
    });
    expect(savedProvider.apiKeyEnv).toBe('PROVIDER_API_KEY');
    expect(savedProvider.npm).toBe('@ai-sdk/openai');
  });

  it('rejects invalid effort overrides', () => {
    expect(() =>
      addProviderToConfig(createDefaultConfig(), 'provider', {
        name: 'Provider',
        baseUrl: 'https://gateway.example.com/v1',
        type: 'openai_responses',
        overrides: {
          'model-a': {
            support_efforts: ['low', '   '],
            default_effort: ' ',
          },
        },
      }),
    ).toThrow(/./u);
  });

  it('rejects override modalities that generated registries cannot use', () => {
    expect(() =>
      addProviderToConfig(createDefaultConfig(), 'provider', {
        name: 'Provider',
        baseUrl: 'https://gateway.example.com/v1',
        type: 'openai_responses',
        overrides: {
          'model-a': {
            modalities: {
              input: ['unsupported' as unknown as 'text'],
            },
          },
        },
      }),
    ).toThrow(/./u);
  });
});
