const ESC = '\u001B';
const BEL = '\u0007';

export const OSC11_QUERY = `${ESC}]11;?${BEL}`;
export const QUERY_TERMINAL_THEME = `${ESC}[?996n`;
export const ENABLE_TERMINAL_THEME_REPORTING = `${ESC}[?2031h`;
export const DISABLE_TERMINAL_THEME_REPORTING = `${ESC}[?2031l`;
export const TERMINAL_THEME_DARK = `${ESC}[?997;1n`;
export const TERMINAL_THEME_LIGHT = `${ESC}[?997;2n`;
export const TERMINAL_THEME_DETECT_TIMEOUT_MS = 250;

const OSC11_RESPONSE = new RegExp(
  String.raw`${ESC}?\]11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:${BEL}|${ESC}\\)`,
  'iu',
);
const OSC11_RESPONSE_PREFIX = `${ESC}]11;rgb:`;
const OSC11_RESPONSE_PREFIX_NO_ESC = ']11;rgb:';
const TERMINAL_THEME_INPUT_BUFFER_MAX_LENGTH = 512;

type TerminalInput = Pick<
  typeof process.stdin,
  'isTTY' | 'isRaw' | 'setRawMode' | 'on' | 'off' | 'listenerCount'
>;
type TerminalOutput = Pick<typeof process.stdout, 'isTTY' | 'write'>;

export type ResolvedTheme = 'dark' | 'light';

export interface DetectTerminalThemeOptions {
  timeoutMs?: number;
  input?: TerminalInput;
  output?: TerminalOutput;
  environment?: NodeJS.ProcessEnv;
}

export interface TerminalThemeInputState {
  osc11Buffer: string;
}

export type TerminalThemeInputResult = { consume?: boolean; data?: string } | undefined;

const isColorOptOut = (environment: NodeJS.ProcessEnv): boolean =>
  (environment['NO_COLOR'] !== undefined && environment['NO_COLOR'] !== '') ||
  environment['FORCE_COLOR'] === '0' ||
  (environment['CI'] !== undefined && environment['CI'] !== '' && environment['CI'] !== '0');

const isInteractiveTerminal = (input: TerminalInput, output: TerminalOutput): boolean =>
  (input.isTTY ?? false) && (output.isTTY ?? false);

const normalizeChannel = (hex: string): number => {
  const max = 16 ** hex.length - 1;
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value / max : 0;
};

export const themeFromHexChannels = (
  redHex: string,
  greenHex: string,
  blueHex: string,
): ResolvedTheme => {
  const luminance =
    0.2126 * normalizeChannel(redHex) +
    0.7152 * normalizeChannel(greenHex) +
    0.0722 * normalizeChannel(blueHex);
  return luminance > 0.5 ? 'light' : 'dark';
};

export const parseOsc11BackgroundTheme = (data: string): ResolvedTheme | undefined => {
  const match = OSC11_RESPONSE.exec(data);
  if (match === null) return undefined;
  const [, red, green, blue] = match;
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return themeFromHexChannels(red, green, blue);
};

export const parseColorFgBg = (value: string | undefined): ResolvedTheme | undefined => {
  if (value === undefined || value.length === 0) return undefined;
  const background = Number(value.split(';').at(-1) ?? '');
  if (!Number.isInteger(background)) return undefined;
  return new Set([0, 1, 2, 3, 4, 5, 6, 8]).has(background) ? 'dark' : 'light';
};

const queryOsc11 = async (
  input: TerminalInput,
  output: TerminalOutput,
  timeoutMs: number,
): Promise<ResolvedTheme | undefined> => {
  if (typeof input.setRawMode !== 'function' || input.listenerCount('data') > 0) return undefined;

  const wasRaw = input.isRaw === true;
  let listener: ((chunk: Buffer) => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    if (!wasRaw) input.setRawMode(true);
    return await new Promise<ResolvedTheme | undefined>((resolve) => {
      let buffer = '';
      let settled = false;
      const finish = (theme: ResolvedTheme | undefined): void => {
        if (settled) return;
        settled = true;
        resolve(theme);
      };
      listener = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const theme = parseOsc11BackgroundTheme(buffer);
        if (theme !== undefined) finish(theme);
      };
      input.on('data', listener);
      timer = setTimeout(() => {
        finish(undefined);
      }, timeoutMs);
      try {
        output.write(OSC11_QUERY);
      } catch {
        finish(undefined);
      }
    });
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener !== undefined) input.off('data', listener);
    if (!wasRaw) {
      try {
        input.setRawMode(false);
      } catch {
        // Restoring raw mode is best-effort, exactly like Kimi Code's probe.
      }
    }
  }
};

