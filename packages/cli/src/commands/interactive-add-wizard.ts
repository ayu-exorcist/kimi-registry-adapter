import type { DiscoveredModel, ProviderType } from '@kastral/kra-core';

export type AddProviderAuthMode = 'none' | 'once' | 'store' | 'env';

export type AddProviderState = {
  providerId: string;
  baseUrl: string;
  modelSourceInput: string;
  authMode: AddProviderAuthMode;
  apiKey: string;
  apiKeyEnv: string;
  providerType: ProviderType;
  include: string[] | undefined;
  includeSource: 'manual' | 'selection';
  selectModelsFromFetchedList: boolean;
  cachedModelIds: string[] | undefined;
  cachedModels: DiscoveredModel[] | undefined;
  cachedModelsKey: string | undefined;
  startServerNow: boolean;
};

export type AddProviderStepId =
  | 'providerId'
  | 'baseUrl'
  | 'authMode'
  | 'apiKey'
  | 'apiKeyEnv'
  | 'providerType'
  | 'modelSource'
  | 'modelInclude'
  | 'startServer';

type AddProviderStepDefinition = {
  id: AddProviderStepId;
  enabled?: (state: AddProviderState) => boolean;
};

const addProviderStepDefinitions: AddProviderStepDefinition[] = [
  { id: 'providerId' },
  { id: 'baseUrl' },
  { id: 'authMode' },
  {
    id: 'apiKey',
    enabled: (state) => state.authMode === 'once' || state.authMode === 'store',
  },
  {
    id: 'apiKeyEnv',
    enabled: (state) => state.authMode === 'env',
  },
  { id: 'providerType' },
  { id: 'modelSource' },
  { id: 'modelInclude' },
  { id: 'startServer' },
];

export const getAddProviderStepOrder = (stepId: AddProviderStepId): number =>
  addProviderStepDefinitions.findIndex((step) => step.id === stepId);

const isAddProviderStepEnabled = (
  step: AddProviderStepDefinition,
  state: AddProviderState,
): boolean => step.enabled?.(state) !== false;

export const getNextAddProviderStepId = (
  currentStepId: AddProviderStepId,
  state: AddProviderState,
): AddProviderStepId => {
  const currentIndex = addProviderStepDefinitions.findIndex((step) => step.id === currentStepId);
  for (let index = currentIndex + 1; index < addProviderStepDefinitions.length; index += 1) {
    const step = addProviderStepDefinitions[index];
    if (step && isAddProviderStepEnabled(step, state)) return step.id;
  }
  return currentStepId;
};

export const getPreviousAddProviderStepId = (
  currentStepId: AddProviderStepId,
  state: AddProviderState,
): AddProviderStepId => {
  const currentIndex = addProviderStepDefinitions.findIndex((step) => step.id === currentStepId);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const step = addProviderStepDefinitions[index];
    if (step && isAddProviderStepEnabled(step, state)) return step.id;
  }
  return currentStepId;
};

type AddProviderWizardEvent =
  | { type: 'NEXT'; state: AddProviderState }
  | { type: 'BACK'; state: AddProviderState };

type AddProviderWizardContext = {
  currentStepId: AddProviderStepId;
};

export type AddProviderWizardActor = {
  start: () => unknown;
  send: (event: AddProviderWizardEvent) => void;
  state: {
    context: AddProviderWizardContext;
  };
};

export const createAddProviderWizardActor = async (): Promise<AddProviderWizardActor> => {
  const { assign, createMachine, interpret } = await import('@xstate/fsm');
  return interpret(
    createMachine<AddProviderWizardContext, AddProviderWizardEvent>({
      initial: 'editing',
      context: {
        currentStepId: 'providerId',
      },
      states: {
        editing: {
          on: {
            NEXT: {
              actions: assign({
                currentStepId: (context, event) =>
                  getNextAddProviderStepId(context.currentStepId, event.state),
              }),
            },
            BACK: {
              actions: assign({
                currentStepId: (context, event) =>
                  getPreviousAddProviderStepId(context.currentStepId, event.state),
              }),
            },
          },
        },
      },
    }),
  );
};
