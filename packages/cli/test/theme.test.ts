import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectPrompt } from '../src/prompts/select';
import {
  installTerminalThemeTracking,
  promptKeyInput,
  setPromptRuntime,
} from '../src/prompts/terminal-session';
import {
  colorize,
  darkColors,
  getColorPalette,
  lightColors,
  setColorPalette,
} from '../src/theme/colors';
import { loadKimiThemePreference } from '../src/theme/kimi-theme';
import {
  OSC11_QUERY,
  TERMINAL_THEME_LIGHT,
  createTerminalThemeInputState,
  detectTerminalTheme,
  handleTerminalThemeInput,
} from '../src/theme/terminal-theme';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'kra-theme-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createRawInput = (): {
  input: typeof process.stdin;
  setRawMode: ReturnType<typeof vi.fn>;
} => {
  const stream = new PassThrough();
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(stream, 'isRaw', { configurable: true, value: false });
  const setRawMode = vi.fn((enabled: boolean) => {
    Object.defineProperty(stream, 'isRaw', { configurable: true, value: enabled });
    return stream;
  });
  Object.defineProperty(stream, 'setRawMode', { configurable: true, value: setRawMode });
  return { input: stream as unknown as typeof process.stdin, setRawMode };
};

const createOutput = (): { output: typeof process.stdout; write: ReturnType<typeof vi.fn> } => {
  const stream = new PassThrough();
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  const write = vi.spyOn(stream, 'write').mockImplementation(() => true);
  return { output: stream as unknown as typeof process.stdout, write };
};

afterEach(async () => {
  setColorPalette(darkColors);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Kimi theme palette resolution', () => {
  it('uses Kimi Code built-in palette values and emits 24-bit color only when color is supported', () => {
    expect(darkColors.primary).toBe('#4FA8FF');
    expect(lightColors.primary).toBe('#1565C0');

    setColorPalette({ ...darkColors, primary: '#010203' });
    expect(getColorPalette().primary).toBe('#010203');
    expect(colorize('primary', 'marker', true)).toBe('\u001B[38;2;1;2;3mmarker\u001B[39m');
    expect(colorize('primary', 'marker', false)).toBe('marker');
  });

  it('resolves Kimi dark and custom palettes, including semantic colors', async () => {
    const dataDir = await createTemporaryDirectory();
    await writeFile(join(dataDir, 'tui.toml'), 'theme = "ocean"\n', 'utf8');
    await mkdir(join(dataDir, 'themes'));
    await writeFile(
      join(dataDir, 'themes', 'ocean.json'),
      JSON.stringify({
        name: 'ocean',
        base: 'light',
        colors: { primary: '#123456', success: '#234567', error: '#345678' },
      }),
      'utf8',
    );

    const preference = await loadKimiThemePreference({ dataDir });
    expect(preference).toMatchObject({
      kind: 'fixed',
      palette: {
        primary: '#123456',
        success: '#234567',
        error: '#345678',
        warning: lightColors.warning,
      },
    });
  });

  it('falls back to auto when Kimi config or the requested custom theme is unavailable', async () => {
    const dataDir = await createTemporaryDirectory();
    await expect(loadKimiThemePreference({ dataDir })).resolves.toEqual({ kind: 'auto' });

    await writeFile(join(dataDir, 'tui.toml'), 'theme = "missing"\n', 'utf8');
    await expect(loadKimiThemePreference({ dataDir })).resolves.toEqual({ kind: 'auto' });

    await writeFile(join(dataDir, 'tui.toml'), 'theme = "../outside"\n', 'utf8');
    await expect(loadKimiThemePreference({ dataDir })).resolves.toEqual({ kind: 'auto' });
  });
});

describe('terminal theme detection and tracking', () => {
  it('uses OSC 11 before COLORFGBG and restores raw mode after the one-shot probe', async () => {
    const { input, setRawMode } = createRawInput();
    const { output, write } = createOutput();
    write.mockImplementation(() => {
      input.emit('data', Buffer.from('\u001B]11;rgb:ffff/ffff/ffff\u0007'));
      return true;
    });

    await expect(
      detectTerminalTheme({ input, output, environment: { COLORFGBG: '7;0' } }),
    ).resolves.toBe('light');
    expect(setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('uses COLORFGBG when OSC 11 is unavailable and honors color opt-out', async () => {
    const { input } = createRawInput();
    Object.defineProperty(input, 'setRawMode', { configurable: true, value: undefined });
    const { output, write } = createOutput();

    await expect(
      detectTerminalTheme({ input, output, environment: { COLORFGBG: '15;default;7' } }),
    ).resolves.toBe('light');
    await expect(
      detectTerminalTheme({ input, output, environment: { NO_COLOR: '1', COLORFGBG: '15;15' } }),
    ).resolves.toBe('dark');
    expect(write).not.toHaveBeenCalled();
  });

  it('filters Kimi terminal reports, forwards normal keys, and applies OSC 11 updates', () => {
    const { input } = createRawInput();
    const { output, write } = createOutput();
    const restore = setPromptRuntime({ input, output });
    const themes: string[] = [];
    const dispose = installTerminalThemeTracking((theme) => themes.push(theme));
    const forwarded: string[] = [];
    promptKeyInput().on('data', (chunk: Buffer) => forwarded.push(chunk.toString('utf8')));

    try {
      input.emit('data', Buffer.from(`a${TERMINAL_THEME_LIGHT}b`));
      input.emit('data', Buffer.from('\u001B]11;rgb:ffff/ffff/ffff\u0007'));

      expect(forwarded).toEqual(['ab']);
      expect(themes).toEqual(['light']);
      expect(write).toHaveBeenCalledWith(OSC11_QUERY);
    } finally {
      dispose();
      restore();
    }
  });

  it('keeps prompt keys functional while filtering terminal theme reports', async () => {
    const { input } = createRawInput();
    const { output } = createOutput();
    const restore = setPromptRuntime({ input, output });
    const dispose = installTerminalThemeTracking(() => {});

    try {
      const selected = selectPrompt({
        message: 'Choose provider',
        options: [
          { value: 'alpha', label: 'Alpha' },
          { value: 'bravo', label: 'Bravo' },
        ],
        clearOnExit: false,
      });
      input.emit('data', Buffer.from('\u001B[B\r'));
      await expect(selected).resolves.toBe('bravo');
    } finally {
      dispose();
      restore();
    }
  });

  it('buffers split OSC 11 reports without forwarding their control bytes', () => {
    const { output } = createOutput();
    const themes: string[] = [];
    const state = createTerminalThemeInputState();

    expect(
      handleTerminalThemeInput('\u001B]11;rgb:ffff/', output, (theme) => themes.push(theme), state),
    ).toEqual({ consume: true });
    expect(
      handleTerminalThemeInput('ffff/ffff\u0007x', output, (theme) => themes.push(theme), state),
    ).toEqual({ data: 'x' });
    expect(themes).toEqual(['light']);
  });
});
