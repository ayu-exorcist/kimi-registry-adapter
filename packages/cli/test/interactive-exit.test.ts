import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  disposePromptReadline: vi.fn(),
  listConfiguredProviderIds: vi.fn((): string[] => []),
  printConnectedSpacer: vi.fn(),
  printIntro: vi.fn(),
  printOutro: vi.fn(),
  selectPrompt: vi.fn(),
}));

vi.mock('../src/prompts/terminal-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/prompts/terminal-session')>();
  return {
    ...actual,
    disposePromptReadline: mocks.disposePromptReadline,
  };
});

vi.mock('../src/commands/interactive-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/interactive-shared')>();
  return {
    ...actual,
    listConfiguredProviderIds: mocks.listConfiguredProviderIds,
  };
});

vi.mock('../src/commands/prompt-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/prompt-adapters')>();
  return {
    ...actual,
    selectPrompt: mocks.selectPrompt,
  };
});

vi.mock('../src/commands/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/render')>();
  return {
    ...actual,
    printConnectedSpacer: mocks.printConnectedSpacer,
    printIntro: mocks.printIntro,
    printOutro: mocks.printOutro,
  };
});

describe('interactive menu exit', () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTTY,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTTY,
    });
  });

  it('disposes the shared prompt readline when the main menu is cancelled', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    mocks.selectPrompt.mockResolvedValueOnce(Symbol('cancel'));

    const { runCli } = await import('../src/index');

    await expect(runCli([])).resolves.toBeUndefined();

    expect(mocks.selectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Main menu',
        cancelOnEscape: false,
        cancelOnLeft: false,
      }),
    );
    expect(mocks.printOutro).toHaveBeenCalledWith('Bye!');
    expect(mocks.disposePromptReadline).toHaveBeenCalledTimes(1);
  });
});
