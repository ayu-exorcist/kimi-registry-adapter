import { equalDeterministicJson } from './json';
import type { EditableModel, EditableRegistry, GeneratedRegistry } from './schema';
import { isUnknownRecord } from './type-guards';

export type MergeConflict = {
  providerId: string;
  modelId: string;
  field: string;
  before: unknown;
  current: unknown;
  incoming: unknown;
  after: unknown;
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
    before: oldValue,
    current: currentValue,
    incoming: newValue,
    after: currentValue,
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

    if (!preserveUnknownModels) {
      for (const modelId of Object.keys(currentProvider.models)) {
        if (!generatedProvider.models[modelId]) {
          delete currentProvider.models[modelId];
        }
      }
    }

    for (const [modelId, generatedModel] of Object.entries(generatedProvider.models)) {
      const currentModel = currentProvider.models[modelId];
      const oldModel = oldProvider?.models[modelId];

      if (!currentModel) {
        currentProvider.models[modelId] = structuredClone(generatedModel);
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

      currentProvider.models[modelId] = mergedModel;
    }
  }

  return {
    editable: merged,
    conflicts,
  };
};
