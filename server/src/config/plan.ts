/**
 * Plan constants. The free-versus-paid split and the reasoning behind each
 * number are in IMPLEMENTATION_PLAN.md (Phase 2 Step 3).
 */

/**
 * Length of the no-card-required trial every new account starts on.
 *
 * Dormant under Step 8a — no trial ends while `BILLING_ENABLED` is off — but
 * still written to `trial_ends_at` at signup, so accounts created during the
 * free year will carry a long-expired trial on the day billing returns and
 * would resolve straight to `free`. Left as it is deliberately: what those
 * accounts should get on restoration is a decision for the step that restores
 * billing, not one to guess at now. Recorded in NEXT_STEPS.
 */
export const TRIAL_DAYS = 30;

/**
 * Sends a `free` account may make per calendar month (UTC).
 *
 * Dormant under Step 8a. It exists to drive conversion, and with nothing to
 * convert to it is a limit that only annoys, so no account is subject to it
 * while billing is off — not by a second mechanism here, but as a consequence
 * of every account resolving to `paid` in `resolveEffectivePlan`.
 *
 * This is **not** the send limit that matters. `EMAIL_DAILY_CAP` of 200 in
 * config/email.ts applies to every account on every plan, is listed in Security
 * Practices, and is the only brake on a compromised account. Step 8a does not
 * touch it.
 */
export const FREE_MONTHLY_EMAIL_CAP = 30;

/** A high-absence threshold: a minimum sample of recorded days and an absence rate to exceed. */
export interface HighAbsenceThreshold {
  minAbsenceRate: number;
  minDaysRecorded: number;
}

/**
 * The product default high-absence threshold: at least 5 recorded days and an
 * absence rate strictly above 15%. Applied to every `free` account regardless of
 * what it may have stored while paid, so the free tier has one fixed definition.
 */
export const DEFAULT_HIGH_ABSENCE: HighAbsenceThreshold = {
  minAbsenceRate: 0.15,
  minDaysRecorded: 5,
};
