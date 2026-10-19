import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';
import { reconcileSubscriptions } from './subscriptionReconcile.js';
import { setStripeClient } from './billing.js';
import { createMemoryAccountStore, testAccount, type AccountStore } from './accountStore.js';
import { resolvePlan } from './plan.js';
import { env } from '../config/env.js';

/**
 * The sweep that answers "did we miss an event?".
 *
 * Both directions are covered, and the second is the one that gets forgotten:
 * an account stuck *paid* after a missed cancellation is the obvious failure,
 * but an account the app wrongly believes has no subscription is the likelier
 * one, and it is the one where a paying teacher cannot cancel or pause.
 */

const NOW_SECONDS = 1_800_000_000;

function subscription(over: { status?: string; id?: string } = {}): Stripe.Subscription {
  return {
    id: over.id ?? 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status: over.status ?? 'active',
    cancel_at_period_end: false,
    pause_collection: null,
    discounts: [],
    items: {
      object: 'list',
      data: [{ id: 'si_1', current_period_end: NOW_SECONDS, price: { id: 'price_m' } }],
    },
  } as unknown as Stripe.Subscription;
}

/** A Stripe stand-in whose subscription list is whatever the test says it is. */
function stubStripe(subs: Stripe.Subscription[], onList?: () => void) {
  return {
    subscriptions: {
      list: async () => {
        onList?.();
        return { data: subs };
      },
    },
  } as unknown as Stripe;
}

function storeWith(...accounts: Parameters<typeof testAccount>[0][]): AccountStore {
  return createMemoryAccountStore(accounts.map((a) => testAccount(a)));
}

