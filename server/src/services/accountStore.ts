import pg from 'pg';
import { ulid } from 'ulid';
import { getPool } from '../db/pool.js';
import { env } from '../config/env.js';
import { TRIAL_DAYS, type HighAbsenceThreshold } from '../config/plan.js';
import { CURRENT_TERMS_VERSION } from '../config/legal.js';
import type { BillingInterval } from '../config/billing.js';
import type { TokenCipher } from './tokenCipher.js';
import { getTokenCipher } from './tokenKey.js';

/**
 * A teacher's account. Holds identity, the teacher's own contact fields, where
 * their spreadsheet lives, subscription status, and the refresh token (decrypted
 * in memory here; encrypted at rest). No student PII — that lives in the Sheet.
 */
export type PlanOverride = 'free' | 'trial' | 'paid';

/** The account's own high-absence threshold, when the teacher has set one. */
export type HighAbsenceSetting = HighAbsenceThreshold;

export interface Account {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string;
  spreadsheetId: string | null;
  refreshToken: string;
  subscriptionStatus: string;
  /** Set directly (dev toggle now, support comps later); wins over everything below. */
  planOverride: PlanOverride | null;
  trialEndsAt: string | null;
  /** Stored even while not applied, so a lapsed account keeps it for re-upgrade. */
  highAbsence: HighAbsenceSetting | null;
  /** Calendar month (`YYYY-MM`, UTC) the send count below belongs to. */
  monthlyEmailPeriod: string | null;
  monthlyEmailCount: number;
  /** The UTC day `dailyEmailCount` belongs to, as YYYY-MM-DD. */
  dailyEmailDate: string | null;
  dailyEmailCount: number;
  /** When the change that last wrote the subscription fields happened, per Stripe. */
  subscriptionEventAt: string | null;
  /** When reconciliation last compared this account against Stripe. */
  subscriptionCheckedAt: string | null;
  /** Stripe's customer handle. Null until the account's first checkout. */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /**
   * Stripe's period end for the subscription, mirrored as-is. **Informational
   * only — no code reads it, and entitlement does not depend on it.**
   *
   * It is deliberately not the mechanism by which access survives cancellation.
   * That is delegated entirely to Stripe: a cancel-at-period-end subscription
   * stays `active` until the period elapses, so `resolvePlan` keeps returning
   * `paid` without this app tracking a date or running a scheduled job.
   *
   * Only meaningful while the status is active. On an immediate cancellation
   * Stripe reports the terminated period's original end, so a `canceled` row can
   * carry a date well in the future — do not present it as "access until".
   */
  currentPeriodEnd: string | null;
  /** Cancelled but still inside the period already paid for. */
  cancelAtPeriodEnd: boolean;
  /**
   * Collection is paused: the subscription exists and is not being billed
   * (Step 6i). **Entitlement reads this**, because Stripe holds a paused
   * subscription at `active` and `subscriptionStatus` alone would keep granting
   * Premium to an account that has stopped paying — see `resolvePlan`.
   */
  collectionPaused: boolean;
  /** When billing resumes. Null when not paused, or paused with no end date. */
  pauseResumesAt: string | null;
  /**
   * When the current or most recent pause began. **Ours, not Stripe's**, and
   * the only one of the pause fields the webhook does not write: Stripe clears
   * `pause_collection` when collection resumes, so the once-per-twelve-months
   * rule needs a record that outlives the pause it describes.
   */
  pauseStartedAt: string | null;
  /**
   * When a repeating discount stops applying — the date of the first real
   * charge, which the founding-user reminder is sent seven days ahead of. Not
   * `currentPeriodEnd`: a fully discounted subscription still renews monthly at
   * zero, so that date moves while this one does not.
   */
  promoEndsAt: string | null;
  /**
   * Which of the two prices the subscription is on, or null when there is no
   * subscription or it is on a price this deployment does not recognise.
   *
   * Read by the promo-ending reminder, which names a figure and would otherwise
   * have to guess which one. Null is a real state and not merely an empty row:
   * an account that predates this column keeps it until Stripe next sends an
   * event, and the copy names no figure rather than a wrong one.
   */
  subscriptionInterval: BillingInterval | null;
  /** Null until the teacher finishes the first-run guide. */
  onboardedAt: string | null;
  /**
   * When this account first had a student, or null if it never has (Step 6f).
   *
   * Set by the first roster read that comes back non-empty as well as by a
   * create, so an account that predates the column converges without a
   * migration guessing at it. Write-once: it records activation, not the most
   * recent add.
   */
  firstStudentAt: string | null;
  /** Step 6j activation milestones. Write-once; null until first reached. */
  firstAttendanceAt: string | null;
  firstGroupingAt: string | null;
  firstPickerAt: string | null;
  firstEmailAt: string | null;
  firstPremiumAttemptAt: string | null;
  /**
   * When the teacher accepted the terms and privacy policy, and which version of
   * them. Null / '' for an account that has never accepted, and stale once
   * CURRENT_TERMS_VERSION moves past the recorded value — both of which mean the
   * same thing to the gate: prompt again.
   */
  termsAcceptedAt: string | null;
  termsVersion: string;
  /**
   * When the teacher acknowledged that the student data they store in their own
   * Google account remains their legal responsibility. Recorded separately from
   * the terms above because it is a separate agreement, accepted by reading the
   * sentence rather than by following a link.
   */
  dataResponsibilityAcceptedAt: string | null;
  /** Google's `hd` claim, or '' for a personal account. The teacher's employer, not student data. */
  workspaceDomain: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The billing state a Stripe webhook writes, always as one unit. Kept together
 * deliberately: these fields are only ever consistent with each other if they
 * are written from a single event, never patched field by field.
 */
export interface SubscriptionState {
  subscriptionStatus: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /**
   * Both directions of the pause, always written together with the rest: a
   * resume arrives as `customer.subscription.updated` carrying a cleared
   * `pause_collection`, so `false` here is as meaningful as `true` and the
   * field can never be left behind at its previous value.
   */
  collectionPaused: boolean;
  pauseResumesAt: string | null;
  promoEndsAt: string | null;
  /**
   * Null when the subscription's price is not one of the two configured ids,
   * which the reminder copy treats as "interval unknown" rather than defaulting.
   */
  subscriptionInterval: BillingInterval | null;
}

export interface UpsertAccountInput {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string;
  refreshToken: string;
  /** '' for a personal Google account. Refreshed on every sign-in, like the other identity fields. */
  workspaceDomain: string;
}

/**
 * The Step 6j activation milestones, in the order a new account normally meets
 * them. `premiumAttempt` is a refusal rather than a use: it records that a free
 * account ran into a gate, which is the signal that the split is working (or
 * that it is placed wrong).
 */
export type Milestone =
  | 'attendance'
  | 'grouping'
  | 'picker'
  | 'email'
  | 'premiumAttempt';

/**
 * Milestone to column. The map is why {@link AccountStore.markMilestone} can
 * build its SQL by name safely: every column it can ever write is written here,
 * in this file, and a caller supplies only a union member.
 */
const MILESTONE_COLUMNS: Record<Milestone, string> = {
  attendance: 'first_attendance_at',
  grouping: 'first_grouping_at',
  picker: 'first_picker_at',
  email: 'first_email_at',
  premiumAttempt: 'first_premium_attempt_at',
};

/**
 * The Account field each milestone lands on, for the in-memory store. Narrowed
 * to just these five keys rather than `keyof Account`, so the assignment in
 * markMilestone stays a plain typed write with no cast: every member of the
 * union is a `string | null` field.
 */
type MilestoneField =
  | 'firstAttendanceAt'
  | 'firstGroupingAt'
  | 'firstPickerAt'
  | 'firstEmailAt'
  | 'firstPremiumAttemptAt';

const MILESTONE_FIELDS: Record<Milestone, MilestoneField> = {
  attendance: 'firstAttendanceAt',
  grouping: 'firstGroupingAt',
  picker: 'firstPickerAt',
  email: 'firstEmailAt',
  premiumAttempt: 'firstPremiumAttemptAt',
};

export interface AccountStore {
  getByGoogleSub(googleSub: string): Promise<Account | null>;
  /**
   * The webhook's lookup path: a Stripe event identifies a customer, not a
   * Google account. Returns null for a customer we have no record of, which the
   * caller treats as an event to acknowledge and ignore rather than an error —
   * a webhook endpoint that 500s on unknown input invites endless retries.
   */
  getByStripeCustomerId(customerId: string): Promise<Account | null>;
  /**
   * Records the Stripe customer created for this account at first checkout.
   * Separate from the subscription writer below because it happens once, before
   * any subscription exists.
   */
  setStripeCustomerId(googleSub: string, customerId: string): Promise<void>;
  /**
   * The sole writer of billing state, called only from the webhook handler.
   * Deliberately keyed on the Stripe customer id rather than the google_sub:
   * the caller is reacting to a Stripe event, and requiring it to resolve an
   * account first would invite writing billing state from somewhere else.
   */
  /**
   * Writes Stripe's view of a subscription, unless the row already holds a
   * *newer* one.
   *
   * `occurredAt` is when the change happened according to Stripe, not when we
   * heard about it. Stripe does not guarantee event ordering and retries for
   * about three days, so an older event can arrive after a newer one; applying
   * it unconditionally would, for instance, restore `active` from an `updated`
   * event redelivered after the `deleted` it precedes, and leave the account
   * paid with nothing left to correct it.
   *
   * Returns whether the write was applied, so a caller can tell "Stripe agrees
   * with us" from "this was stale and ignored".
   */
  applySubscriptionState(
    customerId: string,
    state: SubscriptionState,
    occurredAt: Date,
  ): Promise<boolean>;
  /** Accounts with billing, least-recently-verified first, for reconciliation. */
  listForSubscriptionCheck(limit: number): Promise<Array<{ googleSub: string; stripeCustomerId: string }>>;
  /** Records that reconciliation has looked at this account, whatever it found. */
  markSubscriptionChecked(googleSub: string): Promise<void>;
  /**
   * Records that a pause was started, for the once-per-twelve-months rule
   * (Step 6i). Deliberately separate from `applySubscriptionState` and keyed on
   * the google_sub, because this is the one pause field Stripe does not own: it
   * is written by the request the teacher made, and it must not be reset when
   * the webhook later reports the pause ending.
   */
  markPauseStarted(googleSub: string, startedAt: string): Promise<void>;
  /**
   * Inserts a new account or, if one already exists for the google_sub, updates
   * its identity fields and refresh token. The id, spreadsheet_id,
   * subscription_status, and all plan state are preserved on update. A new
   * account starts its trial here; a returning one never has it reset.
   */
  upsert(input: UpsertAccountInput): Promise<Account>;
  updateSpreadsheetId(googleSub: string, spreadsheetId: string): Promise<void>;
  /**
   * Writes plan_override only. It deliberately cannot touch subscription_status
   * or the billing period — those stay Stripe's alone (Step 3b), so app state
   * and billing state can never disagree.
   */
  setPlanOverride(googleSub: string, plan: PlanOverride | null): Promise<void>;
  setHighAbsence(googleSub: string, setting: HighAbsenceSetting): Promise<void>;
  /**
   * Moves the trial's end date. Written for the development-only control that
   * makes the trial-expiry path testable without waiting thirty days for it,
   * and guarded at the route the same doubled way as the plan toggle: nothing
   * in the product moves this date, and `upsert` deliberately sets it once.
   */
  setTrialEndsAt(googleSub: string, endsAt: string | null): Promise<void>;
  /**
   * Records that the first-run guide has been completed. Idempotent and
   * write-once: re-opening the guide from the account menu must not move the
   * timestamp, so a repeat call leaves the original value alone.
   */
  markOnboarded(googleSub: string): Promise<void>;
  /**
   * Records that this account has had a student. Write-once and idempotent, so
   * the roster read that calls it on every visit is a no-op after the first.
   */
  markFirstStudent(googleSub: string): Promise<void>;
  /**
   * Records the first time this account reached one of the Step 6j activation
   * milestones. Write-once and idempotent like the two markers above, so a call
   * site on a hot path is a no-op after the first success.
   *
   * One method over a union rather than five near-identical ones, because the
   * five differ only in which column they touch. The column is looked up from a
   * fixed map keyed by the union, never interpolated from caller input.
   */
  markMilestone(googleSub: string, milestone: Milestone): Promise<void>;
  /**
   * Records acceptance of both agreements at the given terms version.
   *
   * Not write-once, unlike markOnboarded: a version bump means the teacher is
   * genuinely accepting again, and the record has to move to the new version and
   * the new date or it would claim they agreed to the current text at a time
   * when it did not exist. The previous acceptance is overwritten rather than
   * kept — an append-only consent log is a reasonable thing to want, but it is a
   * retention question that belongs with the privacy policy, not a column
   * added ahead of it.
   */
  recordConsent(googleSub: string, termsVersion: string): Promise<void>;
  /**
   * Adds to the current calendar month's send count, resetting it first when the
   * stored period is a previous month. Returns the new total.
   */
  addMonthlyEmailCount(googleSub: string, period: string, delta: number): Promise<number>;
  /**
   * Adds `delta` to the account's count for `day` and returns the new total,
   * resetting first if the stored day is not `day`.
   *
   * The whole point is that it is one statement. Sends claim their allowance by
   * calling this *before* going to Gmail, so two concurrent batches get two
   * different totals back and cannot both believe the cap is clear. A negative
   * delta returns unused claims. See `emailSend.reserveDailySends`.
   */
  addDailyEmailCount(googleSub: string, day: string, delta: number): Promise<number>;
  delete(googleSub: string): Promise<void>;
}

type UserRow = {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  avatar_url: string;
  spreadsheet_id: string | null;
  refresh_token_enc: string;
  subscription_status: string;
  plan_override: string | null;
  trial_ends_at: Date | null;
  high_absence_min_rate: number | null;
  high_absence_min_days: number | null;
  monthly_email_period: string | null;
  monthly_email_count: number;
  daily_email_date: string | null;
  daily_email_count: number;
  subscription_event_at: Date | null;
  subscription_checked_at: Date | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  collection_paused: boolean;
  pause_resumes_at: Date | null;
  pause_started_at: Date | null;
  promo_ends_at: Date | null;
  subscription_interval: string | null;
  onboarded_at: Date | null;
  first_student_at: Date | null;
  first_attendance_at: Date | null;
  first_grouping_at: Date | null;
  first_picker_at: Date | null;
  first_email_at: Date | null;
  first_premium_attempt_at: Date | null;
  workspace_domain: string;
  terms_accepted_at: Date | null;
  terms_version: string;
  data_responsibility_accepted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Anything unrecognised in the column reads as "no override" rather than throwing. */
function toPlanOverride(value: string | null): PlanOverride | null {
  return value === 'free' || value === 'trial' || value === 'paid' ? value : null;
}

/** Same tolerance as {@link toPlanOverride}: an unrecognised value reads as unknown. */
function toBillingInterval(value: string | null): BillingInterval | null {
  return value === 'monthly' || value === 'annual' ? value : null;
}

function rowToAccount(row: UserRow, cipher: TokenCipher): Account {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    spreadsheetId: row.spreadsheet_id,
    refreshToken: cipher.decrypt(row.refresh_token_enc),
    subscriptionStatus: row.subscription_status,
    planOverride: toPlanOverride(row.plan_override),
    trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : null,
    highAbsence:
      row.high_absence_min_rate !== null && row.high_absence_min_days !== null
        ? {
            minAbsenceRate: row.high_absence_min_rate,
            minDaysRecorded: row.high_absence_min_days,
          }
        : null,
    monthlyEmailPeriod: row.monthly_email_period,
    monthlyEmailCount: row.monthly_email_count,
    dailyEmailDate: row.daily_email_date,
    dailyEmailCount: row.daily_email_count,
    subscriptionEventAt: row.subscription_event_at?.toISOString() ?? null,
    subscriptionCheckedAt: row.subscription_checked_at?.toISOString() ?? null,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end ? row.current_period_end.toISOString() : null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    collectionPaused: row.collection_paused,
    pauseResumesAt: row.pause_resumes_at ? row.pause_resumes_at.toISOString() : null,
    pauseStartedAt: row.pause_started_at ? row.pause_started_at.toISOString() : null,
    promoEndsAt: row.promo_ends_at ? row.promo_ends_at.toISOString() : null,
    subscriptionInterval: toBillingInterval(row.subscription_interval),
    onboardedAt: row.onboarded_at ? row.onboarded_at.toISOString() : null,
    firstStudentAt: row.first_student_at ? row.first_student_at.toISOString() : null,
    firstAttendanceAt: row.first_attendance_at?.toISOString() ?? null,
    firstGroupingAt: row.first_grouping_at?.toISOString() ?? null,
    firstPickerAt: row.first_picker_at?.toISOString() ?? null,
    firstEmailAt: row.first_email_at?.toISOString() ?? null,
    firstPremiumAttemptAt: row.first_premium_attempt_at?.toISOString() ?? null,
    workspaceDomain: row.workspace_domain,
    termsAcceptedAt: row.terms_accepted_at ? row.terms_accepted_at.toISOString() : null,
    termsVersion: row.terms_version,
    dataResponsibilityAcceptedAt: row.data_responsibility_accepted_at
      ? row.data_responsibility_accepted_at.toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The UTC calendar month a timestamp falls in, as `YYYY-MM`. */
export function emailPeriodOf(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Postgres-backed multi-user account store. The refresh token is encrypted on
 * write and decrypted on read via the injected cipher.
 */
export function createPgAccountStore(
  pool: pg.Pool = getPool(),
  cipher: TokenCipher = getTokenCipher(),
): AccountStore {
  return {
    async getByGoogleSub(googleSub) {
      const { rows } = await pool.query<UserRow>(
        'SELECT * FROM users WHERE google_sub = $1',
        [googleSub],
      );
      return rows[0] ? rowToAccount(rows[0], cipher) : null;
    },
    async getByStripeCustomerId(customerId) {
      const { rows } = await pool.query<UserRow>(
        'SELECT * FROM users WHERE stripe_customer_id = $1',
        [customerId],
      );
      return rows[0] ? rowToAccount(rows[0], cipher) : null;
    },
    async setStripeCustomerId(googleSub, customerId) {
      await pool.query(
        'UPDATE users SET stripe_customer_id = $2, updated_at = now() WHERE google_sub = $1',
        [googleSub, customerId],
      );
    },
    async applySubscriptionState(customerId, state, occurredAt) {
      // The guard is the WHERE clause, not a read followed by a write: two
      // events arriving at once would both pass a read-then-check and the later
      // writer would win by luck rather than by timestamp.
      //
      // `<=` rather than `<` so an event bearing the same timestamp as the
      // stored one still applies. Stripe timestamps are whole seconds and
      // several changes can share one; refusing them would drop real updates,
      // and within a single second either order is defensible.
      const { rowCount } = await pool.query(
        `UPDATE users
            SET subscription_status    = $2,
                stripe_subscription_id = $3,
                current_period_end     = $4,
                cancel_at_period_end   = $5,
                collection_paused      = $6,
                pause_resumes_at       = $7,
                promo_ends_at          = $8,
                subscription_interval  = $9,
                subscription_event_at  = $10,
                updated_at             = now()
          WHERE stripe_customer_id = $1
            AND (subscription_event_at IS NULL OR subscription_event_at <= $10)`,
        [
          customerId,
          state.subscriptionStatus,
          state.stripeSubscriptionId,
          state.currentPeriodEnd,
          state.cancelAtPeriodEnd,
          state.collectionPaused,
          state.pauseResumesAt,
          state.promoEndsAt,
          state.subscriptionInterval,
          occurredAt,
        ],
      );
      return (rowCount ?? 0) > 0;
    },
    async listForSubscriptionCheck(limit) {
      // NULLS FIRST: an account that has never been verified is the one most
      // worth verifying. The partial index matches this predicate.
      const { rows } = await pool.query<{ google_sub: string; stripe_customer_id: string }>(
        `SELECT google_sub, stripe_customer_id
           FROM users
          WHERE stripe_customer_id IS NOT NULL
          ORDER BY subscription_checked_at ASC NULLS FIRST
          LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({ googleSub: r.google_sub, stripeCustomerId: r.stripe_customer_id }));
    },
    async markSubscriptionChecked(googleSub) {
      // Stamped whatever the check concluded, including "already correct".
      // Otherwise an account Stripe agrees about would be re-checked forever
      // while one that needed fixing moved to the back of the queue.
      await pool.query('UPDATE users SET subscription_checked_at = now() WHERE google_sub = $1', [
        googleSub,
      ]);
    },
    async markPauseStarted(googleSub, startedAt) {
      await pool.query(
        'UPDATE users SET pause_started_at = $2, updated_at = now() WHERE google_sub = $1',
        [googleSub, startedAt],
      );
    },
    async upsert(input) {
      // trial_ends_at is set in the INSERT only: signing in again must never
      // restart a trial that has already run.
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (id, google_sub, email, name, avatar_url, refresh_token_enc, workspace_domain, trial_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)
         ON CONFLICT (google_sub) DO UPDATE SET
           email             = EXCLUDED.email,
           name              = EXCLUDED.name,
           avatar_url        = EXCLUDED.avatar_url,
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           workspace_domain  = EXCLUDED.workspace_domain,
           updated_at        = now()
         RETURNING *`,
        [
          ulid(),
          input.googleSub,
          input.email,
          input.name,
          input.avatarUrl,
          cipher.encrypt(input.refreshToken),
          input.workspaceDomain,
          String(TRIAL_DAYS),
        ],
      );
      return rowToAccount(rows[0], cipher);
    },
    async updateSpreadsheetId(googleSub, spreadsheetId) {
      await pool.query(
        'UPDATE users SET spreadsheet_id = $2, updated_at = now() WHERE google_sub = $1',
        [googleSub, spreadsheetId],
      );
    },
    async setPlanOverride(googleSub, plan) {
      await pool.query(
        'UPDATE users SET plan_override = $2, updated_at = now() WHERE google_sub = $1',
        [googleSub, plan],
      );
    },
    async setHighAbsence(googleSub, setting) {
      await pool.query(
        `UPDATE users
            SET high_absence_min_rate = $2, high_absence_min_days = $3, updated_at = now()
          WHERE google_sub = $1`,
        [googleSub, setting.minAbsenceRate, setting.minDaysRecorded],
      );
    },
    async setTrialEndsAt(googleSub, endsAt) {
      await pool.query(
        'UPDATE users SET trial_ends_at = $2, updated_at = now() WHERE google_sub = $1',
        [googleSub, endsAt],
      );
    },
    async markOnboarded(googleSub) {
      // COALESCE, so re-opening the guide later cannot rewrite when the account
      // was actually onboarded.
      await pool.query(
        `UPDATE users
            SET onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
          WHERE google_sub = $1`,
        [googleSub],
      );
    },
    async markFirstStudent(googleSub) {
      // COALESCE like markOnboarded, and for a stronger reason: this is called
      // from a read path that runs on most page loads, so without it every
      // roster read would rewrite the timestamp and the column would record the
      // teacher's last visit rather than their first student.
      await pool.query(
        `UPDATE users
            SET first_student_at = COALESCE(first_student_at, now()), updated_at = now()
          WHERE google_sub = $1 AND first_student_at IS NULL`,
        [googleSub],
      );
    },
    async markMilestone(googleSub, milestone) {
      // Same write-once shape as markFirstStudent, and for the same reason:
      // these fire from request paths that repeat, so without the IS NULL guard
      // each column would record the teacher's most recent use rather than
      // their first. The guard also keeps the common case off the write path
      // entirely — after the first hit the UPDATE matches no row.
      //
      // The column name comes from MILESTONE_COLUMNS, never from the caller, so
      // interpolating it here cannot carry caller input into the SQL.
      const column = MILESTONE_COLUMNS[milestone];
      await pool.query(
        `UPDATE users
            SET ${column} = now(), updated_at = now()
          WHERE google_sub = $1 AND ${column} IS NULL`,
        [googleSub],
      );
    },
    async recordConsent(googleSub, termsVersion) {
      // No COALESCE here, unlike markOnboarded above: on a version bump the
      // teacher is accepting genuinely new text, and keeping the old timestamp
      // would record them as having agreed to it before it was written.
      await pool.query(
        `UPDATE users
            SET terms_accepted_at = now(),
                terms_version = $2,
                data_responsibility_accepted_at = now(),
                updated_at = now()
          WHERE google_sub = $1`,
        [googleSub, termsVersion],
      );
    },
    async addMonthlyEmailCount(googleSub, period, delta) {
      // The reset is part of the same statement as the increment, so two sends
      // racing across a month boundary cannot both reset and lose a count.
      const { rows } = await pool.query<{ monthly_email_count: number }>(
        `UPDATE users
            SET monthly_email_period = $2,
                monthly_email_count  =
                  CASE WHEN monthly_email_period = $2 THEN monthly_email_count ELSE 0 END + $3,
                updated_at = now()
          WHERE google_sub = $1
          RETURNING monthly_email_count`,
        [googleSub, period, delta],
      );
      return rows[0]?.monthly_email_count ?? 0;
    },
    async addDailyEmailCount(googleSub, day, delta) {
      // Same shape as the monthly counter above, and atomic for a sharper
      // reason: this one is called to *claim* allowance before any message is
      // sent. Two concurrent batches each get their own post-increment total
      // back, so the second cannot read the first's pre-send state and conclude
      // there is room. A read-then-write would be exactly the race this
      // replaces. GREATEST keeps a refund from driving the day negative.
      const { rows } = await pool.query<{ daily_email_count: number }>(
        `UPDATE users
            SET daily_email_date  = $2,
                daily_email_count = GREATEST(
                  0,
                  CASE WHEN daily_email_date = $2 THEN daily_email_count ELSE 0 END + $3
                ),
                updated_at = now()
          WHERE google_sub = $1
          RETURNING daily_email_count`,
        [googleSub, day, delta],
      );
      return rows[0]?.daily_email_count ?? 0;
    },
    async delete(googleSub) {
      await pool.query('DELETE FROM users WHERE google_sub = $1', [googleSub]);
    },
  };
}

/**
 * In-memory account store for tests. Holds the refresh token in plaintext (no
 * cipher); encryption at rest is covered by the tokenCipher tests.
 */
export function createMemoryAccountStore(seed: Account[] = []): AccountStore {
  const bySub = new Map<string, Account>();
  for (const account of seed) bySub.set(account.googleSub, { ...account });
  return {
    async getByGoogleSub(googleSub) {
      const account = bySub.get(googleSub);
      return account ? { ...account } : null;
    },
    async upsert(input) {
      const existing = bySub.get(input.googleSub);
      const now = new Date().toISOString();
      const account: Account = existing
        ? {
            ...existing,
            email: input.email,
            name: input.name,
            avatarUrl: input.avatarUrl,
            refreshToken: input.refreshToken,
            workspaceDomain: input.workspaceDomain,
            updatedAt: now,
          }
        : {
            id: ulid(),
            googleSub: input.googleSub,
            email: input.email,
            name: input.name,
            avatarUrl: input.avatarUrl,
            spreadsheetId: null,
            refreshToken: input.refreshToken,
            subscriptionStatus: 'inactive',
            planOverride: null,
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
            highAbsence: null,
            monthlyEmailPeriod: null,
            monthlyEmailCount: 0,
            dailyEmailDate: null,
            dailyEmailCount: 0,
            subscriptionEventAt: null,
            subscriptionCheckedAt: null,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            collectionPaused: false,
            pauseResumesAt: null,
            pauseStartedAt: null,
            promoEndsAt: null,
            subscriptionInterval: null,
            onboardedAt: null,
            firstStudentAt: null,
            firstAttendanceAt: null,
            firstGroupingAt: null,
            firstPickerAt: null,
            firstEmailAt: null,
            firstPremiumAttemptAt: null,
            workspaceDomain: input.workspaceDomain,
            termsAcceptedAt: null,
            termsVersion: '',
            dataResponsibilityAcceptedAt: null,
            createdAt: now,
            updatedAt: now,
          };
      bySub.set(input.googleSub, account);
      return { ...account };
    },
    async getByStripeCustomerId(customerId) {
      for (const account of bySub.values()) {
        if (account.stripeCustomerId === customerId) return { ...account };
      }
      return null;
    },
    async setStripeCustomerId(googleSub, customerId) {
      const account = bySub.get(googleSub);
      if (account) account.stripeCustomerId = customerId;
    },
    async applySubscriptionState(customerId, state, occurredAt) {
      let applied = false;
      for (const account of bySub.values()) {
        if (account.stripeCustomerId !== customerId) continue;
        // Same staleness guard as the SQL, or the memory store would accept
        // orderings the real one rejects and the tests would prove nothing.
        const seen = account.subscriptionEventAt;
        if (seen !== null && new Date(seen).getTime() > occurredAt.getTime()) continue;
        account.subscriptionStatus = state.subscriptionStatus;
        account.stripeSubscriptionId = state.stripeSubscriptionId;
        account.currentPeriodEnd = state.currentPeriodEnd;
        account.cancelAtPeriodEnd = state.cancelAtPeriodEnd;
        account.collectionPaused = state.collectionPaused;
        account.pauseResumesAt = state.pauseResumesAt;
        account.promoEndsAt = state.promoEndsAt;
        account.subscriptionInterval = state.subscriptionInterval;
        account.subscriptionEventAt = occurredAt.toISOString();
        applied = true;
      }
      return applied;
    },
    async listForSubscriptionCheck(limit) {
      return [...bySub.values()]
        .filter((a) => a.stripeCustomerId !== null)
        .sort((a, b) => {
          const at = a.subscriptionCheckedAt;
          const bt = b.subscriptionCheckedAt;
          if (at === bt) return 0;
          if (at === null) return -1;
          if (bt === null) return 1;
          return Date.parse(at) - Date.parse(bt);
        })
        .slice(0, limit)
        .map((a) => ({ googleSub: a.googleSub, stripeCustomerId: a.stripeCustomerId as string }));
    },
    async markSubscriptionChecked(googleSub) {
      const account = bySub.get(googleSub);
      if (account) account.subscriptionCheckedAt = new Date().toISOString();
    },
    async markPauseStarted(googleSub, startedAt) {
      const account = bySub.get(googleSub);
      if (account) account.pauseStartedAt = startedAt;
    },
    async updateSpreadsheetId(googleSub, spreadsheetId) {
      const account = bySub.get(googleSub);
      if (account) {
        account.spreadsheetId = spreadsheetId;
        account.updatedAt = new Date().toISOString();
      }
    },
    async setPlanOverride(googleSub, plan) {
      const account = bySub.get(googleSub);
      if (account) account.planOverride = plan;
    },
    async setHighAbsence(googleSub, setting) {
      const account = bySub.get(googleSub);
      if (account) account.highAbsence = { ...setting };
    },
    async setTrialEndsAt(googleSub, endsAt) {
      const account = bySub.get(googleSub);
      if (account) account.trialEndsAt = endsAt;
    },
    async markOnboarded(googleSub) {
      const account = bySub.get(googleSub);
      if (account && account.onboardedAt === null) {
        account.onboardedAt = new Date().toISOString();
      }
    },
    async markFirstStudent(googleSub) {
      const account = bySub.get(googleSub);
      if (account && account.firstStudentAt === null) {
        account.firstStudentAt = new Date().toISOString();
      }
    },
    async markMilestone(googleSub, milestone) {
      const account = bySub.get(googleSub);
      if (!account) return;
      const field = MILESTONE_FIELDS[milestone];
      if (account[field] === null) {
        account[field] = new Date().toISOString();
      }
    },
    async recordConsent(googleSub, termsVersion) {
      const account = bySub.get(googleSub);
      if (!account) return;
      const now = new Date().toISOString();
      account.termsAcceptedAt = now;
      account.termsVersion = termsVersion;
      account.dataResponsibilityAcceptedAt = now;
    },
    async addMonthlyEmailCount(googleSub, period, delta) {
      const account = bySub.get(googleSub);
      if (!account) return 0;
      const base = account.monthlyEmailPeriod === period ? account.monthlyEmailCount : 0;
      account.monthlyEmailPeriod = period;
      account.monthlyEmailCount = base + delta;
      return account.monthlyEmailCount;
    },
    async addDailyEmailCount(googleSub, day, delta) {
      const account = bySub.get(googleSub);
      if (!account) return 0;
      const base = account.dailyEmailDate === day ? account.dailyEmailCount : 0;
      account.dailyEmailDate = day;
      // Clamped like the SQL, so a refund cannot drive the day negative.
      account.dailyEmailCount = Math.max(0, base + delta);
      return account.dailyEmailCount;
    },
    async delete(googleSub) {
      bySub.delete(googleSub);
    },
  };
}

/** A fully-populated Account for tests, with only the fields that matter overridden. */
export function testAccount(overrides: Partial<Account> = {}): Account {
  const now = new Date().toISOString();
  return {
    id: 'acct_test',
    googleSub: 'sub-1',
    email: 'teacher@example.com',
    name: 'Test Teacher',
    avatarUrl: '',
    spreadsheetId: 'sheet-1',
    refreshToken: 'refresh-token',
    subscriptionStatus: 'inactive',
    planOverride: null,
    trialEndsAt: null,
    highAbsence: null,
    monthlyEmailPeriod: null,
    monthlyEmailCount: 0,
    dailyEmailDate: null,
    dailyEmailCount: 0,
    subscriptionEventAt: null,
    subscriptionCheckedAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    collectionPaused: false,
    pauseResumesAt: null,
    pauseStartedAt: null,
    promoEndsAt: null,
    subscriptionInterval: null,
    // Onboarded by default: almost every test is about an account already in
    // use, and the first-run path is the one that asks for null explicitly.
    onboardedAt: now,
    // Null by default, unlike onboardedAt above: an account with no students is
    // the state the menu rule turns on, and a fixture that quietly claimed
    // otherwise would make the "Getting started" tests assert nothing.
    firstStudentAt: null,
    firstAttendanceAt: null,
    firstGroupingAt: null,
    firstPickerAt: null,
    firstEmailAt: null,
    firstPremiumAttemptAt: null,
    workspaceDomain: '',
    // Consented by default, for the same reason as onboardedAt above: nearly
    // every test is about an account already in use, and the consent gate's own
    // tests ask for the un-consented state explicitly.
    termsAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    dataResponsibilityAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
