import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

import { wrapPlainText } from '../prompts/screen';
import { formatShortcutHint } from '../prompts/shortcut-hints';

const RESULT_LABEL_WIDTH = 18;
const RESULT_BOX_SIDE_WIDTH = 4;
const RESULT_BOX_TERMINAL_MARGIN = 1;

export const visibleWidth = (value: string): number => stripVTControlCharacters(value).length;

export const resultInnerWidth = (): number => {
  const columns = Math.max(40, process.stdout.columns ?? 80);
  return Math.max(20, columns - RESULT_BOX_SIDE_WIDTH - RESULT_BOX_TERMINAL_MARGIN);
};

const padVisibleEnd = (value: string, width: number): string => {
  return value + ' '.repeat(Math.max(0, width - visibleWidth(value)));
};

export const wrapResultValue = (value: string, availableWidth: number): string[] => {
  const lines = value.split('\n');
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      wrapped.push('');
      continue;
    }

    let remaining = line;
    while (remaining.length > availableWidth) {
      wrapped.push(remaining.slice(0, availableWidth));
      remaining = remaining.slice(availableWidth);
    }
    wrapped.push(remaining);
  }

  return wrapped;
};

const truncateWithEllipsis = (value: string, maxWidth: number): string => {
  if (maxWidth <= 3) {
    return '.'.repeat(Math.max(0, maxWidth));
  }
  if (value.length <= maxWidth) {
    return value;
  }
  return `${value.slice(0, maxWidth - 3)}...`;
};

const providerDisplayWidth = (): number => {
  const columns = Math.max(40, process.stdout.columns ?? 80);
  return Math.max(8, Math.min(20, Math.floor(columns / 4)));
};

const formatDisplayName = (value: string): string => {
  return truncateWithEllipsis(value, providerDisplayWidth());
};

export const formatProviderDisplayName = (providerId: string): string => {
  return formatDisplayName(providerId);
};

const shouldTruncateNameValue = (label: string): boolean => {
  return label === 'provider' || label === 'name';
};

const formatResultEntry = (label: string, value: string): string[] => {
  const normalizedLabel = `${label}:`;
  const labelColumn = normalizedLabel.padEnd(RESULT_LABEL_WIDTH);
  const prefix = `${pc.bold(labelColumn)} `;
  const continuationPrefix = `${' '.repeat(RESULT_LABEL_WIDTH)} `;
  const displayValue = shouldTruncateNameValue(label) ? formatDisplayName(value) : value;
  const wrappedLines = wrapResultValue(
    displayValue,
    Math.max(8, resultInnerWidth() - visibleWidth(prefix)),
  );

  return wrappedLines.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
};

const formatResultSection = (title: string, lines: string[]): string[] => {
  return ['', pc.bold(title), ...lines.map((line) => `  ${line}`)];
};

export const formatResultMessage = (message: string): string[] => {
  const lines = message.split('\n');
  const formatted: string[] = [];
  let currentSectionTitle: string | undefined;
  let currentSectionLines: string[] = [];

  const flushSection = (): void => {
    if (!currentSectionTitle) {
      return;
    }
    formatted.push(...formatResultSection(currentSectionTitle, currentSectionLines));
    currentSectionTitle = undefined;
    currentSectionLines = [];
  };

  for (const line of lines) {
    if (line.trim().length === 0) {
      flushSection();
      if (formatted.at(-1) !== '') {
        formatted.push('');
      }
      continue;
    }

    if (line.endsWith(':') && !line.includes('://')) {
      flushSection();
      currentSectionTitle = line.slice(0, -1);
      currentSectionLines = [];
      continue;
    }

    if (currentSectionTitle) {
      currentSectionLines.push(line.trimStart());
      continue;
    }

    if (/^[•●-]\s/u.test(line)) {
      formatted.push(line);
      continue;
    }

    const labelMatch = /^([^:]+):\s*(.*)$/u.exec(line);
    if (labelMatch) {
      const label = labelMatch[1];
      const value = labelMatch[2] ?? '';
      if (label && !label.includes('http')) {
        formatted.push(...formatResultEntry(label.trim(), value));
        continue;
      }
    }

    formatted.push(line);
  }

  flushSection();
  while (formatted[0] === '') {
    formatted.shift();
  }
  while (formatted.at(-1) === '') {
    formatted.pop();
  }
  return formatted;
};

export const renderResultBox = (title: string, lines: string[]): string[] => {
  const maxContentWidth = resultInnerWidth();
  const wrappedLines = lines.flatMap((line) => wrapResultValue(line, maxContentWidth));
  const contentWidth = Math.min(
    maxContentWidth,
    Math.max(...wrappedLines.map((line) => visibleWidth(line)), 0),
  );
  const paddedLines = ['', ...wrappedLines, ''];
  const titleIcon = `${pc.green('◇')}  `;
  const titleWidth = Math.max(1, maxContentWidth + 1 - visibleWidth(titleIcon));
  const titleLabel =
    title.length <= titleWidth
      ? title
      : titleWidth <= 3
        ? '.'.repeat(titleWidth)
        : `${title.slice(0, titleWidth - 3)}...`;
  const titleText = `${titleIcon}${pc.bold(titleLabel)}`;
  const topWidth = Math.max(contentWidth + 2, visibleWidth(titleText) + 1);
  const boxContentWidth = topWidth - 2;
  const topFill = '─'.repeat(Math.max(0, topWidth - visibleWidth(titleText) - 1));
  const rendered = [`╭${titleText} ${pc.dim(topFill)}╮`];

  for (const line of paddedLines) {
    rendered.push(`│ ${padVisibleEnd(line, boxContentWidth)} │`);
  }

  rendered.push(`╰${pc.dim('─'.repeat(boxContentWidth + 2))}╯`);
  return rendered;
};

export const getResultScreenLines = (
  title: string,
  sections: string[],
  options: { interactive?: boolean; hint?: string } = {},
): string[] => {
  const hintPrefix = `${pc.dim('│')}  `;
  const rawHint =
    options.hint ??
    (options.interactive ? 'esc/← return · alt+h main menu · ctrl+c exit' : undefined);
  const hint = rawHint ? formatShortcutHint(rawHint) : undefined;
  const hintLines = hint
    ? wrapResultValue(hint, Math.max(1, resultInnerWidth() - visibleWidth(hintPrefix))).map(
        (line) => `${hintPrefix}${pc.dim(line)}`,
      )
    : [];

  return [
    `${pc.dim('╭')}  ${pc.bold('Kimi Registry Adapter')}`,
    ...hintLines,
    `${pc.dim('│')}`,
    ...renderResultBox(title, sections),
  ];
};

export const formatRegistryListing = (
  providerId: string,
  url: string,
  indentWidth = 0,
): string[] => {
  const providerLabel = formatProviderDisplayName(providerId);
  const prefix = `• ${providerLabel}: `;
  const continuationPrefix = ' '.repeat(prefix.length);
  const firstLineUrlWidth = Math.max(12, resultInnerWidth() - indentWidth - prefix.length);
  const wrappedUrl = wrapPlainText(url, firstLineUrlWidth);

  return wrappedUrl.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
};
