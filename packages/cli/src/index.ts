#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatNetworkError, KraFetchError } from '@kastral/kra-core';

import { runCli } from './commands';

export { runCli, testExports } from './commands';

export const isCliEntrypoint = (metaUrl: string, argv1: string | undefined): boolean => {
  if (!argv1 || !metaUrl.startsWith('file:')) {
    return false;
  }

  try {
    return realpathSync.native(fileURLToPath(metaUrl)) === realpathSync.native(argv1);
  } catch {
    return false;
  }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof KraFetchError
        ? formatNetworkError(error)
        : error instanceof Error
          ? error.message
          : 'Unknown CLI error';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
