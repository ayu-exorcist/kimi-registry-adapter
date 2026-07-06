import { posix } from 'node:path';

import { formatRegistryListing, listRegistryUrls, showInteractiveNote } from './render';

export const runInteractiveListProviders = async (options: {
  stateDir: string;
  host: string;
  port: string;
}): Promise<void> => {
  const stateDir = posix.normalize(options.stateDir);
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
