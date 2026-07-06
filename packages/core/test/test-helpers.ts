import { expect } from 'vitest';

function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}

export const expectRecordValue = <T>(record: Record<string, T>, key: string): T => {
  const value = record[key];
  expectDefined(value);
  return value;
};
