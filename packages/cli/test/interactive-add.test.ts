import { describe, expect, it, vi } from 'vitest';

import {
  createAddProviderWizardActor,
  getNextAddProviderStepId,
  getPreviousAddProviderStepId,
  runInteractiveAddProvider,
  type AddProviderState,
} from '../src/commands/interactive-add';
import {
  cachedModelsForCurrentState,
  createInitialAddProviderState,
  currentModelsCacheKey,
  defaultInteractiveModelSourcePlaceholder,
  rememberFetchedModels,
  resetAddProviderStateAfterStep,
  resolvedInteractiveModelSource,
} from '../src/commands/interactive-add-state';
import { providerSetupDraftFromInteractiveState } from '../src/commands/provider-setup-input';

const addProviderState = (overrides: Partial<AddProviderState> = {}): AddProviderState => ({
  providerId: 'provider-a',
  baseUrl: 'https://api.example.com/v1',
  modelSourceInput: '',
  authMode: 'store',
  apiKey: '',
  apiKeyEnv: '',
  providerType: 'openai_responses',
  include: undefined,
  includeSource: 'manual',
  selectModelsFromFetchedList: true,
  cachedModelIds: undefined,
  cachedModels: undefined,
  cachedModelsKey: undefined,
  startServerNow: true,
  ...overrides,
});

describe('interactive add wizard steps', () => {
  it('walks through stored-key auth steps and skips env-only steps', () => {
    const state = addProviderState({ authMode: 'store' });

    expect(getNextAddProviderStepId('authMode', state)).toBe('apiKey');
    expect(getNextAddProviderStepId('apiKey', state)).toBe('providerType');
    expect(getPreviousAddProviderStepId('providerType', state)).toBe('apiKey');
  });

  it('walks through env auth steps and skips stored-key steps', () => {
    const state = addProviderState({ authMode: 'env' });

    expect(getNextAddProviderStepId('authMode', state)).toBe('apiKeyEnv');
    expect(getNextAddProviderStepId('apiKeyEnv', state)).toBe('providerType');
    expect(getPreviousAddProviderStepId('providerType', state)).toBe('apiKeyEnv');
  });

  it('skips all credential entry steps when auth is disabled', () => {
    const state = addProviderState({ authMode: 'none' });

    expect(getNextAddProviderStepId('authMode', state)).toBe('providerType');
    expect(getPreviousAddProviderStepId('providerType', state)).toBe('authMode');
  });

  it('keeps the wizard at the edge steps when moving past either end', () => {
    const state = addProviderState();

    expect(getPreviousAddProviderStepId('providerId', state)).toBe('providerId');
    expect(getNextAddProviderStepId('modelInclude', state)).toBe('startServer');
    expect(getPreviousAddProviderStepId('startServer', state)).toBe('modelInclude');
    expect(getNextAddProviderStepId('startServer', state)).toBe('startServer');
  });

  it('advances the xstate actor using the same step-selection rules', async () => {
    const actor = await createAddProviderWizardActor();
    actor.start();

    actor.send({ type: 'NEXT', state: addProviderState({ authMode: 'env' }) });
    actor.send({ type: 'NEXT', state: addProviderState({ authMode: 'env' }) });
    actor.send({ type: 'NEXT', state: addProviderState({ authMode: 'env' }) });

    expect(actor.state.context.currentStepId).toBe('apiKeyEnv');

    actor.send({ type: 'BACK', state: addProviderState({ authMode: 'env' }) });
    expect(actor.state.context.currentStepId).toBe('authMode');
  });
});

