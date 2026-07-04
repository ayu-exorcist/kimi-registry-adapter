import type { MetadataMatchSummary } from '@kastral/kra-core';

export type ProviderUpdateNoteInput = {
  providerId: string;
  editablePath: string;
  modelCount: number;
  metadataMatchSummary: MetadataMatchSummary;
  configPath?: string;
  commit?: string;
  include?: string[];
};

const metadataMatchSummaryLine = (summary: MetadataMatchSummary): string => {
  return `metadata matches: exact=${summary.exact}, normalized=${summary.normalized}, unmatched=${summary.unmatched}`;
};

export const formatProviderUpdateNote = ({
  providerId,
  configPath,
  editablePath,
  modelCount,
  include,
  metadataMatchSummary,
  commit,
}: ProviderUpdateNoteInput): string => {
  return [
    `provider: ${providerId}`,
    ...(configPath ? [`config: ${configPath}`] : []),
    `registry: ${editablePath}`,
    `models: ${modelCount}`,
    ...(include ? [`include: ${include.join(',')}`] : []),
    metadataMatchSummaryLine(metadataMatchSummary),
    ...(commit ? [`commit: ${commit}`] : []),
  ].join('\n');
};

export type ProviderUpdateModeNoteInput = {
  providerId: string;
  configPath: string;
  updateMode: string;
};

export const formatProviderUpdateModeNote = ({
  providerId,
  configPath,
  updateMode,
}: ProviderUpdateModeNoteInput): string => {
  return [`provider: ${providerId}`, `config: ${configPath}`, `update mode: ${updateMode}`].join(
    '\n',
  );
};
