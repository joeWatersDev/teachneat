import pg from 'pg';
import { ulid } from 'ulid';
import { getPool } from '../db/pool.js';
import { logger } from '../config/logger.js';
import { billingEnabled } from '../config/env.js';
import {
  LIFECYCLE_BATCH_SIZE,
  LIFECYCLE_MAX_ATTEMPTS,
  LIFECYCLE_RETRY_DELAY_MS,
  PROMO_REMINDER_LEAD_DAYS,
  TRIAL_ENDING_LEAD_DAYS,
  type LifecycleMessageType,
} from '../config/lifecycleEmail.js';
import { formatMessageDate, renderLifecycleMessage } from './lifecycleTemplates.js';
import { ACTIVE_SUBSCRIPTION_STATUSES } from './plan.js';
import type { Mailer } from './mailer.js';
import type { BillingInterval } from '../config/billing.js';

/**
 * The lifecycle email queue and its dispatch sweep (Phase 2 Step 6h).
 *
 * Three things live here, and the split between them is the point. Queueing is
 * called from the request that causes a message (signup, deletion) and never
 * sends anything. Scanning derives the time-triggered messages from the `users`
 * table — the two trial messages, and from Step 6i the promo and pause
 * reminders — because a trial that ends in five days has no request behind it.
 * Dispatch takes whatever is queued and sends it, and is the only code that
 * touches the provider.
 */

export interface QueuedLifecycleEmail {
  id: string;
  accountId: string;
  messageType: LifecycleMessageType;
  recipientEmail: string;
  recipientName: string;
  contextDate: string | null;
  /**
   * The account's billing interval, read at claim time rather than snapshotted
   * at enqueue. Only the promo reminder uses it, to name the right price.
   *
   * Null for an unknown interval **and** for an account row that is gone: the
   * queue deliberately carries no foreign key so a deletion confirmation can
   * outlive the account it confirms, so the lookup has to tolerate a missing
   * row. Both cases mean the same thing to the copy, which then names no figure.
   */
  subscriptionInterval: BillingInterval | null;
  attempts: number;
}

export interface EnqueueInput {
  /** `users.id`, not the Google subject id — see migration 0010 for why. */
  accountId: string;
  messageType: LifecycleMessageType;
  recipientEmail: string;
  recipientName: string;
  /** The date the message is about, where it has one. */
  contextDate?: string | null;
}

export interface LifecycleEmailStore {
  /**
   * Queues a message. Returns false when this account already has a row of this
   * type, which is the ordinary outcome of a retry rather than an error.
   */
  enqueue(input: EnqueueInput): Promise<boolean>;
  /**
   * Takes up to `limit` rows that are due, marking each as attempted in the same
   * statement so a second sweep running concurrently cannot take them too.
   */
  claimDue(limit: number, now?: Date): Promise<QueuedLifecycleEmail[]>;
  markSent(id: string): Promise<void>;
  /** Records the failure, and abandons the row once it has used up its attempts. */
  markFailed(id: string, error: string): Promise<void>;
  /**
   * Queues every time-triggered message for every account that is now due one:
   * the two trial messages and, from Step 6i, the promo and pause reminders.
   * Returns how many rows it added.
   */
  queueScheduledMessages(now?: Date): Promise<number>;
  /**
   * Forgets a queued or sent message, so the scan can queue it again.
   *
   * The unique constraint is per (account, type) for the life of the account,
   * which is exactly right for the messages that can only happen once and wrong
   * for the pause reminder, which recurs at most once a year. Starting a new
   * pause clears the old row rather than the constraint being relaxed — a
   * duplicate "your trial is ending" remains impossible.
   */
  clearMessage(accountId: string, messageType: LifecycleMessageType): Promise<void>;
  /**
   * Deletes the finished rows (sent or abandoned) of accounts that no longer
   * exist, and returns how many went.
   *
   * Every row carries the teacher's email address and name, and account
   * deletion enqueues the confirmation message *after* nothing else will ever
   * clear the account's rows, so without this they outlive the account
   * indefinitely. The privacy policy says account information is deleted within
   * 30 days of closure; this is what makes that true for this table. Unfinished
   * rows are left alone so the deletion confirmation still gets its retries,
   * which end in abandonment well inside that window.
   */
  pruneOrphaned(): Promise<number>;
}

type QueueRow = {
  id: string;
  account_id: string;
  message_type: string;
  recipient_email: string;
  recipient_name: string;
  context_date: Date | null;
  subscription_interval: string | null;
  attempts: number;
};

