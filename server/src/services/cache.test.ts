import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cacheKey,
  getCached,
  setCached,
  getOrLoad,
  updateCached,
  invalidate,
  invalidatePrefix,
  dropAllForUser,
  sweepCache,
  snapshotCacheStats,
  clearCache,
} from './cache.js';
import {
  ESTIMATED_BYTES_MIN,
  ESTIMATED_BYTES_PER_ROW,
  IDLE_EVICT_MS,
  MAX_AGE_MS,
  MAX_CACHE_BYTES,
} from '../config/cache.js';

const KEY = cacheKey('user-1', 'thing');

/**
 * Advances the clock in sub-idle steps, reading KEY at each one, so the entry
 * stays continuously "in use". Tests of the age bound need this: idle is the
 * shorter clock, so simply advancing would expire the entry for idleness and
 * prove nothing about age.
 */
function advanceWhileReading(totalMs: number, step = IDLE_EVICT_MS - 30_000): void {
  let elapsed = 0;
  while (elapsed < totalMs) {
    const next = Math.min(step, totalMs - elapsed);
    vi.advanceTimersByTime(next);
    elapsed += next;
    getCached(KEY);
  }
}

describe('getOrLoad (single-flight)', () => {
  beforeEach(() => clearCache());

  it('returns the cached value without invoking the loader', async () => {
    setCached(KEY, 'cached');
    let calls = 0;
    const value = await getOrLoad(KEY, async () => {
      calls++;
      return 'loaded';
    });
    expect(value).toBe('cached');
    expect(calls).toBe(0);
  });

  it('coalesces concurrent misses onto a single loader call', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => {
      release = r;
    });
    const loader = async () => {
      calls++;
      return gate;
    };

    const a = getOrLoad(KEY, loader);
    const b = getOrLoad(KEY, loader);
    const c = getOrLoad(KEY, loader);
    release('shared');

    expect(await Promise.all([a, b, c])).toEqual(['shared', 'shared', 'shared']);
    expect(calls).toBe(1);
    // Value is cached for later callers, still without a second load.
    expect(await getOrLoad(KEY, loader)).toBe('shared');
    expect(calls).toBe(1);
  });

  it('caches the loaded value before resolving', async () => {
    await getOrLoad(KEY, async () => 42);
    expect(getCached<number>(KEY)).toBe(42);
  });

  it('does not poison the key on failure — the next call retries and caches', async () => {
    let calls = 0;
    await expect(
      getOrLoad(KEY, async () => {
        calls++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Nothing cached, nothing pending.
    expect(getCached(KEY)).toBeUndefined();

    const value = await getOrLoad(KEY, async () => {
      calls++;
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(calls).toBe(2);
    expect(getCached(KEY)).toBe('ok');
  });

  it('a rejected in-flight load rejects all coalesced callers, then recovers', async () => {
    let calls = 0;
    let fail!: (e: unknown) => void;
    const gate = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const loader = async () => {
      calls++;
      return gate;
    };
    const a = getOrLoad(KEY, loader);
    const b = getOrLoad(KEY, loader);
    fail(new Error('nope'));

    await expect(a).rejects.toThrow('nope');
    await expect(b).rejects.toThrow('nope');
    expect(calls).toBe(1);

    // The failure cleared the in-flight entry, so a fresh call loads again.
    expect(await getOrLoad(KEY, async () => 'recovered')).toBe('recovered');
  });
});

describe('updateCached (merge)', () => {
  beforeEach(() => clearCache());

  it('applies the updater when the key is warm', () => {
    setCached(KEY, [1, 2, 3]);
    updateCached<number[]>(KEY, (list) => [...list, 4]);
    expect(getCached<number[]>(KEY)).toEqual([1, 2, 3, 4]);
  });

  it('is a no-op when the key is cold (leaves it cold to re-derive fresh)', () => {
    let called = false;
    updateCached<number[]>(KEY, (list) => {
      called = true;
      return [...list, 1];
    });
    expect(called).toBe(false);
    expect(getCached(KEY)).toBeUndefined();
  });
});

/**
 * The working set (Step 6a). What separates it from the Phase 1 cache is the two
 * clocks: idle extends on use, age never does. These assert that split, because
 * getting either half wrong is silent — an idle clock that does not extend is
 * just the old cache, and an age clock that does extend is unbounded staleness.
 */
describe('working set clocks', () => {
  /**
   * The first version of config/cache.ts had a 15-minute idle window under a
   * 5-minute age bound, which makes the idle clock unreachable: the age clock
   * always fires first, so nothing can ever be evicted for idleness and half the
   * design is dead code. It is invisible except under a clock advanced past
   * both, so it is asserted directly rather than left to the behaviour tests
   * that caught it.
   */
  it('has an idle window shorter than the age bound, or idle eviction is dead code', () => {
    expect(IDLE_EVICT_MS).toBeLessThan(MAX_AGE_MS);
  });

  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a continuously-read entry resident past the idle window', () => {
    setCached(KEY, 'v');
    // Read just before each idle deadline. Under the Phase 1 cache this entry
    // would have been gone after the first advance.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(IDLE_EVICT_MS - 30_000);
      expect(getCached(KEY)).toBe('v');
    }
  });

  it('evicts an entry nobody has read for the idle window', () => {
    setCached(KEY, 'v');
    vi.advanceTimersByTime(IDLE_EVICT_MS);
    expect(getCached(KEY)).toBeUndefined();
    expect(snapshotCacheStats().evicted.idle).toBe(1);
  });

  // The bound that matters while Drive push invalidation does not exist. A
  // teacher reading constantly must still reload on the age clock, or an
  // out-of-band edit to their spreadsheet would never surface.
  it('expires on the age bound however often it is read', () => {
    setCached(KEY, 'v');
    const step = 30_000;
    for (let elapsed = step; elapsed < MAX_AGE_MS; elapsed += step) {
      vi.advanceTimersByTime(step);
      expect(getCached(KEY)).toBe('v');
    }
    vi.advanceTimersByTime(step);
    expect(getCached(KEY)).toBeUndefined();
    expect(snapshotCacheStats().evicted.stale).toBe(1);
  });

  // The one substantive behaviour change from Phase 1, and the reason it
  // changed: a merge used to reset the TTL, which under a 5-minute bound would
  // let a teacher editing every few minutes hold a value forever.
  it('a merge does not extend the age bound', () => {
    setCached(KEY, [1]);
    // Kept touched throughout, so idle is never what expires it and the age
    // clock is the only thing under test.
    advanceWhileReading(MAX_AGE_MS - 30_000);
    updateCached<number[]>(KEY, (list) => [...list, 2]);
    expect(getCached<number[]>(KEY)).toEqual([1, 2]);

    vi.advanceTimersByTime(60_000);
    expect(getCached(KEY)).toBeUndefined();
  });

  it('a merge does extend the idle window, since editing is working', () => {
    setCached(KEY, [1]);
    vi.advanceTimersByTime(IDLE_EVICT_MS - 30_000);
    updateCached<number[]>(KEY, (list) => [...list, 2]);
    vi.advanceTimersByTime(IDLE_EVICT_MS - 30_000);
    expect(getCached<number[]>(KEY)).toEqual([1, 2]);
  });

  it('a reload starts the age clock again', () => {
    setCached(KEY, 'old');
    advanceWhileReading(MAX_AGE_MS);
    expect(getCached(KEY)).toBeUndefined();

    setCached(KEY, 'new');
    advanceWhileReading(MAX_AGE_MS - 30_000);
    expect(getCached(KEY)).toBe('new');
  });

  it('sweeping drops expired entries without touching live ones', () => {
    setCached(KEY, 'idle-soon');
    vi.advanceTimersByTime(IDLE_EVICT_MS - 30_000);
    const fresh = cacheKey('user-2', 'thing');
    setCached(fresh, 'fresh');
    vi.advanceTimersByTime(60_000);

    expect(sweepCache()).toBe(1);
    expect(snapshotCacheStats().residentEntries).toBe(1);
    expect(getCached(fresh)).toBe('fresh');
  });
});

