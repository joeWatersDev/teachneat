import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { canOfferPause, handleStripeEvent, subscriptionStateFrom } from './billing.js';
import {
  createMemoryAccountStore,
  testAccount,
  type AccountStore,
} from './accountStore.js';
import { resolvePlan } from './plan.js';
import { env } from '../config/env.js';

/**
 * A Stripe subscription, shaped only as far as the code reads it. Written by
 * hand rather than with the SDK's types in full, because the point is to pin the
 * *shape we depend on* — particularly that `current_period_end` lives on the
 * item and not on the subscription.
 */
function subscription(over: {
  status?: string;
  customer?: string;
  id?: string;
  cancelAtPeriodEnd?: boolean;
  periodEnds?: number[];
  pauseResumesAt?: number | null;
  paused?: boolean;
  discountEnds?: (number | null)[];
  priceIds?: string[];
}): Stripe.Subscription {
  const periodEnds = over.periodEnds ?? [1_800_000_000];
  const paused = over.paused ?? over.pauseResumesAt !== undefined;
  return {
    id: over.id ?? 'sub_123',
    object: 'subscription',
    customer: over.customer ?? 'cus_123',
    status: over.status ?? 'active',
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    pause_collection: paused
      ? { behavior: 'void', resumes_at: over.pauseResumesAt ?? null }
      : null,
    discounts: (over.discountEnds ?? []).map((end, i) => ({
      id: `di_${i}`,
      object: 'discount',
      end,
    })),
    items: {
      object: 'list',
      data: periodEnds.map((current_period_end, i) => ({
        id: `si_${i}`,
        current_period_end,
        price: { id: over.priceIds?.[i] ?? 'price_monthly' },
      })),
    },
  } as unknown as Stripe.Subscription;
}

/**
 * `created` is required, not incidental. It is what the staleness guard orders
 * on, so an event without it would be applied against an invalid timestamp and
 * the ordering these tests rely on would be meaningless. Seconds, as Stripe
 * sends them.
 */
function event(type: string, object: unknown, createdAtSeconds = 1_800_000_000): Stripe.Event {
  return {
    id: 'evt_1',
    type,
    created: createdAtSeconds,
    data: { object },
  } as unknown as Stripe.Event;
}

/** A store holding one account already linked to a Stripe customer. */
function storeWithCustomer(customerId = 'cus_123'): AccountStore {
  return createMemoryAccountStore([
    testAccount({ googleSub: 'sub-1', stripeCustomerId: customerId, trialEndsAt: null }),
  ]);
}

