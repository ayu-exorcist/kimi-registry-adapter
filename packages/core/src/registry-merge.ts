import { equalDeterministicJson } from './json';
import type { EditableModel, EditableRegistry, GeneratedRegistry } from './schema';
import { isUnknownRecord } from './type-guards';

export type MergeConflictValue =
  | { kind: 'missing' }
  | {
      kind: 'value';
      value: unknown;
    };

export type MergeConflict = {
  providerId: string;
  modelId: string;
  field: string;
  before: MergeConflictValue;
  current: MergeConflictValue;
  incoming: MergeConflictValue;
  after: MergeConflictValue;
};

export type ThreeWayMergeInput = {
  oldGenerated: EditableRegistry | undefined;
  currentEditable: EditableRegistry;
  newGenerated: GeneratedRegistry;
  preserveUnknownModels?: boolean;
};

export type MergeEditableRegistryResult = {
  editable: EditableRegistry;
  conflicts: MergeConflict[];
};

const equalJson = (left: unknown, right: unknown): boolean => equalDeterministicJson(left, right);

export const createMergeConflictValue = (value: unknown): MergeConflictValue =>
  value === undefined ? { kind: 'missing' } : { kind: 'value', value: structuredClone(value) };

const mergeValue = (
  currentValue: unknown,
  oldValue: unknown,
  newValue: unknown,
  input: { providerId: string; modelId: string; fieldPath: string[]; conflicts: MergeConflict[] },
): unknown => {
  if (equalJson(currentValue, oldValue)) {
    return structuredClone(newValue);
  }

  if (equalJson(newValue, oldValue)) {
    return currentValue;
  }

  if (equalJson(currentValue, newValue)) {
    return currentValue;
  }

  if (isUnknownRecord(currentValue) && isUnknownRecord(oldValue) && isUnknownRecord(newValue)) {
    const merged = structuredClone(currentValue);

    for (const [key, nestedNewValue] of Object.entries(newValue)) {
      merged[key] = mergeValue(currentValue[key], oldValue[key], nestedNewValue, {
        ...input,
        fieldPath: [...input.fieldPath, key],
      });
    }

    return merged;
  }

  input.conflicts.push({
    providerId: input.providerId,
    modelId: input.modelId,
    field: input.fieldPath.join('.'),
    before: createMergeConflictValue(oldValue),
    current: createMergeConflictValue(currentValue),
    incoming: createMergeConflictValue(newValue),
    after: createMergeConflictValue(currentValue),
  });

  return currentValue;
};

export const mergeEditableRegistry = ({
  oldGenerated,
  currentEditable,
  newGenerated,
  preserveUnknownModels = false,
}: ThreeWayMergeInput): MergeEditableRegistryResult => {
  const merged = structuredClone(currentEditable);
  const conflicts: MergeConflict[] = [];

  for (const [providerId, generatedProvider] of Object.entries(newGenerated)) {
    const currentProvider = merged[providerId];
    const oldProvider = oldGenerated?.[providerId];

    if (!currentProvider) {
      merged[providerId] = structuredClone(generatedProvider);
      continue;
    }

    const mergedProvider = structuredClone(currentProvider);

    for (const [key, newValue] of Object.entries(generatedProvider)) {
      if (key === 'models') {
        continue;
      }

      const providerKey = key as keyof typeof generatedProvider;
      const nextValue = mergeValue(
        currentProvider[providerKey],
        oldProvider?.[providerKey],
        newValue,
        {
          providerId,
          modelId: '__provider__',
          fieldPath: [key],
          conflicts,
        },
      );

      Object.assign(mergedProvider, { [providerKey]: nextValue });
    }

    if (!preserveUnknownModels) {
      for (const modelId of Object.keys(mergedProvider.models)) {
        if (!generatedProvider.models[modelId]) {
          delete mergedProvider.models[modelId];
        }
      }
    }

    for (const [modelId, generatedModel] of Object.entries(generatedProvider.models)) {
      const currentModel = mergedProvider.models[modelId];
      const oldModel = oldProvider?.models[modelId];

      if (!currentModel) {
        mergedProvider.models[modelId] = structuredClone(generatedModel);
        continue;
      }

      const mergedModel = structuredClone(currentModel);

      for (const [key, newValue] of Object.entries(generatedModel)) {
        const modelKey = key as keyof EditableModel;
        const oldValue = oldModel?.[modelKey];
        const currentValue = currentModel[modelKey];

        const nextValue = mergeValue(currentValue, oldValue, newValue, {
          providerId,
          modelId,
          fieldPath: [key],
          conflicts,
        });

        Object.assign(mergedModel, { [modelKey]: nextValue });
      }

      mergedProvider.models[modelId] = mergedModel;
    }

    merged[providerId] = mergedProvider;
  }

  return {
    editable: merged,
    conflicts,
  };
};
