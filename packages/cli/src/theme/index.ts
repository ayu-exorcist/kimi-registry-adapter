import { installTerminalThemeTracking } from '../prompts/terminal-session';
import { getBuiltInPalette, setColorPalette } from './colors';
import { loadKimiThemePreference } from './kimi-theme';
import { detectTerminalTheme } from './terminal-theme';

export * from './colors';
export { loadKimiThemePreference } from './kimi-theme';
export {
  createTerminalThemeInputState,
  detectTerminalTheme,
  handleTerminalThemeInput,
  parseColorFgBg,
  parseOsc11BackgroundTheme,
  themeFromHexChannels,
} from './terminal-theme';

/**
 * Align the interactive CLI with Kimi Code's active palette.  Only `auto`
 * themes install a terminal report listener; explicit and custom palettes are
 * stable for the lifetime of this short-lived CLI process.
 */
export const initializeInteractiveTheme = async (): Promise<() => void> => {
  const preference = await loadKimiThemePreference();
  if (preference.kind === 'fixed') {
    setColorPalette(preference.palette);
    return (): void => {};
  }

  const resolved = await detectTerminalTheme();
  setColorPalette(getBuiltInPalette(resolved));
  return installTerminalThemeTracking((nextResolved) => {
    setColorPalette(getBuiltInPalette(nextResolved));
  });
};
