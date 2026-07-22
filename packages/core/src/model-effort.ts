import { isUnknownRecord } from './type-guards';

const normalizeEffort = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

export const parseSupportEfforts = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const efforts = value.map(normalizeEffort);
  return efforts.every((effort): effort is string => effort !== undefined) ? efforts : undefined;
};

export const supportEffortsFromReasoningOptions = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  let efforts: string[] | undefined;
  for (const option of value) {
    if (
      !isUnknownRecord(option) ||
      option['type'] !== 'effort' ||
      !Array.isArray(option['values'])
    ) {
      continue;
    }

    const selectable = option['values']
      .map(normalizeEffort)
      .filter(
        (effort): effort is string => effort !== undefined && effort.toLowerCase() !== 'none',
      );
    if (selectable.length > 0) {
      efforts = selectable;
    }
  }

  return efforts;
};

export const parseDefaultEffort = (value: unknown): string | undefined => normalizeEffort(value);
