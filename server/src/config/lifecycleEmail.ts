/**
 * Lifecycle email: the message catalogue and the dispatch constants
 * (Phase 2 Step 6h).
 *
 * This is the app's only channel for speaking to a teacher in its own voice.
 * The Gmail integration sends as the *teacher*, to parents, and Stripe sends
 * receipts and dunning notices for a card already on file; neither can say
 * anything about the account itself. The gap that mattered is the end of the
 * trial, which until this step arrived unannounced on a teacher who had just
 * entered a month of attendance.
 *
 * **The catalogue below is closed, and that is a legal limit rather than a
 * scope preference.** Canada's Anti-Spam Legislation treats a message tied to
 * an existing account relationship and to a transaction the teacher initiated
 * as a service message, outside the consent requirement. A product update or
 * anything promoting the paid plan to a free account is a commercial electronic
 * message and needs express consent recorded at signup, an unsubscribe
 * mechanism in every send, and a durable record of when consent was given —
 * none of which exists here, and none of which is a small addition. An
 * announcements list is its own step if it is ever wanted.
 *
 * `lifecycleEmail.test.ts` asserts this list exactly, so a seventh message
 * fails the suite rather than shipping as a one-line change.
 */
export const LIFECYCLE_MESSAGE_TYPES = [
  /** The account was created and consent was recorded. */
  'welcome',
  /** TRIAL_ENDING_LEAD_DAYS before the trial runs out. */
  'trial_ending',
  /** The day the account first resolves to `free` after a trial. */
  'trial_ended',
  /** PROMO_REMINDER_LEAD_DAYS before a founding-user promo's first real charge (Step 6i). */
  'promo_ending',
  /** PROMO_REMINDER_LEAD_DAYS before a summer pause resumes billing (Step 6i). */
  'pause_resuming',
  /** The account was deleted, confirming it happened. */
  'account_deleted',
] as const;

export type LifecycleMessageType = (typeof LIFECYCLE_MESSAGE_TYPES)[number];

/**
 * Payment failure is deliberately absent from the list above. Stripe's own
 * dunning emails cover it and are already configured against the account;
 * adding ours would send a teacher two notices about one card.
 */

/**
 * The postal address in every message's footer, or empty for none.
 *
 * CASL exempts these six from consent and from carrying an unsubscribe
 * mechanism, since each is tied to an account the teacher opened, but the
 * identification requirements are a separate obligation that the exemption does
 * not lift: a message has to say who sent it and give contact information that
 * stays valid. The name and the contact form cover most of that; a mailing
 * address is the part still missing.
 *
 * It is empty rather than approximated because the footer omits the line
 * entirely when it is unset, and a wrong address is worse than an absent one.
 * It is a Canada Post box rather than the address on the business-name
 * registration, which has to be a street address and is the operator's home.
 * CASL accepts a post office box as a mailing address.
 *
 * The legal documents print the same address from `OPERATOR_POSTAL_ADDRESS` in
 * client/src/pages/legal/legalMeta.ts. Change both together; legal.test.ts
 * fails when they differ.
 */
export const OPERATOR_POSTAL_ADDRESS = '';

/** How far ahead of `trial_ends_at` the warning goes out. */
export const TRIAL_ENDING_LEAD_DAYS = 5;

/** How far ahead of a first real charge the Step 6i reminders go out. */
export const PROMO_REMINDER_LEAD_DAYS = 7;

/** How often the dispatch sweep runs. */
export const LIFECYCLE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** Rows dispatched per sweep, so one pass cannot sit on the provider for minutes. */
export const LIFECYCLE_BATCH_SIZE = 50;

/**
 * Attempts before a queued message is abandoned. A lifecycle message is worth
 * retrying across a provider outage and worth giving up on eventually: a
 * "your trial ends in five days" that finally sends a fortnight late is worse
 * than one that never sends at all.
 */
export const LIFECYCLE_MAX_ATTEMPTS = 5;

/** Minimum gap between attempts on the same row. */
export const LIFECYCLE_RETRY_DELAY_MS = 60 * 60 * 1000;
