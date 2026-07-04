import type { ConfirmPromptOptions } from '../prompts/confirm';
import type { InputPromptOptions } from '../prompts/input';
import type { LoadingIndicatorOptions } from '../prompts/loading';
import type { SearchMultiselectOptions } from '../prompts/search-multiselect';
import type { SelectPromptOptions } from '../prompts/select';

export type PromptDriver = {
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<boolean | symbol>;
  inputPrompt: (options: InputPromptOptions) => Promise<string | symbol>;
  withLoadingIndicator: <T>(
    message: string,
    action: () => Promise<T>,
    options?: LoadingIndicatorOptions,
  ) => Promise<T>;
  searchMultiselect: <T>(options: SearchMultiselectOptions<T>) => Promise<T[] | symbol>;
  selectPrompt: <T>(options: SelectPromptOptions<T>) => Promise<T | symbol>;
};

const defaultPromptDriver: PromptDriver = {
  confirmPrompt: async (options) => {
    const prompt = await import('../prompts/confirm');
    return prompt.confirmPrompt(options);
  },
  inputPrompt: async (options) => {
    const prompt = await import('../prompts/input');
    return prompt.inputPrompt(options);
  },
  withLoadingIndicator: async (message, action, options) => {
    const prompt = await import('../prompts/loading');
    return prompt.withLoadingIndicator(message, action, options);
  },
  searchMultiselect: async (options) => {
    const prompt = await import('../prompts/search-multiselect');
    return prompt.searchMultiselect(options);
  },
  selectPrompt: async (options) => {
    const prompt = await import('../prompts/select');
    return prompt.selectPrompt(options);
  },
};

let promptDriver: PromptDriver = defaultPromptDriver;

export const setPromptDriver = (driver: Partial<PromptDriver>): (() => void) => {
  const previous = promptDriver;
  promptDriver = { ...defaultPromptDriver, ...driver };
  return () => {
    promptDriver = previous;
  };
};

export const confirmPrompt = async (options: ConfirmPromptOptions): Promise<boolean | symbol> => {
  return promptDriver.confirmPrompt(options);
};

export const inputPrompt = async (options: InputPromptOptions): Promise<string | symbol> => {
  return promptDriver.inputPrompt(options);
};

export const withLoadingIndicator = async <T>(
  message: string,
  action: () => Promise<T>,
  options?: LoadingIndicatorOptions,
): Promise<T> => {
  return promptDriver.withLoadingIndicator(message, action, options);
};

export const searchMultiselect = async <T>(
  options: SearchMultiselectOptions<T>,
): Promise<T[] | symbol> => {
  return promptDriver.searchMultiselect(options);
};

export const selectPrompt = async <T>(options: SelectPromptOptions<T>): Promise<T | symbol> => {
  return promptDriver.selectPrompt(options);
};
