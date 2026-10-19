/**
 * Support request vocabulary and limits (Phase 2 Step 4).
 *
 * Categories exist to make triage sortable, not to route anything: there is one
 * operator, so a category is a hint about what a request is, and the list is
 * deliberately short enough that a teacher picks one without deliberating.
 */
export const SUPPORT_CATEGORIES = ['question', 'bug', 'billing', 'feature', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/**
 * `new` → `open` (seen, being worked) → `resolved`, plus `closed` for anything
 * that needed no answer. Four states rather than two because "read it, haven't
 * answered" is the state a one-person support queue spends most of its time in
 * and the one worth being able to filter out.
 */
export const SUPPORT_STATUSES = ['new', 'open', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_LIMITS = {
  subjectMax: 120,
  messageMax: 4000,
  adminNoteMax: 2000,
  /** Signed-out form only. The account supplies these on the signed-in path. */
  contactNameMax: 120,
  contactEmailMax: 254,
  /** Page size for the admin list. Small enough that no request needs a cursor yet. */
  listLimit: 100,
} as const;

/**
 * Submissions allowed per account per window. High enough that a teacher
 * reporting three separate things in one sitting is never blocked, low enough
 * that a stuck client cannot fill the table.
 */
export const SUPPORT_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  limit: 10,
} as const;

/**
 * The signed-out form's limit, keyed on the caller's IP subnet.
 *
 * Tighter than the signed-in one because this is the app's only unauthenticated
 * write endpoint, so here the limit *is* a security boundary rather than a
 * guard against a stuck client. Three an hour is more than anyone with a real
 * question needs and far too few to be worth automating against; the honeypot
 * field on the form is the cheap half of the same job, and a captcha (a
 * dependency, a Google-hosted script, and an accessibility cost) is deliberately
 * not used unless abuse actually appears.
 */
export const PUBLIC_SUPPORT_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  limit: 3,
} as const;
