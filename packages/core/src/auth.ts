import { readFileSync } from 'node:fs';

import { _default as zDefault } from 'zod/mini';
import * as z from 'zod/mini';

import { writeAtomicText, writeAtomicTextAsync } from './atomic-file';
import { isFileNotFoundError } from './fs-error';
import { defaultProviderApiKeyEnvName, normalizeProviderId } from './provider-id';

const nonEmptyString = z.string().check(z.trim(), z.minLength(1));

const authProviderSchema = z.strictObject({
  apiKey: z.optional(nonEmptyString),
  apiKeyEnv: z.optional(nonEmptyString),
});

export const authConfigSchema = z.strictObject({
  providers: zDefault(z.record(nonEmptyString, authProviderSchema), {}),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

const emptyAuthConfig = (): AuthConfig => authConfigSchema.parse({ providers: {} });

export const readAuthConfig = (filePath: string): AuthConfig => {
  try {
    return authConfigSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
    return emptyAuthConfig();
  }
};

export const writeAuthConfig = (filePath: string, auth: AuthConfig): AuthConfig => {
  const parsed = authConfigSchema.parse(auth);
  writeAtomicText(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
};

export const writeAuthConfigAsync = async (
  filePath: string,
  auth: AuthConfig,
): Promise<AuthConfig> => {
  const parsed = authConfigSchema.parse(auth);
  await writeAtomicTextAsync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
};

export const setProviderAuth = (
  auth: AuthConfig,
  providerId: string,
  providerAuth: { apiKey?: string; apiKeyEnv?: string },
): AuthConfig => {
  const safeProviderId = normalizeProviderId(providerId);
  return authConfigSchema.parse({
    ...auth,
    providers: {
      ...auth.providers,
      [safeProviderId]: {
        ...(providerAuth.apiKey ? { apiKey: providerAuth.apiKey } : {}),
        ...(providerAuth.apiKeyEnv ? { apiKeyEnv: providerAuth.apiKeyEnv } : {}),
      },
    },
  });
};

export const removeProviderAuth = (auth: AuthConfig, providerId: string): AuthConfig => {
  const safeProviderId = normalizeProviderId(providerId);
  const { [safeProviderId]: _removed, ...providers } = auth.providers;
  return authConfigSchema.parse({
    ...auth,
    providers,
  });
};

export const resolveProviderApiKey = (
  auth: AuthConfig,
  providerId: string,
  configApiKeyEnv?: string,
): string | undefined => {
  const safeProviderId = normalizeProviderId(providerId);
  const providerAuth = auth.providers[safeProviderId];

  if (providerAuth?.apiKey) {
    return providerAuth.apiKey;
  }

  if (providerAuth?.apiKeyEnv) {
    return process.env[providerAuth.apiKeyEnv];
  }

  if (configApiKeyEnv) {
    return process.env[configApiKeyEnv];
  }

  return (
    process.env[defaultProviderApiKeyEnvName(safeProviderId)] ??
    process.env['KIMI_PROVIDERS_API_KEY']
  );
};
