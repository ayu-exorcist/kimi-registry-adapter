import { removeProvider } from '@kastral/kra-core';

import {
  selectExistingProviderId,
  unwrapCustomSelect,
  unwrapSubmenuPrompt,
} from './interactive-shared';
import { confirmPrompt, selectPrompt, withLoadingIndicator } from './prompt-adapters';
import { showNote } from './render';

type RemoveProviderFilesAction = 'delete' | 'keep';

export const runInteractiveRemoveProvider = async (options: {
  stateDir: string;
}): Promise<void> => {
  let currentStep: 'provider' | 'files' | 'confirm' = 'provider';
  let selectedProviderId: string | undefined;
  let selectedFilesAction: RemoveProviderFilesAction | undefined;

  while (true) {
    if (currentStep === 'provider') {
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
      selectedFilesAction = undefined;
      currentStep = 'files';
      continue;
    }

    if (currentStep === 'files') {
      const filesAction = unwrapCustomSelect(
        await selectPrompt<RemoveProviderFilesAction>({
          message: 'Local registry files',
          options: [
            { value: 'delete', label: 'Delete local files' },
            { value: 'keep', label: 'Keep local files' },
          ],
          initialValue: selectedFilesAction ?? 'delete',
        }),
      );

      if (filesAction === undefined) {
        currentStep = 'provider';
        continue;
      }

      selectedFilesAction = filesAction;
      currentStep = 'confirm';
      continue;
    }

    const providerId = selectedProviderId;
    if (providerId === undefined) {
      currentStep = 'provider';
      continue;
    }

    const filesAction = selectedFilesAction ?? 'delete';
    const keepFiles = filesAction === 'keep';
    const confirmed = unwrapSubmenuPrompt(
      await confirmPrompt({
        message: `Remove ${providerId} config/auth${keepFiles ? '' : ' and local registry files'}?`,
        initialValue: true,
      }),
    );

    if (confirmed === undefined) {
      currentStep = 'files';
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
          ...(keepFiles ? { keepFiles } : {}),
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
