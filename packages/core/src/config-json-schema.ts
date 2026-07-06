import * as z from 'zod/mini';

import { configSchema } from './config';

export type JsonSchemaObject = {
  [key: string]: unknown;
  properties?: Record<string, JsonSchemaObject>;
  additionalProperties?: JsonSchemaObject | boolean;
  oneOf?: JsonSchemaObject[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  items?: JsonSchemaObject;
  required?: string[];
  title?: string;
  type?: string;
  $id?: string;
  $schema?: string | undefined;
};

const asObject = (value: unknown, path: string): JsonSchemaObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected generated schema object at ${path}.`);
  }
  return value as JsonSchemaObject;
};

const providerProperties = (schema: JsonSchemaObject): Record<string, JsonSchemaObject> => {
  const providers = asObject(schema.properties?.['providers'], 'properties.providers');
  const provider = providers.additionalProperties;
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    throw new Error('Expected generated provider schema.');
  }
  const properties = provider.properties;
  if (!properties) {
    throw new Error('Expected generated provider properties.');
  }
  return properties;
};

const addGeneratedSchemaMetadata = (generated: JsonSchemaObject): JsonSchemaObject => {
  const properties = generated.properties;
  if (!properties) {
    throw new Error('Expected generated top-level properties.');
  }

  asObject(properties['$schema'], 'properties.$schema').description =
    'Path or URL to the JSON Schema for this config file';

  const provider = providerProperties(generated);
  const modelSource = asObject(provider['modelSource'], 'provider.modelSource');
  const remoteUrl = modelSource.oneOf?.find(
    (candidate) =>
      asObject(candidate.properties?.['kind'], 'modelSource.kind').const === 'remote_url',
  );
  if (!remoteUrl) {
    throw new Error('Expected generated remote_url model source schema.');
  }
  const auth = asObject(remoteUrl.properties?.['auth'], 'remote_url.auth');
  auth.default = 'none';
  auth.description =
    "Credential policy for remote payload fetching. Use provider only when the remote URL is trusted to receive this provider's API key.";

  asObject(provider['preserveUnknownModels'], 'provider.preserveUnknownModels').description =
    'Keep locally added models during merge updates even when they are absent from the latest generated registry';

  const { $schema, ...rest } = generated;
  return {
    $schema,
    $id: 'https://github.com/ayu-exorcist/kimi-registry-adapter/schemas/config.schema.json',
    title: 'kimi-registry-adapter config',
    ...rest,
    required: [],
  };
};

export const generateConfigJsonSchema = (): JsonSchemaObject => {
  return addGeneratedSchemaMetadata(
    z.toJSONSchema(configSchema, { target: 'draft-2020-12', io: 'input' }) as JsonSchemaObject,
  );
};

export const serializeConfigJsonSchema = (schema = generateConfigJsonSchema()): string => {
  return `${JSON.stringify(schema, null, 2)}\n`;
};
