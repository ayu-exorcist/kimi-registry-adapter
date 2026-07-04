import { getServeCommand as getCoreServeCommand, printUrl } from '@kastral/kra-core';
import type { GetServeCommandInput, GetServeCommandResult } from '@kastral/kra-core';

export type { GetServeCommandInput, GetServeCommandResult };

export const importUrl = (providerId: string, host: string, port: string | number): string => {
  return printUrl({ providerId, host, port }).url;
};

export const getServeCommand = (input: GetServeCommandInput): GetServeCommandResult =>
  getCoreServeCommand(input);
