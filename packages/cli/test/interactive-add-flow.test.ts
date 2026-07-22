import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirmPrompt: vi.fn(),
  ensureInteractiveModels: vi.fn(),
  findAvailablePort: vi.fn(),
  inputPrompt: vi.fn(),
  printServeStartupSummary: vi.fn(),
  promptModelIncludeSelection: vi.fn(),
  saveAndUpdateInteractiveProvider: vi.fn(),
  selectPrompt: vi.fn(),
  showNote: vi.fn(),
  startRegistryServerOnDemand: vi.fn(),
  waitForServerClose: vi.fn(),
}));

vi.mock('../src/commands/interactive-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/interactive-shared')>();
  return {
    ...actual,
    listConfiguredProviderIds: () => [],
  };
});

vi.mock('../src/commands/prompt-adapters', () => ({
  confirmPrompt: mocks.confirmPrompt,
  inputPrompt: mocks.inputPrompt,
  selectPrompt: mocks.selectPrompt,
}));

vi.mock('../src/commands/interactive-add-models', () => ({
  ensureInteractiveModels: mocks.ensureInteractiveModels,
  promptModelIncludeSelection: mocks.promptModelIncludeSelection,
}));

vi.mock('../src/commands/interactive-add-action', () => ({
  saveAndUpdateInteractiveProvider: mocks.saveAndUpdateInteractiveProvider,
}));

vi.mock('../src/commands/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/render')>();
  return {
    ...actual,
    printServeStartupSummary: mocks.printServeStartupSummary,
    showNote: mocks.showNote,
  };
});

vi.mock('../src/commands/server-runtime', () => ({
  assertValidTcpPort: (port: number) => port,
  findAvailablePort: mocks.findAvailablePort,
  startRegistryServerOnDemand: mocks.startRegistryServerOnDemand,
  waitForServerClose: mocks.waitForServerClose,
}));

describe('interactive add provider flow', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('walks the add wizard, finalizes the provider, and returns to the menu when server start is declined', async () => {
    mocks.inputPrompt
      .mockResolvedValueOnce('provider-a')
      .mockResolvedValueOnce('https://api.example.com/v1')
      .mockResolvedValueOnce('PROVIDER_A_KEY')
      .mockResolvedValueOnce('');
    mocks.selectPrompt.mockResolvedValueOnce('env').mockResolvedValueOnce('anthropic');
    mocks.ensureInteractiveModels.mockResolvedValueOnce({
      status: 'ok',
      modelIds: ['claude-a'],
      models: [{ id: 'claude-a' }],
    });
    mocks.promptModelIncludeSelection.mockResolvedValueOnce({
      status: 'selected',
      include: ['claude-a'],
      selectFromList: true,
    });
    mocks.saveAndUpdateInteractiveProvider.mockResolvedValueOnce({
      configPath: '/state/config.json',
      stateDir: '/state',
      editablePath: '/state/registries/provider-a/api.json',
      modelCount: 1,
      commit: 'abc123',
    });
    mocks.confirmPrompt.mockResolvedValueOnce(false);

    const { runInteractiveAddProvider } = await import('../src/commands/interactive-add');

    await expect(
      runInteractiveAddProvider({ stateDir: '/state', host: '127.0.0.1', port: '2727' }),
    ).resolves.toBe(true);

    expect(mocks.inputPrompt.mock.calls.map(([options]) => options.message)).toEqual([
      'Provider ID',
      'Provider API base URL',
      'API key environment variable',
      'Model list source (empty = default, URL = custom remote URL, path = local file)',
    ]);
    expect(mocks.selectPrompt.mock.calls.map(([options]) => options.message)).toEqual([
      'API key source',
      'Provider API type',
    ]);
    expect(mocks.ensureInteractiveModels).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider-a',
        baseUrl: 'https://api.example.com/v1',
        authMode: 'env',
        apiKeyEnv: 'PROVIDER_A_KEY',
        providerType: 'anthropic',
      }),
    );
    expect(mocks.promptModelIncludeSelection).toHaveBeenCalledWith({
      modelIds: ['claude-a'],
      initialSelectFromList: true,
      startInList: false,
    });
    expect(mocks.saveAndUpdateInteractiveProvider).toHaveBeenCalledWith({
      stateDir: '/state',
      state: expect.objectContaining({
        providerId: 'provider-a',
        include: ['claude-a'],
      }),
    });
    expect(mocks.confirmPrompt).toHaveBeenCalledWith({
      message: 'Start registry server now?',
      initialValue: true,
    });
    expect(mocks.findAvailablePort).not.toHaveBeenCalled();
    expect(mocks.startRegistryServerOnDemand).not.toHaveBeenCalled();
    expect(mocks.showNote).toHaveBeenCalledWith(
      expect.stringContaining('provider: provider-a'),
      'Provider added',
    );
  });
});