describe('reconcileSubscriptions', () => {
  beforeEach(() => {
    env.stripe.secretKey = 'sk_test_dummy';
    env.stripe.priceMonthly = 'price_m';
    env.stripe.priceAnnual = 'price_a';
  });
  afterEach(() => {
    setStripeClient(null);
    vi.restoreAllMocks();
  });

  it('drops an account Stripe no longer considers subscribed', async () => {
    // The missed `customer.subscription.deleted`: the row still says active, so
    // the teacher keeps premium indefinitely with nothing to correct it.
    const store = storeWith({
      googleSub: 'sub-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_123',
      trialEndsAt: null,
    });
    expect(resolvePlan((await store.getByGoogleSub('sub-1'))!)).toBe('paid');

    setStripeClient(stubStripe([subscription({ status: 'canceled' })]));
    const result = await reconcileSubscriptions(store, 10);

    expect(result).toMatchObject({ checked: 1, corrected: 1, failed: 0 });
    const account = (await store.getByGoogleSub('sub-1'))!;
    expect(account.subscriptionStatus).toBe('canceled');
    expect(resolvePlan(account)).toBe('free');
  });

  it('restores an account whose subscription the app never heard about', async () => {
    // The missed `.created`, and the likelier of the two. Stripe is right, the
    // teacher is paying, and the app will not let them cancel or pause because
    // it thinks there is no subscription to act on.
    const store = storeWith({
      googleSub: 'sub-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'inactive',
      stripeSubscriptionId: null,
      trialEndsAt: null,
    });
    expect(resolvePlan((await store.getByGoogleSub('sub-1'))!)).toBe('free');

    setStripeClient(stubStripe([subscription({ status: 'active' })]));
    await reconcileSubscriptions(store, 10);

    const account = (await store.getByGoogleSub('sub-1'))!;
    expect(account.subscriptionStatus).toBe('active');
    expect(account.stripeSubscriptionId).toBe('sub_123');
    expect(resolvePlan(account)).toBe('paid');
  });

  it('leaves an account alone when Stripe agrees with it', async () => {
    const store = storeWith({
      googleSub: 'sub-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_123',
      trialEndsAt: null,
    });
    setStripeClient(stubStripe([subscription({ status: 'active' })]));
    await reconcileSubscriptions(store, 10);
    expect((await store.getByGoogleSub('sub-1'))?.subscriptionStatus).toBe('active');
  });

  /**
   * A customer with no subscriptions at all is not a cancellation. Stripe keeps
   * cancelled subscriptions listed, so an empty list means someone who never
   * subscribed — and writing a cancelled state from an absence would drop a
   * comped or trialling account that happens to hold a customer record.
   */
  it('does not cancel an account merely because Stripe lists no subscription', async () => {
    const store = storeWith({
      googleSub: 'sub-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'inactive',
      planOverride: 'paid',
      trialEndsAt: null,
    });
    setStripeClient(stubStripe([]));
    const result = await reconcileSubscriptions(store, 10);

    expect(result).toMatchObject({ checked: 1, corrected: 0 });
    const account = (await store.getByGoogleSub('sub-1'))!;
    expect(account.planOverride).toBe('paid');
    expect(resolvePlan(account)).toBe('paid');
  });

  it('never touches plan_override, which is the app\'s field and not Stripe\'s', async () => {
    const store = storeWith({
      googleSub: 'sub-1',
      stripeCustomerId: 'cus_123',
      subscriptionStatus: 'active',
      planOverride: 'free',
      trialEndsAt: null,
    });
    setStripeClient(stubStripe([subscription({ status: 'canceled' })]));
    await reconcileSubscriptions(store, 10);
    expect((await store.getByGoogleSub('sub-1'))?.planOverride).toBe('free');
  });

  it('skips accounts with no Stripe customer, which is most of them', async () => {
    const store = storeWith(
      { googleSub: 'free-1', stripeCustomerId: null },
      { googleSub: 'paid-1', stripeCustomerId: 'cus_123', trialEndsAt: null },
    );
    let calls = 0;
    setStripeClient(stubStripe([subscription()], () => (calls += 1)));
    const result = await reconcileSubscriptions(store, 10);
    expect(result.checked).toBe(1);
    expect(calls).toBe(1);
  });

  /**
   * Bounded by the batch size rather than by however many accounts exist, so
   * the Stripe calls per run are a constant. Least-recently-checked first, so
   * everything still comes round.
   */
  it('checks no more than the batch size in one run', async () => {
    const store = storeWith(
      { googleSub: 'a', stripeCustomerId: 'cus_a', trialEndsAt: null },
      { googleSub: 'b', stripeCustomerId: 'cus_b', trialEndsAt: null },
      { googleSub: 'c', stripeCustomerId: 'cus_c', trialEndsAt: null },
    );
    setStripeClient(stubStripe([subscription()]));
    const result = await reconcileSubscriptions(store, 2);
    expect(result.checked).toBe(2);
  });

  it('takes the accounts it has not checked before the ones it has', async () => {
    const store = storeWith(
      { googleSub: 'a', stripeCustomerId: 'cus_a', trialEndsAt: null },
      { googleSub: 'b', stripeCustomerId: 'cus_b', trialEndsAt: null },
    );
    setStripeClient(stubStripe([subscription()]));

    await reconcileSubscriptions(store, 1);
    const first = (await store.getByGoogleSub('a'))!.subscriptionCheckedAt;
    expect(first).not.toBeNull();
    expect((await store.getByGoogleSub('b'))!.subscriptionCheckedAt).toBeNull();

    // The second run takes the one that has never been looked at.
    await reconcileSubscriptions(store, 1);
    expect((await store.getByGoogleSub('b'))!.subscriptionCheckedAt).not.toBeNull();
  });

  /**
   * One account's failure must not end the batch. They are ordered oldest-first,
   * so everything behind a persistently failing account is exactly what most
   * needs checking.
   */
  it('carries on past an account whose Stripe lookup fails', async () => {
    const store = storeWith(
      { googleSub: 'a', stripeCustomerId: 'cus_a', trialEndsAt: null },
      { googleSub: 'b', stripeCustomerId: 'cus_b', trialEndsAt: null },
    );
    let call = 0;
    setStripeClient({
      subscriptions: {
        list: async () => {
          call += 1;
          if (call === 1) throw new Error('No such customer');
          return { data: [subscription({ status: 'canceled' })] };
        },
      },
    } as unknown as Stripe);

    const result = await reconcileSubscriptions(store, 10);
    expect(result.failed).toBe(1);
    expect(result.checked).toBe(1);
    expect((await store.getByGoogleSub('b'))?.subscriptionStatus).toBe('canceled');
  });

  it('does nothing at all when billing is not configured', async () => {
    const store = storeWith({ googleSub: 'a', stripeCustomerId: 'cus_a', trialEndsAt: null });
    env.stripe.secretKey = '';
    let calls = 0;
    setStripeClient(stubStripe([subscription()], () => (calls += 1)));
    const result = await reconcileSubscriptions(store, 10);
    expect(result).toEqual({ checked: 0, corrected: 0, failed: 0 });
    expect(calls).toBe(0);
  });
});