function rowToQueued(row: QueueRow): QueuedLifecycleEmail {
  return {
    id: row.id,
    accountId: row.account_id,
    messageType: row.message_type as LifecycleMessageType,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    contextDate: row.context_date ? row.context_date.toISOString() : null,
    subscriptionInterval:
      row.subscription_interval === 'monthly' || row.subscription_interval === 'annual'
        ? row.subscription_interval
        : null,
    attempts: row.attempts,
  };
}

/**
 * How far back the trial-ended scan looks.
 *
 * Without a floor, the first deploy of this step would tell every account that
 * has ever had a trial expire, however long ago, that their trial has just
 * ended. The window makes the scan mean "this happened recently" rather than
 * "this has happened at some point", which is what the message actually claims.
 * It also bounds the damage of a sweep that has not run for a while: a message
 * that missed its moment by more than a week is better dropped than sent late.
 */
const TRIAL_ENDED_LOOKBACK_DAYS = 7;

/**
 * Subscription statuses that mean the teacher is already paying. Both trial
 * scans exclude them: someone who subscribed during their trial should not be
 * warned that it is ending, and should certainly not be told they have been
 * moved to the free plan. Taken from `plan.ts` rather than restated, so the
 * definition of "already paying" cannot fork.
 */
const PAYING_STATUSES = [...ACTIVE_SUBSCRIPTION_STATUSES];

export function createPgLifecycleEmailStore(pool: pg.Pool = getPool()): LifecycleEmailStore {
  return {
    async enqueue(input) {
      // ON CONFLICT DO NOTHING rather than a check-then-insert: the check would
      // be a race, and the unique constraint is already the real guarantee.
      const { rowCount } = await pool.query(
        `INSERT INTO lifecycle_emails
           (id, account_id, message_type, recipient_email, recipient_name, context_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT lifecycle_emails_once DO NOTHING`,
        [
          ulid(),
          input.accountId,
          input.messageType,
          input.recipientEmail,
          input.recipientName,
          input.contextDate ?? null,
        ],
      );
      return rowCount === 1;
    },

    async claimDue(limit, now = new Date()) {
      // FOR UPDATE SKIP LOCKED is what makes two sweeps safe: each takes rows
      // the other has not, rather than both blocking on the same ones and then
      // sending them twice. The attempt counter is incremented on claim rather
      // than on failure, so a send that crashes the process mid-flight still
      // costs an attempt and cannot loop forever.
      const { rows } = await pool.query<QueueRow>(
        `UPDATE lifecycle_emails
            SET attempts = attempts + 1, attempted_at = $2
          WHERE id IN (
            SELECT id FROM lifecycle_emails
             WHERE sent_at IS NULL
               AND abandoned_at IS NULL
               AND (attempted_at IS NULL OR attempted_at < $3)
             ORDER BY queued_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
        RETURNING id, account_id, message_type, recipient_email, recipient_name,
                  context_date, attempts,
                  (SELECT u.subscription_interval FROM users u
                    WHERE u.id = lifecycle_emails.account_id) AS subscription_interval`,
        [limit, now, new Date(now.getTime() - LIFECYCLE_RETRY_DELAY_MS)],
      );
      return rows.map(rowToQueued);
    },

    async markSent(id) {
      await pool.query(
        `UPDATE lifecycle_emails SET sent_at = now(), last_error = '' WHERE id = $1`,
        [id],
      );
    },

    async markFailed(id, error) {
      // The abandonment decision is made in SQL against the row's own counter
      // rather than from the value the caller happens to be holding, so it
      // stays correct if two sweeps ever touch the same row.
      await pool.query(
        `UPDATE lifecycle_emails
            SET last_error = $2,
                abandoned_at = CASE WHEN attempts >= $3 THEN now() ELSE abandoned_at END
          WHERE id = $1`,
        [id, error.slice(0, 500), LIFECYCLE_MAX_ATTEMPTS],
      );
    },

    async clearMessage(accountId, messageType) {
      await pool.query(
        'DELETE FROM lifecycle_emails WHERE account_id = $1 AND message_type = $2',
        [accountId, messageType],
      );
    },

    async pruneOrphaned() {
      const { rowCount } = await pool.query(
        `DELETE FROM lifecycle_emails le
          WHERE (le.sent_at IS NOT NULL OR le.abandoned_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = le.account_id)`,
      );
      return rowCount ?? 0;
    },

    async queueScheduledMessages(now = new Date()) {
      // Both scans are INSERT ... SELECT so the whole decision happens in one
      // statement against live data, and both lean on the unique constraint
      // rather than tracking what they have already queued.
      const endingAt = new Date(now.getTime() + TRIAL_ENDING_LEAD_DAYS * 86_400_000);
      const endedAfter = new Date(now.getTime() - TRIAL_ENDED_LOOKBACK_DAYS * 86_400_000);

      const ending = await pool.query(
        `INSERT INTO lifecycle_emails
           (id, account_id, message_type, recipient_email, recipient_name, context_date)
         SELECT $1 || u.id, u.id, 'trial_ending', u.email, u.name, u.trial_ends_at
           FROM users u
          WHERE u.trial_ends_at IS NOT NULL
            AND u.trial_ends_at > $2
            AND u.trial_ends_at <= $3
            AND u.subscription_status <> ALL($4::text[])
         ON CONFLICT ON CONSTRAINT lifecycle_emails_once DO NOTHING`,
        [`${ulid()}-`, now, endingAt, PAYING_STATUSES],
      );

      const ended = await pool.query(
        `INSERT INTO lifecycle_emails
           (id, account_id, message_type, recipient_email, recipient_name, context_date)
         SELECT $1 || u.id, u.id, 'trial_ended', u.email, u.name, u.trial_ends_at
           FROM users u
          WHERE u.trial_ends_at IS NOT NULL
            AND u.trial_ends_at <= $2
            AND u.trial_ends_at > $3
            AND u.subscription_status <> ALL($4::text[])
         ON CONFLICT ON CONSTRAINT lifecycle_emails_once DO NOTHING`,
        [`${ulid()}-`, now, endedAfter, PAYING_STATUSES],
      );

      // The two Step 6i reminders, on the same shape. Both are keyed on a date
      // Stripe gave us and mirrored by the webhook, so neither scan does any
      // arithmetic about what a subscription is doing — it only asks which
      // accounts have that date coming up.
      const remindAt = new Date(now.getTime() + PROMO_REMINDER_LEAD_DAYS * 86_400_000);

      // The founding-user promo. Sent before the first real charge, so a
      // teacher who took six free months is not surprised by a card payment.
      // Excluded once the subscription is no longer live: someone who has
      // already cancelled is not about to be charged.
      const promo = await pool.query(
        `INSERT INTO lifecycle_emails
           (id, account_id, message_type, recipient_email, recipient_name, context_date)
         SELECT $1 || u.id, u.id, 'promo_ending', u.email, u.name, u.promo_ends_at
           FROM users u
          WHERE u.promo_ends_at IS NOT NULL
            AND u.promo_ends_at > $2
            AND u.promo_ends_at <= $3
            AND u.subscription_status = ANY($4::text[])
            AND u.cancel_at_period_end = FALSE
         ON CONFLICT ON CONSTRAINT lifecycle_emails_once DO NOTHING`,
        [`${ulid()}-`, now, remindAt, PAYING_STATUSES],
      );

      // The summer pause resuming. `collection_paused` is required as well as
      // the date: a pause the teacher ended early leaves a stale resumes_at
      // behind for as long as it takes the webhook to clear it, and a message
      // announcing a resumption that already happened is worse than none.
      const pause = await pool.query(
        `INSERT INTO lifecycle_emails
           (id, account_id, message_type, recipient_email, recipient_name, context_date)
         SELECT $1 || u.id, u.id, 'pause_resuming', u.email, u.name, u.pause_resumes_at
           FROM users u
          WHERE u.collection_paused = TRUE
            AND u.pause_resumes_at IS NOT NULL
            AND u.pause_resumes_at > $2
            AND u.pause_resumes_at <= $3
         ON CONFLICT ON CONSTRAINT lifecycle_emails_once DO NOTHING`,
        [`${ulid()}-`, now, remindAt],
      );

      return (
        (ending.rowCount ?? 0) +
        (ended.rowCount ?? 0) +
        (promo.rowCount ?? 0) +
        (pause.rowCount ?? 0)
      );
    },
  };
}

