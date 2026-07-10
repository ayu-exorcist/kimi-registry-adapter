import pc from 'picocolors';

import type { interactiveHomeSymbol } from '../prompts/navigation';
import { clearTerminalScreen, FrameRenderer, waitForScreenExit } from '../prompts/screen';
import { subscribeTerminalResize } from '../prompts/terminal-session';
import { listAvailableRegistries } from '../server/registry-listing';
import { subscribeColorPalette } from '../theme';
import { formatRegistryListing, formatResultMessage, getResultScreenLines } from './result-format';
import { importUrl as buildImportUrl } from './serve-command';

export { formatRegistryListing } from './result-format';

export type RegistryListing = {
  providerId: string;
  url: string;
  updatedAt: Date;
};

export const printIntro = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

export const printConnectedSpacer = (): void => {
  process.stdout.write(`${pc.dim('│')}\n`);
};

export const printOutro = (message: string): void => {
  process.stdout.write(`${pc.dim('╰')}  ${message}\n`);
};

export const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const showResultScreen = (
  title: string,
  sections: string[],
  options: { interactive?: boolean } = {},
): void => {
  clearTerminalScreen();
  process.stdout.write(`${getResultScreenLines(title, sections, options).join('\n')}\n`);
};

export const showNote = (message: string | (() => string), title: string): void => {
  const resolvedMessage = typeof message === 'function' ? message() : message;
  showResultScreen(title, formatResultMessage(resolvedMessage));
};

const showPersistentNote = (
  message: string | (() => string),
  title: string,
  options: { hint?: string } = {},
): (() => void) => {
  const frame = new FrameRenderer();

  const render = (): void => {
    const resolvedMessage = typeof message === 'function' ? message() : message;
    const lines = getResultScreenLines(title, formatResultMessage(resolvedMessage), options);
    frame.render(lines);
  };

  const redrawScreen = (): void => {
    frame.reset();
    clearTerminalScreen();
    render();
  };

  const resizeHandler = (): void => {
    redrawScreen();
  };

  redrawScreen();
  const unsubscribeResize = subscribeTerminalResize(resizeHandler, { poll: true });
  const unsubscribeTheme = subscribeColorPalette(redrawScreen);
  return () => {
    unsubscribeTheme();
    unsubscribeResize();
  };
};

export const showInteractiveNote = async (
  message: string | (() => string),
  title: string,
): Promise<typeof interactiveHomeSymbol | undefined> => {
  const frame = new FrameRenderer();

  const render = (): void => {
    const resolvedMessage = typeof message === 'function' ? message() : message;
    const lines = getResultScreenLines(title, formatResultMessage(resolvedMessage), {
      interactive: true,
    });
    frame.render(lines);
  };

  const redrawScreen = (): void => {
    frame.reset();
    clearTerminalScreen();
    render();
  };

  redrawScreen();
  return waitForScreenExit(redrawScreen);
};

export const importUrl = (providerId: string, host: string, port: string): string => {
  return buildImportUrl(providerId, host, port);
};

export const listRegistryUrls = (
  stateDir: string,
  host: string,
  port: string,
): RegistryListing[] => {
  return listAvailableRegistries(stateDir)
    .map((registry) => ({
      providerId: registry.providerId,
      url: importUrl(registry.providerId, host, port),
      updatedAt: registry.updatedAt,
    }))
    .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
};

export const printServeStartupSummary = (
  stateDir: string,
  host: string,
  port: string,
  options: { leadingSpacer?: boolean } = {},
): (() => void) => {
  if (options.leadingSpacer) {
    process.stderr.write(`${pc.dim('│')}\n`);
  }

  return showPersistentNote(
    () => {
      const registries = listRegistryUrls(stateDir, host, port);
      return (
        registries.length === 0
          ? ['No registries configured.']
          : registries.flatMap((registry) =>
              formatRegistryListing(registry.providerId, registry.url),
            )
      ).join('\n');
    },
    `Registry: ${stateDir}`,
    { hint: 'esc/← return · alt+h main menu · ctrl+c exit' },
  );
};
