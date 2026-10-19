import Stripe from 'stripe';
import { env } from '../config/env.js';
import {
  ADVERTISED_PRICES,
  BILLING_INTERVALS,
  intervalForPriceId,
  PAUSE_COOLDOWN_MONTHS,
  priceIdFor,
  type BillingInterval,
} from '../config/billing.js';
import { logger } from '../config/logger.js';
import type { AccountStore, SubscriptionState } from './accountStore.js';
import { ACTIVE_SUBSCRIPTION_STATUSES } from './plan.js';

/**
 * Stripe integration (Phase 2 Step 3b). The webhook handler here is the sole
 * writer of billing state — `plan_override` is how the dev toggle and support
 * comps set plan, precisely so that nothing but Stripe ever writes the fields
 * Stripe owns and the two can never disagree.
 *
 * Nothing in this file touches student PII. A Stripe customer carries only the
 * teacher's own email and name, which the account row already holds.
 */

let client: Stripe | null = null;

/** The shared Stripe client. Lazy so importing this module needs no configuration. */
export function stripeClient(): Stripe {
  if (!client) client = new Stripe(env.stripe.secretKey);
  return client;
}

/** Replaces the client, for tests. */
export function setStripeClient(next: Stripe | null): void {
  client = next;
}

/**
 * The billing state implied by a Stripe subscription.
 *
 * `current_period_end` is read from the subscription's **items**, not the
 * subscription: it moved there in recent API versions (the SDK pins
 * 2026-06-24.dahlia), and reading the old location silently yields `undefined`
 * rather than failing. The latest period end across items is used, which for a
 * single-price subscription like ours is simply that price's period end.
 */
export function subscriptionStateFrom(sub: Stripe.Subscription): SubscriptionState {
  const periodEnds = sub.items.data
    .map((item) => item.current_period_end)
    .filter((v): v is number => typeof v === 'number');
  const periodEnd = periodEnds.length > 0 ? Math.max(...periodEnds) : null;
  return {
    subscriptionStatus: sub.status,
    stripeSubscriptionId: sub.id,
    // Stripe timestamps are seconds; Postgres wants a Date.
    currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd * 1000).toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    // Presence of the object is the pause, not the resume date: an indefinite
    // pause carries no `resumes_at`, and a resume arrives as the whole object
    // going null.
    collectionPaused: sub.pause_collection != null,
    pauseResumesAt: secondsToIso(sub.pause_collection?.resumes_at ?? null),
    promoEndsAt: promoEndOf(sub),
    // Which price this is on, for the promo reminder's figure. Read from the
    // first item because this product sells one price per subscription; a
    // multi-item subscription is not a shape this app creates.
    subscriptionInterval: intervalForPriceId(sub.items.data[0]?.price?.id),
  };
}

/** A Stripe timestamp (seconds) as an ISO string, or null. */
function secondsToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * When a repeating discount stops applying to this subscription, which is the
 * date of the first real charge (Step 6i).
 *
 * Read from `discounts` rather than the singular `discount`, which is where the
 * field moved in recent API versions — the same trap `current_period_end` above
 * documents, and with the same silent failure of reading `undefined` instead of
 * erroring. Only expanded discount objects can be read; an unexpanded id yields
 * null, which means no reminder rather than a wrong one.
 *
 * A discount with no `end` is a forever discount, and there is no first charge
 * to warn about — so null is the right answer there too.
 */
function promoEndOf(sub: Stripe.Subscription): string | null {
  const ends = (sub.discounts ?? [])
    .map((d) => (typeof d === 'string' ? null : d.end))
    .filter((v): v is number => typeof v === 'number');
  // The latest, so a stacked pair of discounts warns about the charge that
  // actually happens rather than the first one that lapses.
  return ends.length > 0 ? secondsToIso(Math.max(...ends)) : null;
}

/** A subscription's customer id, whether the field is expanded or not. */
function customerIdOf(sub: Stripe.Subscription): string | null {
  const { customer } = sub;
  if (typeof customer === 'string') return customer;
  return customer?.id ?? null;
}

/**
 * The subscription events that change entitlement. `created` and `updated` are
 * both handled by mirroring Stripe's status, and `deleted` is what fires when a
 * cancelled subscription actually reaches the end of its paid period — which is
 * why cancellation needs no scheduled job on our side: access simply continues
 * until Stripe says the period is over.
 *
 * `invoice.payment_failed` is deliberately not handled. Stripe moves the
 * subscription to `past_due` and sends `customer.subscription.updated`, so
 * handling the invoice event as well would be a second path to the same state.
 * `past_due` keeps access on purpose (see plan.ts): a card expiring mid-semester
 * should not lock a teacher out of their class during a lesson.
 */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/**
 * Re-fetches the subscription when its discounts arrived as bare ids.
 *
 * Webhook payloads are not expanded, so a promo-bearing subscription reaches
 * us as a list of discount ids with no `end` on them — and {@link promoEndOf}
 * would read that as "no promo" and quietly never queue the reminder that makes
 * card-up-front honest. One extra API call, only on events that actually carry
 * a discount, is the cost of not silently losing it.
 *
 * A failed re-fetch falls back to the event payload rather than throwing: the
 * status change the event carries matters more than the promo date, and a 500
 * here would have Stripe retrying an event we could otherwise apply.
 */
