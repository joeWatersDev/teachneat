/**
 * Lightweight in-process instrumentation for outbound Google API calls.
 *
 * Every call the app makes to Google (Sheets / Drive / Gmail) is recorded with
 * its service, method, and result (ok / rate_limited / error). Counts are kept
 * in a rolling 60-second window so we can read a per-minute total — the gauge
 * that tells us how close aggregate load is to the shared quota ceilings
 * (600 reads/min and 300 writes/min per project after the granted increase;
 * 60/min per user for each).
 *
 * This is the Phase 1 form: a single-process counter with a dev-only read
 * endpoint. Phase 2 pipes the same signal into real monitoring (dashboards +
 * alerts). It holds no student PII — only call counts keyed by API method.
 */

import { isQuotaError } from '../utils/googleErrors.js';

export type ApiService = 'sheets' | 'drive' | 'gmail';
export type ApiResult = 'ok' | 'rate_limited' | 'error';

const WINDOW_SECONDS = 60;

interface Bucket {
  /** UNIX second this bucket holds counts for; -1 when unused/stale. */
  second: number;
  counts: Map<string, number>;
}

// Ring of one bucket per second. Indexing by `second % WINDOW_SECONDS` and
// checking the stored second keeps memory O(WINDOW_SECONDS) even under a runaway
// call loop, and makes stale buckets self-expire without a sweep.
const ring: Bucket[] = Array.from({ length: WINDOW_SECONDS }, () => ({
  second: -1,
  counts: new Map<string, number>(),
}));

function nowSecond(): number {
  return Math.floor(Date.now() / 1000);
}

function key(service: ApiService, method: string, result: ApiResult): string {
  return `${service}|${method}|${result}`;
}

/** Records one outbound Google API call. */
export function recordApiCall(service: ApiService, method: string, result: ApiResult): void {
  const second = nowSecond();
  const bucket = ring[second % WINDOW_SECONDS];
  if (bucket.second !== second) {
    bucket.second = second;
    bucket.counts.clear();
  }
  const k = key(service, method, result);
  bucket.counts.set(k, (bucket.counts.get(k) ?? 0) + 1);
}

/**
 * Backoff between retries of a rate-limited call, and by its length the number
 * of retries. Deliberately short: the per-minute buckets these calls exhaust
 * refill continuously, so a brief wait is usually enough, and a request that is
 * going to fail should still fail while the teacher is watching.
 */
const QUOTA_RETRY_DELAYS_MS = [250, 750];

/** Google's own advice when it sets one, in ms, capped so it cannot hang a request. */
function retryAfterMs(err: unknown): number | null {
  const header = (err as { response?: { headers?: Record<string, string> } })?.response?.headers?.[
    'retry-after'
  ];
  const seconds = Number.parseInt(String(header ?? ''), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds, 3) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a Google API call so its result is recorded, retrying it if Google
 * rate-limits it. On final failure the error is re-thrown unchanged, so callers
 * keep their existing error handling.
 *
 * **Retrying belongs here, at the individual call, and not at the request.** A
 * route like a class archive is a dozen calls in sequence; retrying the whole
 * request because one of them was rate-limited re-spends every call that already
 * succeeded, which turns a transient limit into a hard failure and pushes the
 * account further past the ceiling on each attempt. That is not hypothetical —
 * it is what a rate-limited unarchive did before this existed.
 *
 * Every attempt is recorded, including the ones that were retried: they are all
 * real calls against the quota, and the metrics exist to show load rather than
 * outcomes.
 */
export async function trackGoogleCall<T>(
  service: ApiService,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const out = await fn();
      recordApiCall(service, method, 'ok');
      return out;
    } catch (err) {
      const rateLimited = isQuotaError(err);
      recordApiCall(service, method, rateLimited ? 'rate_limited' : 'error');
      if (!rateLimited || attempt >= QUOTA_RETRY_DELAYS_MS.length) throw err;
      await sleep(retryAfterMs(err) ?? QUOTA_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export interface MethodStat {
  service: ApiService;
  method: string;
  ok: number;
  rate_limited: number;
  error: number;
  total: number;
}

export interface MetricsSnapshot {
  windowSeconds: number;
  generatedAt: string;
  totalCalls: number;
  byResult: Record<ApiResult, number>;
  byMethod: MethodStat[];
}

/** Aggregates the last `WINDOW_SECONDS` of calls into a readable snapshot. */
export function snapshotMetrics(): MetricsSnapshot {
  const second = nowSecond();
  const byMethodKey = new Map<string, MethodStat>();
  const byResult: Record<ApiResult, number> = { ok: 0, rate_limited: 0, error: 0 };
  let totalCalls = 0;

  for (const bucket of ring) {
    if (bucket.second < 0 || second - bucket.second >= WINDOW_SECONDS) continue;
    for (const [k, count] of bucket.counts) {
      const [service, method, result] = k.split('|') as [ApiService, string, ApiResult];
      totalCalls += count;
      byResult[result] += count;
      const mk = `${service}|${method}`;
      const stat =
        byMethodKey.get(mk) ??
        { service, method, ok: 0, rate_limited: 0, error: 0, total: 0 };
      stat[result] += count;
      stat.total += count;
      byMethodKey.set(mk, stat);
    }
  }

  const byMethod = [...byMethodKey.values()].sort((a, b) => b.total - a.total);
  return {
    windowSeconds: WINDOW_SECONDS,
    generatedAt: new Date().toISOString(),
    totalCalls,
    byResult,
    byMethod,
  };
}

/** Test hook: clear all recorded counts. */
export function resetMetrics(): void {
  for (const bucket of ring) {
    bucket.second = -1;
    bucket.counts.clear();
  }
}
