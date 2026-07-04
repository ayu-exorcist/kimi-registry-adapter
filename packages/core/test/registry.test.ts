import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseModelsMetadata,
  serializeDeterministicJson,
  sourceModelSchema,
  transformOpenAiModelsToRegistry,
  transformOpenAiModelsToRegistryDetailed,
  validateGeneratedRegistry,
  validateKimiImportSubset,
} from '../src/internal';
import { expectRecordValue } from './test-helpers';

const readFixture = <T>(fileName: string): T => {
  const filePath = resolve(process.cwd(), 'packages/core/test/fixtures', fileName);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
};

describe('transformOpenAiModelsToRegistry', () => {
  const baseConfig = {
    providerId: 'provider',
    providerName: 'Provider',
    baseUrl: 'https://gateway.example.com/v1',
    type: 'openai' as const,
    fallbackContext: 131072,
    fallbackToolCall: true,
  };

  it('transforms minimal OpenAI models into a Kimi-compatible provider map', () => {
    const payload = readFixture<{ data: Array<{ id: string }> }>('openai-minimal-models.json');

    const registry = transformOpenAiModelsToRegistry({
      config: baseConfig,
      models: payload.data,
    });

    expect(validateGeneratedRegistry(registry)).toEqual(registry);
    expect(validateKimiImportSubset(registry)).toEqual(registry);
    const provider = expectRecordValue(registry, 'provider');
    expect(expectRecordValue(provider.models, 'gpt-4.1')).toEqual({
      id: 'gpt-4.1',
      name: 'gpt-4.1',
      limit: {
        context: 131072,
      },
      tool_call: true,
    });
  });

  it('enriches missing fields from exact metadata matches', () => {
    const registry = transformOpenAiModelsToRegistry({
      config: {
        ...baseConfig,
        fallbackContext: 131072,
        fallbackToolCall: false,
        modelsMetadata: {
          'gpt-5.4': {
            id: 'gpt-5.4',
            name: 'GPT 5.4',
            family: 'gpt',
            reasoning: true,
            tool_call: true,
            limit: {
              context: 400000,
              output: 16384,
            },
            modalities: {
              input: ['text', 'image'],
              output: ['text'],
            },
          },
        },
      },
      models: [{ id: 'gpt-5.4' }],
    });

    const provider = expectRecordValue(registry, 'provider');
    expect(expectRecordValue(provider.models, 'gpt-5.4')).toEqual({
      id: 'gpt-5.4',
      name: 'GPT 5.4',
      family: 'gpt',
      limit: {
        context: 400000,
        output: 16384,
      },
      tool_call: true,
      reasoning: true,
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
    });
  });

  it('uses a single normalized metadata match but ignores ambiguous normalized matches', () => {
    const registry = transformOpenAiModelsToRegistry({
      config: {
        ...baseConfig,
        fallbackContext: 131072,
        fallbackToolCall: false,
        modelsMetadata: {
          'openai/gpt-5.4': {
            id: 'openai/gpt-5.4',
            name: 'GPT 5.4',
            limit: {
              context: 400000,
            },
            tool_call: true,
          },
          'foo/deepseek-v4-flash': {
            id: 'foo/deepseek-v4-flash',
            name: 'DeepSeek V4 Flash A',
            limit: {
              context: 200000,
            },
          },
          'bar/deepseek-v4-flash': {
            id: 'bar/deepseek-v4-flash',
            name: 'DeepSeek V4 Flash B',
            limit: {
              context: 300000,
            },
          },
        },
      },
      models: [{ id: 'gpt-5.4' }, { id: 'deepseek-v4-flash' }],
    });

    const provider = expectRecordValue(registry, 'provider');
    expect(expectRecordValue(provider.models, 'gpt-5.4')).toEqual({
      id: 'gpt-5.4',
      name: 'GPT 5.4',
      limit: {
        context: 400000,
      },
      tool_call: true,
    });

    expect(expectRecordValue(provider.models, 'deepseek-v4-flash')).toEqual({
      id: 'deepseek-v4-flash',
      name: 'deepseek-v4-flash',
      limit: {
        context: 131072,
      },
      tool_call: false,
    });
  });

  it('reports metadata match summary counts', () => {
    const result = transformOpenAiModelsToRegistryDetailed({
      config: {
        ...baseConfig,
        fallbackContext: 131072,
        fallbackToolCall: false,
        modelsMetadata: {
          'gpt-5.4': {
            id: 'gpt-5.4',
            name: 'GPT 5.4',
          },
          'openai/gpt-5.5': {
            id: 'openai/gpt-5.5',
            name: 'GPT 5.5',
          },
          'foo/deepseek-v4-flash': {
            id: 'foo/deepseek-v4-flash',
            name: 'DeepSeek A',
          },
          'bar/deepseek-v4-flash': {
            id: 'bar/deepseek-v4-flash',
            name: 'DeepSeek B',
          },
        },
      },
      models: [
        { id: 'gpt-5.4' },
        { id: 'gpt-5.5' },
        { id: 'deepseek-v4-flash' },
        { id: 'unknown-model' },
      ],
    });

    expect(result.metadataMatchSummary).toEqual({
      exact: 1,
      normalized: 1,
      unmatched: 2,
    });
  });

  it('prefers richer upstream limit fields before falling back to defaults', () => {
    const registry = transformOpenAiModelsToRegistry({
      config: {
        ...baseConfig,
        fallbackContext: 131072,
        fallbackToolCall: false,
      },
      models: [
        {
          id: 'model-a',
          max_input_tokens: 262144,
          max_generated_tokens: 16384,
        },
      ],
    });

    const provider = expectRecordValue(registry, 'provider');
    expect(expectRecordValue(provider.models, 'model-a')).toEqual({
      id: 'model-a',
      name: 'model-a',
      limit: {
        context: 262144,
        output: 16384,
      },
      tool_call: false,
    });
  });

  it('derives reasoning, tool use, and modalities from capability-shaped upstream metadata', () => {
    const registry = transformOpenAiModelsToRegistry({
      config: {
        ...baseConfig,
        fallbackToolCall: false,
      },
      models: [
        {
          id: 'model-b',
          reasoning_supported: true,
          supports_function_calling: true,
          capabilities: {
            image_input: true,
            audio_output: true,
          },
        },
      ],
    });

    const provider = expectRecordValue(registry, 'provider');
    expect(expectRecordValue(provider.models, 'model-b')).toEqual({
      id: 'model-b',
      name: 'model-b',
      limit: {
        context: 131072,
      },
      tool_call: true,
      reasoning: true,
      modalities: {
        input: ['text', 'image'],
        output: ['audio'],
      },
    });
  });

  it('emits provider env and npm metadata when configured', () => {
    const registry = transformOpenAiModelsToRegistry({
      config: {
        ...baseConfig,
        apiKeyEnv: 'PROVIDER_API_KEY',
        npm: '@ai-sdk/openai',
      },
      models: [{ id: 'gpt-4.1' }],
    });

    const provider = expectRecordValue(registry, 'provider');
    expect(provider.env).toEqual(['PROVIDER_API_KEY']);
    expect(provider.npm).toBe('@ai-sdk/openai');
  });
});