/**
 * Queues a message and never throws.
 *
 * Every trigger site is inside a request the teacher cares about far more than
 * the email — creating their account, deleting it — and none of them should
 * fail because the queue did. The failure is logged with the message type and
 * the account id, and neither the recipient's address nor any body is logged
 * with it.
 */
export async function enqueueQuietly(
  store: LifecycleEmailStore,
  input: EnqueueInput,
): Promise<void> {
  try {
    await store.enqueue(input);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, messageType: input.messageType, accountId: input.accountId },
      'Could not queue lifecycle email',
    );
  }
}

export interface DispatchResult {
  queued: number;
  sent: number;
  failed: number;
}

/**
 * One pass of the sweep: derive any newly due time-triggered messages, then send
 * what is waiting.
 *
 * Scanning first means an account whose trial ended minutes ago is served by the
 * same pass rather than waiting for the next one.
 *
 * A failure to send is recorded against the row and the pass continues: one
 * teacher's bad address must not stop everyone else's mail. Only the provider's
 * error text is logged, never the message or the recipient.
 */
export async function dispatchLifecycleEmails(
  mailer: Mailer,
  store: LifecycleEmailStore = createPgLifecycleEmailStore(),
  now: Date = new Date(),
): Promise<DispatchResult> {
  // Step 8a. All four scheduled scans are billing-shaped — the two trial
  // messages, the founding-user promo reminder and the pause resumption — and
  // with billing off none of them describes anything that will happen. The
  // trial warning is the one that matters, because it would tell a teacher
  // their access is about to change when it is not, but a promo reminder with
  // no subscription behind it is equally untrue.
  //
  // The guard is here rather than inside the store so it holds for every
  // implementation of it, and so the sweep's own behaviour is the thing under
  // test. The queue drain below is untouched: the messages that are not about
  // money — the welcome, the deletion confirmation — are enqueued by the
  // request that causes them and have nothing to do with a plan.
  const queued = billingEnabled() ? await store.queueScheduledMessages(now) : 0;
  const due = await store.claimDue(LIFECYCLE_BATCH_SIZE, now);
  let sent = 0;
  let failed = 0;

  for (const item of due) {
    try {
      const rendered = renderLifecycleMessage(item.messageType, {
        name: item.recipientName,
        date: item.contextDate ? formatMessageDate(item.contextDate) : null,
        interval: item.subscriptionInterval,
      });
      await mailer.send({
        to: item.recipientEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await store.markSent(item.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      const detail = (err as Error).message;
      await store.markFailed(item.id, detail).catch(() => undefined);
      logger.warn(
        { err: detail, messageType: item.messageType, attempts: item.attempts },
        'Lifecycle email send failed',
      );
    }
  }

  if (queued > 0 || sent > 0 || failed > 0) {
    logger.info({ queued, sent, failed, driver: mailer.name }, 'Lifecycle email sweep');
  }
  return { queued, sent, failed };
}

/**
 * In-memory queue for tests. Enforces the same uniqueness the constraint does,
 * because that rule is the one every test in this area is really about.
 */
export function createMemoryLifecycleEmailStore(
  /** Stands in for the users table, which the pruning query checks against. */
  accountExists: (accountId: string) => boolean = () => true,
): LifecycleEmailStore & {
  all(): (QueuedLifecycleEmail & { sentAt: string | null; abandonedAt: string | null })[];
} {
  type Entry = QueuedLifecycleEmail & {
    sentAt: string | null;
    abandonedAt: string | null;
    lastError: string;
    attemptedAt: number | null;
  };
  const rows: Entry[] = [];
  const keyOf = (accountId: string, type: string) => `${accountId}::${type}`;
  const seen = new Set<string>();

  return {
    async enqueue(input) {
      const key = keyOf(input.accountId, input.messageType);
      if (seen.has(key)) return false;
      seen.add(key);
      rows.push({
        id: ulid(),
        accountId: input.accountId,
        messageType: input.messageType,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        contextDate: input.contextDate ?? null,
        // Always null in the memory store: the real one reads it from the users
        // table at claim time, and there is no users table here. The copy that
        // depends on it is covered against the template directly.
        subscriptionInterval: null,
        attempts: 0,
        sentAt: null,
        abandonedAt: null,
        lastError: '',
        attemptedAt: null,
      });
      return true;
    },
    async claimDue(limit, now = new Date()) {
      const cutoff = now.getTime() - LIFECYCLE_RETRY_DELAY_MS;
      const due = rows
        .filter(
          (r) =>
            r.sentAt === null &&
            r.abandonedAt === null &&
            (r.attemptedAt === null || r.attemptedAt < cutoff),
        )
        .slice(0, limit);
      for (const r of due) {
        r.attempts += 1;
        r.attemptedAt = now.getTime();
      }
      return due.map((r) => ({ ...r }));
    },
    async markSent(id) {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.sentAt = new Date().toISOString();
        row.lastError = '';
      }
    },
    async markFailed(id, error) {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.lastError = error.slice(0, 500);
      if (row.attempts >= LIFECYCLE_MAX_ATTEMPTS) row.abandonedAt = new Date().toISOString();
    },
    async queueScheduledMessages() {
      // The scan is a SQL statement against the users table and has no
      // meaningful in-memory equivalent; the pg store's own tests cover it.
      return 0;
    },
    async clearMessage(accountId, messageType) {
      const key = keyOf(accountId, messageType);
      seen.delete(key);
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].accountId === accountId && rows[i].messageType === messageType) {
          rows.splice(i, 1);
        }
      }
    },
    async pruneOrphaned() {
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const r = rows[i];
        if ((r.sentAt !== null || r.abandonedAt !== null) && !accountExists(r.accountId)) {
          seen.delete(keyOf(r.accountId, r.messageType));
          rows.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
    all() {
      return rows.map((r) => ({ ...r }));
    },
  };
}
