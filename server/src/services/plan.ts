import { DEFAULT_HIGH_ABSENCE } from '../config/plan.js';
import { billingEnabled } from '../config/env.js';
import type { Account, HighAbsenceSetting } from './accountStore.js';

/**
 * Plan state, resolved from the account record on every request. `trial` and
 * `paid` are entitlement-identical — they differ only in how the client labels
 * premium controls and in what happens when the trial ends. The split itself is
 * specified in IMPLEMENTATION_PLAN.md (Phase 2 Step 3).
 */
export type Plan = 'free' | 'trial' | 'paid';

/**
 * Subscription states Stripe reports that entitle an account (Step 3b writes
 * these). Exported because the lifecycle email scans (Step 6h) have to exclude
 * the same set — a teacher who subscribed during their trial must not be told
 * it is ending — and two lists that mean "already paying" would eventually
 * disagree.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Resolution order: an explicit `plan_override` first (the dev toggle now, the
 * support comp mechanism later), then a live subscription, then an unexpired
 * trial, then `free`. An expired trial or a lapsed subscription lands on `free`,
 * which is a working plan and never a lockout.
 *
 * **The subscription is checked before the trial, and the order matters to the
 * interface rather than to entitlement.** `trial` and `paid` are
 * entitlement-identical, so either order grants the same access; what differs is
 * the label, and the label is what the client renders. A teacher who subscribes
 * during their trial — the ordinary case for the founding-user promo, which is
 * aimed at new signups — was resolving to `trial`, so the app went on offering
 * them "Upgrade to Premium" in the account menu and a trial countdown with its
 * own upgrade button in the sidebar, having just taken their card. Asking
 * someone to buy what they have already bought is the kind of thing teachers
 * tell each other about.
 *
 * The pause is folded into the subscription check rather than left as a separate
 * clause before the trial, because a pause must not cost a teacher trial time
 * they still have: a paused subscription is not a live one, so resolution falls
 * through to the trial, and only an account with no unexpired trial lands on
 * `free`. That is the same outcome the earlier ordering produced for every
 * paused account that had no trial left, which is all of them in practice.
 *
 * **Paid entitlement is decided by Stripe's status alone, never by a date we
 * hold.** `current_period_end` is mirrored onto the account but deliberately not
 * consulted here: Stripe keeps a cancel-at-period-end subscription `active`
 * until the period elapses and then sends `customer.subscription.deleted`, so
 * there is no date arithmetic and no scheduled job on our side.
 *
 * The cost of that simplicity, recorded rather than fixed: expiry depends on
 * that event arriving. A `deleted` we never process leaves the status `active`
 * and the account paid indefinitely, with no floor here to catch it. Stripe
 * retries for ~3 days and surfaces failures in its dashboard, so the window is
 * bounded, but adding a backstop (treat `active` with a past `current_period_end`
 * as lapsed) is an open decision for Step 7 — see NEXT_STEPS, Open Questions.
 * It is not made here because it trades a missed-webhook risk against cutting
 * off a teacher whose renewal event is merely still in flight.
 *
 * **A paused subscription is the one place a status is not taken at face
 * value** (Step 6i). Stripe holds a subscription with `pause_collection` set at
 * `active`, so the status check below would grant Premium to an account that
 * has stopped paying. The pause therefore disqualifies the subscription in the
 * same condition that tests it, and it is read as a flag rather than as a date
 * comparison against `pauseResumesAt`: Stripe
 * clears `pause_collection` and sends `customer.subscription.updated` when
 * collection resumes, so the flag is what actually tracks the state, and a
 * pause with no end date has no date to compare anyway. The failure mode of
 * trusting the flag is that a missed resume event leaves a teacher on `free`
 * while paying, which is visible to them immediately and complained about, as
 * opposed to silently free access.
 */
export function resolvePlan(account: Account, now: Date = new Date()): Plan {
  if (account.planOverride) return account.planOverride;
  if (!account.collectionPaused && ACTIVE_SUBSCRIPTION_STATUSES.has(account.subscriptionStatus)) {
    return 'paid';
  }
  if (account.trialEndsAt && new Date(account.trialEndsAt).getTime() > now.getTime()) {
    return 'trial';
  }
  return 'free';
}

/**
 * The plan the rest of the server acts on (Phase 2 Step 8a).
 *
 * With billing switched off, every account resolves to `paid` — full
 * entitlement, no trial countdown, no wall — and `resolvePlan` above is not
 * consulted at all. This is the single point the launch scope reduction acts
 * through: `requirePremium`, `isPremium`, `effectiveHighAbsence`, the grouping
 * constraints flag and the email monthly cap all read their answer from here,
 * so none of them needed an edit and none of them can disagree.
 *
 * `resolvePlan` is deliberately left untouched beside it, with its logic, its
 * reasoning and its tests intact, because it is what comes back the day
 * `BILLING_ENABLED` is set. Call this one from request paths; call
 * `resolvePlan` only where the question really is "what would this account's
 * plan be", which today is nowhere.
 */
export function resolveEffectivePlan(account: Account, now: Date = new Date()): Plan {
  if (!billingEnabled()) return 'paid';
  return resolvePlan(account, now);
}

/** Whether the plan carries premium entitlements. The only distinction that gating makes. */
export function isPremium(plan: Plan): boolean {
  return plan !== 'free';
}

/**
 * The high-absence threshold actually applied for this account. A `free` account
 * is computed with the product default even when it has a stored override — the
 * same "stored but not applied" rule grouping constraints follow — so the free
 * tier has one fixed definition and its tooltip always reads 15%. The stored
 * value survives untouched and re-applies on upgrade.
 */
export function effectiveHighAbsence(
  account: Account,
  plan: Plan,
): { threshold: HighAbsenceSetting; isDefault: boolean } {
  if (isPremium(plan) && account.highAbsence) {
    return { threshold: account.highAbsence, isDefault: false };
  }
  return { threshold: { ...DEFAULT_HIGH_ABSENCE }, isDefault: true };
}
