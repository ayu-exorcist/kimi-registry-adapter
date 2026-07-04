import { describe, expect, it } from 'vitest';

import {
  formatProviderUpdateModeNote,
  formatProviderUpdateNote,
} from '../src/commands/interactive-update-presenter';

describe('interactive update presenter', () => {
  it('formats refresh result notes with optional config and commit lines', () => {
    expect(
      formatProviderUpdateNote({
        providerId: 'provider-a',
        configPath: '/state/config.json',
        editablePath: '/state/registries/provider-a/api.json',
        modelCount: 2,
        metadataMatchSummary: { exact: 1, normalized: 1, unmatched: 0 },
        commit: 'abc123',
      }),
    ).toBe(
      [
        'provider: provider-a',
        'config: /state/config.json',
        'registry: /state/registries/provider-a/api.json',
        'models: 2',
        'metadata matches: exact=1, normalized=1, unmatched=0',
        'commit: abc123',
      ].join('\n'),
    );
  });

  it('formats model include and update mode notes', () => {
    expect(
      formatProviderUpdateNote({
        providerId: 'provider-a',
        editablePath: '/state/registries/provider-a/api.json',
        modelCount: 1,
        include: ['model-a', 'model-b'],
        metadataMatchSummary: { exact: 0, normalized: 0, unmatched: 1 },
      }),
    ).toContain('include: model-a,model-b');

    expect(
      formatProviderUpdateModeNote({
        providerId: 'provider-a',
        configPath: '/state/config.json',
        updateMode: 'merge',
      }),
    ).toBe(['provider: provider-a', 'config: /state/config.json', 'update mode: merge'].join('\n'));
  });
});
