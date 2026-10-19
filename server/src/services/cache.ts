/**
 * In-memory, per-user, per-resource read-side working set.
 *
 * Phase 1 shipped this as a 45-second cache whose only job was to keep a single
 * teacher's rapid interactions from each costing a Sheets read. Step 6a widens
 * it into a working set: a teacher's data stays resident for as long as they are
 * working and is evicted when they stop, which decouples read volume from
 * interaction count. See config/cache.ts for the reasoning and the numbers.
 *
 * The mechanism is two clocks per entry, and the split is the point:
 *
 * - **idle** (`idleExpiresAt`) extends on every read. It answers "is this
 *   teacher still working?" and is what makes the set a working set rather than
 *   a cache with a long TTL.
 * - **age** (`staleAt`) is fixed when the value is loaded and is *never*
 *   extended. It answers "how stale might this be?" and is the only bound on
 *   serving an out-of-band edit's stale predecessor until Drive push
 *   invalidation exists (Step 6d).
 *
 * An entry is live only while both clocks say so, so a continuously-read entry
 * still reloads on the age bound rather than persisting forever.
 *
 * PII boundary: RAM only, never persisted, never logged. The Sheet remains the
 * sole durable copy. This is a quantitative widening of a surface the app
 * already had — more data, held longer, more teachers resident at once — taken
 * as a deliberate decision, not a side effect.
 *
 * Keys are namespaced by user, so one teacher's data can never be served to
 * another. Writes stay write-through: every mutation reaches the Sheet before
 * its response returns, and then either drops its key or merges into it, so
 * in-app edits are visible immediately regardless of the clocks above.
 *
 * Single-process by design. The multi-instance question (sticky sessions vs a
 * shared cache) is a Step 6a decision confirmed in 6b; keeping this per-instance
 * RAM is what keeps the PII surface per-instance.
 */

import {
  ESTIMATED_BYTES_MIN,
  ESTIMATED_BYTES_PER_ROW,
  IDLE_EVICT_MS,
  MAX_AGE_MS,
  MAX_CACHE_BYTES,
} from '../config/cache.js';

interface Entry {
  value: unknown;
  /** Fixed at load. Never extended — the staleness bound. */
  staleAt: number;
  /** Extended on every read — the idle bound. */
  idleExpiresAt: number;
  /** Estimated heap cost, fixed at insert and summed into {@link residentBytes}. */
  bytes: number;
}

/**
 * Running total of {@link Entry.bytes}, maintained rather than recomputed: the
 * capacity check runs on every insert, and walking the whole store to add up
 * sizes would make inserts quadratic in the number of resident teachers.
 */
let residentBytes = 0;

/**
 * How deep {@link countRows} looks for the arrays inside a cached value. Three
 * covers every shape in use, the deepest being the groupings `Map` → one
 * `Grouping` → its `groups` array.
 */
const MAX_SHAPE_DEPTH = 3;

/**
 * The number of rows a cached value holds, found by walking its containers.
 *
 * The walk **stops at an array and returns its length** rather than recursing
 * into the elements. That is what keeps this O(number of containers) instead of
 * O(number of rows): sizing a teacher's attendance must not itself be
 * proportional to their attendance.
 *
 * It exists because `Array.isArray` alone was not enough and failed silently
 * when it was not. Step 6k changed the attendance cache entry from a flat array
 * to `{ records, classDays }` so it could carry the class-day markers, and an
 * array test on an object returns false: the single largest thing this process
 * holds, about 98% of a teacher's footprint, was charged the 1 KB floor. A real
 * teacher-year was measured at 345x its accounted size, which meant
 * `MAX_CACHE_BYTES` was not bounding the one consumer it was introduced to
 * bound, and capacity eviction could not fire for it.
 *
 * Nothing failed. That is the point, and it is why cache.test.ts now asserts the
 * shapes each resource actually caches rather than only the generic behaviour.
 */
function countRows(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Set) return value.size;
  if (depth >= MAX_SHAPE_DEPTH) return 0;
  if (value instanceof Map) {
    let total = 0;
    for (const entry of value.values()) total += countRows(entry, depth + 1);
    // A Map whose values hold no arrays still costs one row per entry, which is
    // nearer the truth than zero.
    return Math.max(total, value.size);
  }
  let total = 0;
  for (const entry of Object.values(value)) total += countRows(entry, depth + 1);
  return total;
}

/**
 * Rows times a measured per-row constant, rather than measuring the value. See
 * ESTIMATED_BYTES_PER_ROW for why exact sizing is the wrong trade here.
 */
function estimateBytes(value: unknown): number {
  return Math.max(countRows(value) * ESTIMATED_BYTES_PER_ROW, ESTIMATED_BYTES_MIN);
}

/**
 * Insertion order is used as LRU order: a read deletes and re-inserts its key,
 * moving it to the end, so the oldest key is always the least recently used one
 * and capacity eviction is a walk from the front.
 */
const store = new Map<string, Entry>();

