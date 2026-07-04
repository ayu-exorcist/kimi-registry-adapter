import { resolve } from 'node:path';

import { isInteractiveHome } from '../prompts/navigation';
import { printServeStartupSummary } from './render';
import {
  assertValidTcpPort,
  findAvailablePort,
  startRegistryServerOnDemand,
  waitForServerClose,
} from './server-runtime';

export const runInteractiveServe = async (options: {
  stateDir: string;
  host: string;
  port: string;
}): Promise<void> => {
  let servePort = assertValidTcpPort(Number(options.port), 'port');

  const availablePort = await findAvailablePort(options.host, servePort);
  if (availablePort !== servePort) {
    process.stderr.write(`port ${servePort} is unavailable, using ${availablePort}\n`);
    servePort = availablePort;
  }

  const stopRenderingServeSummary = printServeStartupSummary(
    resolve(options.stateDir),
    options.host,
    `${servePort}`,
  );
  const server = await startRegistryServerOnDemand({
    stateDir: resolve(options.stateDir),
    host: options.host,
    port: servePort,
  });
  try {
    const closeResult = await waitForServerClose(server);
    if (isInteractiveHome(closeResult)) {
      throw closeResult;
    }
  } finally {
    stopRenderingServeSummary();
  }
};
