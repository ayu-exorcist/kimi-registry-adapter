import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface ConfigureDiagnosticsOptions {
  defaultLogDir?: string;
}

export interface DiagnosticEvent {
  event: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  data?: Record<string, unknown>;
  error?: unknown;
}

let defaultLogDir: string | undefined;

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|api[-_]?key|token|secret|password|cookie|credential|access[-_]?token|refresh[-_]?token)/iu;

export function configureDiagnostics(options: ConfigureDiagnosticsOptions = {}): void {
  defaultLogDir = options.defaultLogDir;
}

export function isDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['KRA_LOG'] === '1' || env['KRA_DEBUG'] === '1';
}

export function getDiagnosticsLogFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env['KRA_LOG_FILE']) {
    return resolve(env['KRA_LOG_FILE']);
  }

  if (defaultLogDir) {
    return resolve(defaultLogDir, 'kra-debug.log');
  }

  return resolve('.kimi-registry-adapter', 'logs', 'kra-debug.log');
}

export function writeDiagnostic(
  event: DiagnosticEvent,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isDiagnosticsEnabled(env)) {
    return;
  }

  const logFile = getDiagnosticsLogFile(env);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...(redact(event) as Record<string, unknown>),
  });

  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${line}\n`, 'utf8');
}

function redact(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(nestedValue);
    }
    return result;
  }

  return value;
}
