/**
 * Email sending limits. The daily cap is a hard security boundary (see
 * IMPLEMENTATION_PLAN.md Email Security); the burst limit is a softer guard
 * against runaway loops. Both are enforced server-side.
 */

/**
 * Hard per-user daily send cap. Enforced against a Postgres counter claimed
 * before sending, not against `emailLog` — Step 7 moved it there because a
 * teacher could reset a cap counted from rows in their own spreadsheet.
 *
 * Lowered from 200 to 120 in Step 8a. It is the only brake on a compromised
 * account, and 120 still covers the days that actually need volume — a whole
 * timetable of classes contacted in one afternoon, or report-card season —
 * while cutting the blast radius of a stolen session by 40%.
 */
export const EMAIL_DAILY_CAP = 120;

/**
 * Max recipients accepted in a single POST /email/send request.
 *
 * Deliberately left above EMAIL_DAILY_CAP. It bounds the size of one request
 * rather than a teacher's day, and the two are enforced independently: a send
 * larger than the remaining daily allowance is accepted, fills the allowance,
 * and reports the rest as skipped with a reason. Since the cap dropped to 120,
 * a maximal 200-recipient request can no longer complete in a single day; that
 * is the daily cap doing its job, not a mis-sized request limit.
 */
export const MAX_RECIPIENTS_PER_SEND = 200;

/**
 * Burst protection on POST /email/send. No more than EMAIL_BURST_MAX requests
 * per user within a rolling EMAIL_BURST_WINDOW_MS window. Set strictly below the
 * "100 in 10 seconds should be blocked" threshold in IMPLEMENTATION_PLAN.md.
 */
export const EMAIL_BURST_WINDOW_MS = 10_000;
export const EMAIL_BURST_MAX = 60;

/** Placeholder token grammar shared by templates and rendering. */
export const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]{0,40})\s*\}\}/g;

/** Default placeholder keys resolved from the student record. */
export const STUDENT_PLACEHOLDER_KEYS = ['firstName', 'lastName', 'goesBy', 'pronouns'] as const;
