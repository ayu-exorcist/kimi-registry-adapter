import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  configureDiagnostics,
  getDiagnosticsLogFile,
  isDiagnosticsEnabled,
  writeDiagnostic,
} from './diagnostics';

const tmpDirs: string[] = [];

afterEach(() => {
  configureDiagnostics({});
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('diagnostics', () => {
  it('is disabled by default and enabled by KRA_LOG or KRA_DEBUG', () => {
    expect(isDiagnosticsEnabled({})).toBe(false);
    expect(isDiagnosticsEnabled({ KRA_LOG: '1' })).toBe(true);
    expect(isDiagnosticsEnabled({ KRA_DEBUG: '1' })).toBe(true);
  });

  it('uses KRA_LOG_FILE as an override', () => {
    expect(getDiagnosticsLogFile({ KRA_LOG_FILE: 'custom.log' })).toMatch(/custom\.log$/u);
  });

  it('writes JSON lines to the configured default log directory and redacts secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kra-diagnostics-'));
    tmpDirs.push(dir);
    configureDiagnostics({ defaultLogDir: join(dir, 'logs') });

    writeDiagnostic(
      {
        event: 'request',
        data: { token: 'secret-token', nested: { apiKey: 'secret-key', keep: 'value' } },
        error: new Error('request failed'),
      },
      { KRA_LOG: '1' },
    );

    const log = readFileSync(join(dir, 'logs', 'kra-debug.log'), 'utf8').trim();
    const record = JSON.parse(log) as {
      event: string;
      data: { token: string; nested: { apiKey: string; keep: string } };
      error: { name: string; message: string };
    };
    expect(record.event).toBe('request');
    expect(record.error).toMatchObject({ name: 'Error', message: 'request failed' });
    expect(record.data.token).toBe('[REDACTED]');
    expect(record.data.nested.apiKey).toBe('[REDACTED]');
    expect(record.data.nested.keep).toBe('value');
  });
});