/**
 * Loaders in progress, keyed the same as `store`. An entry lives here only while
 * its loader is running; it is removed the moment the loader settles (resolve or
 * reject), so a failed read never poisons the key into a permanent pending state.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Keys explicitly invalidated *while a load for them was still running*.
 *
 * Removing the key from `inFlight` does not undo anything: the loader's `.then`
 * closure is already attached and will call `setCached` when it resolves. So an
 * invalidation that lands mid-flight is overwritten a moment later by the very
 * value it was trying to discard — the read started before the change and
 * carries the state from before it.
 *
 * That is a staleness bug wherever it happens (a write invalidating a key a
 * concurrent read is loading), and on the account-deletion path it is worse than
 * stale: it puts a deleted teacher's data back for a full age window, with no
 * account left to explain why it is there.
 *
 * Bounded by the number of concurrently in-flight loads rather than by the
 * number of keys ever seen, because the entry is cleared when its flight
 * settles.
 */
const invalidatedInFlight = new Set<string>();

/** Marks a running load so its result is discarded rather than cached. */
function markInFlightStale(key: string): void {
  if (inFlight.has(key)) invalidatedInFlight.add(key);
}

export type EvictionReason = 'idle' | 'stale' | 'capacity' | 'explicit';

/**
 * Counters for deciding, in Step 6d, whether the age bound can safely be raised.
 * The question that matters there is how much of the eviction is `stale` — that
 * is the share of reloads the working set is *not* absorbing, and the share push
 * invalidation would convert into cache hits. Counts only; no keys, no user
 * identifiers, nothing derived from student data.
 */
const stats = {
  hits: 0,
  misses: 0,
  coalesced: 0,
  evicted: { idle: 0, stale: 0, capacity: 0, explicit: 0 } as Record<EvictionReason, number>,
};

export function cacheKey(userKey: string, resource: string): string {
  return `${userKey}::${resource}`;
}

function drop(key: string, reason: EvictionReason): void {
  const entry = store.get(key);
  if (!entry) return;
  residentBytes -= entry.bytes;
  store.delete(key);
  stats.evicted[reason] += 1;
}

/**
 * Whichever clock has run out, or null if the entry is live. Distinguished so
 * the eviction counters can tell "the teacher stopped working" from "we held
 * this as long as we are willing to" — the second is the number 6d acts on.
 */
function expiredBy(entry: Entry, now: number): EvictionReason | null {
  if (now >= entry.staleAt) return 'stale';
  if (now >= entry.idleExpiresAt) return 'idle';
  return null;
}

/**
 * Evicts least-recently-used entries until the working set is within budget.
 * Called after each insert, so the store never exceeds the cap rather than
 * being trimmed back to it later.
 *
 * A single entry larger than the whole budget is kept rather than immediately
 * evicted: the store empties, the loop finds nothing left to drop, and it
 * stops. Serving one oversized teacher is better than a load that evicts
 * itself and re-reads on every request.
 */
function enforceCapacity(): void {
  while (residentBytes > MAX_CACHE_BYTES && store.size > 1) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    drop(oldest.value, 'capacity');
  }
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    stats.misses += 1;
    return undefined;
  }
  const now = Date.now();
  const expired = expiredBy(entry, now);
  if (expired) {
    drop(key, expired);
    stats.misses += 1;
    return undefined;
  }
  // A read is what keeps a teacher resident: extend the idle clock, and move the
  // key to the end of the LRU order. The age clock is deliberately untouched.
  entry.idleExpiresAt = now + IDLE_EVICT_MS;
  store.delete(key);
  store.set(key, entry);
  stats.hits += 1;
  return entry.value as T;
}

/**
 * Inserts or replaces a value, starting both clocks fresh.
 *
 * `maxAgeMs` overrides the staleness bound for callers with a different
 * tolerance; it does not affect idle eviction, which is about the teacher rather
 * than about the data.
 */
export function setCached(key: string, value: unknown, maxAgeMs: number = MAX_AGE_MS): void {
  const now = Date.now();
  // Delete first so a replacement lands at the end of the LRU order rather than
  // keeping the original insertion position.
  // drop() rather than delete(), so a replacement's bytes leave the running
  // total before the new value's are added.
  const existing = store.get(key);
  if (existing) {
    residentBytes -= existing.bytes;
    store.delete(key);
  }
  const bytes = estimateBytes(value);
  store.set(key, {
    value,
    staleAt: now + maxAgeMs,
    idleExpiresAt: now + IDLE_EVICT_MS,
    bytes,
  });
  residentBytes += bytes;
  enforceCapacity();
}

/**
 * Returns the cached value for `key`, or loads it exactly once. Concurrent
 * callers that miss while a load is in flight share that single load rather than
 * each issuing their own Sheets read. The loaded value is cached before the
 * promise resolves, so callers arriving just after settle read it from `store`.
 *
 * The in-flight promise is cleared on both success and failure: a rejected load
 * leaves nothing cached and nothing pending, so the next caller retries cleanly.
 */
