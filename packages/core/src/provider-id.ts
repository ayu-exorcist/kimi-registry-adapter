import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

declare const providerIdBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: true };

const controlCharacterPattern = /[\u0000-\u001F\u007F]/u;
const pathSeparatorPattern = /[\\/]/u;
const windowsDrivePrefixPattern = /^[A-Za-z]:/u;

const providerIdRulesDescription =
  'Provider IDs must be non-empty and must not contain path separators (/ or \\), path traversal (. or ..), absolute path prefixes, null bytes, or control characters.';

const formatProviderIdForError = (value: string): string => JSON.stringify(value);

export class InvalidProviderIdError extends Error {
  constructor(value: string) {
    super(`Invalid providerId ${formatProviderIdForError(value)}. ${providerIdRulesDescription}`);
    this.name = 'InvalidProviderIdError';
  }
}

export class UnsafeStatePathError extends Error {
  constructor(path: string, stateDir: string) {
    super(
      `Refusing to access path outside the state directory: ${path}. State directory: ${stateDir}`,
    );
    this.name = 'UnsafeStatePathError';
  }
}

export const providerIdFormatDescription = providerIdRulesDescription;

export const isValidProviderId = (value: string): value is ProviderId => {
  if (value.length === 0 || value.trim().length === 0) {
    return false;
  }
  if (value === '.' || value === '..') {
    return false;
  }
  if (controlCharacterPattern.test(value)) {
    return false;
  }
  if (pathSeparatorPattern.test(value)) {
    return false;
  }
  if (windowsDrivePrefixPattern.test(value)) {
    return false;
  }

  return true;
};

export const normalizeProviderId = (value: string): ProviderId => {
  if (!isValidProviderId(value)) {
    throw new InvalidProviderIdError(value);
  }

  return value as ProviderId;
};

export const isValid = isValidProviderId;
export const normalize = normalizeProviderId;

export const assertPathInside = (rootDir: string, candidatePath: string): string => {
  const resolvedRoot = resolve(rootDir);
  const resolvedCandidate = resolve(candidatePath);
  const relativePath = relative(resolvedRoot, resolvedCandidate);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return resolvedCandidate;
  }

  throw new UnsafeStatePathError(resolvedCandidate, resolvedRoot);
};

export const resolveStatePath = (stateDir: string, ...segments: string[]): string => {
  const resolvedStateDir = resolve(stateDir);
  return assertPathInside(resolvedStateDir, resolve(resolvedStateDir, ...segments));
};

export const resolveProviderStatePath = (
  stateDir: string,
  providerId: string,
  ...segments: string[]
): string => {
  const safeProviderId = normalizeProviderId(providerId);
  return resolveStatePath(stateDir, 'registries', safeProviderId, ...segments);
};

export const providerRegistryGitPath = (providerId: string): string => {
  return `registries/${normalizeProviderId(providerId)}`;
};

export const providerApiRegistryGitPath = (providerId: string): string => {
  return `${providerRegistryGitPath(providerId)}/api.json`;
};

export const encodeProviderIdForUrl = (providerId: string): string => {
  return encodeURIComponent(normalizeProviderId(providerId));
};

export const defaultProviderApiKeyEnvName = (providerId: string): string => {
  const safeProviderId = normalizeProviderId(providerId);
  return `KIMI_PROVIDERS_${safeProviderId.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '_')}_API_KEY`;
};

export const providerIdFromRegistryPath = (
  stateDir: string,
  registryPath: string,
): ProviderId | undefined => {
  const registriesDir = resolveStatePath(stateDir, 'registries');
  let resolvedRegistryPath: string;

  try {
    resolvedRegistryPath = assertPathInside(registriesDir, registryPath);
  } catch {
    return undefined;
  }

  if (basename(resolvedRegistryPath) !== 'api.json') {
    return undefined;
  }

  const providerDir = dirname(resolvedRegistryPath);
  const providerId = relative(registriesDir, providerDir);
  if (providerId.length === 0 || providerId.includes('/') || providerId.includes('\\')) {
    return undefined;
  }

  try {
    return normalizeProviderId(providerId);
  } catch {
    return undefined;
  }
};

export const providerId = {
  isValid: isValidProviderId,
  normalize: normalizeProviderId,
  assertPathInside,
  resolveStatePath,
  resolveProviderStatePath,
  encodeForUrl: encodeProviderIdForUrl,
} as const;
