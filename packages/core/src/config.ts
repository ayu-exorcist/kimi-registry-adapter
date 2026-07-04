import { readFileSync } from 'node:fs';

import { _default as zDefault } from 'zod/mini';
import * as z from 'zod/mini';

import { writeAtomicText, writeAtomicTextAsync } from './atomic-file';
import { DEFAULT_PROVIDER_TYPE, providerModelEndpointSourceKinds } from './provider-descriptor';
import { normalizeProviderId } from './provider-id';
import {
  modalitySchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  providerTypeSchema,
} from './schema-primitives';

const nonEmptyString = nonEmptyStringSchema;
const positiveInteger = positiveIntegerSchema;
const nonEmptyModalities = z.array(modalitySchema).check(z.minLength(1));

export const providerModelSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(providerModelEndpointSourceKinds),
    modelsUrl: z.optional(nonEmptyString),
  }),
  z.strictObject({
    kind: z.literal('local_file'),
    path: nonEmptyString,
  }),
  z.strictObject({
    kind: z.literal('remote_url'),
    url: nonEmptyString,
    auth: z.optional(z.enum(['none', 'provider'])),
  }),
]);

export const modelOverrideSchema = z.strictObject({
  id: z.optional(nonEmptyString),
  name: z.optional(nonEmptyString),
  family: z.optional(nonEmptyString),
  limit: z.optional(
    z.strictObject({
      context: z.optional(positiveInteger),
      output: z.optional(positiveInteger),
    }),
  ),
  tool_call: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  interleaved: z.optional(z.boolean()),
  modalities: z.optional(
    z.strictObject({
      input: z.optional(nonEmptyModalities),
      output: z.optional(nonEmptyModalities),
    }),
  ),
});

export const providerConfigSchema = z.strictObject({
  name: nonEmptyString,
  baseUrl: nonEmptyString,
  type: zDefault(providerTypeSchema, DEFAULT_PROVIDER_TYPE),
  modelSource: z.optional(providerModelSourceSchema),
  modelsMetadataPath: z.optional(nonEmptyString),
  apiKeyEnv: z.optional(nonEmptyString),
  updateMode: z.optional(z.enum(['merge', 'overwrite'])),
  preserveUnknownModels: z.optional(z.boolean()),
  npm: z.optional(nonEmptyString),
  fallbackContext: z.optional(positiveInteger),
  fallbackToolCall: z.optional(z.boolean()),
  include: z.optional(z.array(nonEmptyString)),
  exclude: z.optional(z.array(nonEmptyString)),
  overrides: z.optional(z.record(nonEmptyString, modelOverrideSchema)),
});

export const configSchema = z.strictObject({
  $schema: z.optional(nonEmptyString),
  server: zDefault(
    z.strictObject({
      host: zDefault(nonEmptyString, '127.0.0.1'),
      port: zDefault(positiveInteger, 2727),
    }),
    {
      host: '127.0.0.1',
      port: 2727,
    },
  ),
  update: zDefault(
    z.strictObject({
      mode: zDefault(z.enum(['merge', 'overwrite']), 'merge'),
    }),
    {
      mode: 'merge',
    },
  ),
  providers: zDefault(z.record(nonEmptyString, providerConfigSchema), {}),
});

export const CONFIG_SCHEMA_PATH =
  'https://raw.githubusercontent.com/ayu-exorcist/kimi-registry-adapter/refs/heads/main/schemas/config.schema.json';

export type ProviderModelSource = z.infer<typeof providerModelSourceSchema>;
export type ModelOverride = z.infer<typeof modelOverrideSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type KraConfig = z.infer<typeof configSchema>;

export const createDefaultConfig = (): KraConfig => {
  return configSchema.parse({
    $schema: CONFIG_SCHEMA_PATH,
    server: {
      host: '127.0.0.1',
      port: 2727,
    },
    update: {
      mode: 'merge',
    },
    providers: {},
  });
};

export const readConfig = (filePath: string): KraConfig => {
  return configSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
};

const prepareConfigForWrite = (config: KraConfig): KraConfig => {
  return configSchema.parse({
    ...config,
    $schema: config.$schema ?? CONFIG_SCHEMA_PATH,
  });
};

const serializeConfig = (config: KraConfig): string => `${JSON.stringify(config, null, 2)}\n`;

export const writeConfig = (filePath: string, config: KraConfig): KraConfig => {
  const parsed = prepareConfigForWrite(config);
  writeAtomicText(filePath, serializeConfig(parsed));
  return parsed;
};

export const writeConfigAsync = async (filePath: string, config: KraConfig): Promise<KraConfig> => {
  const parsed = prepareConfigForWrite(config);
  await writeAtomicTextAsync(filePath, serializeConfig(parsed));
  return parsed;
};

export const addProviderToConfig = (
  config: KraConfig,
  providerId: string,
  provider: ProviderConfig,
): KraConfig => {
  const safeProviderId = normalizeProviderId(providerId);
  return configSchema.parse({
    ...config,
    providers: {
      ...config.providers,
      [safeProviderId]: provider,
    },
  });
};

export const removeProviderFromConfig = (config: KraConfig, providerId: string): KraConfig => {
  const safeProviderId = normalizeProviderId(providerId);
  const { [safeProviderId]: _removed, ...providers } = config.providers;
  return configSchema.parse({
    ...config,
    providers,
  });
};
