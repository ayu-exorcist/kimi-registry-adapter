#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { formatNetworkError, KraFetchError } from '@kastral/kra-core';

import { runCli } from './commands';

export { runCli, testExports } from './commands';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
