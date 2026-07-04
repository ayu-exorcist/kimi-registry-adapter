import { describe, expect, it } from 'vitest';

import {
  normalizeVariadicPatternOptions,
  parseModelSource,
  parseUpdateMode,
  parsePatternList,
  requireCliString,
  withPatternOptions,
} from '../src/commands/args';

describe('command argument helpers', () => {
  it('parses model source variants', () => {
    expect(parseModelSource(undefined, {})).toBeUndefined();
    expect(
      parseModelSource('openai_models', {
        modelSourceUrl: 'https://api.example.com/v1/models',
      }),
    ).toEqual({ kind: 'openai_models', modelsUrl: 'https://api.example.com/v1/models' });
    expect(parseModelSource('anthropic_models', {})).toEqual({ kind: 'anthropic_models' });
    expect(parseModelSource('local_file', { modelSourcePath: './models.json' })).toEqual({
      kind: 'local_file',
      path: './models.json',
    });
    expect(
      parseModelSource('remote_url', { modelSourceUrl: 'https://example.com/models.json' }),
    ).toEqual({
      kind: 'remote_url',
      url: 'https://example.com/models.json',
    });
  });

  it('rejects incomplete or unknown model source values', () => {
    expect(() => parseModelSource('local_file', {})).toThrow('--model-source-path');
    expect(() => parseModelSource('remote_url', {})).toThrow('--model-source-url');
    expect(() => parseModelSource('unknown', {})).toThrow('Invalid --model-source');
  });

  it('parses update modes', () => {
    expect(parseUpdateMode(undefined)).toBeUndefined();
    expect(parseUpdateMode('merge')).toBe('merge');
    expect(parseUpdateMode('overwrite')).toBe('overwrite');
    expect(() => parseUpdateMode('invalid')).toThrow('Invalid --update-mode');
  });

  it('normalizes repeated, variadic, and parsed include/exclude options', () => {
    const normalized = normalizeVariadicPatternOptions([
      'add',
      'provider-a',
      '--include',
      'model-a',
      'model-b',
      '--exclude=model-c, model-d',
      '--base-url',
      'https://api.example.com/v1',
    ]);

    expect(normalized).toEqual([
      'add',
      'provider-a',
      '--include',
      'model-a,model-b',
      '--exclude=model-c, model-d',
      '--base-url',
      'https://api.example.com/v1',
    ]);
    expect(normalizeVariadicPatternOptions(['--include'])).toEqual(['--include']);
    expect(normalizeVariadicPatternOptions(['--include=ready', '--exclude'])).toEqual([
      '--include=ready',
      '--exclude',
    ]);
    expect(parsePatternList(undefined)).toBeUndefined();
    expect(parsePatternList([])).toBeUndefined();
    expect(parsePatternList([' ,  '])).toBeUndefined();
    expect(parsePatternList(['model-a, model-b', ' model-c '])).toEqual([
      'model-a',
      'model-b',
      'model-c',
    ]);
    expect(withPatternOptions({}, normalized)).toMatchObject({
      include: ['model-a', 'model-b'],
      exclude: ['model-c', 'model-d'],
    });
    expect(withPatternOptions({}, ['--include'])).toEqual({});
    expect(
      withPatternOptions({ include: 'model-e, model-f', exclude: ['model-g', ' model-h '] }, [
        'add',
        'provider-a',
      ]),
    ).toMatchObject({
      include: ['model-e', 'model-f'],
      exclude: ['model-g', 'model-h'],
    });
  });

  it('requires string command arguments', () => {
    expect(requireCliString('provider-a', 'providerId')).toBe('provider-a');
    expect(() => requireCliString(undefined, 'providerId')).toThrow(
      'Missing required argument: providerId',
    );
  });
});