async function withExpandedDiscounts(sub: Stripe.Subscription): Promise<Stripe.Subscription> {
  const hasBareIds = (sub.discounts ?? []).some((d) => typeof d === 'string');
  if (!hasBareIds) return sub;
  try {
    return await stripeClient().subscriptions.retrieve(sub.id, { expand: ['discounts'] });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'Could not expand subscription discounts; using the event payload',
    );
    return sub;
  }
}

/**
 * When the change this event describes happened, for the staleness guard.
 *
 * `created` is required by Stripe's API, so the fallback is defensive rather
 * than expected — but an invalid Date would throw on the way into the column,
 * the handler would answer 500, and Stripe would retry a malformed event
 * forever. Falling back to now means such an event applies rather than jamming,
 * which is the right way round for something that should never happen.
 */
function eventOccurredAt(event: Stripe.Event): Date {
  return typeof event.created === 'number' && Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();
}

export interface HandleResult {
  /** What was done, for the log line and the tests. */
  outcome:
    | 'applied'
    | 'stale_event'
    | 'ignored_event_type'
    | 'unknown_customer'
    | 'no_customer_on_event';
}

/**
 * Applies a verified Stripe event to the account store.
 *
 * Unrecognised event types and events for customers we have no record of are
 * acknowledged rather than treated as errors: a webhook endpoint that fails on
 * input it does not recognise earns itself an endless retry loop, and Stripe
 * sends far more event types than any integration consumes.
 *
 * Known, accepted limitation: Stripe does not guarantee event ordering, and this
 * applies last-write-wins. A delayed `updated` could briefly restore a state its
 * successor had already replaced. The corrective is that Stripe re-sends the
 * current state on every subsequent change, and the realistic failure (a stale
 * `active` landing after a `canceled`) errs toward the teacher keeping access.
 * If it ever matters, the fix is to re-fetch the subscription by id here and use
 * that instead of the event payload.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  store: AccountStore,
): Promise<HandleResult> {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    return { outcome: 'ignored_event_type' };
  }

  const sub = await withExpandedDiscounts(event.data.object as Stripe.Subscription);
  const customerId = customerIdOf(sub);
  if (!customerId) return { outcome: 'no_customer_on_event' };

  const account = await store.getByStripeCustomerId(customerId);
  if (!account) {
    // Most likely a test-mode customer from before this database, or an event
    // for a different environment sharing the endpoint.
    logger.warn({ eventType: event.type }, 'Stripe event for an unknown customer; ignoring');
    return { outcome: 'unknown_customer' };
  }

  // `event.created` rather than now(): what matters for ordering is when the
  // change happened at Stripe, not when it reached us. A retry delivered three
  // days late still carries its original timestamp and so cannot overwrite
  // something newer.
  const applied = await store.applySubscriptionState(
    customerId,
    subscriptionStateFrom(sub),
    eventOccurredAt(event),
  );
  // Acknowledged either way. A stale event is not a failure and must not be
  // retried: Stripe would redeliver it forever, and it would keep losing.
  return { outcome: applied ? 'applied' : 'stale_event' };
}

/**
 * Finds or creates this account's Stripe customer, recording the id the first
 * time. Reusing one customer per account is what keeps a teacher's payment
 * methods and invoice history together across resubscribes, and it is what the
 * webhook's customer-id lookup depends on.
 */
export async function ensureCustomer(
  store: AccountStore,
  account: { googleSub: string; email: string; name: string; stripeCustomerId: string | null },
): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await stripeClient().customers.create({
    email: account.email,
    name: account.name || undefined,
    // The reverse mapping, so a customer opened in the dashboard identifies its
    // account without a database lookup. Not read by any code path.
    metadata: { googleSub: account.googleSub },
  });
  await store.setStripeCustomerId(account.googleSub, customer.id);
  return customer.id;
}

/**
 * A Checkout Session for one of the two intervals. Card details are collected on
 * Stripe's hosted page and never reach this server or the client, which is the
 * reason for using hosted checkout rather than collecting card fields directly.
 */
