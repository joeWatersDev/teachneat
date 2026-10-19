import { apiClient } from './client';

/** `trial` and `paid` are entitlement-identical; they differ only in labelling. */
export type Plan = 'free' | 'trial' | 'paid';

/**
 * Why a `free` account has lost premium, where it had it before. Declared here,
 * with the response it arrives in, so the copy module and the entitlements
 * context cannot drift from the values the server actually sends.
 */
export type LapsedFrom = 'trial' | 'subscription' | 'paused';

export interface AuthProfile {
  /**
   * Whether the product charges anybody (Phase 2 Step 8a). False through the
   * first school year, and the single thing the client reads to decide that no
   * upgrade affordance, trial countdown or Premium mark should exist anywhere.
   *
   * The fields below that describe a trial or a subscription — `trialEndsAt`,
   * `lapsedFrom`, `paused`, `promoEndsAt`, `currentPeriodEnd` — are withheld
   * entirely while this is false, rather than sent as values the client would
   * have to know to ignore.
   */
  billingEnabled: boolean;
  email: string;
  name: string;
  avatarUrl: string;
  /** Per-session CSRF token, echoed on every state-changing request. */
  csrfToken: string;
  /**
   * Resolved server-side on every call. Presentation only — badges and disabled
   * controls — never the security boundary; every gated endpoint checks again.
   */
  plan: Plan;
  /** Present only while `plan` is `trial`. */
  trialEndsAt?: string;
  /**
   * Why this account is on `free`, when it has had premium before (Phase 2 Step
   * 6h). Chooses the words on a locked control, never whether it locks — a
   * teacher who has been reading Statistics for a month is owed an explanation
   * and the assurance that nothing was deleted; one who has never seen it is
   * owed an invitation.
   *
   * Absent for an account that has never been premium. The three values exist
   * because a single "the trial ended" flag told a teacher who paid for a year
   * and cancelled, and one whose subscription is merely paused, about a trial
   * that finished long before either event.
   */
  lapsedFrom?: LapsedFrom;
  /**
   * Whether billing is currently paused, and when it resumes (Phase 2 Step 6i).
   * Wording rather than permission: a paused account already resolves to `free`
   * server-side. It is here so the account page can say "paused until
   * September" rather than leaving a teacher who chose the pause to conclude
   * their subscription was cancelled.
   */
  paused?: boolean;
  pauseResumesAt?: string | null;
  /**
   * When a founding-user promo stops covering the subscription, if one does
   * (Phase 2 Step 6i). Wording rather than permission, like the pause fields
   * above: the account page states it so a teacher on the promo can see when
   * their free period ends without hunting for the reminder email.
   *
   * Absent rather than null when there is no promo.
   */
  promoEndsAt?: string;
  /**
   * When the current billing period ends. Present only while there is a live
   * subscription, because Stripe reports a terminated subscription's original
   * period end and a `canceled` account can therefore carry a future date —
   * never present this as "access until" without that guard, which the server
   * applies before sending it.
   *
   * Here for the cancellation dialog: a promo-covered subscription renews
   * monthly at zero, so cancelling ends it at this date and **not** when the
   * promo runs out.
   */
  currentPeriodEnd?: string;
  /**
   * Whether there is a subscription worth offering to cancel (Phase 2 Step 6i).
   * **Not the same question as `hasBilling`**, which is only whether a Stripe
   * customer exists: both the customer id and the subscription id survive a
   * cancellation, so an account that cancelled last term still has them and has
   * nothing left to cancel. Nor is it the plan, since a comped account resolves
   * to `paid` with no subscription behind it.
   */
  canCancel?: boolean;
  /**
   * Whether the cancellation flow should offer a pause. A hint: the endpoint
   * re-checks, including the monthly-only rule that the account row cannot
   * answer, so this can be optimistic and the request refused.
   */
  pauseAvailable?: boolean;
  /**
   * Whether the first-run guide is still outstanding (Phase 2 Step 5a). Server
   * state rather than a localStorage flag, so a teacher who signs in on a second
   * device is not walked through it again. Not a permission — nothing is gated
   * on it, so it needs no re-check.
   */
  needsOnboarding?: boolean;
  /**
   * Whether this account has ever had a student (Phase 2 Step 6f). The account
   * menu offers "Getting started" only until it does, so the guide is a
   * first-week affordance rather than a permanent item.
   *
   * Not the same question as `needsOnboarding`: skipping the guide finishes
   * onboarding without adding anyone, and that teacher is precisely the one who
   * should still be offered it.
   */
  hasStudents?: boolean;
  /**
   * Whether the terms and the data-responsibility acknowledgement are still
   * outstanding (Phase 2 Step 5c). Unlike `needsOnboarding` this one *is* a
   * permission — but it is not enforced here. The server refuses every gated
   * router independently, so forging `false` yields an app shell whose every
   * request comes back CONSENT_REQUIRED.
   */
  needsConsent?: boolean;
  /** The version of the agreements currently in force, echoed back on acceptance. */
  termsVersion?: string;
  /**
   * Whether to render the development-only plan toggle. A rendering hint, not a
   * permission: the endpoint re-checks its own guards, so forging this gains
   * nothing.
   */
  devTools?: boolean;
  /**
   * The stored plan override, present only alongside `devTools`. `null` means
   * no override, which is not the same as a forced plan that happens to resolve
   * the same way — the toggle's label depends on the difference.
   */
  planOverride?: 'free' | 'trial' | 'paid' | null;
  /**
   * Whether to offer the support triage view. A rendering hint like `devTools`:
   * the admin endpoints re-check the allowlist and answer 404, so forging this
   * reveals an empty page and nothing else.
   */
  supportAdmin?: boolean;
  /**
   * Whether a Stripe customer exists for this account, deciding between
   * "Upgrade" and "Manage billing". Not the same question as the plan: a lapsed
   * account is `free` but still has invoices and a card worth managing.
   */
  hasBilling?: boolean;
}