export const detectTerminalTheme = async (
  options: DetectTerminalThemeOptions = {},
): Promise<ResolvedTheme> => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const environment = options.environment ?? process.env;
  if (!isInteractiveTerminal(input, output) || isColorOptOut(environment)) return 'dark';

  const fromOsc11 = await queryOsc11(
    input,
    output,
    options.timeoutMs ?? TERMINAL_THEME_DETECT_TIMEOUT_MS,
  );
  if (fromOsc11 !== undefined) return fromOsc11;
  return parseColorFgBg(environment['COLORFGBG']) ?? 'dark';
};

export const createTerminalThemeInputState = (): TerminalThemeInputState => ({ osc11Buffer: '' });

const stripOsc11Reports = (data: string, onTheme: (theme: ResolvedTheme) => void): string => {
  let remaining = data;
  for (;;) {
    const match = OSC11_RESPONSE.exec(remaining);
    if (match === null) return remaining;
    const theme = parseOsc11BackgroundTheme(match[0]);
    if (theme !== undefined) onTheme(theme);
    remaining = `${remaining.slice(0, match.index)}${remaining.slice(match.index + match[0].length)}`;
  }
};

const stripTerminalThemeReports = (
  data: string,
  output: Pick<typeof process.stdout, 'write'>,
): string => {
  let remaining = data;
  let strippedReport = false;
  for (const report of [TERMINAL_THEME_DARK, TERMINAL_THEME_LIGHT]) {
    if (!remaining.includes(report)) continue;
    remaining = remaining.split(report).join('');
    strippedReport = true;
  }
  if (strippedReport) output.write(OSC11_QUERY);
  return remaining;
};

const findPartialOsc11Start = (data: string): number => {
  const prefixIndex = data.indexOf(OSC11_RESPONSE_PREFIX);
  if (prefixIndex !== -1) return prefixIndex;
  const noEscPrefixIndex = data.indexOf(OSC11_RESPONSE_PREFIX_NO_ESC);
  if (noEscPrefixIndex !== -1) return noEscPrefixIndex;

  for (let index = 0; index < data.length; index += 1) {
    const suffix = data.slice(index);
    if (OSC11_RESPONSE_PREFIX.startsWith(suffix) && suffix.length > 1) return index;
    if (OSC11_RESPONSE_PREFIX_NO_ESC.startsWith(suffix) && suffix.startsWith(']11;')) return index;
  }
  return -1;
};

const resultFromRemaining = (data: string): TerminalThemeInputResult =>
  data.length === 0 ? { consume: true } : { data };

export const handleTerminalThemeInput = (
  data: string,
  output: Pick<typeof process.stdout, 'write'>,
  onTheme: (theme: ResolvedTheme) => void,
  inputState: TerminalThemeInputState = createTerminalThemeInputState(),
): TerminalThemeInputResult => {
  if (inputState.osc11Buffer.length > 0) {
    const candidate = `${inputState.osc11Buffer}${data}`;
    const stripped = stripOsc11Reports(candidate, onTheme);
    if (stripped !== candidate) {
      inputState.osc11Buffer = '';
      return resultFromRemaining(stripped);
    }
    inputState.osc11Buffer =
      candidate.length > TERMINAL_THEME_INPUT_BUFFER_MAX_LENGTH ? '' : candidate;
    return { consume: true };
  }

  let remaining = stripOsc11Reports(data, onTheme);
  remaining = stripTerminalThemeReports(remaining, output);
  const partialOsc11Start = findPartialOsc11Start(remaining);
  if (partialOsc11Start !== -1) {
    inputState.osc11Buffer = remaining.slice(partialOsc11Start);
    return resultFromRemaining(remaining.slice(0, partialOsc11Start));
  }
  return remaining === data ? undefined : resultFromRemaining(remaining);
};
