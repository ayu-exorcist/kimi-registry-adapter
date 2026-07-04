import { describe, expect, it } from 'vitest';

import { generateConfigJsonSchema, serializeConfigJsonSchema } from '../src/internal';

type JsonSchemaObject = {
  additionalProperties?: JsonSchemaObject | boolean;
  const?: unknown;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  oneOf?: JsonSchemaObject[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  title?: string;
  type?: string;
  $id?: string;
  $schema?: string;
};

const providerProperties = (schema: JsonSchemaObject): Record<string, JsonSchemaObject> => {
  const provider = schema.properties?.['providers']?.additionalProperties;
  if (!provider || typeof provider === 'boolean' || !provider.properties) {
    throw new Error('Invalid generated provider schema.');
  }
  return provider.properties;
};

describe('config JSON schema generator', () => {
  it('generates published schema metadata and provider descriptions from the runtime schema', () => {
    const schema = generateConfigJsonSchema() as JsonSchemaObject;

    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['$id']).toBe(
      'https://github.com/ayu-exorcist/kimi-registry-adapter/schemas/config.schema.json',
    );
    expect(schema.title).toBe('kimi-registry-adapter config');
    expect(schema.required).toEqual([]);
    expect(schema.properties?.['server']?.default).toEqual({ host: '127.0.0.1', port: 2727 });
    expect(schema.properties?.['$schema']?.description).toBe(
      'Path or URL to the JSON Schema for this config file',
    );

    const provider = providerProperties(schema);
    expect(provider['type']?.enum).toEqual(['anthropic', 'openai', 'openai_responses']);
    expect(provider['type']?.default).toBe('openai_responses');
    expect(provider['preserveUnknownModels']?.description).toMatch(/Keep locally added models/u);

    const remoteUrl = provider['modelSource']?.oneOf?.find(
      (candidate) => candidate.properties?.['kind']?.const === 'remote_url',
    );
    expect(remoteUrl?.properties?.['auth']).toMatchObject({
      default: 'none',
      enum: ['none', 'provider'],
      description: expect.stringContaining('trusted'),
    });
  });

  it('serializes deterministically with a trailing newline', () => {
    const serialized = serializeConfigJsonSchema();

    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized)).toEqual(generateConfigJsonSchema());
  });
});
