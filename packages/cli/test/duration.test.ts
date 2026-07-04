import { describe, expect, it } from 'vitest';

import { parseUpdateIntervalMs } from '../src/duration';

describe('parseUpdateIntervalMs', () => {
  it('parses minute, hour, and day durations including floats', () => {
    expect(parseUpdateIntervalMs('1m')).toBe(60_000);
    expect(parseUpdateIntervalMs('1.5m')).toBe(90_000);
    expect(parseUpdateIntervalMs('1.5h')).toBe(5_400_000);
    expect(parseUpdateIntervalMs('1.5d')).toBe(129_600_000);
  });

  it('returns undefined for an omitted duration', () => {
    expect(parseUpdateIntervalMs(undefined)).toBeUndefined();
  });

  it('requires a unit, a positive amount, and enforces a 1m minimum', () => {
    expect(() => parseUpdateIntervalMs('1')).toThrow('Expected a number followed by m, h, or d');
    expect(() => parseUpdateIntervalMs('0m')).toThrow('Expected a positive duration');
    expect(() => parseUpdateIntervalMs('0.5m')).toThrow('Minimum interval is 1m');
    expect(() => parseUpdateIntervalMs('0')).toThrow('Expected a number followed by m, h, or d');
  });
});
