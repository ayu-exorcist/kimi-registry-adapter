import {
  getProviderModelSourceDescriptor,
  isProviderModelEndpointSourceKind,
  isProviderModelSourceKind,
  providerModelSourceKindDescription,
  type ProviderConfig,
  type UpdateMode,
} from '@kastral/kra-core';

export type { UpdateMode };

export const parseModelSource = (
  kind: string | undefined,
  options: { modelSourcePath?: string | undefined; modelSourceUrl?: string | undefined },
): ProviderConfig['modelSource'] | undefined => {
  if (!kind) {
    return undefined;
  }

  if (!isProviderModelSourceKind(kind)) {
    throw new Error(`Invalid --model-source. Expected ${providerModelSourceKindDescription}.`);
  }

  const descriptor = getProviderModelSourceDescriptor(kind);

  if (descriptor.requiresPath) {
    if (!options.modelSourcePath) {
      throw new Error(`--model-source-path is required when --model-source ${kind} is used.`);
    }
    return { kind: 'local_file', path: options.modelSourcePath };
  }

  if (descriptor.requiresUrl) {
    if (!options.modelSourceUrl) {
      throw new Error(`--model-source-url is required when --model-source ${kind} is used.`);
    }
    return { kind: 'remote_url', url: options.modelSourceUrl };
  }

  if (descriptor.acceptsEndpointUrl && isProviderModelEndpointSourceKind(kind)) {
    return {
      kind,
      ...(options.modelSourceUrl ? { modelsUrl: options.modelSourceUrl } : {}),
    };
  }

  throw new Error(`Invalid --model-source. Expected ${providerModelSourceKindDescription}.`);
};

export const parseUpdateMode = (mode: string | undefined): UpdateMode | undefined => {
  if (!mode) {
    return undefined;
  }

  if (mode !== 'merge' && mode !== 'overwrite') {
    throw new Error('Invalid --update-mode. Expected merge or overwrite.');
  }

  return mode;
};

export const parsePatternList = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined;
  }

  const patterns = values.flatMap((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
  return patterns.length > 0 ? patterns : undefined;
};

const collectOptionValues = (rawArgs: string[], optionName: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const item = rawArgs[index];
    if (item === `--${optionName}` && rawArgs[index + 1] && !rawArgs[index + 1]?.startsWith('--')) {
      values.push(rawArgs[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (item?.startsWith(`--${optionName}=`)) values.push(item.slice(optionName.length + 3));
  }
  return values;
};

export const normalizeVariadicPatternOptions = (argv: string[]): string[] => {
  const variadicOptions = new Set(['include', 'exclude']);
  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item) continue;
    const optionName = item.startsWith('--') ? (item.slice(2).split('=')[0] ?? '') : undefined;
    if (!optionName || !variadicOptions.has(optionName) || item.includes('=')) {
      normalized.push(item);
      continue;
    }
    normalized.push(item);
    const values: string[] = [];
    while (argv[index + 1] && !argv[index + 1]?.startsWith('--')) {
      values.push(argv[index + 1] ?? '');
      index += 1;
    }
    if (values.length > 0) normalized.push(values.join(','));
  }
  return normalized;
};

export const requireCliString = (value: string | undefined, name: string): string => {
  if (value === undefined) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

type PatternOptionInput = {
  include?: string | string[] | undefined;
  exclude?: string | string[] | undefined;
};

type NormalizedPatternOptions<T extends PatternOptionInput> = Omit<T, 'include' | 'exclude'> & {
  include?: string[];
  exclude?: string[];
};

const parsePatternOptionInput = (value: string | string[] | undefined): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return parsePatternList(Array.isArray(value) ? value : [value]);
};

export const withPatternOptions = <T extends PatternOptionInput>(
  args: T,
  rawArgs: string[],
): NormalizedPatternOptions<T> => {
  const { include: rawInclude, exclude: rawExclude, ...rest } = args;
  const include =
    parsePatternList(collectOptionValues(rawArgs, 'include')) ??
    parsePatternOptionInput(rawInclude);
  const exclude =
    parsePatternList(collectOptionValues(rawArgs, 'exclude')) ??
    parsePatternOptionInput(rawExclude);
  return { ...rest, ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) };
};