export function getMe(): Promise<AuthProfile> {
  return apiClient.get<AuthProfile>('/auth/me');
}

export function logout(): Promise<void> {
  return apiClient.post<void>('/auth/logout');
}

/**
 * Ends every session on this account, including the calling one (Step 6f). The
 * caller is signed out as a consequence and must send the teacher somewhere
 * public, exactly as an ordinary sign-out does.
 */
export function revokeAllSessions(): Promise<void> {
  return apiClient.delete<void>('/auth/sessions');
}

/**
 * Deletes the account (Step 6f). Irreversible, and the caller is responsible
 * for having confirmed it.
 *
 * It does not touch the teacher's spreadsheet, which is the fact the
 * confirmation dialog leads with. It can fail with a message worth showing: an
 * active subscription that Stripe would not cancel stops the whole operation,
 * because a subscription outliving its account has nothing left that could stop
 * it billing.
 */
export function deleteAccount(): Promise<void> {
  return apiClient.delete<void>('/auth/account');
}

/**
 * Records that the teacher has finished the first-run guide. Idempotent
 * server-side, so the caller does not have to know whether it has run before —
 * which matters, because the guide stays re-openable from the account menu.
 */
export function completeOnboarding(): Promise<void> {
  return apiClient.post<void>('/auth/onboarding/complete');
}

/**
 * Records acceptance of both agreements (Phase 2 Step 5c). The version is sent
 * back rather than assumed server-side so that a client holding stale text
 * cannot record consent to terms the teacher was never shown — the server
 * rejects a mismatch, and the reload puts the current wording in front of them.
 */
export function acceptConsent(termsVersion: string): Promise<void> {
  return apiClient.post<void>('/auth/consent', {
    termsVersion,
    acceptedTerms: true,
    acceptedDataResponsibility: true,
  });
}

/**
 * Development-only: steps this account's plan override through
 * `none` → `free` → `trial` → `paid` → `none`, so premium presentation can be
 * checked in all three states without leaving the page, and so the override can
 * be cleared to reveal the account's real plan. Answers 404 unless the server is
 * non-production and the account is allowlisted, so it does not exist in
 * production.
 */
export function cyclePlan(): Promise<{ plan: Plan; override: Plan | null }> {
  return apiClient.post<{ plan: Plan; override: Plan | null }>('/internal/dev/plan');
}

/**
 * Development-only: moves this account's trial end date (Phase 2 Step 6h).
 *
 * `days` is relative and may be negative. It exists because the path this step
 * was built for — the trial expiring — otherwise takes thirty days to reach, and
 * the alternative is editing the database by hand. Guarded and 404-ing exactly
 * like `cyclePlan` above.
 */
export function setTrialEnd(days: number): Promise<{ trialEndsAt: string; plan: Plan }> {
  return apiClient.post<{ trialEndsAt: string; plan: Plan }>('/internal/dev/trial', { days });
}

/**
 * Development-only: runs the lifecycle email sweep now rather than waiting for
 * its quarter-hour timer (Phase 2 Step 6h).
 *
 * Returns the pass's counts and nothing about who was written to. With no
 * provider configured — every environment until the sending domain is verified
 * — the messages print to the server's terminal instead of being delivered.
 */
export function runLifecycleSweep(): Promise<{ queued: number; sent: number; failed: number }> {
  return apiClient.post<{ queued: number; sent: number; failed: number }>(
    '/internal/dev/lifecycle',
  );
}

/** Absolute URL the browser must navigate to in order to start the OAuth flow.
 * The endpoint content-negotiates: navigating directly (Accept: text/html) sets
 * the state cookie and redirects to Google in one step. */
export const SIGNIN_URL = '/api/auth/google';
