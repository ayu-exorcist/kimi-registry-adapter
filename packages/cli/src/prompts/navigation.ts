export const interactiveHomeSymbol = Symbol('interactive-home');

export const isInteractiveHome = (value: unknown): boolean => value === interactiveHomeSymbol;

export const isHomeKey = (
  key: { meta?: boolean | undefined; name?: string | undefined } | undefined,
): boolean => {
  return Boolean(key?.meta && key.name === 'h');
};
