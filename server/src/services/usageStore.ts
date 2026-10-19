import { getPool } from '../db/pool.js';
import { logger } from '../config/logger.js';
import { emailPeriodOf } from './accountStore.js';

/**
 * Monthly per-tool usage counters (Phase 2 Step 6j).
 *
 * The counters answer two operator questions the account row cannot: which
 * tools teachers actually adopt, and whether use holds up across a school year.
 * They answer nothing finer than that by construction — the stored value is a
 * count per calendar month, so there is no timestamp to order and no sequence
 * to reconstruct. That ceiling is the design rather than a first version: what
 * makes this describable to a school board is that it is arithmetic about a
 * product, not a record of a teacher's day.
 *
 * Three of the four tools are counted on a completed action, on a request the
 * app was already making. The picker is the exception and is counted
 * differently on purpose; see PICKER_COUNTS_PAGE_OPENS below.
 */

/**
 * The tools a counter can be kept for. A closed union rather than free text,
 * because `tool` is part of the primary key and a typo would silently start a
 * second series that reads like a fifth tool.
 */
export type UsageTool = 'attendance' | 'grouping' | 'email' | 'picker';

export const USAGE_TOOLS: readonly UsageTool[] = ['attendance', 'grouping', 'email', 'picker'];

/**
 * The picker's number does not mean what the other three mean, and every reader
 * of it has to be told so.
 *
 * Attendance, grouping and email are counted when the teacher completes an
 * action, because each of those actions is already a server request. The Name
 * Picker is entirely client-side by an explicit Step 8 decision — it has no
 * endpoints at all — so the only thing the server can observe is the roster
 * read its page makes on open. That is a page open, not a round: a teacher who
 * opens the picker and closes it counts the same as one who runs twenty draws.
 *
 * The alternative was an endpoint whose only purpose is to report usage, which
 * would have been the one call site in the app existing solely to be
 * instrumentation. Counting the read the page already makes was preferred; the
 * cost is this asymmetry, and the metrics view labels it rather than hiding it.
 */
export const PICKER_COUNTS_PAGE_OPENS = true;

/**
 * How many months of counters are kept. Stated in the privacy policy's
 * retention section, so changing it is a change to that document.
 *
 * Twenty-four rather than twelve because the comparison worth having in a
 * product with an annual cycle is this September against last September, and a
 * twelve-month window never holds both.
 */
export const USAGE_RETENTION_MONTHS = 24;

export interface UsagePeriodTotals {
  period: string;
  /** Total increments in the month, per tool. */
  counts: Record<UsageTool, number>;
  /** Distinct accounts with any use of the tool that month. Zero on a per-account read. */
  accounts: Record<UsageTool, number>;
}

export interface UsageStore {
  /**
   * Adds one to an account's count for a tool in the current month.
   *
   * Never throws to its caller: see the note in the implementation. A dropped
   * count is a slightly wrong number on an internal page, and it must not be
   * able to fail the teacher's request.
   */
  record(accountId: string, tool: UsageTool, when?: Date): Promise<void>;
  /** Totals per tool per month across all accounts, newest month first. */
  totalsByPeriod(months: number): Promise<UsagePeriodTotals[]>;
  /** One account's counts, newest month first. Used on the support ticket view. */
  forAccount(accountId: string, months: number): Promise<UsagePeriodTotals[]>;
  /** Deletes counters older than the retention window. Returns rows removed. */
  prune(now?: Date): Promise<number>;
}

interface CounterRow {
  period: string;
  tool: string;
  total: string;
  accounts: string;
}

function emptyCounts(): Record<UsageTool, number> {
  return { attendance: 0, grouping: 0, email: 0, picker: 0 };
}

function isUsageTool(value: string): value is UsageTool {
  return (USAGE_TOOLS as readonly string[]).includes(value);
}

/** The period key exactly `months` months before `from`, as `YYYY-MM`. */
export function periodBefore(months: number, from: Date = new Date()): string {
  return emailPeriodOf(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1)));
}

/**
 * The earliest period key in an `months`-long window that **ends with the month
 * `from` falls in**, for use with an inclusive `period >= …` filter.
 *
 * The `- 1` is the whole point and is easy to get wrong: `periodBefore(12)` with
 * `period >= floor` spans thirteen buckets, not twelve, because both endpoints
 * are included. That was harmless on the read side — a chart one month too wide
 * — but the same arithmetic decides `prune`, where it meant counters survived
 * twenty-five months against a privacy policy that promises twenty-four. Both
 * call sites go through here so they cannot drift apart again.
 */
export function windowStart(months: number, from: Date = new Date()): string {
  return periodBefore(months - 1, from);
}