describe('interactive add provider use case', () => {
  it('returns to the interactive menu without saving when provider id entry is cancelled', async () => {
    const inputPrompt = vi.fn().mockResolvedValueOnce(Symbol('input-cancel'));
    const saveAndUpdateInteractiveProvider = vi.fn();

    await expect(
      runInteractiveAddProvider({
        stateDir: '/state',
        host: '127.0.0.1',
        port: '2727',
        runtime: {
          listConfiguredProviderIds: () => [],
          inputPrompt,
          saveAndUpdateInteractiveProvider,
        },
      }),
    ).resolves.toBe(true);

    expect(saveAndUpdateInteractiveProvider).not.toHaveBeenCalled();
  });

  it('shows a model source error on the source step when model fetching fails', async () => {
    const inputPrompt = vi
      .fn()
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce('https://api.example.com/v1')
      .mockResolvedValueOnce('https://api.example.com/v1/models')
      .mockResolvedValueOnce(Symbol('cancel'));
    const selectPrompt = vi.fn().mockResolvedValueOnce('none').mockResolvedValueOnce('openai');
    const ensureInteractiveModels = vi.fn().mockResolvedValueOnce({
      status: 'fix_models_endpoint',
      message: 'Failed to fetch models: 401',
    });

    await expect(
      runInteractiveAddProvider({
        stateDir: '/state',
        host: '127.0.0.1',
        port: '2727',
        runtime: {
          listConfiguredProviderIds: () => [],
          inputPrompt,
          selectPrompt,
          ensureInteractiveModels,
        },
      }),
    ).resolves.toBe(true);

    expect(inputPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Model list source (empty = default, URL = custom remote URL, path = local file)',
        details: [
          {
            tone: 'danger',
            text: 'Failed to fetch models: 401',
          },
        ],
      }),
    );
  });

  it('starts the server through injected adapters after the provider is finalized', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stopRenderingServeSummary = vi.fn();
    const inputPrompt = vi
      .fn()
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce('https://api.example.com/v1')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    const selectPrompt = vi.fn().mockResolvedValueOnce('none').mockResolvedValueOnce('openai');
    const confirmPrompt = vi.fn().mockResolvedValueOnce(true);
    const ensureInteractiveModels = vi.fn().mockResolvedValueOnce({
      status: 'ok',
      modelIds: ['model-a'],
      models: [{ id: 'model-a' }],
    });
    const promptModelIncludeSelection = vi.fn().mockResolvedValueOnce({
      status: 'selected',
      include: ['model-a'],
      selectFromList: true,
    });
    const saveAndUpdateInteractiveProvider = vi.fn().mockResolvedValueOnce({
      configPath: '/state/config.json',
      stateDir: '/state',
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      commit: 'abc123',
    });
    const findAvailablePort = vi.fn().mockResolvedValue(3000);
    const showNote = vi.fn();
    const printServeStartupSummary = vi.fn(() => stopRenderingServeSummary);
    const startRegistryServerOnDemand = vi.fn().mockResolvedValue({});
    const waitForServerClose = vi.fn().mockResolvedValue(undefined);

    await expect(
      runInteractiveAddProvider({
        stateDir: '/state',
        host: '127.0.0.1',
        port: '2727',
        runtime: {
          listConfiguredProviderIds: () => [],
          inputPrompt,
          selectPrompt,
          confirmPrompt,
          ensureInteractiveModels,
          promptModelIncludeSelection,
          saveAndUpdateInteractiveProvider,
          findAvailablePort,
          showNote,
          printServeStartupSummary,
          startRegistryServerOnDemand,
          waitForServerClose,
        },
      }),
    ).resolves.toBe(false);

    expect(saveAndUpdateInteractiveProvider).toHaveBeenCalledWith({
      stateDir: '/state',
      state: expect.objectContaining({
        providerId: 'provider-a',
        providerType: 'openai',
        include: ['model-a'],
        startServerNow: true,
      }),
    });
    expect(findAvailablePort).toHaveBeenCalledWith('127.0.0.1', 2727);
    expect(startRegistryServerOnDemand).toHaveBeenCalledWith({
      stateDir: '/state',
      host: '127.0.0.1',
      port: 3000,
    });
    expect(waitForServerClose).toHaveBeenCalled();
    expect(stopRenderingServeSummary).toHaveBeenCalled();
    expect(showNote).toHaveBeenCalledWith(expect.stringContaining('url:'), 'Provider added');
    stderr.mockRestore();
  });
});

describe('interactive add state helpers', () => {
  it('creates the initial state used by the add wizard', () => {
    expect(createInitialAddProviderState()).toMatchObject({
      providerId: '',
      authMode: 'store',
      providerType: 'openai_responses',
      startServerNow: true,
    });
  });

  it('resolves default, URL, and local file model sources from state', () => {
    expect(
      resolvedInteractiveModelSource(
        addProviderState({ providerType: 'anthropic', modelSourceInput: '' }),
      ),
    ).toEqual({ kind: 'anthropic_models' });
    expect(
      resolvedInteractiveModelSource(
        addProviderState({ modelSourceInput: 'https://api.example.com/v1/models' }),
      ),
    ).toEqual({ kind: 'remote_url', url: 'https://api.example.com/v1/models' });
    expect(
      resolvedInteractiveModelSource(addProviderState({ modelSourceInput: './models.json' })),
    ).toEqual({ kind: 'local_file', path: './models.json' });
  });

  it('resets downstream answers after editing an earlier step', () => {
    const state = addProviderState({
      baseUrl: 'https://api.example.com/v1',
      authMode: 'env',
      apiKey: 'stored-key',
      apiKeyEnv: 'PROVIDER_KEY',
      modelSourceInput: './models.json',
      cachedModelIds: ['model-a'],
      cachedModels: [{ id: 'model-a' }],
      cachedModelsKey: 'old-key',
      include: ['model-a'],
      includeSource: 'selection',
      selectModelsFromFetchedList: false,
      startServerNow: false,
    });

    resetAddProviderStateAfterStep(state, 'authMode');

    expect(state.apiKey).toBe('');
    expect(state.apiKeyEnv).toBe('');
    expect(state.modelSourceInput).toBe('');
    expect(state.cachedModels).toBeUndefined();
    expect(state.include).toBeUndefined();
    expect(state.includeSource).toBe('manual');
    expect(state.selectModelsFromFetchedList).toBe(true);
    expect(state.startServerNow).toBe(true);
  });

  it('keys and returns cached models only for the current state', () => {
    const state = addProviderState({ apiKey: 'key-a' });
    const fetched = { modelIds: ['model-a'], models: [{ id: 'model-a' }] };

    rememberFetchedModels(state, fetched);

    expect(currentModelsCacheKey(state)).toContain('key-a');
    expect(cachedModelsForCurrentState(state)).toEqual(fetched.models);

    state.apiKey = 'key-b';
    expect(cachedModelsForCurrentState(state)).toBeUndefined();
  });

  it('builds the shared provider setup draft used by interactive save and update', () => {
    const state = addProviderState({
      authMode: 'env',
      apiKeyEnv: 'PROVIDER_KEY',
      modelSourceInput: 'https://models.example.com/list.json',
      include: ['model-a'],
    });

    expect(providerSetupDraftFromInteractiveState('/state', state)).toMatchObject({
      stateDir: '/state',
      providerId: 'provider-a',
      baseUrl: 'https://api.example.com/v1',
      type: 'openai_responses',
      modelSource: { kind: 'remote_url', url: 'https://models.example.com/list.json' },
      apiKeyEnv: 'PROVIDER_KEY',
      include: ['model-a'],
      updateMode: 'merge',
    });
  });

  it('falls back to a model source placeholder when the base URL is invalid', () => {
    expect(
      defaultInteractiveModelSourcePlaceholder(addProviderState({ baseUrl: 'not a url' })),
    ).toBe('Leave empty to derive from base URL');
  });
});
