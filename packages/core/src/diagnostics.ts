import {
  configureDiagnostics as configureLoggerDiagnostics,
  diagnosticsLogFile,
  isDiagnosticsEnabled as isLoggerDiagnosticsEnabled,
  writeDiagnosticsRecord,
  type DiagnosticsOptions,
} from './logger';

export type ConfigureDiagnosticsOptions = Pick<DiagnosticsOptions, 'defaultLogDir'>;

export interface DiagnosticEvent {
  event: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  data?: Record<string, unknown>;
  error?: unknown;
}

export const configureDiagnostics = (options: ConfigureDiagnosticsOptions = {}): void => {
  configureLoggerDiagnostics(options);
};

export const isDiagnosticsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  isLoggerDiagnosticsEnabled(env);

export const getDiagnosticsLogFile = (env: NodeJS.ProcessEnv = process.env): string =>
  diagnosticsLogFile(env);

export const writeDiagnostic = (
  event: DiagnosticEvent,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  writeDiagnosticsRecord(
    {
      ts: new Date().toISOString(),
      ...event,
    },
    env,
  );
};
