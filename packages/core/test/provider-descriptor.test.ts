import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROVIDER_TYPE,
  defaultModelSourceKindForProvider,
  defaultModelSourceLabelForProvider,
  deriveDefaultProviderModelsUrl,
  getProviderDescriptor,
  isProviderModelEndpointSourceKind,
  parseProviderType,
  providerModelSourceKindDescription,
  providerTypeOptions,
  providerTypes,
} from '../src/internal';

describe('provider descriptors', () => {
  it('centralizes provider type labels and defaults', () => {
    expect(DEFAULT_PROVIDER_TYPE).toBe('openai_responses');
    expect(providerTypeOptions()).toEqual([
      { value: 'openai_responses', label: 'OpenAI Responses API' },
      { value: 'openai', label: 'OpenAI Chat Completions API' },
      { value: 'anthropic', label: 'Anthropic-compatible' },
    ]);
    expect(new Set(providerTypeOptions().map((option) => option.value))).toEqual(
      new Set(providerTypes),
    );
  });

  it('derives provider-specific model sources from the descriptor registry', () => {
    expect(defaultModelSourceKindForProvider('openai_responses')).toBe('openai_models');
    expect(defaultModelSourceKindForProvider('openai')).toBe('openai_models');
    expect(defaultModelSourceKindForProvider('anthropic')).toBe('anthropic_models');
    expect(defaultModelSourceLabelForProvider('anthropic')).toBe('Anthropic native');
    expect(deriveDefaultProviderModelsUrl('anthropic', 'https://api.example.com')).toBe(
      'https://api.example.com/v1/models',
    );
    expect(deriveDefaultProviderModelsUrl('openai', 'https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/models',
    );
  });

  it('keeps auth header conventions in descriptors', () => {
    expect(getProviderDescriptor('openai').discovery.headers('token')).toEqual({
      Authorization: 'Bearer token',
    });
    expect(getProviderDescriptor('anthropic').discovery.headers('token')).toEqual({
      'anthropic-version': '2023-06-01',
      'x-api-key': 'token',
    });
  });

  it('parses provider types through the registry', () => {
    expect(parseProviderType('openai')).toBe('openai');
    expect(() => parseProviderType('unknown')).toThrow(/Invalid provider type/u);
  });

  // Covers endpoint source detection so CLI validation accepts only provider-backed model sources.
  it('identifies endpoint-backed model source kinds separately from other source kinds', () => {
    expect(isProviderModelEndpointSourceKind('openai_models')).toBe(true);
    expect(isProviderModelEndpointSourceKind('anthropic_models')).toBe(true);
    expect(isProviderModelEndpointSourceKind('local_file')).toBe(false);
    expect(isProviderModelEndpointSourceKind('remote_url')).toBe(false);
    expect(providerModelSourceKindDescription).toBe(
      'openai_models, anthropic_models, local_file, remote_url',
    );
  });
});