export async function getOrLoad<T>(
  key: string,
  loader: () => Promise<T>,
  maxAgeMs: number = MAX_AGE_MS,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) {
    stats.coalesced += 1;
    return pending as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      // Not cached if the key was invalidated while this load was running: the
      // value predates the change that invalidated it, so storing it would put
      // the stale state back. The caller still gets it — they asked before the
      // change too, and failing their request would be worse than answering it.
      if (!invalidatedInFlight.has(key)) setCached(key, value, maxAgeMs);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
      invalidatedInFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Coalesces concurrent calls for `key` onto one execution **without caching the
 * result**. For work whose product is written elsewhere — the roster warm-up,
 * which seeds three separate entries rather than producing a value of its own.
 * Caching the return as well would hold a second copy of everything for no
 * reader.
 *
 * The in-flight entry is cleared on settle either way, so a failure leaves
 * nothing pending and the next caller retries cleanly.
 */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) {
    stats.coalesced += 1;
    return pending as Promise<T>;
  }
  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Merges a mutation's result into a warm entry instead of dropping it, so an
 * active editing loop (repeated note edits, at-risk toggles, attendance saves) keeps
 * serving from the working set rather than running cold after every write.
 *
 * Only applies when the key is already warm: a cold key is left untouched, so
 * the next read derives fresh from Sheets. Safe because every mutation writes
 * through to the Sheet first (the Sheet stays authoritative) and re-reads there
 * for row numbers; this only updates the read-side derived view.
 *
 * **The age clock is preserved, not reset**, which is the one substantive change
 * from the Phase 1 version and is a deliberate correction. Resetting it would
 * let a teacher who edits every few minutes hold a value indefinitely past the
 * staleness bound, because each merge would push the deadline out — the exact
 * unbounded-staleness case the bound exists to prevent. A merge proves the
 * edited field is current; it proves nothing about the rest of the tab, which
 * has not been re-read since the original load.
 */
export function updateCached<T>(key: string, updater: (current: T) => T): void {
  const entry = store.get(key);
  if (!entry) return;
  const now = Date.now();
  const expired = expiredBy(entry, now);
  if (expired) {
    drop(key, expired);
    return;
  }
  entry.value = updater(entry.value as T);
  entry.idleExpiresAt = now + IDLE_EVICT_MS;
  store.delete(key);
  store.set(key, entry);
}

export function invalidate(key: string): void {
  drop(key, 'explicit');
  markInFlightStale(key);
}

/** Removes every entry whose key begins with the prefix (e.g. all of a user's resources). */
export function invalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) drop(key, 'explicit');
  }
  // Separately from the store walk above: a key can be in flight without being
  // in the store yet, which is exactly the case that needs marking.
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(prefix)) invalidatedInFlight.add(key);
  }
}

/**
 * Evicts everything held for one user, for account deletion.
 *
 * Deletion revokes the token, destroys the sessions and drops the row, after
 * which nothing can serve this data — but it stays resident until the clocks
 * run out, which is up to the age bound. The privacy policy does not describe a
 * deletion that finishes later, so this closes the gap rather than waiting.
 *
 * It clears `inFlight` as well as `store`, which `invalidatePrefix` alone does
 * not. A read that began just before the delete would otherwise settle
 * afterwards and re-populate the very keys that were just dropped, putting the
 * data back for a full age window with no account left to explain it.
 */
export function dropAllForUser(userKey: string): void {
  invalidatePrefix(`${userKey}::`);
}

/**
 * Drops entries whose clocks have run out. Purely a memory measure: an expired
 * entry is never served regardless, since every read checks. Without it, a
 * teacher who stops working leaves their data resident until something happens
 * to read the key again, which for a departed user is never.
 */
export function sweepCache(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of [...store.entries()]) {
    const expired = expiredBy(entry, now);
    if (expired) {
      drop(key, expired);
      removed += 1;
    }
  }
  return removed;
}

export interface CacheStats {
  residentEntries: number;
  /** Distinct users with anything resident, derived from the key namespace. */
  residentUsers: number;
  /** Estimated heap held, and the budget it is measured against. */
  residentBytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  /** Reads that joined an in-flight load instead of issuing their own. */
  coalesced: number;
  evicted: Record<EvictionReason, number>;
  /** Hit rate over hits + misses, or null before any read. */
  hitRate: number | null;
}

/**
 * A snapshot for the dev metrics endpoint and, in 6d, for real monitoring. The
 * figure to watch is `evicted.stale` against `hits`: it is the share of reloads
 * the working set is not absorbing, and therefore the size of the prize for
 * Drive push invalidation.
 */
export function snapshotCacheStats(): CacheStats {
  const users = new Set<string>();
  for (const key of store.keys()) users.add(key.slice(0, key.indexOf('::')));
  const reads = stats.hits + stats.misses;
  return {
    residentEntries: store.size,
    residentUsers: users.size,
    residentBytes,
    maxBytes: MAX_CACHE_BYTES,
    hits: stats.hits,
    misses: stats.misses,
    coalesced: stats.coalesced,
    evicted: { ...stats.evicted },
    hitRate: reads === 0 ? null : stats.hits / reads,
  };
}

/** Test hook: wipe the working set, any in-flight loads, and the counters. */
export function clearCache(): void {
  store.clear();
  residentBytes = 0;
  inFlight.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.coalesced = 0;
  stats.evicted = { idle: 0, stale: 0, capacity: 0, explicit: 0 };
}
