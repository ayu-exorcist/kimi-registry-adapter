import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { parse } from 'smol-toml';

import {
  darkColors,
  getBuiltInPalette,
  isHexColor,
  type ColorPalette,
  type ColorToken,
  type ResolvedTheme,
} from './colors';

export type KimiThemePreference =
  | { kind: 'auto' }
  | {
      kind: 'fixed';
      palette: ColorPalette;
    };

export interface LoadKimiThemeOptions {
  dataDir?: string;
  readFile?: typeof readFile;
}

const colorTokens = Object.keys(darkColors) as ColorToken[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getKimiDataDir = (): string => {
  const configured = process.env['KIMI_CODE_HOME']?.trim();
  return configured && configured.length > 0 ? configured : join(homedir(), '.kimi-code');
};

const parseThemeName = (content: string): string => {
  try {
    const parsed: unknown = parse(content);
    if (!isRecord(parsed) || typeof parsed['theme'] !== 'string') return 'auto';
    return parsed['theme'];
  } catch {
    return 'auto';
  }
};

const safeCustomThemeName = (name: string): boolean =>
  name.length > 0 && name !== '.' && name !== '..' && basename(name) === name;

const paletteFromCustomTheme = (content: string): ColorPalette | undefined => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || typeof parsed['name'] !== 'string' || parsed['name'].length === 0) {
      return undefined;
    }

    const base: ResolvedTheme = parsed['base'] === 'light' ? 'light' : 'dark';
    const colors = isRecord(parsed['colors']) ? parsed['colors'] : {};
    const overrides: Partial<ColorPalette> = {};
    for (const token of colorTokens) {
      const value = colors[token];
      if (isHexColor(value)) {
        overrides[token] = value;
      }
    }
    return { ...getBuiltInPalette(base), ...overrides };
  } catch {
    return undefined;
  }
};

const readThemeFile = async (path: string, read: typeof readFile): Promise<string | undefined> => {
  try {
    return await read(path, 'utf8');
  } catch {
    return undefined;
  }
};

export const loadKimiThemePreference = async (
  options: LoadKimiThemeOptions = {},
): Promise<KimiThemePreference> => {
  const dataDir = options.dataDir ?? getKimiDataDir();
  const read = options.readFile ?? readFile;
  const tuiConfig = await readThemeFile(join(dataDir, 'tui.toml'), read);
  const themeName = tuiConfig === undefined ? 'auto' : parseThemeName(tuiConfig);

  if (themeName === 'dark') return { kind: 'fixed', palette: getBuiltInPalette('dark') };
  if (themeName === 'light') return { kind: 'fixed', palette: getBuiltInPalette('light') };
  if (themeName === 'auto' || !safeCustomThemeName(themeName)) return { kind: 'auto' };

  const customTheme = await readThemeFile(join(dataDir, 'themes', `${themeName}.json`), read);
  const palette = customTheme === undefined ? undefined : paletteFromCustomTheme(customTheme);
  return palette === undefined ? { kind: 'auto' } : { kind: 'fixed', palette };
};