describe('working set capacity', () => {
  beforeEach(() => clearCache());

  // Entries big enough that a handful fill the budget, so the test exercises
  // the real constant rather than a lowered one. Rows are plain numbers, so the
  // arrays are cheap to allocate however the estimator prices them.
  const ROWS = 100_000;
  const bytesPerEntry = ROWS * ESTIMATED_BYTES_PER_ROW;
  const capacity = Math.floor(MAX_CACHE_BYTES / bytesPerEntry);
  const big = () => new Array<number>(ROWS).fill(0);

  it('holds entries up to the byte budget', () => {
    for (let i = 0; i < capacity; i++) setCached(cacheKey(`user-${i}`, 'thing'), big());
    const stats = snapshotCacheStats();
    expect(stats.residentEntries).toBe(capacity);
    expect(stats.residentBytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
    expect(stats.evicted.capacity).toBe(0);
  });

  it('evicts least-recently-used first when the budget is exceeded', () => {
    for (let i = 0; i < capacity; i++) setCached(cacheKey(`user-${i}`, 'thing'), big());

    // Touch the oldest so it is no longer the least recently used, then overflow:
    // the *second* oldest should go, not the one just read.
    expect(getCached(cacheKey('user-0', 'thing'))).toBeDefined();
    setCached(cacheKey('overflow', 'thing'), big());

    expect(getCached(cacheKey('user-0', 'thing'))).toBeDefined();
    expect(getCached(cacheKey('user-1', 'thing'))).toBeUndefined();
    expect(snapshotCacheStats().evicted.capacity).toBe(1);
    expect(snapshotCacheStats().residentBytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
  });

  it('prices entries by row count, so one large entry displaces many small ones', () => {
    for (let i = 0; i < 50; i++) setCached(cacheKey(`small-${i}`, 'thing'), [1, 2, 3]);
    const smallBytes = snapshotCacheStats().residentBytes;
    setCached(cacheKey('large', 'thing'), big());
    expect(snapshotCacheStats().residentBytes - smallBytes).toBe(bytesPerEntry);
  });

  it('releases the old size when a key is replaced rather than double counting', () => {
    const key = cacheKey('user-1', 'thing');
    setCached(key, big());
    const afterBig = snapshotCacheStats().residentBytes;
    setCached(key, [1]);
    const afterSmall = snapshotCacheStats().residentBytes;
    expect(afterSmall).toBeLessThan(afterBig);
    expect(snapshotCacheStats().residentEntries).toBe(1);
  });

  it('keeps a single entry that exceeds the whole budget rather than evicting it', () => {
    // Better to serve one oversized teacher than to have every request evict
    // its own load and re-read from Sheets.
    const rows = Math.ceil((MAX_CACHE_BYTES * 2) / ESTIMATED_BYTES_PER_ROW);
    const key = cacheKey('whale', 'attendance');
    setCached(key, new Array<number>(rows).fill(0));
    expect(getCached(key)).toBeDefined();
    expect(snapshotCacheStats().residentEntries).toBe(1);
  });

  it('returns bytes to the budget when an entry is invalidated', () => {
    setCached(cacheKey('user-1', 'thing'), big());
    invalidate(cacheKey('user-1', 'thing'));
    expect(snapshotCacheStats().residentBytes).toBe(0);
  });
});

describe('working set isolation and stats', () => {
  beforeEach(() => clearCache());

  it('namespaces by user, so one teacher never reads another', () => {
    setCached(cacheKey('user-1', 'students'), ['a']);
    setCached(cacheKey('user-2', 'students'), ['b']);
    expect(getCached(cacheKey('user-1', 'students'))).toEqual(['a']);
    expect(getCached(cacheKey('user-2', 'students'))).toEqual(['b']);
    expect(snapshotCacheStats().residentUsers).toBe(2);
  });

  it('drops a whole user with invalidatePrefix, leaving others resident', () => {
    setCached(cacheKey('user-1', 'students'), ['a']);
    setCached(cacheKey('user-1', 'attendance'), ['a']);
    setCached(cacheKey('user-2', 'students'), ['b']);

    invalidatePrefix('user-1::');
    expect(getCached(cacheKey('user-1', 'students'))).toBeUndefined();
    expect(getCached(cacheKey('user-1', 'attendance'))).toBeUndefined();
    expect(getCached(cacheKey('user-2', 'students'))).toEqual(['b']);
  });

  it('counts hits, misses and explicit invalidations for the 6d decision', async () => {
    await getOrLoad(KEY, async () => 'v');
    getCached(KEY);
    getCached(KEY);
    getCached(cacheKey('user-9', 'absent'));
    invalidate(KEY);

    const stats = snapshotCacheStats();
    expect(stats.hits).toBe(2);
    // The initial getOrLoad miss, plus the absent key.
    expect(stats.misses).toBe(2);
    expect(stats.evicted.explicit).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('reports no hit rate before anything has been read', () => {
    expect(snapshotCacheStats().hitRate).toBeNull();
  });
});

/**
 * Account deletion (Step 6f) revokes the token, destroys the sessions and drops
 * the row. Until this existed, it left the teacher's student data resident in
 * the working set until the clocks ran out. Nothing could serve it, so this is
 * about not holding it rather than about access — but the privacy policy does
 * not describe a deletion that finishes later.
 */
describe('dropAllForUser', () => {
  beforeEach(() => clearCache());

  it('drops every resource held for that user', () => {
    setCached(cacheKey('gone', 'students'), [1, 2]);
    setCached(cacheKey('gone', 'attendance'), [3]);
    setCached(cacheKey('gone', 'attendance'), [4]);

    dropAllForUser('gone');

    expect(getCached(cacheKey('gone', 'students'))).toBeUndefined();
    expect(getCached(cacheKey('gone', 'attendance'))).toBeUndefined();
    expect(getCached(cacheKey('gone', 'attendance'))).toBeUndefined();
  });

  it('leaves every other teacher untouched', () => {
    setCached(cacheKey('gone', 'students'), [1]);
    setCached(cacheKey('staying', 'students'), [2]);

    dropAllForUser('gone');

    expect(getCached(cacheKey('staying', 'students'))).toEqual([2]);
  });

  /**
   * The reason this does not just call invalidatePrefix. A read that started
   * before the delete settles after it, and getOrLoad writes the result into the
   * store on the way out — putting the data back for a full age window, on an
   * account that no longer exists.
   */
  it('does not let a read already in flight repopulate the user after deletion', async () => {
    let release: (v: number[]) => void = () => {};
    const slow = new Promise<number[]>((resolve) => {
      release = resolve;
    });

    const pending = getOrLoad(cacheKey('gone', 'students'), () => slow);
    dropAllForUser('gone');
    release([1, 2, 3]);
    await pending;

    expect(getCached(cacheKey('gone', 'students'))).toBeUndefined();
  });

  it('is a no-op for a user holding nothing', () => {
    expect(() => dropAllForUser('never-seen')).not.toThrow();
  });
});

/**
 * Byte accounting against the shapes each resource actually caches.
 *
 * The generic "an array is sized by its length" behaviour was already covered,
 * and it was not enough: Step 6k changed the attendance entry from a flat array
 * to `{ records, classDays }`, `Array.isArray` returned false, and the largest
 * value this process holds started being charged the 1 KB floor. Nothing failed,
 * because nothing asserted the real shape.
 *
 * So these are deliberately written as the shapes rather than as the rule. A
 * future change to what a resource caches has to come past them.
 */
describe('working set byte accounting, per cached shape', () => {
  beforeEach(() => clearCache());

  const bytesOf = (value: unknown): number => {
    clearCache();
    setCached('u::probe', value);
    return snapshotCacheStats().residentBytes;
  };

  const rows = (n: number): Array<{ id: string }> =>
    Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

  it('sizes a flat array by its length (students, enrollments, templates)', () => {
    expect(bytesOf(rows(1000))).toBe(1000 * ESTIMATED_BYTES_PER_ROW);
  });

  /**
   * The 6k regression, as the shape that caused it. `records` dominates, and
   * both arrays have to be counted or the marker rows are free.
   */
  it('sizes the attendance snapshot, which is an object of arrays, not an array', () => {
    const snapshot = { records: rows(1890), classDays: rows(900) };
    const measured = bytesOf(snapshot);
    // The regression charged this the 1 KB floor. Both arrays counted, or the
    // marker rows are free.
    expect(measured).toBe((1890 + 900) * ESTIMATED_BYTES_PER_ROW);
    // And it must agree with the flat array of the same total length, since the
    // wrapping object changed the shape and not the cost.
    expect(measured).toBe(bytesOf(rows(1890 + 900)));
  });

  it('sizes the groupings Map by what its entries hold, not by the floor', () => {
    const groupings = new Map<string, unknown>();
    for (let i = 0; i < 40; i++) {
      groupings.set(`course-${i}`, { id: `g${i}`, groups: rows(8), savedAt: null });
    }
    expect(bytesOf(groupings)).toBe(40 * 8 * ESTIMATED_BYTES_PER_ROW);
  });

  it('charges a Map whose entries hold no rows at least one row each', () => {
    const m = new Map<string, unknown>([['a', { x: 1 }], ['b', { x: 2 }]]);
    expect(bytesOf(m)).toBeGreaterThanOrEqual(ESTIMATED_BYTES_MIN);
  });

  it('still floors a small scalar, such as the cached daily send count', () => {
    expect(bytesOf(7)).toBe(ESTIMATED_BYTES_MIN);
  });

  /**
   * The walk stops at an array rather than recursing into it. Without that,
   * sizing a teacher's attendance would itself be proportional to their
   * attendance, on every insert.
   */
  it('does not recurse into array elements, so sizing stays cheap', () => {
    const nested = rows(500).map((r) => ({ ...r, children: rows(100) }));
    // 500 elements, counted as 500 rows rather than 500 * 100.
    expect(bytesOf(nested)).toBe(500 * ESTIMATED_BYTES_PER_ROW);
  });

  it('is bounded in depth rather than following an arbitrarily nested value', () => {
    let deep: unknown = rows(50);
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(() => bytesOf(deep)).not.toThrow();
  });

  it('accounts a value the capacity bound can actually act on', () => {
    // The bound exists to evict; an entry charged the floor never triggers it.
    const snapshot = { records: rows(5000), classDays: rows(1000) };
    expect(bytesOf(snapshot)).toBeGreaterThan(ESTIMATED_BYTES_MIN * 1000);
  });
});
