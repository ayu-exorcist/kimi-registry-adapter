import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureInteractiveModels,
  modelIdsFromPayload,
  modelIdsMatchingInclude,
  promptModelIncludeSelection,
} from '../src/commands/interactive-add-models';
import {
  createInitialAddProviderState,
  rememberFetchedModels,
} from '../src/commands/interactive-add-state';
import { setPromptDriver } from '../src/commands/prompt-adapters';

describe('interactive add model helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts sorted non-empty model ids from payload records', () => {
    expect(
      modelIdsFromPayload([{ id: 'model-b' }, { id: '' }, { id: 'model-a' }, { id: 'model-c' }]),
    ).toEqual(['model-a', 'model-b', 'model-c']);
  });

  it('resolves wildcard include patterns to concrete fetched model ids', () => {
    expect(modelIdsMatchingInclude(['claude-a', 'gpt-a', 'gpt-b'], ['gpt-*'])).toEqual([
      'gpt-a',
      'gpt-b',
    ]);
    expect(modelIdsMatchingInclude(['model-a'], undefined)).toEqual(['model-a']);
  });

  it('can treat back from the model list as an immediate parent-step back', async () => {
    const restore = setPromptDriver({
      searchMultiselect: async () => Symbol('cancel'),
    });

    try {
      await expect(
        promptModelIncludeSelection({
          modelIds: ['model-a'],
          startInList: true,
          backFromList: 'back',
        }),
      ).resolves.toEqual({ status: 'back' });
    } finally {
      restore();
    }
  });

  it('keeps add-provider back behavior from the model list returning to select mode', async () => {
    const searchMultiselect = vi.fn().mockResolvedValueOnce(Symbol('cancel'));
    const confirmPrompt = vi.fn().mockResolvedValueOnce(false);
    const restore = setPromptDriver({
      searchMultiselect,
      confirmPrompt,
    });

    try {
      await expect(
        promptModelIncludeSelection({
          modelIds: ['model-a'],
          startInList: true,
        }),
      ).resolves.toEqual({
        status: 'selected',
        include: ['model-a'],
        selectFromList: false,
      });
      expect(confirmPrompt).toHaveBeenCalledWith({
        message: 'Choose models from fetched list?',
        initialValue: true,
      });
    } finally {
      restore();
    }
  });

  it('returns cached models without fetching when the cache key still matches', async () => {
    const state = createInitialAddProviderState();
    state.providerId = 'provider-a';
    state.baseUrl = 'https://api.example.com/v1';
    const fetched = { modelIds: ['model-a'], models: [{ id: 'model-a' }] };
    rememberFetchedModels(state, fetched);

    await expect(ensureInteractiveModels(state)).resolves.toEqual({
      status: 'ok',
      ...fetched,
    });
  });
});
