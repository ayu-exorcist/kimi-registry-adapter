export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const compareKeys = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).toSorted(([left], [right]) => compareKeys(left, right));
    return Object.fromEntries(
      entries.map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }

  return value;
};

export const serializeDeterministicJson = (value: unknown): string => {
  const sorted = sortJsonValue(value);
  return `${JSON.stringify(sorted, null, 2)}\n`;
};

export const createDeterministicJsonSnapshot = (value: unknown): string =>
  serializeDeterministicJson(value);

export const equalDeterministicJson = (left: unknown, right: unknown): boolean =>
  createDeterministicJsonSnapshot(left) === createDeterministicJsonSnapshot(right);
