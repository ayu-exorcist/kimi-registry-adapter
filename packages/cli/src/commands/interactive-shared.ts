import {
  defaultProviderApiKeyEnvName,
  isValidProviderId,
  listProviders,
  providerIdFormatDescription,
} from '@kastral/kra-core';

import { isInteractiveHome } from '../prompts/navigation';
import { selectPrompt } from './prompt-adapters';

export type MainInteractiveAction = 'add' | 'list' | 'update' | 'remove' | 'serve';
export type InteractiveAuthAction = 'store' | 'env' | 'clearStoredKey' | 'stopUsingEnv';

const isPromptCancel = (value: unknown): value is symbol => typeof value === 'symbol';

export const unwrapSubmenuPrompt = <T>(value: T | symbol): T | undefined => {
  if (isInteractiveHome(value)) {
    throw value;
  }
  if (isPromptCancel(value) || typeof value === 'symbol') {
    return undefined;
  }

  return value;
};

export const unwrapCustomSelect = <T>(value: T | symbol): T | undefined => {
  if (isInteractiveHome(value)) {
    throw value;
  }
  return typeof value === 'symbol' ? undefined : value;
};

export const requiredText = (value: string | undefined): string | undefined => {
  return value && value.trim().length > 0 ? undefined : 'Required.';
};

export const optionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const listConfiguredProviderIds = (stateDir: string): string[] => {
  return listProviders({ stateDir }).providers.toSorted((left, right) => left.localeCompare(right));
};

export const validateNewProviderId =
  (existingProviderIds: string[]) =>
  (value: string | undefined): string | undefined => {
    const requiredError = requiredText(value);
    if (requiredError) {
      return requiredError;
    }

    const providerId = value?.trim() ?? '';
    if (!isValidProviderId(providerId)) {
      return providerIdFormatDescription;
    }
    if (existingProviderIds.includes(providerId)) {
      return 'Provider id already exists.';
    }

    return undefined;
  };

export { defaultProviderApiKeyEnvName };

export const describeInteractiveAuthState = (options: {
  currentAuth: { apiKey?: string | undefined; apiKeyEnv?: string | undefined } | undefined;
  currentProviderConfig: { apiKeyEnv?: string | undefined } | undefined;
}): {
  hasStoredApiKey: boolean;
  hasEnvReference: boolean;
  currentApiKeyEnv: string | undefined;
  currentModeLabel: string;
} => {
  const hasStoredApiKey = Boolean(options.currentAuth?.apiKey);
  const currentApiKeyEnv =
    options.currentAuth?.apiKeyEnv ?? options.currentProviderConfig?.apiKeyEnv;
  const hasEnvReference = Boolean(currentApiKeyEnv);

  return {
    hasStoredApiKey,
    hasEnvReference,
    currentApiKeyEnv,
    currentModeLabel: hasStoredApiKey
      ? 'Stored API key'
      : currentApiKeyEnv
        ? `Environment variable (${currentApiKeyEnv})`
        : 'No auth configured',
  };
};

export const getInteractiveAuthOptions = (options: {
  hasStoredApiKey: boolean;
  hasEnvReference: boolean;
}): {
  options: Array<{ value: InteractiveAuthAction; label: string; hint?: string }>;
  initialValue: InteractiveAuthAction;
} => {
  const authOptions: Array<{ value: InteractiveAuthAction; label: string; hint?: string }> = [
    {
      value: 'store',
      label: 'Use stored API key',
      ...(options.hasEnvReference ? { hint: 'Stops using the environment variable' } : {}),
    },
    {
      value: 'env',
      label: 'Use environment variable',
      ...(options.hasStoredApiKey ? { hint: 'Clears the stored API key' } : {}),
    },
  ];

  if (options.hasStoredApiKey) {
    authOptions.push({ value: 'clearStoredKey', label: 'Clear stored API key' });
  }

  if (options.hasEnvReference) {
    authOptions.push({ value: 'stopUsingEnv', label: 'Stop using environment variable' });
  }

  return {
    options: authOptions,
    initialValue: options.hasStoredApiKey ? 'store' : options.hasEnvReference ? 'env' : 'store',
  };
};

export const selectExistingProviderId = async (
  stateDir: string,
  message: string,
  initialProviderId?: string,
): Promise<string | undefined> => {
  const providerIds = listConfiguredProviderIds(stateDir);

  if (providerIds.length === 0) {
    return undefined;
  }

  const selected = unwrapCustomSelect(
    await selectPrompt<string>({
      message,
      options: providerIds.map((providerId) => ({
        value: providerId,
        label: providerId,
      })),
      ...(initialProviderId === undefined ? {} : { initialValue: initialProviderId }),
    }),
  );

  return selected;
};

export const getInteractiveMenuOptions = (
  providerIds: string[],
): Array<{ value: MainInteractiveAction; label: string }> => {
  if (providerIds.length === 0) {
    return [{ value: 'add', label: 'Add provider' }];
  }

  return [
    { value: 'add', label: 'Add provider' },
    { value: 'remove', label: 'Remove provider' },
    { value: 'update', label: 'Update provider' },
    { value: 'list', label: 'List providers' },
    { value: 'serve', label: 'Start registry server' },
  ];
};

export const formatInteractiveError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.split('\n')[0] ?? error.message;
  }
  return 'Unknown error';
};
