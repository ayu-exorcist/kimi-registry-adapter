import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configureProviderAuth: vi.fn(),
  fetchConfiguredProviderModels: vi.fn(),
  getProviderAuthState: vi.fn(),
  getProviderConfig: vi.fn(),
  removeProvider: vi.fn(),
  setProviderConfigApiKeyEnv: vi.fn(),
  setProviderModelInclude: vi.fn(),
  updateProviderConfig: vi.fn(),
  updateProviderOperation: vi.fn(),
  selectExistingProviderId: vi.fn(),
  confirmPrompt: vi.fn(),
  inputPrompt: vi.fn(),
  selectPrompt: vi.fn(),
  withLoadingIndicator: vi.fn(),
  showNote: vi.fn(),
  showInteractiveNote: vi.fn(),
  printServeStartupSummary: vi.fn(),
  listRegistryUrls: vi.fn(),
  promptModelIncludeSelection: vi.fn(),
  findAvailablePort: vi.fn(),
  startRegistryServerOnDemand: vi.fn(),
  waitForServerClose: vi.fn(),
}));

vi.mock('@kastral/kra-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kastral/kra-core')>();
  return {
    ...actual,
    configureProviderAuth: mocks.configureProviderAuth,
    fetchConfiguredProviderModels: mocks.fetchConfiguredProviderModels,
    getProviderAuthState: mocks.getProviderAuthState,
    getProviderConfig: mocks.getProviderConfig,
    removeProvider: mocks.removeProvider,
    setProviderConfigApiKeyEnv: mocks.setProviderConfigApiKeyEnv,
    setProviderModelInclude: mocks.setProviderModelInclude,
    updateProviderConfig: mocks.updateProviderConfig,
    updateProviderOperation: mocks.updateProviderOperation,
  };
});

vi.mock('../src/commands/interactive-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/interactive-shared')>();
  return {
    ...actual,
    selectExistingProviderId: mocks.selectExistingProviderId,
  };
});

vi.mock('../src/commands/interactive-add-models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/interactive-add-models')>();
  return {
    ...actual,
    promptModelIncludeSelection: mocks.promptModelIncludeSelection,
  };
});

vi.mock('../src/commands/prompt-adapters', () => ({
  confirmPrompt: mocks.confirmPrompt,
  inputPrompt: mocks.inputPrompt,
  selectPrompt: mocks.selectPrompt,
  withLoadingIndicator: mocks.withLoadingIndicator,
}));

vi.mock('../src/commands/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/render')>();
  return {
    ...actual,
    listRegistryUrls: mocks.listRegistryUrls,
    printServeStartupSummary: mocks.printServeStartupSummary,
    showInteractiveNote: mocks.showInteractiveNote,
    showNote: mocks.showNote,
  };
});

vi.mock('../src/commands/server-runtime', () => ({
  assertValidTcpPort: (port: number) => port,
  findAvailablePort: mocks.findAvailablePort,
  startRegistryServerOnDemand: mocks.startRegistryServerOnDemand,
  waitForServerClose: mocks.waitForServerClose,
}));

