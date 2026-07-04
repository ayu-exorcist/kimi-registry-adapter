import { KraFetchError, type UpdateProviderOperationResult } from '@kastral/kra-core';
import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  createServeUpdateTracker,
  updateConfiguredProviders,
} from '../src/commands/server-runtime';

const waitUntil = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error('Timed out waiting for condition.');
};

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('serve provider update scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs provider updates with bounded concurrency', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const releases = new Map([
      ['provider-a', deferred()],
      ['provider-b', deferred()],
      ['provider-c', deferred()],
    ]);
    const started: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const updates = updateConfiguredProviders('unused-state-dir', {
      providerIds: ['provider-a', 'provider-b', 'provider-c'],
      concurrency: 2,
      runtime: {
        updateProviderOperation: async ({ providerId }) => {
          started.push(providerId);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await releases.get(providerId)?.promise;
          inFlight -= 1;
          return {
            editablePath: '',
            modelCount: 1,
            updateStateSummary: {
              updatedAt: '2026-07-03T00:00:00.000Z',
              lastUpdateStatus: 'ok',
              warnings: 0,
              errors: 0,
              conflicts: 0,
            },
            metadataMatchSummary: { exact: 0, normalized: 0, unmatched: 0 },
          } satisfies UpdateProviderOperationResult;
        },
      },
    });

    await waitUntil(() => started.length === 2);
    expect(started).toEqual(['provider-a', 'provider-b']);
    expect(maxInFlight).toBe(2);

    releases.get('provider-a')?.resolve();
    await waitUntil(() => started.length === 3);
    expect(started).toEqual(['provider-a', 'provider-b', 'provider-c']);
    expect(maxInFlight).toBe(2);

    releases.get('provider-b')?.resolve();
    releases.get('provider-c')?.resolve();
    await updates;
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('updated provider-a'));
  });

  it('skips and aborts a provider update after the configured timeout', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let capturedSignal: AbortSignal | undefined;

    await updateConfiguredProviders('unused-state-dir', {
      providerIds: ['provider-a'],
      timeoutMs: 1,
      runtime: {
        updateProviderOperation: async ({ signal }) => {
          capturedSignal = signal;
          return new Promise(() => undefined);
        },
      },
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Provider update timed out after 1ms: provider-a'),
    );
  });

  it('records provider update health for successful and failed serve refreshes', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dates = [
      '2026-07-03T00:00:00.000Z',
      '2026-07-03T00:00:01.000Z',
      '2026-07-03T00:00:02.000Z',
      '2026-07-03T00:00:03.000Z',
    ];
    let dateIndex = 0;
    const tracker = createServeUpdateTracker(() => new Date(dates[dateIndex++]!));

    const providerResults = new Map<string, () => Promise<UpdateProviderOperationResult>>([
      [
        'provider-a',
        async () => ({
          editablePath: '',
          modelCount: 1,
          updateStateSummary: {
            updatedAt: '2026-07-03T00:00:00.000Z',
            lastUpdateStatus: 'ok',
            warnings: 0,
            errors: 0,
            conflicts: 0,
          },
          metadataMatchSummary: { exact: 0, normalized: 0, unmatched: 0 },
        }),
      ],
      [
        'provider-b',
        async () => {
          throw new Error('Provider config is invalid.');
        },
      ],
    ]);

    await updateConfiguredProviders('unused-state-dir', {
      providerIds: ['provider-a', 'provider-b'],
      updateTracker: tracker,
      runtime: {
        updateProviderOperation: async ({ providerId }) => providerResults.get(providerId)!(),
      },
    });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('updated provider-a'));
    expect(tracker.health()).toMatchObject({
      status: 'degraded',
      lastRunStartedAt: '2026-07-03T00:00:00.000Z',
      lastSuccessAt: '2026-07-03T00:00:01.000Z',
      lastFailureAt: '2026-07-03T00:00:02.000Z',
      lastRunFinishedAt: '2026-07-03T00:00:03.000Z',
      failedProviderIds: ['provider-b'],
    });
  });

  it('labels non-network update failures separately from network failures', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const updateProviderOperation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider config is invalid.'))
      .mockRejectedValueOnce(
        new KraFetchError('network', 'Fetch models failed.', {
          url: 'https://api.example.com/v1/models',
        }),
      );

    await updateConfiguredProviders('unused-state-dir', {
      providerIds: ['config-error', 'network-error'],
      runtime: { updateProviderOperation },
    });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[kra:update] warn'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[kra:network] warn'));
  });

  it('rejects invalid serve update scheduler options', async () => {
    await expect(
      updateConfiguredProviders('unused-state-dir', { providerIds: [], concurrency: 0 }),
    ).rejects.toThrow('Serve update concurrency must be a positive integer.');
    await expect(
      updateConfiguredProviders('unused-state-dir', { providerIds: [], timeoutMs: 0 }),
    ).rejects.toThrow('Serve update timeout must be a positive number of milliseconds.');
  });
});
