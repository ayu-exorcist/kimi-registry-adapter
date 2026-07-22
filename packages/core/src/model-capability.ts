import type { ProviderConfig } from './config';
import {
  contextLimitSourceFields,
  outputLimitSourceFields,
  reasoningSourceFields,
  toolCallSourceFields,
} from './model-capability-definition';
import {
  parseDefaultEffort,
  parseSupportEfforts,
  supportEffortsFromReasoningOptions,
} from './model-effort';
import { editableModelSchema, type EditableModel, type SourceModel } from './schema';
import type { Modality } from './schema-primitives';
import type { UnknownRecord } from './type-guards';

export type ModelLimit = {
  context?: number;
  output?: number;
};

export type ModelModalities = {
  input?: Modality[];
  output?: Modality[];
};

export type ModelsMetadataEntry = {
  id: string;
  name?: string;
  family?: string;
  limit?: ModelLimit;
  tool_call?: boolean;
  reasoning?: boolean;
  interleaved?: boolean;
  support_efforts?: string[];
  default_effort?: string;
  modalities?: ModelModalities;
};

export type InferredEditableModel = EditableModel;

const firstPositiveIntegerField = <Field extends keyof SourceModel>(
  model: SourceModel,
  fields: readonly Field[],
): number | undefined => {
  for (const field of fields) {
    const value = model[field];
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
};

const firstBooleanField = <Field extends keyof SourceModel>(
  model: SourceModel,
  fields: readonly Field[],
): boolean | undefined => {
  for (const field of fields) {
    const value = model[field];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
};

const pickContextLimit = (
  model: SourceModel,
  fallbackContext: number | undefined,
): number | undefined =>
  firstPositiveIntegerField(model, contextLimitSourceFields) ?? fallbackContext;

const pickOutputLimit = (model: SourceModel): number | undefined =>
  firstPositiveIntegerField(model, outputLimitSourceFields);

const pickModalities = (model: SourceModel): ModelModalities | undefined => {
  if (model.modalities) {
    return {
      ...(model.modalities.input ? { input: model.modalities.input } : {}),
      ...(model.modalities.output ? { output: model.modalities.output } : {}),
    };
  }

  const input = model.architecture?.input_modalities;
  const output = model.architecture?.output_modalities;

  if (input || output) {
    return {
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    };
  }

  const inferredInput = [
    model.capabilities?.image_input ? 'image' : undefined,
    model.capabilities?.audio_input ? 'audio' : undefined,
    model.capabilities?.video_input ? 'video' : undefined,
  ].filter((value): value is Modality => value !== undefined);
  const inferredOutput = [
    model.capabilities?.image_output ? 'image' : undefined,
    model.capabilities?.audio_output ? 'audio' : undefined,
  ].filter((value): value is Modality => value !== undefined);

  if (inferredInput.length === 0 && inferredOutput.length === 0) {
    return undefined;
  }

  return {
    input: ['text', ...inferredInput],
    ...(inferredOutput.length > 0 ? { output: inferredOutput } : { output: ['text'] }),
  };
};

const pickToolCall = (
  model: SourceModel,
  fallbackToolCall: boolean | undefined,
): boolean | undefined =>
  firstBooleanField(model, toolCallSourceFields) ??
  model.capabilities?.tool_call ??
  fallbackToolCall;

const pickReasoning = (model: SourceModel): boolean | undefined =>
  firstBooleanField(model, reasoningSourceFields) ??
  model.capabilities?.reasoning ??
  model.capabilities?.thinking;

const pickInterleaved = (model: SourceModel): boolean | undefined => {
  return model.interleaved ?? model.supports_interleaved;
};

const mergeModalities = (
  primary: ModelModalities | undefined,
  fallback: ModelModalities | undefined,
): ModelModalities | undefined => {
  if (!primary && !fallback) {
    return undefined;
  }

  const input = primary?.input ?? fallback?.input;
  const output = primary?.output ?? fallback?.output;

  return {
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
  };
};

export type InferEditableModelInput = {
  model: SourceModel;
  fallbackContext: number | undefined;
  fallbackToolCall: boolean | undefined;
  metadataModel: ModelsMetadataEntry | undefined;
  override: NonNullable<ProviderConfig['overrides']>[string] | undefined;
};

export const inferEditableModel = ({
  model,
  fallbackContext,
  fallbackToolCall,
  metadataModel,
  override,
}: InferEditableModelInput): InferredEditableModel => {
  const context =
    pickContextLimit(model, undefined) ?? metadataModel?.limit?.context ?? fallbackContext;
  const output = pickOutputLimit(model) ?? metadataModel?.limit?.output;
  const modalities = mergeModalities(pickModalities(model), metadataModel?.modalities);
  const toolCall = pickToolCall(model, undefined) ?? metadataModel?.tool_call ?? fallbackToolCall;
  const reasoning = pickReasoning(model) ?? metadataModel?.reasoning;
  const interleaved = pickInterleaved(model) ?? metadataModel?.interleaved;
  const supportEfforts =
    parseSupportEfforts(model.support_efforts) ??
    supportEffortsFromReasoningOptions(model.reasoning_options) ??
    metadataModel?.support_efforts;
  const defaultEffort = parseDefaultEffort(model.default_effort) ?? metadataModel?.default_effort;
  const inferredModelInput: UnknownRecord = {
    id: model.id,
    name: override?.name ?? metadataModel?.name ?? model.name ?? model.id,
  };
  const family = model.family ?? metadataModel?.family;
  if (family) {
    inferredModelInput['family'] = family;
  }
  if (context || output) {
    inferredModelInput['limit'] = {
      ...(context ? { context } : {}),
      ...(output ? { output } : {}),
    };
  }
  if (toolCall !== undefined) {
    inferredModelInput['tool_call'] = toolCall;
  }
  if (reasoning !== undefined) {
    inferredModelInput['reasoning'] = reasoning;
  }
  if (interleaved !== undefined) {
    inferredModelInput['interleaved'] = interleaved;
  }
  if (supportEfforts !== undefined) {
    inferredModelInput['support_efforts'] = supportEfforts;
  }
  if (defaultEffort !== undefined) {
    inferredModelInput['default_effort'] = defaultEffort;
  }
  if (modalities) {
    inferredModelInput['modalities'] = modalities;
  }
  const inferredModel = editableModelSchema.parse(inferredModelInput);

  if (!override) {
    return inferredModel;
  }

  const overriddenModelInput: UnknownRecord = { ...inferredModel };
  if (override.id) {
    overriddenModelInput['id'] = override.id;
  }
  if (override.name) {
    overriddenModelInput['name'] = override.name;
  }
  if (override.family) {
    overriddenModelInput['family'] = override.family;
  }
  if (override.limit) {
    overriddenModelInput['limit'] = {
      ...inferredModel.limit,
      ...override.limit,
    };
  }
  if (override.tool_call !== undefined) {
    overriddenModelInput['tool_call'] = override.tool_call;
  }
  if (override.reasoning !== undefined) {
    overriddenModelInput['reasoning'] = override.reasoning;
  }
  if (override.interleaved !== undefined) {
    overriddenModelInput['interleaved'] = override.interleaved;
  }
  if (override.support_efforts !== undefined) {
    overriddenModelInput['support_efforts'] = override.support_efforts;
  }
  if (override.default_effort !== undefined) {
    overriddenModelInput['default_effort'] = override.default_effort;
  }
  if (override.modalities) {
    overriddenModelInput['modalities'] = {
      ...inferredModel.modalities,
      ...override.modalities,
    };
  }

  return editableModelSchema.parse(overriddenModelInput);
};
