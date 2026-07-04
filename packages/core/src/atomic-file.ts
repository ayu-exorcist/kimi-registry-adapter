import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AtomicWriteOptions = {
  retries?: number;
  retryDelayMs?: number;
};

const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 25;
const RETRYABLE_RENAME_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

const tempFilePath = (filePath: string): string => `${filePath}.${process.pid}.${randomUUID()}.tmp`;

const errorCode = (error: unknown): string | undefined => {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
};

const isRetryableRenameError = (error: unknown): boolean => {
  const code = errorCode(error);
  return code !== undefined && RETRYABLE_RENAME_ERROR_CODES.has(code);
};

const retryDelay = (attempt: number, retryDelayMs: number): number =>
  retryDelayMs * 2 ** Math.max(0, attempt - 1);

const sleepSync = (ms: number): void => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
};

export const renameWithRetrySync = (
  fromPath: string,
  toPath: string,
  options: AtomicWriteOptions = {},
): void => {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(fromPath, toPath);
      return;
    } catch (error) {
      if (attempt >= retries || !isRetryableRenameError(error)) {
        throw error;
      }
      sleepSync(retryDelay(attempt + 1, retryDelayMs));
    }
  }
};

export const renameWithRetry = async (
  fromPath: string,
  toPath: string,
  options: AtomicWriteOptions = {},
): Promise<void> => {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error) {
      if (attempt >= retries || !isRetryableRenameError(error)) {
        throw error;
      }
      await sleep(retryDelay(attempt + 1, retryDelayMs));
    }
  }
};

export const writeAtomicText = (
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = tempFilePath(filePath);
  try {
    writeFileSync(tempPath, content, 'utf8');
    renameWithRetrySync(tempPath, filePath, options);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
};

export const writeAtomicTextAsync = async (
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = tempFilePath(filePath);
  try {
    await writeFile(tempPath, content, 'utf8');
    await renameWithRetry(tempPath, filePath, options);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};
