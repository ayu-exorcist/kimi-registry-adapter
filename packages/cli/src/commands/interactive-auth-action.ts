import {
  configureProviderAuth,
  getProviderAuthState,
  setProviderConfigApiKeyEnv,
} from '@kastral/kra-core';

import {
  defaultProviderApiKeyEnvName,
  describeInteractiveAuthState,
  getInteractiveAuthOptions,
  requiredText,
  selectExistingProviderId,
  unwrapCustomSelect,
  unwrapSubmenuPrompt,
  type InteractiveAuthAction,
} from './interactive-shared';
import { confirmPrompt, inputPrompt, selectPrompt } from './prompt-adapters';
import { showNote } from './render';

type ProviderActionResult = 'done' | 'back';

export const configureProviderAuthForSelectedProvider = async (options: {
  stateDir: string;
  providerId: string;
}): Promise<ProviderActionResult> => {
  let currentStep: 'action' | 'value' | 'confirm' = 'action';
  let selectedAuthAction: InteractiveAuthAction | undefined;

  while (true) {
    const providerAuthState = getProviderAuthState({
      stateDir: options.stateDir,
      providerId: options.providerId,
    });
    const authState = describeInteractiveAuthState({
      currentAuth: providerAuthState.currentAuth,
      currentProviderConfig: providerAuthState.currentProviderConfig,
    });
    const authActionOptions = getInteractiveAuthOptions({
      hasStoredApiKey: authState.hasStoredApiKey,
      hasEnvReference: authState.hasEnvReference,
    });

    if (currentStep === 'action') {
      let initialAuthAction = authActionOptions.initialValue;
      for (const option of authActionOptions.options) {
        if (option.value === selectedAuthAction) {
          initialAuthAction = selectedAuthAction;
          break;
        }
      }

      const action = unwrapCustomSelect(
        await selectPrompt<InteractiveAuthAction>({
          message: 'Auth action',
          options: authActionOptions.options,
          initialValue: initialAuthAction,
        }),
      );

      if (action === undefined) {
        return 'back';
      }

      selectedAuthAction = action;
      currentStep = action === 'clearStoredKey' || action === 'stopUsingEnv' ? 'confirm' : 'value';
      continue;
    }

    const action = selectedAuthAction;
    if (action === undefined) {
      currentStep = 'action';
      continue;
    }

    if (currentStep === 'confirm') {
      const confirmed = unwrapSubmenuPrompt(
        await confirmPrompt({
          message:
            action === 'clearStoredKey'
              ? `Clear the stored API key for ${options.providerId}?`
              : `Stop using the environment variable for ${options.providerId}?`,
          initialValue: true,
        }),
      );

      if (confirmed === undefined) {
        currentStep = 'action';
        continue;
      }

      if (!confirmed) {
        showNote('No auth changes made.', 'Configure auth');
        return 'done';
      }

      await configureProviderAuth({
        stateDir: options.stateDir,
        providerId: options.providerId,
        clear: true,
      });
      const configPath =
        action === 'stopUsingEnv'
          ? (
              await setProviderConfigApiKeyEnv({
                stateDir: options.stateDir,
                providerId: options.providerId,
              })
            ).configPath
          : undefined;
      showNote(
        [
          `provider: ${options.providerId}`,
          `auth: ${providerAuthState.authPath}`,
          ...(configPath ? [`config: ${configPath}`] : []),
          `stored: none`,
          'current: No auth configured',
        ].join('\n'),
        'Configure auth',
      );
      return 'done';
    }

    const apiKey =
      action === 'store'
        ? unwrapSubmenuPrompt(
            await inputPrompt({
              message: 'API key',
              validate: requiredText,
              mask: true,
            }),
          )
        : undefined;

    if (action === 'store' && apiKey === undefined) {
      currentStep = 'action';
      continue;
    }

    const apiKeyEnvInput =
      action === 'env'
        ? unwrapSubmenuPrompt(
            await inputPrompt({
              message: 'API key environment variable',
              placeholder: defaultProviderApiKeyEnvName(options.providerId),
              initialValue: authState.currentApiKeyEnv ?? '',
              validate: requiredText,
            }),
          )
        : undefined;

    if (action === 'env' && apiKeyEnvInput === undefined) {
      currentStep = 'action';
      continue;
    }

    const resolvedApiKey = apiKey?.trim();
    const apiKeyEnv = apiKeyEnvInput?.trim();

    const authResult = await configureProviderAuth({
      stateDir: options.stateDir,
      providerId: options.providerId,
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
    });
    const { configPath } = await setProviderConfigApiKeyEnv({
      stateDir: options.stateDir,
      providerId: options.providerId,
      ...(action === 'env' && apiKeyEnv ? { apiKeyEnv } : {}),
    });
    showNote(
      [
        `provider: ${options.providerId}`,
        `auth: ${authResult.authPath}`,
        `config: ${configPath}`,
        `stored: ${authResult.stored}`,
        `current: ${action === 'store' ? 'Stored API key' : `Environment variable (${apiKeyEnv})`}`,
      ].join('\n'),
      'Configure auth',
    );
    return 'done';
  }
};

export const runInteractiveConfigureAuth = async (options: { stateDir: string }): Promise<void> => {
  let selectedProviderId: string | undefined;

  while (true) {
    const providerId = await selectExistingProviderId(
      options.stateDir,
      'Select provider to configure auth',
      selectedProviderId,
    );

    if (!providerId) {
      showNote('No providers configured yet.', 'Configure auth');
      return;
    }

    selectedProviderId = providerId;
    const result = await configureProviderAuthForSelectedProvider({
      stateDir: options.stateDir,
      providerId,
    });
    if (result === 'back') {
      continue;
    }
    return;
  }
};
