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

    const saveProviderDefinition = vi.fn().mockResolvedValue({
      configPath: '/state/config.json',
      stateDir: '/state',
    });
    const configureProviderAuth = vi.fn().mockResolvedValue({
      providerId: 'provider-a',
      authPath: '/state/auth.json',
      stored: 'apiKey',
    });
    const updateProviderOperation = vi.fn().mockResolvedValue({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      updateStateSummary: {
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastUpdateStatus: 'ok',
        warnings: 0,
        errors: 0,
        conflicts: 0,
      },
      metadataMatchSummary: { exact: 0, normalized: 0, unmatched: 1 },
      commit: 'abc123',
    });
    const loadingMessages: string[] = [];
    const withLoadingIndicator = <T>(message: string, action: () => Promise<T>): Promise<T> => {
      loadingMessages.push(message);
      return action();
    };

    const result = await saveAndUpdateInteractiveProvider({
      stateDir: '/state',
      state,
      runtime: {
        saveProviderDefinition,
        configureProviderAuth,
        updateProviderOperation,
        withLoadingIndicator,
      },
    });

    expect(saveProviderDefinition).toHaveBeenCalledWith('provider-a', {
      stateDir: '/state',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      modelSourceConfig: { kind: 'openai_models' },
      include: ['model-a'],
    });
    expect(configureProviderAuth).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      apiKey: 'secret-key',
    });
    expect(loadingMessages).toEqual(['Updating registry...']);
    expect(updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      models: [{ id: 'model-a' }],
      updateMode: 'merge',
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