describe('validation and serialization contract', () => {
  it('preserves passthrough fields in upstream and Kimi subset schemas', () => {
    const upstream = {
      id: 'model-a',
      architecture: {
        input_modalities: ['text'],
        tokenizer: 'custom',
      },
      'x-provider': {
        tier: 'preview',
      },
    };
    expect(sourceModelSchema.parse(upstream)).toEqual(upstream);

    const kimiSubset = {
      provider: {
        id: 'provider',
        name: 'Provider',
        api: 'https://gateway.example.com/v1',
        type: 'openai',
        models: {
          'model-a': {
            id: 'model-a',
            'x-provider': {
              tier: 'preview',
            },
          },
        },
        'x-provider': {
          docs: 'https://example.com',
        },
      },
    };
    expect(validateKimiImportSubset(kimiSubset)).toEqual(kimiSubset);
  });

  it('rejects empty Kimi subset limits and invalid metadata input', () => {
    expect(() =>
      validateKimiImportSubset({
        provider: {
          id: 'provider',
          name: 'Provider',
          api: 'https://gateway.example.com/v1',
          type: 'openai',
          models: {
            'model-a': {
              id: 'model-a',
              limit: {},
            },
          },
        },
      }),
    ).toThrow(/limit must include context or output/u);

    expect(() => parseModelsMetadata([])).toThrow(/models metadata must be an object/u);
  });

  it('accepts the minimal Kimi import registry fixture', () => {
    const registry = readFixture<unknown>('kimi-import-registry.json');
    expect(validateKimiImportSubset(registry)).toEqual(registry);
  });

  it('serializes registry JSON deterministically', () => {
    const serialized = serializeDeterministicJson({
      b: 1,
      a: {
        d: 2,
        c: 3,
      },
    });

    expect(serialized).toBe(`{
  "a": {
    "c": 3,
    "d": 2
  },
  "b": 1
}\n`);
  });
});