describe('interactive provider actions', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('lets users reselect models before updating the selected provider', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('models').mockResolvedValueOnce(Symbol('back'));
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.fetchConfiguredProviderModels.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { include: ['model-a'] },
      models: [{ id: 'model-a' }, { id: 'model-b' }],
    });
    mocks.promptModelIncludeSelection.mockResolvedValueOnce({
      status: 'selected',
      include: ['model-b'],
      selectFromList: true,
    });
    mocks.setProviderModelInclude.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      include: ['model-b'],
    });
    mocks.updateProviderOperation.mockResolvedValueOnce({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
      commit: 'abc123',
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.promptModelIncludeSelection).toHaveBeenCalledWith({
      modelIds: ['model-a', 'model-b'],
      initialSelectFromList: true,
      initialInclude: ['model-a'],
      startInList: true,
      backFromList: 'back',
    });
    expect(mocks.setProviderModelInclude).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      include: ['model-b'],
    });
    expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      models: [{ id: 'model-a' }, { id: 'model-b' }],
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('include: model-b'),
      'Provider updated',
    );
  });

  it('returns to provider selection when backing out of update model selection', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('models').mockResolvedValueOnce(Symbol('back'));
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.fetchConfiguredProviderModels.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { include: ['model-a'] },
      models: [{ id: 'model-a' }],
    });
    mocks.promptModelIncludeSelection.mockResolvedValueOnce({ status: 'back' });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.selectExistingProviderId).toHaveBeenNthCalledWith(
      2,
      '/state',
      'Select provider',
      'provider-a',
    );
    expect(mocks.setProviderModelInclude).not.toHaveBeenCalled();
    expect(mocks.updateProviderOperation).not.toHaveBeenCalled();
    expect(mocks.showNote).not.toHaveBeenCalledWith(expect.any(String), 'Provider updated');
  });

  it('refreshes the selected provider registry', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('refresh').mockResolvedValueOnce(Symbol('back'));
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.updateProviderOperation.mockResolvedValueOnce({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 2,
      metadataMatchSummary: { exact: 1, normalized: 1, unmatched: 0 },
      commit: 'abc123',
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.selectPrompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Update provider-a',
        initialValue: 'name',
      }),
    );
    expect(mocks.showNote).toHaveBeenCalledWith(
      [
        'provider: provider-a',
        'registry: /state/registries/provider-a/api.json',
        'models: 2',
        'metadata matches: exact=1, normalized=1, unmatched=0',
        'commit: abc123',
      ].join('\n'),
      'Provider updated',
    );
  });

  it('updates the selected provider name and refreshes the registry', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('name').mockResolvedValueOnce(Symbol('back'));
    mocks.inputPrompt.mockResolvedValueOnce('New Provider Name');
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.getProviderConfig.mockReturnValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { name: 'Old Provider', baseUrl: 'https://old.example.com', type: 'openai' },
    });
    mocks.updateProviderConfig.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
    });
    mocks.updateProviderOperation.mockResolvedValueOnce({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.inputPrompt).toHaveBeenCalledWith({
      message: 'Provider name',
      initialValue: 'Old Provider',
      validate: expect.any(Function),
    });
    expect(mocks.updateProviderConfig).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      name: 'New Provider Name',
    });
    expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('config: /state/config.json'),
      'Provider updated',
    );
  });

  it('updates the selected provider base URL and refreshes the registry', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('baseUrl').mockResolvedValueOnce(Symbol('back'));
    mocks.inputPrompt.mockResolvedValueOnce(' https://new.example.com ');
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.getProviderConfig.mockReturnValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { name: 'Provider A', baseUrl: 'https://old.example.com', type: 'openai' },
    });
    mocks.updateProviderConfig.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
    });
    mocks.updateProviderOperation.mockResolvedValueOnce({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.inputPrompt).toHaveBeenCalledWith({
      message: 'Provider API base URL',
      placeholder: 'https://api.example.com',
      initialValue: 'https://old.example.com',
      validate: expect.any(Function),
    });
    expect(mocks.updateProviderConfig).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      baseUrl: 'https://new.example.com',
    });
    expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
  });

  it('updates the selected provider API type and refreshes the registry', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt
      .mockResolvedValueOnce('type')
      .mockResolvedValueOnce('anthropic')
      .mockResolvedValueOnce(Symbol('back'));
    mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
    mocks.getProviderConfig.mockReturnValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { name: 'Provider A', baseUrl: 'https://api.example.com', type: 'openai' },
    });
    mocks.updateProviderConfig.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
    });
    mocks.updateProviderOperation.mockResolvedValueOnce({
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.updateProviderConfig).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      type: 'anthropic',
    });
    expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
  });

  it('updates the selected provider update mode without refreshing the registry', async () => {
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt
      .mockResolvedValueOnce('updateMode')
      .mockResolvedValueOnce('overwrite')
      .mockResolvedValueOnce(Symbol('back'));
    mocks.getProviderConfig.mockReturnValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      provider: { name: 'Provider A', baseUrl: 'https://api.example.com', type: 'openai' },
    });
    mocks.updateProviderConfig.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
    });

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.updateProviderConfig).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      updateMode: 'overwrite',
    });
    expect(mocks.updateProviderOperation).not.toHaveBeenCalled();
    expect(mocks.showNote).toHaveBeenCalledWith(
      ['provider: provider-a', 'config: /state/config.json', 'update mode: overwrite'].join('\n'),
      'Provider updated',
    );
  });

  it.each([
    {
      description: 'remote URL',
      input: ' https://models.example.com/models.json ',
      expectedPatch: {
        modelSource: { kind: 'remote_url', url: 'https://models.example.com/models.json' },
      },
    },
    {
      description: 'local file path',
      input: './fixtures/models.json',
      expectedPatch: { modelSource: { kind: 'local_file', path: './fixtures/models.json' } },
    },
    {
      description: 'empty default input',
      input: '   ',
      expectedPatch: { clearModelSource: true },
    },
  ])(
    'updates the selected provider model source from $description',
    async ({ input, expectedPatch }) => {
      mocks.selectExistingProviderId
        .mockResolvedValueOnce('provider-a')
        .mockResolvedValueOnce(undefined);
      mocks.selectPrompt.mockResolvedValueOnce('modelSource').mockResolvedValueOnce(Symbol('back'));
      mocks.inputPrompt.mockResolvedValueOnce(input);
      mocks.withLoadingIndicator.mockImplementation((_message, action) => action());
      mocks.getProviderConfig.mockReturnValueOnce({
        providerId: 'provider-a',
        configPath: '/state/config.json',
        provider: {
          name: 'Provider A',
          baseUrl: 'https://api.example.com/v1',
          type: 'openai',
          modelSource: { kind: 'openai_models', modelsUrl: 'https://old.example.com/models' },
        },
      });
      mocks.updateProviderConfig.mockResolvedValueOnce({
        providerId: 'provider-a',
        configPath: '/state/config.json',
      });
      mocks.updateProviderOperation.mockResolvedValueOnce({
        editablePath: '/state/registries/provider-a/api.json',
        modelCount: 1,
        metadataMatchSummary: { exact: 1, normalized: 0, unmatched: 0 },
      });

      const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

      await runInteractiveUpdateProvider({ stateDir: '/state' });

      expect(mocks.inputPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Model list source',
          initialValue: 'https://old.example.com/models',
        }),
      );
      expect(mocks.updateProviderConfig).toHaveBeenCalledWith({
        stateDir: '/state',
        providerId: 'provider-a',
        ...expectedPatch,
      });
      expect(mocks.updateProviderOperation).toHaveBeenCalledWith({
        stateDir: '/state',
        providerId: 'provider-a',
      });
    },
  );

  it('returns to provider management when auth configuration asks to go back', async () => {
    const configureProviderAuthForSelectedProvider = vi.fn().mockResolvedValueOnce('back');
    mocks.selectExistingProviderId
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce(undefined);
    mocks.selectPrompt.mockResolvedValueOnce('auth').mockResolvedValueOnce(Symbol('back'));

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({
      stateDir: '/state',
      runtime: { configureProviderAuthForSelectedProvider },
    });

    expect(configureProviderAuthForSelectedProvider).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.updateProviderOperation).not.toHaveBeenCalled();
  });

  it('stores an API key for the selected provider', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce('provider-a');
    mocks.getProviderAuthState.mockReturnValue({
      authPath: '/state/auth.json',
      currentAuth: undefined,
      currentProviderConfig: {},
    });
    mocks.selectPrompt.mockResolvedValueOnce('store');
    mocks.inputPrompt.mockResolvedValueOnce('secret-key');
    mocks.configureProviderAuth.mockResolvedValueOnce({
      authPath: '/state/auth.json',
      stored: 'apiKey',
    });
    mocks.setProviderConfigApiKeyEnv.mockResolvedValueOnce({ configPath: '/state/config.json' });

    const { runInteractiveConfigureAuth } = await import('../src/commands/interactive-actions');

    await runInteractiveConfigureAuth({ stateDir: '/state' });

    expect(mocks.configureProviderAuth).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      apiKey: 'secret-key',
    });
    expect(mocks.setProviderConfigApiKeyEnv).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('current: Stored API key'),
      'Configure auth',
    );
  });

  it('stores an environment variable auth reference and mirrors it into provider config', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce('provider-a');
    mocks.getProviderAuthState.mockReturnValue({
      authPath: '/state/auth.json',
      currentAuth: undefined,
      currentProviderConfig: { apiKeyEnv: 'OLD_PROVIDER_KEY' },
    });
    mocks.selectPrompt.mockResolvedValueOnce('env');
    mocks.inputPrompt.mockResolvedValueOnce(' NEW_PROVIDER_KEY ');
    mocks.configureProviderAuth.mockResolvedValueOnce({
      authPath: '/state/auth.json',
      stored: 'apiKeyEnv',
    });
    mocks.setProviderConfigApiKeyEnv.mockResolvedValueOnce({ configPath: '/state/config.json' });

    const { runInteractiveConfigureAuth } = await import('../src/commands/interactive-actions');

    await runInteractiveConfigureAuth({ stateDir: '/state' });

    expect(mocks.configureProviderAuth).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      apiKeyEnv: 'NEW_PROVIDER_KEY',
    });
    expect(mocks.setProviderConfigApiKeyEnv).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      apiKeyEnv: 'NEW_PROVIDER_KEY',
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('current: Environment variable (NEW_PROVIDER_KEY)'),
      'Configure auth',
    );
  });

  it('clears stored auth and config env references only after confirmation', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce('provider-a');
    mocks.getProviderAuthState.mockReturnValue({
      authPath: '/state/auth.json',
      currentAuth: { apiKeyEnv: 'PROVIDER_A_KEY' },
      currentProviderConfig: { apiKeyEnv: 'PROVIDER_A_KEY' },
    });
    mocks.selectPrompt.mockResolvedValueOnce('stopUsingEnv');
    mocks.confirmPrompt.mockResolvedValueOnce(true);
    mocks.configureProviderAuth.mockResolvedValueOnce({
      authPath: '/state/auth.json',
      stored: 'none',
    });
    mocks.setProviderConfigApiKeyEnv.mockResolvedValueOnce({ configPath: '/state/config.json' });

    const { runInteractiveConfigureAuth } = await import('../src/commands/interactive-actions');

    await runInteractiveConfigureAuth({ stateDir: '/state' });

    expect(mocks.configureProviderAuth).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
      clear: true,
    });
    expect(mocks.setProviderConfigApiKeyEnv).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('current: No auth configured'),
      'Configure auth',
    );
  });

  it('leaves auth unchanged when a destructive auth action is not confirmed', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce('provider-a');
    mocks.getProviderAuthState.mockReturnValue({
      authPath: '/state/auth.json',
      currentAuth: { apiKey: 'secret-key' },
      currentProviderConfig: {},
    });
    mocks.selectPrompt.mockResolvedValueOnce('clearStoredKey');
    mocks.confirmPrompt.mockResolvedValueOnce(false);

    const { runInteractiveConfigureAuth } = await import('../src/commands/interactive-actions');

    await runInteractiveConfigureAuth({ stateDir: '/state' });

    expect(mocks.configureProviderAuth).not.toHaveBeenCalled();
    expect(mocks.setProviderConfigApiKeyEnv).not.toHaveBeenCalled();
    expect(mocks.showNote).toHaveBeenCalledWith('No auth changes made.', 'Configure auth');
  });

  it('removes a provider after file handling and confirmation prompts', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce('provider-a');
    mocks.selectPrompt.mockResolvedValueOnce('delete');
    mocks.confirmPrompt.mockResolvedValueOnce(true);
    mocks.withLoadingIndicator.mockImplementationOnce((_message, action) => action());
    mocks.removeProvider.mockResolvedValueOnce({
      providerId: 'provider-a',
      configPath: '/state/config.json',
      authPath: '/state/auth.json',
      deletedFiles: true,
      commit: 'abc123',
    });

    const { runInteractiveRemoveProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveRemoveProvider({ stateDir: '/state' });

    expect(mocks.removeProvider).toHaveBeenCalledWith({
      stateDir: '/state',
      providerId: 'provider-a',
    });
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('files: deleted'),
      'Provider removed',
    );
  });

  it('shows an actionable interactive registry list and handles the empty state', async () => {
    mocks.listRegistryUrls.mockReturnValueOnce([
      { providerId: 'provider-a', url: 'http://127.0.0.1:3000/provider-a/api.json' },
      { providerId: 'provider-b', url: 'http://127.0.0.1:3000/provider-b/api.json' },
    ]);

    const { runInteractiveListProviders } = await import('../src/commands/interactive-actions');

    await runInteractiveListProviders({
      stateDir: '/state/../state',
      host: '127.0.0.1',
      port: '3000',
    });

    expect(mocks.listRegistryUrls).toHaveBeenCalledWith('/state', '127.0.0.1', '3000');
    expect(mocks.showInteractiveNote).toHaveBeenCalledWith(
      expect.any(Function),
      'Providers: /state',
    );
    const renderList = mocks.showInteractiveNote.mock.calls[0]?.[0];
    expect(typeof renderList).toBe('function');
    expect(renderList()).toContain('provider-a');
    expect(renderList()).toContain('provider-b');

    mocks.listRegistryUrls.mockReturnValueOnce([]);
    await runInteractiveListProviders({ stateDir: '/empty', host: '127.0.0.1', port: '3000' });

    expect(mocks.showInteractiveNote).toHaveBeenLastCalledWith(
      'No providers configured yet.',
      'Providers: /empty',
    );
  });

  it('serves from interactive mode, reports a port fallback, and always stops the summary renderer', async () => {
    const stopRenderingServeSummary = vi.fn();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.findAvailablePort.mockResolvedValueOnce(3100);
    mocks.printServeStartupSummary.mockReturnValueOnce(stopRenderingServeSummary);
    mocks.startRegistryServerOnDemand.mockResolvedValueOnce({ close: vi.fn() });
    mocks.waitForServerClose.mockResolvedValueOnce(undefined);

    const { runInteractiveServe } = await import('../src/commands/interactive-actions');

    await runInteractiveServe({ stateDir: '/state/../state', host: '127.0.0.1', port: '3000' });

    expect(stderrWrite).toHaveBeenCalledWith('port 3000 is unavailable, using 3100\n');
    expect(mocks.printServeStartupSummary).toHaveBeenCalledWith('/state', '127.0.0.1', '3100');
    expect(mocks.startRegistryServerOnDemand).toHaveBeenCalledWith({
      stateDir: '/state',
      host: '127.0.0.1',
      port: 3100,
    });
    expect(stopRenderingServeSummary).toHaveBeenCalledTimes(1);

    stderrWrite.mockRestore();
  });

  it('propagates the interactive home signal after closing serve mode and still cleans up rendering', async () => {
    const stopRenderingServeSummary = vi.fn();
    mocks.findAvailablePort.mockResolvedValueOnce(3000);
    mocks.printServeStartupSummary.mockReturnValueOnce(stopRenderingServeSummary);
    mocks.startRegistryServerOnDemand.mockResolvedValueOnce({ close: vi.fn() });

    const { interactiveHomeSymbol } = await import('../src/prompts/navigation');
    mocks.waitForServerClose.mockResolvedValueOnce(interactiveHomeSymbol);

    const { runInteractiveServe } = await import('../src/commands/interactive-actions');

    await expect(
      runInteractiveServe({ stateDir: '/state', host: '127.0.0.1', port: '3000' }),
    ).rejects.toBe(interactiveHomeSymbol);
    expect(stopRenderingServeSummary).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-provider message when update has no provider to select', async () => {
    mocks.selectExistingProviderId.mockResolvedValueOnce(undefined);

    const { runInteractiveUpdateProvider } = await import('../src/commands/interactive-actions');

    await runInteractiveUpdateProvider({ stateDir: '/state' });

    expect(mocks.updateProviderOperation).not.toHaveBeenCalled();
    expect(mocks.showNote).toHaveBeenCalledWith('No providers configured yet.', 'Update provider');
  });
});
