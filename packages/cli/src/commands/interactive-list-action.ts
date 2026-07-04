import { resolve } from 'node:path';

import { formatRegistryListing, listRegistryUrls, showInteractiveNote } from './render';

export const runInteractiveListProviders = async (options: {
  stateDir: string;
  host: string;
  port: string;
}): Promise<void> => {
  const stateDir = resolve(options.stateDir);
  const registries = listRegistryUrls(stateDir, options.host, options.port);
  const title = `Providers: ${stateDir}`;

  if (registries.length === 0) {
    await showInteractiveNote('No providers configured yet.', title);
    return;
  }

  await showInteractiveNote(
    () =>
      registries
        .flatMap((registry) => formatRegistryListing(registry.providerId, registry.url))
        .join('\n'),
    title,
  );
};
