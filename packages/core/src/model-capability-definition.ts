const modelCapabilityFieldNames = [
  'limit',
  'tool_call',
  'reasoning',
  'interleaved',
  'support_efforts',
  'default_effort',
  'modalities',
] as const;

export type ModelCapabilityFieldName = (typeof modelCapabilityFieldNames)[number];

export const modalityValues = ['text', 'image', 'audio', 'video'] as const;

export const allowedMetadataModalities: ReadonlySet<string> = new Set<string>(modalityValues);

export const contextLimitSourceFields = [
  'context_length',
  'max_context_length',
  'max_context_tokens',
  'max_input_tokens',
  'input_token_limit',
  'max_model_len',
  'model_context_window',
  'context_window',
] as const;

export const outputLimitSourceFields = [
  'max_output_tokens',
  'max_completion_tokens',
  'output_token_limit',
  'max_output',
  'max_generated_tokens',
  'completion_token_limit',
  'max_tokens',
] as const;

export const toolCallSourceFields = [
  'tool_call',
  'supports_tool_calls',
  'tools',
  'function_calling',
  'supports_function_calling',
] as const;

export const reasoningSourceFields = [
  'reasoning',
  'supports_reasoning',
  'thinking',
  'reasoning_supported',
] as const;
