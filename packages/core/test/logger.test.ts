import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configureDiagnostics,
  diagnosticsLogFile,
  isDiagnosticsEnabled,
  logDebug,
  logInfo,
  redactDiagnosticsValue,
} from '../src/logger';

const originalEnv = { ...process.env };
let tempDir: string;

const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

describe('diagnostics logger', () => {
  beforeEach(() => {
    resetEnv();
    tempDir = mkdtempSync(join(tmpdir(), 'kra-logger-'));
    configureDiagnostics({ defaultLogDir: join(tempDir, 'logs'), runId: 'test-run' });
  });

  afterEach(() => {
    resetEnv();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('is disabled by default', () => {
    expect(isDiagnosticsEnabled()).toBe(false);
    logInfo('test', 'disabled');
  });

  it('writes JSON lines when enabled', () => {
    process.env['KRA_LOG'] = '1';

    logInfo('test.scope', 'event.name', { value: 1 });

    const content = readFileSync(diagnosticsLogFile(), 'utf8').trim();
    const entry = JSON.parse(content) as {
      level: string;
      runId: string;
      scope: string;
      event: string;
      context: { value: number };
    };
    expect(entry.level).toBe('info');
    expect(entry.runId).toBe('test-run');
    expect(entry.scope).toBe('test.scope');
    expect(entry.event).toBe('event.name');
    expect(entry.context.value).toBe(1);
  });

  it('honors log level filtering', () => {
    process.env['KRA_LOG'] = '1';
    process.env['KRA_LOG_LEVEL'] = 'info';

    logDebug('test', 'debug');
    logInfo('test', 'info');

    const lines = readFileSync(diagnosticsLogFile(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toMatchObject({ level: 'info', event: 'info' });
  });

  it('redacts sensitive fields recursively', () => {
    expect(
      redactDiagnosticsValue({
        apiKey: 'secret',
        nested: { authorization: 'Bearer token', ok: true },
        list: [{ password: 'pw' }],
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', ok: true },
      list: [{ password: '[REDACTED]' }],
    });
  });
});
