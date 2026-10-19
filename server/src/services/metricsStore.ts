import { getPool } from '../db/pool.js';
import { emailPeriodOf } from './accountStore.js';
import { periodBefore } from './usageStore.js';

/**
 * Cross-account aggregate reads for the operator metrics view (Phase 2 Step 6j).
 *
 * Separate from `accountStore`, which is deliberately about one account at a
 * time: nothing here can return an account, and every method returns counts.
 * That is a boundary worth keeping, because it is what lets the privacy policy
 * say the metrics view reports totals rather than browsing accounts.
 *
 * There is no plan mix here on purpose. Resolving `free` / `trial` / `paid`
 * lives in `resolvePlan`, which reads several columns and a pause flag; a SQL
 * re-implementation would be a second copy of that rule, free to drift from the
 * one the app actually enforces. Subscriber counts are Stripe's to report, and
 * a number here that disagreed with the Stripe dashboard would be worse than no
 * number.
 */

/**
 * The activation funnel, in the order a new account meets it.
 *
 * `signedUp` is the denominator; every later stage is a count of accounts whose
 * milestone column is set. Stages are not nested — an account can send an email
 * without ever generating a grouping — so these do not sum to anything and the
 * view renders them as counts against the denominator rather than as a cascade.
 */
export interface ActivationFunnel {
  signedUp: number;
  onboarded: number;
  firstStudent: number;
  firstAttendance: number;
  firstGrouping: number;
  firstPicker: number;
  firstEmail: number;
  /** Accounts that met a premium gate at least once, on any plan they held then. */
  premiumAttempt: number;
}

export interface SignupsByMonth {
  period: string;
  count: number;
}

export interface MetricsStore {
  funnel(): Promise<ActivationFunnel>;
  /** New accounts per UTC calendar month, newest first. */
  signups(months: number): Promise<SignupsByMonth[]>;
}

export function createPgMetricsStore(): MetricsStore {
  const pool = getPool();

  return {
    async funnel() {
      // One pass over users. COUNT(column) counts non-null values, which is
      // exactly "accounts that reached this milestone" given every milestone is
      // null until first reached and never cleared.
      const { rows } = await pool.query<Record<string, string>>(
        `SELECT COUNT(*)                        AS signed_up,
                COUNT(onboarded_at)             AS onboarded,
                COUNT(first_student_at)         AS first_student,
                COUNT(first_attendance_at)      AS first_attendance,
                COUNT(first_grouping_at)        AS first_grouping,
                COUNT(first_picker_at)          AS first_picker,
                COUNT(first_email_at)           AS first_email,
                COUNT(first_premium_attempt_at) AS premium_attempt
           FROM users`,
      );
      const r = rows[0] ?? {};
      return {
        signedUp: Number(r.signed_up ?? 0),
        onboarded: Number(r.onboarded ?? 0),
        firstStudent: Number(r.first_student ?? 0),
        firstAttendance: Number(r.first_attendance ?? 0),
        firstGrouping: Number(r.first_grouping ?? 0),
        firstPicker: Number(r.first_picker ?? 0),
        firstEmail: Number(r.first_email ?? 0),
        premiumAttempt: Number(r.premium_attempt ?? 0),
      };
    },

    async signups(months) {
      const { rows } = await pool.query<{ period: string; count: string }>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
                COUNT(*) AS count
           FROM users
          WHERE created_at >= $1::timestamptz
       GROUP BY period
       ORDER BY period DESC`,
        [`${periodBefore(months)}-01T00:00:00Z`],
      );
      return rows.map((row) => ({ period: row.period, count: Number(row.count) }));
    },
  };
}

/** In-memory double for tests. */
export function createMemoryMetricsStore(
  accounts: { createdAt: string; milestones: Partial<Record<keyof ActivationFunnel, boolean>> }[] = [],
): MetricsStore {
  return {
    async funnel() {
      const tally = (key: keyof ActivationFunnel) =>
        accounts.filter((a) => a.milestones[key]).length;
      return {
        signedUp: accounts.length,
        onboarded: tally('onboarded'),
        firstStudent: tally('firstStudent'),
        firstAttendance: tally('firstAttendance'),
        firstGrouping: tally('firstGrouping'),
        firstPicker: tally('firstPicker'),
        firstEmail: tally('firstEmail'),
        premiumAttempt: tally('premiumAttempt'),
      };
    },
    async signups(months) {
      const floor = periodBefore(months);
      const byPeriod = new Map<string, number>();
      for (const account of accounts) {
        const period = emailPeriodOf(new Date(account.createdAt));
        if (period < floor) continue;
        byPeriod.set(period, (byPeriod.get(period) ?? 0) + 1);
      }
      return [...byPeriod]
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => b.period.localeCompare(a.period));
    },
  };
}
