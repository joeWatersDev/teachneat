import { env } from './env.js';

/**
 * Billing constants. The provider choice, the fee arithmetic behind the two
 * prices, and why annual is the prominent option are in NEXT_STEPS.md
 * ("Billing provider") and IMPLEMENTATION_PLAN.md (Phase 2 Step 3b).
 */

/** The two ways to pay for the single paid plan. There is no middle tier. */
export type BillingInterval = 'monthly' | 'annual';

export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'annual'];

/**
 * What the product tells teachers it charges, in the currency's minor unit.
 * Kept here rather than only in Stripe so that {@link assertPricesMatch} can
 * check the two against each other at startup: a Price's amount can be changed
 * in the Stripe dashboard without the id changing, so nothing else would catch
 * the app advertising one number while Stripe charges another.
 */
export const ADVERTISED_PRICES: Record<BillingInterval, { amount: number; currency: string }> = {
  monthly: { amount: 699, currency: 'cad' },
  annual: { amount: 6990, currency: 'cad' },
};

/**
 * An advertised price as a teacher reads it — "$6.99 CAD" — from the figures
 * above rather than from a string typed out again somewhere else.
 *
 * It exists because prices are not settled: the currency, the amounts and
 * whether they are localised are all still open, and every place that spells one
 * out by hand is a place that will be missed when they change. A lifecycle email
 * is the worst of those, since it cannot be corrected after it is sent. Anything
 * that needs to name a price calls this.
 */
export function formatAdvertisedPrice(interval: BillingInterval): string {
  const { amount, currency } = ADVERTISED_PRICES[interval];
  return `$${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** The configured Stripe Price id for an interval, or '' when unconfigured. */
export function priceIdFor(interval: BillingInterval): string {
  return interval === 'monthly' ? env.stripe.priceMonthly : env.stripe.priceAnnual;
}

/**
 * The interval a Stripe Price id belongs to, or null for one we do not
 * recognise. The inverse of {@link priceIdFor}.
 *
 * Null rather than a default, and the difference matters: a subscription on a
 * price this deployment has never heard of is either a leftover from an earlier
 * test-mode configuration or a price added in the dashboard without touching
 * `.env`. Guessing "monthly" there would put a wrong figure in the one email
 * whose purpose is that a charge is not a surprise, so the interval stays
 * unknown and the copy falls back to naming no figure at all.
 *
 * Guards the empty string, because {@link priceIdFor} returns '' when billing is
 * unconfigured and an unrecognised id is also '' in that case — without this,
 * every subscription would read as monthly on a fresh clone.
 */
export function intervalForPriceId(priceId: string | null | undefined): BillingInterval | null {
  if (!priceId) return null;
  return BILLING_INTERVALS.find((interval) => priceIdFor(interval) === priceId) ?? null;
}

/**
 * The summer pause (Phase 2 Step 6i). Teachers stop teaching for two months and
 * a June cancellation is the predictable churn event this product has; pausing
 * collection holds the subscription without billing it.
 *
 * The bounds are enforced server-side rather than only offered in the dialog,
 * because the endpoint is reachable directly and a twelve-month pause would be
 * a free subscription.
 */
export const PAUSE_MIN_MONTHS = 1;
export const PAUSE_MAX_MONTHS = 3;
export const PAUSE_DEFAULT_MONTHS = 2;

/**
 * How long after a pause starts before another may be taken. A year rather than
 * a season, so the offer is "the summer" and not "any time things are quiet" —
 * the pricing analysis in IMPLEMENTATION_PLAN.md assumes at most two unbilled
 * months per subscriber-year, and a second pause would break it.
 */
export const PAUSE_COOLDOWN_MONTHS = 12;

/**
 * The pause is monthly-only, and this is the reason rather than an omission: a
 * September annual renewal already falls outside the summer, which is that
 * plan's entire advantage. An annual subscriber who cancels runs to period end
 * as before.
 */
export const PAUSE_ELIGIBLE_INTERVAL: BillingInterval = 'monthly';

/** Whether billing is configured enough to run. False in tests and on a fresh clone. */
export function isBillingConfigured(): boolean {
  return (
    env.stripe.secretKey.length > 0 &&
    env.stripe.priceMonthly.length > 0 &&
    env.stripe.priceAnnual.length > 0
  );
}

/**
 * How many accounts one reconciliation sweep verifies against Stripe.
 *
 * A constant rather than "every account with billing", so the work per run and
 * the Stripe API calls it makes do not grow with the number of paying teachers.
 * Ordered least-recently-checked first, so at this size and an hourly sweep,
 * 2,400 accounts come round every day; well past that the interval is the thing
 * to shorten, or the batch the thing to raise, and either is a one-line change
 * made against a real number rather than a guessed one.
 */
export const RECONCILE_BATCH_SIZE = 100;

/** How often the reconciliation sweep runs. Hourly, beside the other sweeps. */
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
