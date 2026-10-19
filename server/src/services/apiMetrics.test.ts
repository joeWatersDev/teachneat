import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  recordApiCall,
  trackGoogleCall,
  snapshotMetrics,
  resetMetrics,
} from './apiMetrics.js';

describe('apiMetrics', () => {
  beforeEach(() => resetMetrics());
  afterEach(() => vi.useRealTimers());

  it('aggregates recorded calls by method and result within the window', () => {
    recordApiCall('sheets', 'values.batchGet', 'ok');
    recordApiCall('sheets', 'values.batchGet', 'ok');
    recordApiCall('sheets', 'values.batchGet', 'rate_limited');
    recordApiCall('sheets', 'values.update', 'ok');
    recordApiCall('gmail', 'messages.send', 'error');

    const snap = snapshotMetrics();
    expect(snap.totalCalls).toBe(5);
    expect(snap.byResult).toEqual({ ok: 3, rate_limited: 1, error: 1 });

    const batchGet = snap.byMethod.find((m) => m.method === 'values.batchGet');
    expect(batchGet).toMatchObject({ service: 'sheets', ok: 2, rate_limited: 1, total: 3 });
    // Methods are sorted by total desc, so batchGet (3) leads.
    expect(snap.byMethod[0].method).toBe('values.batchGet');
  });

  it('trackGoogleCall records ok on success and returns the value', async () => {
    const out = await trackGoogleCall('sheets', 'values.get', async () => 'payload');
    expect(out).toBe('payload');
    const snap = snapshotMetrics();
    expect(snap.byResult.ok).toBe(1);
  });

  it('trackGoogleCall tags a 429 as rate_limited and rethrows unchanged', async () => {
    const quotaErr: any = new Error('Quota exceeded');
    quotaErr.code = 429;
    let attempts = 0;
    await expect(
      trackGoogleCall('sheets', 'values.get', async () => {
        attempts += 1;
        throw quotaErr;
      }),
    ).rejects.toBe(quotaErr);

    // Retried rather than surfaced on the first refusal, and every attempt
    // counted: they all spent quota, which is what these counters are for.
    expect(attempts).toBe(3);
    const snap = snapshotMetrics();
    expect(snap.byResult.rate_limited).toBe(3);
    expect(snap.byResult.error).toBe(0);
  });

  it('trackGoogleCall retries a rate-limited call and returns once it succeeds', async () => {
    const quotaErr: any = new Error('Quota exceeded');
    quotaErr.code = 429;
    let attempts = 0;
    const out = await trackGoogleCall('sheets', 'values.get', async () => {
      attempts += 1;
      if (attempts === 1) throw quotaErr;
      return 'payload';
    });

    expect(out).toBe('payload');
    const snap = snapshotMetrics();
    expect(snap.byResult.ok).toBe(1);
    expect(snap.byResult.rate_limited).toBe(1);
  });

  it('does not retry a failure that is not a rate limit', async () => {
    let attempts = 0;
    await expect(
      trackGoogleCall('sheets', 'values.get', async () => {
        attempts += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
  });

  it('tags a non-quota failure as error', async () => {
    await expect(
      trackGoogleCall('sheets', 'values.get', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(snapshotMetrics().byResult.error).toBe(1);
  });

  it('drops calls older than the 60-second rolling window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'));
    recordApiCall('sheets', 'values.get', 'ok');
    expect(snapshotMetrics().totalCalls).toBe(1);

    // 61 seconds later the earlier call has aged out of the window.
    vi.setSystemTime(new Date('2026-07-13T12:01:01Z'));
    expect(snapshotMetrics().totalCalls).toBe(0);

    recordApiCall('sheets', 'values.get', 'ok');
    expect(snapshotMetrics().totalCalls).toBe(1);
  });
});
