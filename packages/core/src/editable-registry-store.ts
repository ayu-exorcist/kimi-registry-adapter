import type { DiscoveredModel } from './model-payload';
import type { EditableRegistry, GeneratedRegistry } from './schema';
import {
  createStatePaths,
  hasConflictMarkers,
  loadLastKnownGoodRegistry,
  loadProviderState,
  mergeEditableRegistry,
  validateRegistryFile,
  writeModelsSnapshot,
  writeRegistryArtifacts,
  type MergeEditableRegistryResult,
  type ProviderState,
  type StatePaths,
  type ThreeWayMergeInput,
  type UpdateState,
} from './state';

export type EditableRegistryStore = {
  paths: StatePaths;
  hasConflictMarkers: (content: string) => boolean;
  loadLastKnownGoodRegistry: () => EditableRegistry | undefined;
  loadProviderState: () => ProviderState | undefined;
  mergeEditableRegistry: (input: ThreeWayMergeInput) => MergeEditableRegistryResult;
  writeModelsSnapshot: (models: DiscoveredModel[]) => void;
  writeRegistryArtifacts: (
    generated: GeneratedRegistry,
    editable: EditableRegistry,
    updateState: UpdateState,
  ) => void;
  validateRegistryFile: () => ReturnType<typeof validateRegistryFile>;
};

export const createEditableRegistryStore = (
  stateDir: string,
  providerId: string,
): EditableRegistryStore => {
  const paths = createStatePaths(stateDir, providerId);

  return {
    paths,
    hasConflictMarkers,
    loadLastKnownGoodRegistry: () => loadLastKnownGoodRegistry(paths.apiPath),
    loadProviderState: () => loadProviderState(paths.statePath),
    mergeEditableRegistry,
    writeModelsSnapshot: (models) => writeModelsSnapshot(paths.modelsPath, models),
    writeRegistryArtifacts: (generated, editable, updateState) => {
      writeRegistryArtifacts(paths, generated, editable, updateState);
    },
    validateRegistryFile: () => validateRegistryFile(paths.apiPath),
  };
};
