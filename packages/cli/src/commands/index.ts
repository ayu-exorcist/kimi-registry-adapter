import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { configureDiagnostics } from '@kastral/kra-core';
import { defineCommand, runMain } from 'citty';
import pc from 'picocolors';

import { isInteractiveHome } from '../prompts/navigation';
import { formatShortcutHint } from '../prompts/shortcut-hints';
import { disposePromptReadline } from '../prompts/terminal-session';
import { normalizeVariadicPatternOptions } from './args';
import { createCommandModeSubcommands } from './command-mode';
import {
  runInteractiveListProviders,
  runInteractiveRemoveProvider,
  runInteractiveServe,
  runInteractiveUpdateProvider,
} from './interactive-actions';
import { runInteractiveAddProvider } from './interactive-add';
import {
  defaultProviderApiKeyEnvName,
  describeInteractiveAuthState,
  getInteractiveAuthOptions,
  getInteractiveMenuOptions,
  listConfiguredProviderIds,
  unwrapCustomSelect,
  validateNewProviderId,
  type MainInteractiveAction,
} from './interactive-shared';
import { selectPrompt } from './prompt-adapters';
import { printConnectedSpacer, printIntro, printOutro, showInteractiveNote } from './render';

const DEFAULT_STATE_DIR = resolve(homedir(), '.kimi-registry-adapter');
configureDiagnostics({ defaultLogDir: resolve(DEFAULT_STATE_DIR, 'logs') });
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 2727;

const formatInteractiveError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.split('\n')[0] ?? error.message;
  }
  return 'Unknown error';
};

const showInteractiveError = async (error: unknown, title = 'Action failed'): Promise<void> => {
  await showInteractiveNote(formatInteractiveError(error), title);
};

export const testExports = {
  getInteractiveMenuOptions,
  listConfiguredProviderIds,
  validateNewProviderId,
  defaultProviderApiKeyEnvName,
  describeInteractiveAuthState,
  getInteractiveAuthOptions,
  formatInteractiveError,
};

const runInteractiveMenu = async (options: {
  stateDir: string;
  host: string;
  port: string;
}): Promise<void> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive mode requires a TTY. Use kra add <providerId> --base-url <url> for non-interactive usage.',
    );
  }

  printIntro(pc.bold('Kimi Registry Adapter'));
  printConnectedSpacer();

  let selectedMainAction: MainInteractiveAction = 'add';

  while (true) {
    const providerIds = listConfiguredProviderIds(options.stateDir);
    const rawAction: MainInteractiveAction | symbol = await selectPrompt<MainInteractiveAction>({
      message: 'Main menu',
      options: getInteractiveMenuOptions(providerIds),
      initialValue: selectedMainAction,
      cancelHint: formatShortcutHint('ctrl+c exit'),
      cancelOnEscape: false,
      cancelOnLeft: false,
    });
    if (isInteractiveHome(rawAction)) {
      continue;
    }
    const action: MainInteractiveAction | undefined = unwrapCustomSelect(rawAction);

    if (action === undefined) {
      printOutro('Bye!');
      return;
    }

    selectedMainAction = action;

    try {
      if (action === 'add') {
        const shouldContinue = await runInteractiveAddProvider(options);
        if (shouldContinue) {
          printConnectedSpacer();
          continue;
        }
        return;
      }

      if (action === 'list') {
        await runInteractiveListProviders(options);
        printConnectedSpacer();
        continue;
      }

      if (action === 'update') {
        await runInteractiveUpdateProvider(options);
        printConnectedSpacer();
        continue;
      }

      if (action === 'remove') {
        await runInteractiveRemoveProvider(options);
        printConnectedSpacer();
        continue;
      }

      await runInteractiveServe(options);
      return;
    } catch (error) {
      if (isInteractiveHome(error)) {
        printConnectedSpacer();
        continue;
      }
      await showInteractiveError(error);
      printConnectedSpacer();
    }
  }
};

const runInteractiveSetup = async (options: {
  stateDir: string;
  host: string;
  port: string;
}): Promise<void> => {
  try {
    await runInteractiveMenu(options);
  } finally {
    disposePromptReadline();
  }
};

const commandModeSubcommands = createCommandModeSubcommands({
  stateDir: DEFAULT_STATE_DIR,
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
});

const interactiveCommand = defineCommand({
  meta: { name: '__default', hidden: true },
  async run() {
    await runInteractiveSetup({
      stateDir: DEFAULT_STATE_DIR,
      host: DEFAULT_HOST,
      port: `${DEFAULT_PORT}`,
    });
  },
});

const mainCommand = defineCommand({
  meta: {
    name: 'kra',
    description:
      'Generate editable Kimi provider registries from OpenAI-compatible /models endpoints.',
  },
  default: '__default',
  subCommands: {
    __default: interactiveCommand,
    ...commandModeSubcommands,
  },
});

export const runCli = async (argv: string[]): Promise<void> => {
  await runMain(mainCommand, { rawArgs: normalizeVariadicPatternOptions(argv) });
};