export async function createCheckoutSession(
  customerId: string,
  interval: BillingInterval,
  returnTo: { success: string; cancel: string },
): Promise<string | null> {
  const session = await stripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceIdFor(interval), quantity: 1 }],
    success_url: returnTo.success,
    cancel_url: returnTo.cancel,
    // The founding-user promo (Step 6i), offered on both prices.
    //
    // It was monthly-only at first, on the reasoning that a coupon measured in
    // months against a yearly interval is confusing to explain. The coupon is
    // now twelve months rather than six, which removes that problem: twelve
    // months is one free year on either price, because an annual subscription
    // issues exactly one invoice inside the discount window and a monthly one
    // issues twelve at zero. Symmetric, and a sentence a teacher can check.
    //
    // Note that no Stripe mechanism could have enforced monthly-only anyway.
    // Promotion-code `restrictions` cover first-time-transaction and minimum
    // amount, and coupon `applies_to` is per-product while both prices sit on
    // one product. This flag was the whole enforcement, which is another reason
    // not to rest a pricing rule on it.
    //
    // The card is collected either way, which is the point of running the
    // promo through Checkout at all rather than by extending trial_ends_at:
    // the first post-promo invoice bills by default, so the default outcome is
    // a paying customer rather than a lapsed one. The seven-days-before
    // reminder (Step 6h) is what makes that honest rather than a trap.
    allow_promotion_codes: true,
  });
  return session.url;
}

/**
 * Pauses collection until `resumesAt` (Step 6i).
 *
 * `behavior: 'void'` rather than `keep_as_draft` or `mark_uncollectible`: the
 * paused months are not owed and must never be billed later. A teacher told
 * "not paying, not teaching" who returns in September to two backdated invoices
 * would be right to call that a lie.
 *
 * Nothing here writes account state. The update causes
 * `customer.subscription.updated`, and the webhook applies it — the sole-writer
 * rule holds for the pause exactly as it does for everything else, which is
 * also why the endpoint calling this cannot report the new plan back
 * synchronously.
 */
export async function pauseCollection(subscriptionId: string, resumesAt: Date): Promise<void> {
  await stripeClient().subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: 'void',
      resumes_at: Math.floor(resumesAt.getTime() / 1000),
    },
  });
}

