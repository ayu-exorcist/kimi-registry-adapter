export type UnknownRecord = Record<string, unknown>;

export const isUnknownRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