describe('subscriptionStateFrom', () => {
  // The field moved from the subscription to its items in recent API versions.
  // Reading the old location yields undefined rather than throwing, so this is
  // the assertion that would catch a regression to the old shape.
  it('reads current_period_end from the subscription items', () => {
    const state = subscriptionStateFrom(subscription({ periodEnds: [1_700_000_000] }));
    expect(state.currentPeriodEnd).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('takes the latest period end when there are several items', () => {
    const state = subscriptionStateFrom(subscription({ periodEnds: [1_700_000_000, 1_900_000_000] }));
    expect(state.currentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });

  it('survives a subscription with no items rather than producing an invalid date', () => {
    const state = subscriptionStateFrom(subscription({ periodEnds: [] }));
    expect(state.currentPeriodEnd).toBeNull();
  });

  /**
   * The interval the promo reminder names a price from. Derived from the price
   * id rather than stored at checkout, so it stays correct if a subscription's
   * price is ever changed in the Stripe dashboard.
   */
  describe('subscription interval', () => {
    const saved = { ...env.stripe };
    beforeEach(() => {
      env.stripe.priceMonthly = 'price_m';
      env.stripe.priceAnnual = 'price_a';
    });
    afterEach(() => {
      Object.assign(env.stripe, saved);
    });

    it('recognises each of the two configured prices', () => {
      expect(subscriptionStateFrom(subscription({ priceIds: ['price_m'] })).subscriptionInterval)
        .toBe('monthly');
      expect(subscriptionStateFrom(subscription({ priceIds: ['price_a'] })).subscriptionInterval)
        .toBe('annual');
    });

    /**
     * Null rather than a default, because the reminder names a figure: a
     * subscription on a price this deployment has never heard of gets no figure
     * instead of the monthly one, which would be a wrong number in an email
     * nobody can correct after it is sent.
     */
    it('reports an unrecognised price as an unknown interval', () => {
      expect(subscriptionStateFrom(subscription({ priceIds: ['price_other'] })).subscriptionInterval)
        .toBeNull();
    });

    /**
     * The empty-string trap: priceIdFor returns '' when billing is unconfigured,
     * so a naive comparison would match an item carrying no price at all and
     * report every subscription as monthly on a fresh clone.
     */
    it('does not read a missing price as the unconfigured monthly id', () => {
      env.stripe.priceMonthly = '';
      env.stripe.priceAnnual = '';
      expect(subscriptionStateFrom(subscription({ priceIds: [''] })).subscriptionInterval).toBeNull();
    });

    it('survives a subscription with no items', () => {
      expect(subscriptionStateFrom(subscription({ periodEnds: [] })).subscriptionInterval).toBeNull();
    });
  });

  it('carries status and the cancel-at-period-end flag through unchanged', () => {
    const state = subscriptionStateFrom(
      subscription({ status: 'past_due', cancelAtPeriodEnd: true }),
    );
    expect(state.subscriptionStatus).toBe('past_due');
    expect(state.cancelAtPeriodEnd).toBe(true);
  });

  // Step 6i. The pause is the presence of the object, not a date: Stripe allows
  // an indefinite pause with no resumes_at, and reading the date alone would
  // treat that as not paused at all.
  it('reads a pause with no resume date as paused', () => {
    const state = subscriptionStateFrom(subscription({ paused: true, pauseResumesAt: null }));
    expect(state.collectionPaused).toBe(true);
    expect(state.pauseResumesAt).toBeNull();
  });

  it('carries the resume date when the pause has one', () => {
    const state = subscriptionStateFrom(subscription({ pauseResumesAt: 1_750_000_000 }));
    expect(state.collectionPaused).toBe(true);
    expect(state.pauseResumesAt).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });

  it('reports a subscription with no pause_collection as not paused', () => {
    expect(subscriptionStateFrom(subscription({})).collectionPaused).toBe(false);
  });

  it('reads the promo end from the discounts list', () => {
    const state = subscriptionStateFrom(subscription({ discountEnds: [1_760_000_000] }));
    expect(state.promoEndsAt).toBe(new Date(1_760_000_000 * 1000).toISOString());
  });

  // A discount that never ends has no first charge to warn about.
  it('reports no promo end for a forever discount', () => {
    expect(subscriptionStateFrom(subscription({ discountEnds: [null] })).promoEndsAt).toBeNull();
  });

  it('takes the latest end when discounts are stacked', () => {
    const state = subscriptionStateFrom(
      subscription({ discountEnds: [1_760_000_000, 1_780_000_000] }),
    );
    expect(state.promoEndsAt).toBe(new Date(1_780_000_000 * 1000).toISOString());
  });
});

describe('handleStripeEvent', () => {
  let store: AccountStore;
  beforeEach(() => {
    store = storeWithCustomer();
  });

  it('moves an account to paid when a subscription becomes active', async () => {
    const result = await handleStripeEvent(
      event('customer.subscription.created', subscription({ status: 'active' })),
      store,
    );
    expect(result.outcome).toBe('applied');

    const account = await store.getByGoogleSub('sub-1');
    expect(account?.subscriptionStatus).toBe('active');
    expect(resolvePlan(account!)).toBe('paid');
  });

  // Cancellation is not a lockout and not immediate: Stripe keeps the
  // subscription active with cancel_at_period_end set, and only fires `deleted`
  // when the paid-for period actually runs out. That is why no scheduled job is
  // needed on our side.
  it('keeps access while a cancelled subscription runs out its paid period', async () => {
    await handleStripeEvent(
      event(
        'customer.subscription.updated',
        subscription({ status: 'active', cancelAtPeriodEnd: true }),
      ),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.cancelAtPeriodEnd).toBe(true);
    expect(resolvePlan(account!)).toBe('paid');
  });

  it('drops to free when the period ends and the subscription is deleted', async () => {
    await handleStripeEvent(
      event('customer.subscription.deleted', subscription({ status: 'canceled' })),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(resolvePlan(account!)).toBe('free');
    // Nothing is destroyed by a downgrade: the sheet mapping is untouched.
    expect(account?.spreadsheetId).toBe('sheet-1');
  });

  // A card expiring mid-semester should not lock a teacher out during a lesson.
  it('keeps access on past_due', async () => {
    await handleStripeEvent(
      event('customer.subscription.updated', subscription({ status: 'past_due' })),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(resolvePlan(account!)).toBe('paid');
  });

  it('ignores event types it does not consume', async () => {
    const result = await handleStripeEvent(
      event('invoice.payment_succeeded', { id: 'in_1' }),
      store,
    );
    expect(result.outcome).toBe('ignored_event_type');
  });

  // A webhook endpoint that errors on unrecognised input earns an endless retry
  // loop, so an unknown customer is acknowledged rather than failed.
  it('acknowledges an event for a customer it has no record of', async () => {
    const result = await handleStripeEvent(
      event('customer.subscription.created', subscription({ customer: 'cus_unknown' })),
      store,
    );
    expect(result.outcome).toBe('unknown_customer');
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.subscriptionStatus).toBe('inactive');
  });

  it('handles an expanded customer object as well as a bare id', async () => {
    const sub = subscription({});
    (sub as unknown as { customer: unknown }).customer = { id: 'cus_123', object: 'customer' };
    const result = await handleStripeEvent(event('customer.subscription.updated', sub), store);
    expect(result.outcome).toBe('applied');
  });

  // The webhook is the sole writer of billing state. plan_override belongs to
  // the dev toggle and to support comps, and must survive a billing event.
  it('never touches plan_override', async () => {
    await store.setPlanOverride('sub-1', 'free');
    await handleStripeEvent(
      event('customer.subscription.created', subscription({ status: 'active' })),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.planOverride).toBe('free');
    // The override still wins, which is what makes a comp account a comp account.
    expect(resolvePlan(account!)).toBe('free');
  });

  // Step 6i, and the whole reason resolvePlan needed changing: Stripe holds a
  // paused subscription at `active`, so a status-only read would keep granting
  // Premium to an account that has stopped paying.
  it('drops a paused subscription to free even though Stripe still calls it active', async () => {
    await handleStripeEvent(
      event(
        'customer.subscription.updated',
        subscription({ status: 'active', pauseResumesAt: 1_750_000_000 }),
      ),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.subscriptionStatus).toBe('active');
    expect(account?.collectionPaused).toBe(true);
    expect(resolvePlan(account!)).toBe('free');
  });

  it('restores premium when the pause is lifted', async () => {
    await handleStripeEvent(
      event('customer.subscription.updated', subscription({ pauseResumesAt: 1_750_000_000 })),
      store,
    );
    // A resume arrives as pause_collection going null on the same event type,
    // which is why the flag is written on every event rather than only when set.
    await handleStripeEvent(
      event('customer.subscription.updated', subscription({ status: 'active' })),
      store,
    );
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.collectionPaused).toBe(false);
    expect(account?.pauseResumesAt).toBeNull();
    expect(resolvePlan(account!)).toBe('paid');
  });

  // A pause is a billing state, not a comp. If it ever wrote plan_override the
  // two writers would disagree and the override would outlive the pause.
  it('never writes plan_override when pausing', async () => {
    await handleStripeEvent(
      event('customer.subscription.updated', subscription({ pauseResumesAt: 1_750_000_000 })),
      store,
    );
    expect((await store.getByGoogleSub('sub-1'))?.planOverride).toBeNull();
  });

  // pause_started_at is ours and records that a pause was taken. The webhook
  // must not touch it, or the once-a-year rule would reset the moment Stripe
  // reported the pause ending.
  it('leaves pause_started_at alone', async () => {
    await store.markPauseStarted('sub-1', '2026-06-01T00:00:00.000Z');
    await handleStripeEvent(
      event('customer.subscription.updated', subscription({ status: 'active' })),
      store,
    );
    expect((await store.getByGoogleSub('sub-1'))?.pauseStartedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

/**
 * The presentation hint behind the cancellation dialog's pause offer. Weaker than
 * the endpoint by design — it cannot see the billing interval, which only Stripe
 * knows — so it exists to stop the dialog offering something that would be
 * refused, not to be the authority.
 */
describe('canOfferPause', () => {
  const live = { stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' };
  const base = { ...live, collectionPaused: false, pauseStartedAt: null, promoEndsAt: null };

  it('offers a pause to a live, unpaused subscription with no promo', () => {
    expect(canOfferPause(base)).toBe(true);
  });

  /**
   * A promo-covered subscription bills nothing, so pausing it saves nothing —
   * while still spending two of the free months and the once-a-year allowance,
   * because the discount runs on calendar months rather than on invoices.
   */
  it('withholds it while a promo is still running', () => {
    const promo = new Date(Date.now() + 200 * 86_400_000).toISOString();
    expect(canOfferPause({ ...base, promoEndsAt: promo })).toBe(false);
  });

  it('offers it again once the promo has ended', () => {
    const promo = new Date(Date.now() - 86_400_000).toISOString();
    expect(canOfferPause({ ...base, promoEndsAt: promo })).toBe(true);
  });

  it('withholds it from an account with no live subscription', () => {
    expect(canOfferPause({ ...base, subscriptionStatus: 'canceled' })).toBe(false);
    expect(canOfferPause({ ...base, stripeSubscriptionId: null })).toBe(false);
  });

  it('withholds it from an already paused subscription', () => {
    expect(canOfferPause({ ...base, collectionPaused: true })).toBe(false);
  });
});

/**
 * Stripe does not guarantee event ordering, and retries for about three days,
 * so an older event can arrive after a newer one. Applying it unconditionally
 * was how a cancelled account could be put back to active and left paid with
 * nothing to correct it.
 */
describe('handleStripeEvent: out-of-order delivery', () => {
  const EARLY = 1_800_000_000;
  const LATE = EARLY + 3600;

  it('ignores an update that describes an older moment than the row already holds', async () => {
    const store = storeWithCustomer();

    await handleStripeEvent(
      event('customer.subscription.deleted', subscription({ status: 'canceled' }), LATE),
      store,
    );
    expect((await store.getByGoogleSub('sub-1'))?.subscriptionStatus).toBe('canceled');

    // The `updated` that preceded the cancellation, redelivered after it.
    const result = await handleStripeEvent(
      event('customer.subscription.updated', subscription({ status: 'active' }), EARLY),
      store,
    );

    expect(result.outcome).toBe('stale_event');
    const account = await store.getByGoogleSub('sub-1');
    expect(account?.subscriptionStatus).toBe('canceled');
    expect(resolvePlan(account!)).toBe('free');
  });

  it('applies events that arrive in order', async () => {
    const store = storeWithCustomer();
    await handleStripeEvent(
      event('customer.subscription.created', subscription({ status: 'active' }), EARLY),
      store,
    );
    const result = await handleStripeEvent(
      event('customer.subscription.deleted', subscription({ status: 'canceled' }), LATE),
      store,
    );
    expect(result.outcome).toBe('applied');
    expect((await store.getByGoogleSub('sub-1'))?.subscriptionStatus).toBe('canceled');
  });

  /**
   * Stripe timestamps are whole seconds and several changes can share one.
   * Refusing an equal timestamp would drop real updates, and within one second
   * either order is defensible.
   */
  it('applies an event bearing the same timestamp as the stored one', async () => {
    const store = storeWithCustomer();
    await handleStripeEvent(
      event('customer.subscription.created', subscription({ status: 'active' }), EARLY),
      store,
    );
    const result = await handleStripeEvent(
      event('customer.subscription.updated', subscription({ status: 'past_due' }), EARLY),
      store,
    );
    expect(result.outcome).toBe('applied');
    expect((await store.getByGoogleSub('sub-1'))?.subscriptionStatus).toBe('past_due');
  });

  /**
   * A stale event is acknowledged, not failed. Answering 500 would have Stripe
   * redeliver it on a schedule, and it would lose the comparison every time.
   */
  it('does not ask Stripe to retry a stale event', async () => {
    const store = storeWithCustomer();
    await handleStripeEvent(
      event('customer.subscription.deleted', subscription({ status: 'canceled' }), LATE),
      store,
    );
    await expect(
      handleStripeEvent(
        event('customer.subscription.updated', subscription({ status: 'active' }), EARLY),
        store,
      ),
    ).resolves.toMatchObject({ outcome: 'stale_event' });
  });
});
