import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  getProviderRegistryPath,
  normalizeProviderId,
  validateEditableRegistry,
  type EditableRegistry,
} from '@kastral/kra-core';

export type ServerHealth = {
  status: 'ok' | 'degraded';
  providerCount: number;
  providerIds: string[];
  invalidRegistryCount?: number;
  registryPath?: string;
};

export type RegistryListing = {
  providerId: string;
  registryPath: string;
  updatedAt: Date;
};

type InvalidRegistryListing = {
  providerId: string;
  registryPath: string;
  error: string;
};

export type RegistryInspection = {
  available: RegistryListing[];
  invalid: InvalidRegistryListing[];
};

const loadRegistry = (registryPath: string): EditableRegistry => {
  return validateEditableRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
};

export const loadProviderRegistry = (
  registryPath: string,
  providerId: string,
): EditableRegistry => {
  const registry = loadRegistry(registryPath);
  const safeProviderId = normalizeProviderId(providerId);
  if (!registry[safeProviderId] || Object.keys(registry).length !== 1) {
    throw new Error(`Registry file ${registryPath} does not match provider ${safeProviderId}.`);
  }
  return registry;
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown registry validation error';
};

export const inspectRegistries = (stateDir: string): RegistryInspection => {
  const registriesDir = join(stateDir, 'registries');

  try {
    return readdirSync(registriesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .reduce<RegistryInspection>(
        (inspection, entry) => {
          const fallbackRegistryPath = join(registriesDir, entry.name, 'api.json');

          try {
            const providerId = normalizeProviderId(entry.name);
            const registryPath = getProviderRegistryPath({ stateDir, providerId });
            loadProviderRegistry(registryPath, providerId);
            inspection.available.push({
              providerId,
              registryPath,
              updatedAt: statSync(registryPath).mtime,
            });
          } catch (error) {
            inspection.invalid.push({
              providerId: entry.name,
              registryPath: fallbackRegistryPath,
              error: errorMessage(error),
            });
          }

          return inspection;
        },
        { available: [], invalid: [] },
      );
  } catch {
    return { available: [], invalid: [] };
  }
};

export const listAvailableRegistries = (stateDir: string): RegistryListing[] => {
  return inspectRegistries(stateDir).available;
};

const providerIdFromRegistryPath = (registryPath: string): string =>
  normalizeProviderId(basename(dirname(registryPath)));

export const createHealthSnapshot = (registryPath?: string): ServerHealth => {
  if (!registryPath) {
    return {
      status: 'degraded',
      providerCount: 0,
      providerIds: [],
    };
  }

  try {
    const providerId = providerIdFromRegistryPath(registryPath);
    loadProviderRegistry(registryPath, providerId);

    return {
      status: 'ok',
      providerCount: 1,
      providerIds: [providerId],
      registryPath,
    };
  } catch {
    return {
      status: 'degraded',
      providerCount: 0,
      providerIds: [],
      invalidRegistryCount: 1,
      registryPath,
    };
  }
};
