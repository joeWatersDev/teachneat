import type Stripe from 'stripe';
import { logger } from '../config/logger.js';
import { isBillingConfigured, RECONCILE_BATCH_SIZE } from '../config/billing.js';
import { stripeClient, subscriptionStateFrom } from './billing.js';
import { createPgAccountStore, type AccountStore } from './accountStore.js';

/**
 * Asks Stripe what it thinks, for accounts we have not checked recently.
 *
 * The webhook is how subscription state normally arrives, and it is reliable
 * right up until it is not: Stripe retries a failed delivery for about three
 * days and then stops. Nothing after that point corrects the account, and the
 * app resolves paid entitlement from `subscription_status` alone, so the failure
 * is silent and permanent in both directions.
 *
 *  - A missed `customer.subscription.deleted` leaves a cancelled account **paid
 *    indefinitely**, which is the question NEXT_STEPS has been carrying and the
 *    one people think of first.
 *  - A missed `.created` is the likelier one and was found later: `canCancel`
 *    and `canOfferPause` read the mirrored state, so a teacher who *is* paying
 *    can neither cancel nor pause in the app. Stripe is right, the billing
 *    portal works, and the app is wrong about a customer who is giving us money.
 *
 * One sweep answers both, which is why it was preferred over the other candidate
 * fix. That one was to treat `active` with a `current_period_end` in the past as
 * lapsed — cheap, but it only addresses the first direction, and it cuts off a
 * teacher whose renewal event is merely still in flight.
 *
 * **This does not make Stripe's state a matter of opinion.** It derives the
 * account row through `subscriptionStateFrom` and writes it through
 * `applySubscriptionState`, which are the same mapper and the same writer the
 * webhook uses. There is one definition of what a subscription means to this
 * app; this is that definition applied on a timer for the cases where the push
 * did not arrive. The staleness guard applies here too, so a reconcile carrying
 * an older timestamp than the row cannot overwrite it.
 */

export interface ReconcileResult {
  checked: number;
  corrected: number;
  failed: number;
}

/**
 * Reconciles one batch of accounts.
 *
 * Bounded by `limit` rather than sweeping everything, and ordered by
 * least-recently-checked, so the work per run is a constant instead of growing
 * with the number of paying teachers. Every account still comes round; it just
 * does so at a rate this decides rather than the user count.
 */
export async function reconcileSubscriptions(
  store: AccountStore = createPgAccountStore(),
  limit: number = RECONCILE_BATCH_SIZE,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, corrected: 0, failed: 0 };
  if (!isBillingConfigured()) return result;

  const accounts = await store.listForSubscriptionCheck(limit);
  for (const account of accounts) {
    try {
      const sub = await latestSubscriptionFor(account.stripeCustomerId);
      if (sub) {
        const applied = await store.applySubscriptionState(
          account.stripeCustomerId,
          subscriptionStateFrom(sub),
          // `now`, not a Stripe event time: this is a fresh read of the current
          // object, so it is the newest information there is. Using the
          // subscription's `created` would date a live subscription to when it
          // began and let a months-old reconcile lose to any recent event.
          new Date(),
        );
        if (applied) result.corrected += 1;
      }
      // A customer with no subscription at all is left alone deliberately.
      // Stripe keeps cancelled subscriptions listed, so "nothing found" means a
      // customer who never subscribed, not one who stopped — and writing a
      // cancelled state from an absence would drop a comped or trialling
      // account that happens to have a Stripe customer record.
      await store.markSubscriptionChecked(account.googleSub);
      result.checked += 1;
    } catch (err) {
      // One account's failure must not end the batch: a deleted customer or a
      // transient Stripe error would otherwise stop every account behind it
      // being checked, and they are ordered oldest-first precisely because they
      // are the ones most in need of it.
      result.failed += 1;
      logger.warn(
        { err: (err as Error).message },
        'Subscription reconciliation failed for one account',
      );
    }
  }
  return result;
}

/**
 * The subscription that decides this customer's entitlement.
 *
 * `status: 'all'` because a cancelled subscription is exactly what a missed
 * `deleted` event leaves us blind to, and asking only for active ones would
 * return nothing and teach us nothing. Sorted by Stripe's default of newest
 * first, so a teacher who cancelled and resubscribed is read from the current
 * subscription rather than the old one.
 */
async function latestSubscriptionFor(customerId: string): Promise<Stripe.Subscription | null> {
  const list = await stripeClient().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 1,
    // Discounts must be expanded to read the promo end date, the same trap
    // documented on withExpandedDiscounts: an unexpanded id silently yields
    // null rather than erroring.
    expand: ['data.discounts'],
  });
  return list.data[0] ?? null;
}
