export const providerTypes = ['anthropic', 'openai', 'openai_responses'] as const;
export type ProviderType = (typeof providerTypes)[number];

export const providerModelEndpointSourceKinds = ['openai_models', 'anthropic_models'] as const;
export const providerModelFileSourceKinds = ['local_file', 'remote_url'] as const;
export const providerModelSourceKinds = [
  ...providerModelEndpointSourceKinds,
  ...providerModelFileSourceKinds,
] as const;
export type ProviderModelEndpointSourceKind = (typeof providerModelEndpointSourceKinds)[number];
export type ProviderModelSourceKind = (typeof providerModelSourceKinds)[number];

type ProviderHeaderFactory = (apiKey?: string) => Record<string, string>;

export type ProviderDescriptor = {
  type: ProviderType;
  label: string;
  defaultModelSourceKind: ProviderModelEndpointSourceKind;
  modelSourceLabel: string;
  defaultModelsUrl: (baseUrl: string, modelsUrl?: string) => string;
  discovery: {
    operation: string;
    headers: ProviderHeaderFactory;
  };
};

export type ProviderTypeOption = { value: ProviderType; label: string };

type ProviderDescriptorMap = { [Type in ProviderType]: ProviderDescriptor & { type: Type } };

const isStringLiteralMember = <const Values extends readonly string[]>(
  values: Values,
  value: string,
): value is Values[number] => values.some((item) => item === value);

const deriveV1ModelsUrl = (baseUrl: string, modelsUrl?: string): string => {
  if (modelsUrl) {
    return modelsUrl;
  }

  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/u, '');

  if (pathname.endsWith('/v1')) {
    return new URL('./models', `${url.toString().replace(/\/?$/u, '/')}`).toString();
  }

  return new URL('./v1/models', `${url.toString().replace(/\/?$/u, '/')}`).toString();
};

const bearerHeaders: ProviderHeaderFactory = (apiKey) => {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
};

const anthropicHeaders: ProviderHeaderFactory = (apiKey) => ({
  'anthropic-version': '2023-06-01',
  ...(apiKey ? { 'x-api-key': apiKey } : {}),
});

export const providerDescriptors = {
  anthropic: {
    type: 'anthropic',
    label: 'Anthropic-compatible',
    defaultModelSourceKind: 'anthropic_models',
    modelSourceLabel: 'Anthropic native',
    defaultModelsUrl: deriveV1ModelsUrl,
    discovery: {
      operation: 'Fetch Anthropic models',
      headers: anthropicHeaders,
    },
  },
  openai: {
    type: 'openai',
    label: 'OpenAI Chat Completions API',
    defaultModelSourceKind: 'openai_models',
    modelSourceLabel: 'OpenAI-compatible',
    defaultModelsUrl: deriveV1ModelsUrl,
    discovery: {
      operation: 'Fetch OpenAI models',
      headers: bearerHeaders,
    },
  },
  openai_responses: {
    type: 'openai_responses',
    label: 'OpenAI Responses API',
    defaultModelSourceKind: 'openai_models',
    modelSourceLabel: 'OpenAI-compatible',
    defaultModelsUrl: deriveV1ModelsUrl,
    discovery: {
      operation: 'Fetch OpenAI models',
      headers: bearerHeaders,
    },
  },
} satisfies ProviderDescriptorMap;

export const DEFAULT_PROVIDER_TYPE: ProviderType = 'openai_responses';

export const getProviderDescriptor = (type: ProviderType): ProviderDescriptor =>
  providerDescriptors[type];

export const isProviderType = (value: string): value is ProviderType => {
  return isStringLiteralMember(providerTypes, value);
};

export const parseProviderType = (value: string): ProviderType => {
  if (isProviderType(value)) {
    return value;
  }

  throw new Error(`Invalid provider type. Expected ${providerTypes.join(', ')}.`);
};

export const isProviderModelEndpointSourceKind = (
  value: string,
): value is ProviderModelEndpointSourceKind => {
  return isStringLiteralMember(providerModelEndpointSourceKinds, value);
};

export const isProviderModelSourceKind = (value: string): value is ProviderModelSourceKind => {
  return isStringLiteralMember(providerModelSourceKinds, value);
};

export type ProviderModelSourceDescriptor = {
  kind: ProviderModelSourceKind;
  label: string;
  requiresPath: boolean;
  requiresUrl: boolean;
  acceptsEndpointUrl: boolean;
};

export const providerModelSourceDescriptors = {
  openai_models: {
    kind: 'openai_models',
    label: 'OpenAI-compatible /models endpoint',
    requiresPath: false,
    requiresUrl: false,
    acceptsEndpointUrl: true,
  },
  anthropic_models: {
    kind: 'anthropic_models',
    label: 'Anthropic /models endpoint',
    requiresPath: false,
    requiresUrl: false,
    acceptsEndpointUrl: true,
  },
  local_file: {
    kind: 'local_file',
    label: 'Local models payload file',
    requiresPath: true,
    requiresUrl: false,
    acceptsEndpointUrl: false,
  },
  remote_url: {
    kind: 'remote_url',
    label: 'Remote models payload URL',
    requiresPath: false,
    requiresUrl: true,
    acceptsEndpointUrl: false,
  },
} satisfies { [Kind in ProviderModelSourceKind]: ProviderModelSourceDescriptor & { kind: Kind } };

export const getProviderModelSourceDescriptor = (
  kind: ProviderModelSourceKind,
): ProviderModelSourceDescriptor => providerModelSourceDescriptors[kind];

export const providerModelSourceKindDescription = providerModelSourceKinds.join(', ');

const providerTypeOptionOrder: ProviderType[] = ['openai_responses', 'openai', 'anthropic'];

export const providerTypeOptions = (): ProviderTypeOption[] =>
  providerTypeOptionOrder.map((type) => ({
    value: type,
    label: getProviderDescriptor(type).label,
  }));

export const defaultModelSourceKindForProvider = (
  type: ProviderType,
): ProviderModelEndpointSourceKind => getProviderDescriptor(type).defaultModelSourceKind;

export const deriveDefaultProviderModelsUrl = (
  type: ProviderType,
  baseUrl: string,
  modelsUrl?: string,
): string => getProviderDescriptor(type).defaultModelsUrl(baseUrl, modelsUrl);

export const defaultModelSourceLabelForProvider = (type: ProviderType): string =>
  getProviderDescriptor(type).modelSourceLabel;