/**
 * Collapses the one-row-per-(period, tool) result into one entry per period.
 * An unrecognised tool name is skipped rather than thrown on: the only way one
 * can exist is a counter written by an older build, and a renamed tool should
 * not break the page that reports the others.
 */
function foldRows(rows: CounterRow[]): UsagePeriodTotals[] {
  const byPeriod = new Map<string, UsagePeriodTotals>();
  for (const row of rows) {
    if (!isUsageTool(row.tool)) continue;
    let entry = byPeriod.get(row.period);
    if (!entry) {
      entry = { period: row.period, counts: emptyCounts(), accounts: emptyCounts() };
      byPeriod.set(row.period, entry);
    }
    entry.counts[row.tool] = Number(row.total);
    entry.accounts[row.tool] = Number(row.accounts);
  }
  return [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period));
}

export function createPgUsageStore(): UsageStore {
  const pool = getPool();

  return {
    async record(accountId, tool, when = new Date()) {
      // Swallowed rather than propagated, and this is the one place in the
      // server where that is the right call. Every caller is a teacher's
      // request that has already succeeded — attendance is saved, the email is
      // sent — and failing it afterwards to report that a counter did not move
      // would trade the teacher's work for an operator's statistic. Logged at
      // warn so the failure is visible without being fatal.
      try {
        await pool.query(
          `INSERT INTO usage_counters (account_id, tool, period, count)
                VALUES ($1, $2, $3, 1)
           ON CONFLICT (account_id, tool, period)
             DO UPDATE SET count = usage_counters.count + 1, updated_at = now()`,
          [accountId, tool, emailPeriodOf(when)],
        );
      } catch (error) {
        logger.warn({ tool, err: error }, 'usage counter write failed');
      }
    },

    async totalsByPeriod(months) {
      const { rows } = await pool.query<CounterRow>(
        `SELECT period, tool, SUM(count) AS total, COUNT(*) AS accounts
           FROM usage_counters
          WHERE period >= $1
       GROUP BY period, tool
       ORDER BY period DESC`,
        [windowStart(months)],
      );
      return foldRows(rows);
    },

    async forAccount(accountId, months) {
      const { rows } = await pool.query<CounterRow>(
        `SELECT period, tool, count AS total, 0 AS accounts
           FROM usage_counters
          WHERE account_id = $1 AND period >= $2
       ORDER BY period DESC`,
        [accountId, windowStart(months)],
      );
      return foldRows(rows);
    },

    async prune(now = new Date()) {
      const { rowCount } = await pool.query('DELETE FROM usage_counters WHERE period < $1', [
        windowStart(USAGE_RETENTION_MONTHS, now),
      ]);
      return rowCount ?? 0;
    },
  };
}

/** In-memory double for tests, with the same write-never-throws contract. */
export function createMemoryUsageStore(): UsageStore {
  const counts = new Map<string, number>();
  // Keyed by JSON rather than a joined string. A separator character has to be
  // one that cannot occur in an id, and picking one is a bet about ids that a
  // test double should not be making; encoding and decoding removes the bet.
  const key = (accountId: string, tool: string, period: string) =>
    JSON.stringify([accountId, tool, period]);
  const parse = (k: string) => JSON.parse(k) as [string, string, string];

  return {
    async record(accountId, tool, when = new Date()) {
      const k = key(accountId, tool, emailPeriodOf(when));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
    async totalsByPeriod(months) {
      const floor = windowStart(months);
      const seen = new Map<string, { total: number; accounts: number }>();
      for (const [k, count] of counts) {
        const [, tool, period] = parse(k);
        if (period < floor) continue;
        const bucket = JSON.stringify([period, tool]);
        const agg = seen.get(bucket) ?? { total: 0, accounts: 0 };
        agg.total += count;
        agg.accounts += 1;
        seen.set(bucket, agg);
      }
      return foldRows(
        [...seen].map(([k, agg]) => {
          const [period, tool] = JSON.parse(k) as [string, string];
          return { period, tool, total: String(agg.total), accounts: String(agg.accounts) };
        }),
      );
    },
    async forAccount(accountId, months) {
      const floor = windowStart(months);
      const rows: CounterRow[] = [];
      for (const [k, count] of counts) {
        const [id, tool, period] = parse(k);
        if (id !== accountId || period < floor) continue;
        rows.push({ period, tool, total: String(count), accounts: '0' });
      }
      return foldRows(rows);
    },
    async prune(now = new Date()) {
      const cutoff = windowStart(USAGE_RETENTION_MONTHS, now);
      let removed = 0;
      for (const k of [...counts.keys()]) {
        if (parse(k)[2] < cutoff) {
          counts.delete(k);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