/** The same date, `months` calendar months later (negative to go back). */
export function addMonths(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/**
 * Whether this account has a subscription there is any point acting on.
 *
 * **Not the same question as having a Stripe customer**, and conflating the two
 * is a live trap: `stripe_customer_id` is set at the first checkout and never
 * cleared, and `stripe_subscription_id` keeps its value after a subscription
 * ends, so a teacher who cancelled last term still carries both. An account
 * page that reads "has billing" as "has a subscription" therefore offers to
 * cancel something that is already gone, and Stripe refuses the request.
 *
 * **Nor is it the same question as being on the paid plan.** A `plan_override`
 * comp resolves to `paid` with no subscription behind it at all, and there is
 * nothing there to cancel or pause either.
 */
export function hasLiveSubscription(account: {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
}): boolean {
  return (
    account.stripeSubscriptionId !== null &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(account.subscriptionStatus)
  );
}

/**
 * Whether the cancellation flow should offer a pause (Step 6i).
 *
 * Everything here is answerable from the account row, which is why it can run
 * on `GET /auth/me` without a Stripe call on every page load. The one condition
 * it cannot check is the monthly-versus-annual interval, which the account does
 * not record — the endpoint reads that from Stripe and refuses. So this is
 * deliberately the weaker test of the two, and it is a presentation hint: an
 * annual subscriber may briefly be offered a pause and told no. The alternative,
 * a Stripe round-trip on every session check, is a worse trade.
 */
export function canOfferPause(
  account: {
    stripeSubscriptionId: string | null;
    subscriptionStatus: string;
    collectionPaused: boolean;
    pauseStartedAt: string | null;
    promoEndsAt: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (!hasLiveSubscription(account)) return false;
  if (account.collectionPaused) return false;
  if (promoIsActive(account, now)) return false;
  if (account.pauseStartedAt && new Date(account.pauseStartedAt) > addMonths(now, -PAUSE_COOLDOWN_MONTHS)) {
    return false;
  }
  return true;
}

/**
 * Whether a founding-user promo is still covering this subscription.
 *
 * A pause is refused while one is, and not merely because pausing a subscription
 * that bills nothing is a strange thing to offer. **Taking it would cost the
 * teacher and gain them nothing.** The discount runs for a fixed number of
 * calendar months from when it started, not for a number of invoices, so a pause
 * does not defer it: the promo keeps expiring on schedule while the paused months
 * elapse inside it. The teacher would burn two of their free months, spend the
 * once-per-twelve-months pause allowance they might genuinely want in a later
 * summer when they *are* paying, and save nothing, because zero dollars a month
 * paused is the same as zero dollars a month billed.
 *
 * The narrow case this refuses wrongly is a promo ending mid-summer, where a
 * teacher might reasonably want to pause the months just after it. They can, once
 * it ends — and promos here run twelve months from signup, so they expire when
 * teachers sign up, in late summer and early autumn, rather than in the middle of
 * a break.
 */
export function promoIsActive(
  account: { promoEndsAt: string | null },
  now: Date = new Date(),
): boolean {
  return account.promoEndsAt !== null && new Date(account.promoEndsAt).getTime() > now.getTime();
}

/** The subscription as Stripe currently has it, for the eligibility checks. */
export async function fetchSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripeClient().subscriptions.retrieve(subscriptionId);
}

/**
 * Whether a subscription is on the monthly price, which is the pause's
 * eligibility test. Read from Stripe's own line items rather than from anything
 * we mirror: the account row records a status, not which price it is paying,
 * and inferring the interval from the period length would be arithmetic on a
 * date that a pause has already moved.
 */
export function isOnInterval(sub: Stripe.Subscription, interval: BillingInterval): boolean {
  const wanted = priceIdFor(interval);
  return wanted.length > 0 && sub.items.data.some((item) => item.price?.id === wanted);
}

/**
 * A billing-portal session: cancellation, card updates, invoices, receipts.
 *
 * `cancelSubscriptionId` opens the portal **on its cancellation flow** rather
 * than on the portal's home page, via Stripe's `flow_data`. That distinction is
 * the whole difference between the two entry points the account page has: a
 * teacher who pressed "Manage billing" wants the home page, and one who pressed
 * "Continue to cancel" has already said what they came to do and should not
 * have to find the control again. Without it both buttons land in the same
 * place and the cancellation flow quietly stops being one.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
  cancelSubscriptionId?: string,
): Promise<string> {
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    ...(cancelSubscriptionId
      ? {
          flow_data: {
            type: 'subscription_cancel' as const,
            subscription_cancel: { subscription: cancelSubscriptionId },
          },
        }
      : {}),
  });
  return session.url;
}

/**
 * Ends a subscription immediately, used only by account deletion (Step 6f).
 *
 * Immediate rather than at period end, which is the opposite of what the
 * cancel button in the billing portal does, and the difference is the point: a
 * teacher cancelling wants to keep what they paid for until it runs out, while
 * a teacher deleting their account is leaving and must not be billed again.
 * There is no account left to hold the remainder of the period anyway.
 *
 * Throws rather than swallowing, unlike the Google revocation beside it in the
 * deletion path. The asymmetry is deliberate: an unrevoked Google token is
 * inert once our copy is gone, but an uncancelled subscription keeps charging a
 * card every month with no account behind it and no way for the teacher to
 * reach the portal that would stop it. That is the one failure here worth
 * refusing to proceed on.
 *
 * **A subscription that has already ended is not a failure**, and this is not a
 * rare case: `stripe_subscription_id` is never cleared, so every teacher who
 * cancelled and let the period run out keeps a `canceled` id on their row while
 * sitting on the free plan. That is the population most likely to delete, and
 * Stripe rejects cancelling an already-cancelled subscription — which would
 * have refused their deletion permanently, with a message telling them to
 * cancel a subscription they had already cancelled. So the status is read
 * first, and a terminal one means the work is done.
 */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  'canceled',
  'incomplete_expired',
]);

export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const stripe = stripeClient();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    // An id Stripe has no record of bills nobody, so there is nothing to refuse
    // the deletion over. Any other retrieve failure is an unknown state and
    // still stops it.
    if ((err as { code?: string }).code === 'resource_missing') return;
    throw err;
  }
  if (TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) return;
  await stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Checks that each configured Price still charges what the product advertises.
 *
 * This exists because a Price's amount is editable in the Stripe dashboard
 * without its id changing, so the app can end up displaying one number while
 * Stripe charges another with nothing in between to notice. Logs rather than
 * throws: a startup that refuses to boot over a pricing discrepancy takes the
 * whole app down for every teacher, including the ones not buying anything.
 */
export async function assertPricesMatch(): Promise<void> {
  for (const interval of BILLING_INTERVALS) {
    const expected = ADVERTISED_PRICES[interval];
    try {
      const price = await stripeClient().prices.retrieve(priceIdFor(interval));
      if (price.unit_amount !== expected.amount || price.currency !== expected.currency) {
        logger.error(
          {
            interval,
            advertised: `${expected.amount} ${expected.currency}`,
            stripe: `${price.unit_amount} ${price.currency}`,
          },
          'Stripe price does not match the advertised price',
        );
      }
    } catch (err) {
      logger.error(
        { interval, err: (err as Error).message },
        'Could not verify Stripe price at startup',
      );
    }
  }
}
