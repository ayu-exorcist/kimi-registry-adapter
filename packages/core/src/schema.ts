import * as z from 'zod/mini';

import {
  modalitySchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  providerTypeSchema,
} from './schema-primitives';

const nonEmptyString = nonEmptyStringSchema;
const positiveInteger = positiveIntegerSchema;
const namespacedKeyRegex = /^(x-[A-Za-z0-9._-]+)$/u;
const nonEmptyModalities = z.array(modalitySchema).check(z.minLength(1));

const limitSchema = z.strictObject({
  context: z.optional(positiveInteger),
  output: z.optional(positiveInteger),
});

const modalitiesSchema = z.strictObject({
  input: z.optional(nonEmptyModalities),
  output: z.optional(nonEmptyModalities),
});

const namespacedMetadataSchema = z.record(
  z.string().check(z.regex(namespacedKeyRegex)),
  z.unknown(),
);

export const sourceModelSchema = z.looseObject({
  id: nonEmptyString,
  name: z.optional(nonEmptyString),
  object: z.optional(z.string()),
  created: z.optional(z.int()),
  owned_by: z.optional(z.string()),
  context_length: z.optional(positiveInteger),
  max_context_length: z.optional(positiveInteger),
  max_context_tokens: z.optional(positiveInteger),
  max_model_len: z.optional(positiveInteger),
  model_context_window: z.optional(positiveInteger),
  context_window: z.optional(positiveInteger),
  input_token_limit: z.optional(positiveInteger),
  max_input_tokens: z.optional(positiveInteger),
  max_tokens: z.optional(positiveInteger),
  max_output_tokens: z.optional(positiveInteger),
  max_completion_tokens: z.optional(positiveInteger),
  output_token_limit: z.optional(positiveInteger),
  max_output: z.optional(positiveInteger),
  max_generated_tokens: z.optional(positiveInteger),
  completion_token_limit: z.optional(positiveInteger),
  family: z.optional(nonEmptyString),
  tool_call: z.optional(z.boolean()),
  supports_tool_calls: z.optional(z.boolean()),
  tools: z.optional(z.boolean()),
  function_calling: z.optional(z.boolean()),
  supports_function_calling: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  supports_reasoning: z.optional(z.boolean()),
  thinking: z.optional(z.boolean()),
  reasoning_supported: z.optional(z.boolean()),
  interleaved: z.optional(z.boolean()),
  supports_interleaved: z.optional(z.boolean()),
  modalities: z.optional(modalitiesSchema),
  architecture: z.optional(
    z.looseObject({
      input_modalities: z.optional(nonEmptyModalities),
      output_modalities: z.optional(nonEmptyModalities),
    }),
  ),
  capabilities: z.optional(
    z.looseObject({
      image_input: z.optional(z.boolean()),
      video_input: z.optional(z.boolean()),
      audio_input: z.optional(z.boolean()),
      image_output: z.optional(z.boolean()),
      audio_output: z.optional(z.boolean()),
      tool_call: z.optional(z.boolean()),
      reasoning: z.optional(z.boolean()),
      thinking: z.optional(z.boolean()),
    }),
  ),
});

const generatedModelSchemaBase = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  family: z.optional(nonEmptyString),
  limit: z.optional(limitSchema),
  tool_call: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  interleaved: z.optional(z.boolean()),
  modalities: z.optional(modalitiesSchema),
});

export const editableModelSchema = z.catchall(generatedModelSchemaBase, z.unknown());

const generatedProviderSchemaBase = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  api: nonEmptyString,
  type: providerTypeSchema,
  env: z.optional(z.array(nonEmptyString).check(z.minLength(1))),
  npm: z.optional(nonEmptyString),
  models: z.record(nonEmptyString, editableModelSchema),
});

export const editableProviderSchema = z.catchall(generatedProviderSchemaBase, z.unknown());

export const generatedRegistrySchema = z.record(nonEmptyString, generatedProviderSchemaBase);
export const editableRegistrySchema = z.record(nonEmptyString, editableProviderSchema);
export const servedRegistrySchema = editableRegistrySchema;

const populatedLimitSchema = limitSchema.check(
  z.refine((value) => value.context !== undefined || value.output !== undefined, {
    message: 'limit must include context or output when present',
  }),
);

export const kimiImportSubsetModelSchema = z.looseObject({
  id: nonEmptyString,
  name: z.optional(nonEmptyString),
  limit: z.optional(populatedLimitSchema),
  tool_call: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  interleaved: z.optional(z.boolean()),
  modalities: z.optional(modalitiesSchema),
});

export const kimiImportSubsetProviderSchema = z.looseObject({
  id: nonEmptyString,
  name: nonEmptyString,
  api: nonEmptyString,
  type: providerTypeSchema,
  models: z.record(nonEmptyString, kimiImportSubsetModelSchema),
});

export const kimiImportSubsetSchema = z.record(nonEmptyString, kimiImportSubsetProviderSchema);

export type SourceModel = z.infer<typeof sourceModelSchema>;
export type EditableModel = z.infer<typeof editableModelSchema>;
export type EditableProvider = z.infer<typeof editableProviderSchema>;
export type GeneratedRegistry = z.infer<typeof generatedRegistrySchema>;
export type EditableRegistry = z.infer<typeof editableRegistrySchema>;
export type ServedRegistry = z.infer<typeof servedRegistrySchema>;

export const validateGeneratedRegistry = (value: unknown): GeneratedRegistry =>
  generatedRegistrySchema.parse(value);
export const validateEditableRegistry = (value: unknown): EditableRegistry =>
  editableRegistrySchema.parse(value);
export const validateKimiImportSubset = (value: unknown) => kimiImportSubsetSchema.parse(value);
export const isNamespacedMetadataKey = (key: string): boolean => namespacedKeyRegex.test(key);
export const emptyNamespacedMetadata = (): Record<string, unknown> =>
  namespacedMetadataSchema.parse({});
