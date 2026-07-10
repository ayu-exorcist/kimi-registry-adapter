import { removeProvider } from '@kastral/kra-core';

import { selectExistingProviderId, unwrapSubmenuPrompt } from './interactive-shared';
import { confirmPrompt, withLoadingIndicator } from './prompt-adapters';
import { showNote } from './render';

export const runInteractiveRemoveProvider = async (options: {
  stateDir: string;
}): Promise<void> => {
  let selectedProviderId: string | undefined;

  while (true) {
    const providerId = await selectExistingProviderId(
      options.stateDir,
      'Select provider to remove',
      selectedProviderId,
    );

    if (!providerId) {
      showNote('No providers configured yet.', 'Remove provider');
      return;
    }

    selectedProviderId = providerId;
    const confirmed = unwrapSubmenuPrompt(
      await confirmPrompt({
        message: `Remove ${providerId} config/auth and local registry files?`,
        initialValue: true,
      }),
    );

    if (confirmed === undefined) {
      continue;
    }

    if (!confirmed) {
      showNote('No provider removed.', 'Remove provider');
      return;
    }

    const result = await withLoadingIndicator(
      'Removing provider...',
      async () =>
        removeProvider({
          stateDir: options.stateDir,
          providerId,
        }),
      { delayMs: 50 },
    );
    showNote(
      [
        `provider: ${providerId}`,
        `config: ${result.configPath}`,
        `auth: ${result.authPath}`,
        `files: ${result.deletedFiles ? 'deleted' : 'kept'}`,
        ...(result.commit ? [`commit: ${result.commit}`] : []),
      ].join('\n'),
      'Provider removed',
    );
    return;
  }
};
