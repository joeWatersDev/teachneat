/**
 * Read-side working set tuning (Phase 2 Step 6a).
 *
 * The constraint being solved is Google's shared ceiling of Sheets reads per
 * minute per Cloud project — 600/min, raised from the default 300 by a granted
 * quota increase — drawn from by every teacher at once. Average load is not the
 * risk; correlated peaks are — every teacher taking attendance at the top of the
 * same period. Holding a teacher's data in RAM for the length of their
 * working session, instead of dropping it every 45 seconds, decouples read volume
 * from interaction count and takes steady-state reads to roughly zero.
 *
 * Two clocks per entry, and the difference between them is the whole design.
 */

import { env } from './env.js';

/**
 * How long an untouched entry survives. Extended on every read, so a teacher
 * working continuously keeps their data resident and a teacher who has closed
 * the laptop stops costing us memory. This is the "working set" half.
 *
 * **It must stay below `MAX_AGE_MS` below, or it is dead machinery** — the age
 * clock would always fire first and no entry could ever reach the idle
 * deadline. That inversion was the first version of this file, and it is only
 * visible in a test that advances the clock past both.
 *
 * Short on purpose, and not only for memory. Student data in RAM is the app's
 * one transient PII surface, and the length of time it persists after a teacher
 * stops working is a privacy property, not just a cost: two minutes of silence
 * is a real pause, and the price of getting it wrong is a single Sheets read
 * when they come back.
 *
 * Note the asymmetry with the age bound: **Step 6d raises `MAX_AGE_MS`, not
 * this.** Once push invalidation makes a long age bound safe, this clock becomes
 * the dominant one and the structure finally works as designed — resident while
 * you work, gone when you stop.
 */
export const IDLE_EVICT_MS = 2 * 60_000;

/**
 * The hard ceiling on how stale a value may be, measured from when it was
 * loaded. **Never extended, no matter how much the entry is read.**
 *
 * This is the conservative number, and it is conservative for a specific missing
 * piece: Drive `files.watch` push invalidation, which is what would let the
 * working set hold a long or indefinite TTL safely, cannot be built until there
 * is a publicly reachable HTTPS endpoint on a verified domain (Step 6d). Until
 * it exists, nothing tells us when a teacher edits their spreadsheet directly,
 * and this bound is the only thing limiting how long we would serve a stale
 * answer.
 *
 * Note the exposure is narrower than it looks: every write *through the app*
 * invalidates or merges its own key, so in-app edits are always immediately
 * visible. This window only covers out-of-band edits made in Google Sheets
 * itself.
 *
 * **Raising this is the last task of Step 6d**, once push invalidation is proven
 * in production. Do not raise it before then.
 */
export const MAX_AGE_MS = 5 * 60_000;

/**
 * Ceiling on the working set, in bytes, protecting a single instance from
 * running out of heap as concurrent users climb. Eviction is least-recently-
 * used, which for this workload means evicting whoever stopped working longest
 * ago — the same population idle eviction is aimed at, just reached sooner
 * under memory pressure.
 *
 * **This was an entry count until Step 6d measured it, and the count was both
 * the wrong unit and far too permissive.** At the time one teacher cost about
 * 8.0 MB of heap, of which the single `attendance` entry was 7.85 MB, so one
 * attendance entry cost as much as 180 student entries and any bound counting
 * both as "1" was measuring the wrong thing. The old ceiling of 2,000 entries
 * allowed about 285 concurrent teachers, which needs roughly 2.3 GB of heap on
 * a 1 GiB instance — the process would have died long before the guard fired.
 *
 * **Step 8 re-measured it against the current schema and the figure fell by
 * 18.6x, to 0.43 MB per teacher**, of which `attendance` is 0.29 MB. Step 6k
 * (attendance as exceptions plus class-day markers) is most of that, the
 * per-read string interner and dropping `createdAt`/`updatedAt` from
 * `AttendanceRecord` the rest. The same unfavourable profile now implies roughly
 * 1,180 concurrent working teachers per 1 GiB instance rather than 64, which is
 * what settles `instance_count: 1` at launch.
 *
 * The budget below is deliberately well under the instance: Node on a 1 GiB
 * container settles near 512 MB of usable old space, and the request path, the
 * pg pool and Express need room that is not this. Raising the instance size is
 * then a config change (`CACHE_MAX_MB`) rather than a code change.
 *
 * Re-measure with `scripts/measure-working-set.mjs` if the shapes change. Note
 * that it can no longer measure a single teacher: at 0.43 MB the delta is inside
 * the noise of a `global.gc()` pair, so it averages a salted batch, and the
 * salting is what stops V8's cross-parse string internalisation from
 * understating the total.
 */
export const MAX_CACHE_BYTES = env.cacheMaxMb * 1024 * 1024;

/**
 * Cost estimate for one row of a cached array, used instead of measuring each
 * value.
 *
 * Step 8 measured the eight cached resources at 106–887 bytes per row, with a
 * weighted mean of 141. The spread is wide but the mean is dominated by
 * attendance, which is 87% of the rows the cache counts and the cheapest per row
 * at 106, because its strings are pooled by the loader's interner and shared
 * across the entry.
 *
 * **Set deliberately above that mean rather than at it.** A flat estimate is a
 * fail-safe bound, not an accounting of what is resident, and the direction of
 * the error matters: too high evicts a little early, too low lets the heap
 * exceed a budget that exists to stop the process dying. 200 keeps roughly a 40%
 * margin over the measured mean and stays above every resource that is bounded
 * by the roster rather than by the year, which is what a teacher with a heavy
 * roster and little recorded attendance looks like.
 *
 * It was 400 until Step 8, calibrated against the v4 dense attendance row that
 * no longer exists. That was 2.8x conservative rather than 1.4x, which cost
 * nothing at launch scale but made `MAX_CACHE_BYTES` bind at about a third of
 * true capacity.
 *
 * The alternative, `JSON.stringify(value).length`, is exact and self-defeating:
 * sizing the attendance entry that way allocates a multi-megabyte string on
 * every cold load, adding the GC pressure the bound exists to avoid.
 */
export const ESTIMATED_BYTES_PER_ROW = 200;

/** Floor for a non-array value, which is small but never free. */
export const ESTIMATED_BYTES_MIN = 1_024;

/** How often expired entries are swept out rather than waiting to be read again. */
export const SWEEP_INTERVAL_MS = 60_000;
