import { describe, expect, it } from 'vitest';

import {
  parseDefaultEffort,
  parseSupportEfforts,
  supportEffortsFromReasoningOptions,
} from '../src/model-effort';

describe('model effort metadata', () => {
  it('accepts non-empty provider-defined effort names without imposing an enum', () => {
    expect(parseSupportEfforts([' low ', 'xhigh'])).toEqual(['low', 'xhigh']);
    expect(parseDefaultEffort(' max ')).toBe('max');
  });

  it('rejects malformed direct effort fields without throwing', () => {
    expect(parseSupportEfforts([])).toBeUndefined();
    expect(parseSupportEfforts(['low', ' '])).toBeUndefined();
    expect(parseSupportEfforts(['low', 42])).toBeUndefined();
    expect(parseDefaultEffort(' ')).toBeUndefined();
    expect(parseDefaultEffort(null)).toBeUndefined();
  });

  it('extracts selectable effort values from models.dev reasoning options', () => {
    expect(
      supportEffortsFromReasoningOptions([
        null,
        { type: 'toggle' },
        { type: 'budget_tokens', values: [1024] },
        { type: 'effort', values: [null, '', 'none', ' LOW ', 'high', 42] },
      ]),
    ).toEqual(['LOW', 'high']);
  });

  it('returns no effort list when reasoning options contain only disable or invalid values', () => {
    expect(
      supportEffortsFromReasoningOptions([
        { type: 'effort', values: [null, 'none', '', 42] },
        { type: 'effort', values: 'high' },
      ]),
    ).toBeUndefined();
  });
});
