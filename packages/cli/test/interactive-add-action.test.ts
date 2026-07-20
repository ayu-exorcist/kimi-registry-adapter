import { describe, expect, it, vi } from 'vitest';

import {
  interactiveProviderApiKey,
  interactiveProviderApiKeyEnv,
  saveAndUpdateInteractiveProvider,
} from '../src/commands/interactive-add-action';
import {
  createInitialAddProviderState,
  rememberFetchedModels,
} from '../src/commands/interactive-add-state';

describe('interactive add provider action', () => {
  it('saves config, stores auth, and updates using cached models', async () => {
    const state = createInitialAddProviderState();
    state.providerId = 'provider-a';
    state.baseUrl = 'https://api.example.com/v1';
    state.apiKey = 'secret-key';
    state.include = ['model-a'];
    rememberFetchedModels(state, { modelIds: ['model-a'], models: [{ id: 'model-a' }] });

    const setupProviderOperation = vi.fn().mockResolvedValue({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      metadataMatchSummary: { exact: 0, normalized: 0, unmatched: 1 },
      commit: 'abc123',
    });
    const loadingMessages: string[] = [];
    const withLoadingIndicator = <T>(
      message: string,
      action: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      loadingMessages.push(message);
      return action(new AbortController().signal);
    };

    const result = await saveAndUpdateInteractiveProvider({
      stateDir: '/state',
      state,
      runtime: {
        setupProviderOperation,
        withLoadingIndicator,
      },
    });

    expect(loadingMessages).toEqual(['Updating registry...']);
    expect(setupProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      modelSource: { kind: 'openai_models' },
      include: ['model-a'],
      apiKey: 'secret-key',
      models: [{ id: 'model-a' }],
      updateMode: 'merge',
      storeApiKey: true,
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({
      configPath: '/state/config.json',
      stateDir: '/state',
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      commit: 'abc123',
    });
  });

  it('derives transient and environment auth inputs from state', () => {
    const state = createInitialAddProviderState();

    state.authMode = 'once';
    state.apiKey = 'one-shot-key';
    expect(interactiveProviderApiKey(state)).toBe('one-shot-key');
    expect(interactiveProviderApiKeyEnv(state)).toBeUndefined();

    state.authMode = 'env';
    state.apiKeyEnv = 'PROVIDER_KEY';
    expect(interactiveProviderApiKey(state)).toBeUndefined();
    expect(interactiveProviderApiKeyEnv(state)).toBe('PROVIDER_KEY');
  });
});
