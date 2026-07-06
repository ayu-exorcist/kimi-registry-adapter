import { encodeProviderIdForUrl, normalizeProviderId } from '../provider-id';
import type { ProviderIdInput, StateDirInput } from './types';

export type PrintUrlInput = ProviderIdInput & {
  host: string;
  port: string | number;
};

export type PrintUrlResult = ProviderIdInput & {
  url: string;
};

export const printUrl = (input: PrintUrlInput): PrintUrlResult => {
  const providerId = normalizeProviderId(input.providerId);
  return {
    providerId,
    url: `http://${input.host}:${input.port}/${encodeProviderIdForUrl(providerId)}/api.json`,
  };
};

export type GetServeCommandInput = StateDirInput & {
  host: string;
  port: string | number;
  updateInterval?: string;
  executable?: string;
  serveStateDir?: string;
};

export type GetServeCommandResult = {
  command: string;
  argv: string[];
};

const splitCommandLine = (command: string): string[] => {
  const tokens: string[] = [];
  const tokenPattern = /"((?:\\"|[^"])*)"|'([^']*)'|(\S+)/gu;

  for (const match of command.matchAll(tokenPattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? '').replaceAll('\\"', '"'));
  }

  return tokens;
};

const shellQuote = (value: string): string => {
  if (/^[^\s"']+$/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
};

export const getServeCommand = (input: GetServeCommandInput): GetServeCommandResult => {
  const executable = input.executable ?? 'kra serve';
  const executableArgv = splitCommandLine(executable);
  const argv = [
    ...executableArgv,
    '--state-dir',
    input.serveStateDir ?? input.stateDir,
    '--host',
    input.host,
    '--port',
    String(input.port),
    ...(input.updateInterval ? ['--update-interval', input.updateInterval] : []),
  ];

  return {
    command: [
      executable,
      `--state-dir ${shellQuote(input.serveStateDir ?? input.stateDir)}`,
      `--host ${shellQuote(input.host)}`,
      `--port ${shellQuote(String(input.port))}`,
      ...(input.updateInterval ? [`--update-interval ${shellQuote(input.updateInterval)}`] : []),
    ].join(' '),
    argv,
  };
};
