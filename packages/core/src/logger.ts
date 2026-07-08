import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticLogContext = Record<string, unknown>;

export type DiagnosticsOptions = {
  defaultLogDir?: string;
  runId?: string;
};

const levels: Record<DiagnosticLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKeyPattern = /api[-_]?key|authorization|token|password|secret|credential/iu;

let diagnosticsOptions: DiagnosticsOptions = {};
let runId: string = randomUUID();

export const configureDiagnostics = (options: DiagnosticsOptions): void => {
  diagnosticsOptions = { ...diagnosticsOptions, ...options };
  if (options.runId) {
    runId = options.runId;
  }
};

export const diagnosticsRunId = (): string => runId;

export const isDiagnosticsEnabled = (): boolean =>
  process.env['KRA_LOG'] === '1' || process.env['KRA_DEBUG'] === '1';

const configuredLevel = (): DiagnosticLogLevel => {
  const value = process.env['KRA_LOG_LEVEL']?.toLowerCase();
  if (value === 'info' || value === 'warn' || value === 'error') return value;
  return 'debug';
};

const shouldLog = (level: DiagnosticLogLevel): boolean =>
  isDiagnosticsEnabled() && levels[level] >= levels[configuredLevel()];

const defaultLogFile = (): string => {
  const logDir =
    diagnosticsOptions.defaultLogDir ?? resolve(homedir(), '.kimi-registry-adapter', 'logs');
  return resolve(logDir, 'kra-debug.log');
};

export const diagnosticsLogFile = (): string =>
  process.env['KRA_LOG_FILE'] ? resolve(process.env['KRA_LOG_FILE']) : defaultLogFile();

export const redactDiagnosticsValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticsValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    redacted[key] = sensitiveKeyPattern.test(key)
      ? '[REDACTED]'
      : redactDiagnosticsValue(entryValue);
  }
  return redacted;
};

const normalizeError = (error: unknown): DiagnosticLogContext => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { error };
};

export const writeDiagnosticLog = (
  level: DiagnosticLogLevel,
  scope: string,
  event: string,
  context: DiagnosticLogContext = {},
): void => {
  if (!shouldLog(level)) return;

  const file = diagnosticsLogFile();
  const payload = {
    ts: new Date().toISOString(),
    level,
    runId,
    scope,
    event,
    context: redactDiagnosticsValue(context),
  };

  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Diagnostics must never break normal CLI behavior.
  }
};

export const logDebug = (scope: string, event: string, context?: DiagnosticLogContext): void =>
  writeDiagnosticLog('debug', scope, event, context);

export const logInfo = (scope: string, event: string, context?: DiagnosticLogContext): void =>
  writeDiagnosticLog('info', scope, event, context);

export const logWarn = (scope: string, event: string, context?: DiagnosticLogContext): void =>
  writeDiagnosticLog('warn', scope, event, context);

export const logError = (scope: string, event: string, errorOrContext?: unknown): void =>
  writeDiagnosticLog(
    'error',
    scope,
    event,
    errorOrContext instanceof Error
      ? normalizeError(errorOrContext)
      : ((errorOrContext as DiagnosticLogContext | undefined) ?? {}),
  );

export const createOperationLogger = (
  scope: string,
  baseContext: DiagnosticLogContext = {},
): {
  operationId: string;
  debug: (event: string, context?: DiagnosticLogContext) => void;
  info: (event: string, context?: DiagnosticLogContext) => void;
  warn: (event: string, context?: DiagnosticLogContext) => void;
  error: (event: string, errorOrContext?: unknown) => void;
} => {
  const operationId = randomUUID();
  const withContext = (context: DiagnosticLogContext = {}): DiagnosticLogContext => ({
    ...baseContext,
    ...context,
    operationId,
  });

  return {
    operationId,
    debug: (event, context) => logDebug(scope, event, withContext(context)),
    info: (event, context) => logInfo(scope, event, withContext(context)),
    warn: (event, context) => logWarn(scope, event, withContext(context)),
    error: (event, errorOrContext) =>
      logError(
        scope,
        event,
        errorOrContext instanceof Error
          ? { ...withContext(), ...normalizeError(errorOrContext) }
          : withContext((errorOrContext as DiagnosticLogContext | undefined) ?? {}),
      ),
  };
};
