import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchResponse, KraFetchError, readJsonResponse } from '../src/internal';

describe('fetch client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries idempotent requests on retryable responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('try again', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchResponse('https://example.test/models', {
      operation: 'Fetch test models',
      retry: { retries: 1, delayMs: 0 },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries idempotent requests after a transient network failure', async () => {
    // Scenario: a transient network failure is retried and returns the final successful response.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchResponse('https://example.test/models', {
      operation: 'Fetch test models',
      retry: { retries: 1, delayMs: 0 },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies caller-initiated aborts without retry success as an aborted request', async () => {
    // Scenario: a caller-provided AbortSignal produces a stable aborted-request error.
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        controller.abort();
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchResponse('https://example.test/cancelled', {
        operation: 'Fetch cancellable test',
        signal: controller.signal,
        retry: { retries: 0 },
      }),
    ).rejects.toMatchObject({ kind: 'timeout', message: 'Fetch cancellable test was aborted.' });
  });

  it('classifies timeout failures', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchResponse('https://example.test/slow', {
        operation: 'Fetch slow test',
        timeoutMs: 1,
        retry: { retries: 0 },
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('classifies JSON parsing failures', async () => {
    await expect(readJsonResponse(new Response('not-json'), 'Parse test')).rejects.toBeInstanceOf(
      KraFetchError,
    );
    await expect(readJsonResponse(new Response('not-json'), 'Parse test')).rejects.toMatchObject({
      kind: 'parse',
    });
  });
});
