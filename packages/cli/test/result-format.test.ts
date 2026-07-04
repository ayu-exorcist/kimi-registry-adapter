import { afterEach, describe, expect, it } from 'vitest';

import {
  formatProviderDisplayName,
  formatRegistryListing,
  formatResultMessage,
  getResultScreenLines,
  renderResultBox,
  wrapResultValue,
} from '../src/commands/result-format';

const setStdoutColumns = (columns: number | undefined): void => {
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: columns,
  });
};

describe('result formatting', () => {
  afterEach(() => {
    setStdoutColumns(undefined);
  });

  it('formats labeled results and sections without treating URLs as labels', () => {
    setStdoutColumns(80);

    const lines = formatResultMessage(
      [
        'provider: provider-a',
        'url: http://127.0.0.1:3000/provider-a/api.json',
        '',
        'Next steps:',
        '- Import the URL in Kimi',
        'https://example.com/docs:still-url',
      ].join('\n'),
    );

    const plainOutput = lines.join('\n');
    expect(plainOutput).toContain('provider:');
    expect(plainOutput).toContain('provider-a');
    expect(plainOutput).toContain('url:');
    expect(plainOutput).toContain('http://127.0.0.1:3000/provider-a/api.json');
    expect(plainOutput).toContain('Next steps');
    expect(plainOutput).toContain('- Import the URL in Kimi');
    expect(plainOutput).toContain('https://example.com/docs:still-url');
  });

  it('wraps long registry URLs under the provider label for narrow terminals', () => {
    setStdoutColumns(48);

    const lines = formatRegistryListing(
      'provider-with-a-very-long-display-name',
      'http://127.0.0.1:3000/provider-with-a-very-long-display-name/api.json',
    );

    expect(formatProviderDisplayName('provider-with-a-very-long-display-name')).toBe(
      'provider-...',
    );
    expect(lines[0]).toContain('provider-...');
    expect(lines.join('\n')).toContain('api.json');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]?.startsWith(' '.repeat('• provider-...: '.length))).toBe(true);
  });

  it('renders compact result boxes and explicit hints without dropping content', () => {
    setStdoutColumns(24);

    expect(wrapResultValue('abcdef', 3)).toEqual(['abc', 'def']);
    expect(wrapResultValue('first\n\nsecond', 10)).toEqual(['first', '', 'second']);

    const box = renderResultBox(
      'A very long operation title that must be shortened in compact terminals',
      ['line one', 'line two'],
    );
    expect(box[0]).toContain('...');
    expect(box.join('\n')).toContain('line one');
    expect(box.join('\n')).toContain('line two');

    const screenLines = getResultScreenLines('Done', ['provider: provider-a'], {
      interactive: true,
      hint: 'enter confirm · esc back',
    });
    expect(screenLines.join('\n')).toContain('Kimi Registry Adapter');
    expect(screenLines.join('\n')).toContain('enter');
    expect(screenLines.join('\n')).toContain('provider-a');

    const nonInteractiveScreen = getResultScreenLines('Done', ['provider: provider-a']);
    expect(nonInteractiveScreen.join('\n')).not.toContain('ctrl+c exit');
  });
});
