import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { buildBillingRouter, buildStripeWebhookRouter } from './billing.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { requireCsrf, CSRF_HEADER } from '../middleware/csrf.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import {
  createMemoryAccountStore,
  testAccount,
  type AccountStore,
} from '../services/accountStore.js';
import { createCheckoutSession, setStripeClient } from '../services/billing.js';
import { createMemoryLifecycleEmailStore } from '../services/lifecycleEmail.js';
import { env } from '../config/env.js';

const SUB = 'user-1';
const WEBHOOK_SECRET = 'whsec_test_secret';
const MONTHLY_PRICE = 'price_monthly_test';
const ANNUAL_PRICE = 'price_annual_test';

/**
 * A real Stripe signature header for a body. Uses the SDK's own generator so the
 * test exercises genuine verification rather than a reimplementation of it — the
 * point is to prove a forged request is rejected, which is worthless if the
 * signature is checked by test code we also wrote.
 */
function signedHeader(payload: string, secret = WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

function subscriptionEvent(status = 'active', customer = 'cus_123') {
  return {
    id: 'evt_1',
    type: 'customer.subscription.created',
    // Required: the handler dates the write from it, so an event without one
    // would be applied against an invalid timestamp.
    created: 1_799_000_000,
    data: {
      object: {
        id: 'sub_1',
        object: 'subscription',
        customer,
        status,
        cancel_at_period_end: false,
        items: { object: 'list', data: [{ id: 'si_1', current_period_end: 1_800_000_000 }] },
      },
    },
  };
}

/**
 * The webhook mounted the way index.ts mounts it: ahead of express.json(), so
 * the handler receives raw bytes. Mounting it after the JSON parser is the
 * classic way this integration breaks, and the test below pins the ordering.
 */
function webhookApp(store: AccountStore, jsonFirst = false) {
  const app = express();
  if (jsonFirst) app.use(express.json());
  app.use('/api/billing/webhook', buildStripeWebhookRouter(store));
  if (!jsonFirst) app.use(express.json());
  app.use(errorHandler);
  return app;
}

async function gatedApp(store: AccountStore) {
  const sessions = createMemorySessionStore();
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  app.use('/api/billing', [requireSession(sessions), requireCsrf], buildBillingRouter(store));
  app.use(errorHandler);
  return {
    app,
    cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
    csrfToken: created.csrfToken,
  };
}

describe('Stripe webhook', () => {
  let store: AccountStore;

  beforeEach(() => {
    store = createMemoryAccountStore([
      testAccount({ googleSub: SUB, stripeCustomerId: 'cus_123', trialEndsAt: null }),
    ]);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    env.stripe.webhookSecret = WEBHOOK_SECRET;
    setStripeClient(new Stripe('sk_test_dummy'));
  });

  afterEach(() => {
    setStripeClient(null);
    vi.unstubAllEnvs();
  });

  it('accepts a correctly signed event and applies it', async () => {
    const payload = JSON.stringify(subscriptionEvent());
    const res = await request(webhookApp(store))
      .post('/api/billing/webhook')
      .set('stripe-signature', signedHeader(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    const account = await store.getByGoogleSub(SUB);
    expect(account?.subscriptionStatus).toBe('active');
  });

  // The endpoint is publicly reachable. Without verification anyone could
  // declare their own account paid, so this is the security boundary of the
  // whole billing integration.
  it('rejects a request with no signature', async () => {
    const payload = JSON.stringify(subscriptionEvent());
    const res = await request(webhookApp(store))
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    const account = await store.getByGoogleSub(SUB);
    expect(account?.subscriptionStatus).toBe('inactive');
  });

  it('rejects a request signed with the wrong secret', async () => {
    const payload = JSON.stringify(subscriptionEvent());
    const res = await request(webhookApp(store))
      .post('/api/billing/webhook')
      .set('stripe-signature', signedHeader(payload, 'whsec_not_the_secret'))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    const account = await store.getByGoogleSub(SUB);
    expect(account?.subscriptionStatus).toBe('inactive');
  });

  // A valid signature over a *different* body must not carry: this is what
  // stops an attacker replaying a captured signature with altered contents.
  it('rejects a body that does not match its signature', async () => {
    const signature = signedHeader(JSON.stringify(subscriptionEvent('active')));
    const tampered = JSON.stringify(subscriptionEvent('active', 'cus_attacker'));
    const res = await request(webhookApp(store))
      .post('/api/billing/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(tampered);

    expect(res.status).toBe(400);
  });

  /**
   * The ordering constraint, asserted rather than trusted to a comment. With
   * express.json() ahead of the route the body arrives parsed and re-serialized,
   * the byte-for-byte hash no longer matches, and every real Stripe event would
   * be rejected — a failure that only shows up against live Stripe, which is the
   * worst possible time to find it.
   */
  it('fails verification when mounted after express.json(), which is why it is not', async () => {
    const payload = JSON.stringify(subscriptionEvent());
    const res = await request(webhookApp(store, true))
      .post('/api/billing/webhook')
      .set('stripe-signature', signedHeader(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
  });

  it('acknowledges an event for an unknown customer instead of erroring', async () => {
    const payload = JSON.stringify(subscriptionEvent('active', 'cus_nobody'));
    const res = await request(webhookApp(store))
      .post('/api/billing/webhook')
      .set('stripe-signature', signedHeader(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
  });
});

describe('billing endpoints', () => {
  let store: AccountStore;
  let savedKey: string;

  // Blanked deliberately: these two cases must answer from the request and the
  // account, not from whether the developer running the suite happens to have a
  // configured .env. An earlier ordering passed only because one was present.
  beforeEach(() => {
    store = createMemoryAccountStore([testAccount({ googleSub: SUB, stripeCustomerId: null })]);
    savedKey = env.stripe.secretKey;
    env.stripe.secretKey = '';
  });

  afterEach(() => {
    env.stripe.secretKey = savedKey;
  });

  it('requires a session', async () => {
    const app = express();
    app.use(express.json());
    const sessions = createMemorySessionStore();
    app.use('/api/billing', [requireSession(sessions), requireCsrf], buildBillingRouter(store));
    app.use(errorHandler);

    const res = await request(app).post('/api/billing/checkout').send({ interval: 'annual' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown interval rather than defaulting to one', async () => {
    const { app, cookie, csrfToken } = await gatedApp(store);
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ interval: 'weekly' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // Nothing to manage before a first checkout, and the portal call would fail
  // at Stripe anyway. Answering here keeps a confusing upstream error away.
  it('answers NOT_FOUND for the portal when the account has no Stripe customer', async () => {
    const { app, cookie, csrfToken } = await gatedApp(store);
    const res = await request(app)
      .post('/api/billing/portal')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({});

    expect(res.status).toBe(404);
  });
});

/**
 * The summer pause (Step 6i).
 *
 * Every bound here is asserted against the endpoint rather than the dialog,
 * because the endpoint is what a teacher can reach directly and a pause with no
 * ceiling is a free subscription.
 */
describe('POST /billing/pause', () => {
  let store: AccountStore;
  let emails: ReturnType<typeof createMemoryLifecycleEmailStore>;
  let updates: { id: string; params: Stripe.SubscriptionUpdateParams }[];
  const saved = { ...env.stripe };

  /** A subscription on the given price, as `fetchSubscription` reads it. */
  function stubStripe(priceId = MONTHLY_PRICE) {
    updates = [];
    setStripeClient({
      subscriptions: {
        retrieve: async (id: string) => ({
          id,
          items: { data: [{ id: 'si_1', price: { id: priceId } }] },
        }),
        update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
          updates.push({ id, params });
          return { id };
        },
      },
    } as unknown as Stripe);
  }

  async function pauseApp(account = testAccount({ googleSub: SUB, stripeSubscriptionId: 'sub_1' })) {
    store = createMemoryAccountStore([account]);
    emails = createMemoryLifecycleEmailStore();
    const sessions = createMemorySessionStore();
    const created = await sessions.create(SUB);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/billing',
      [requireSession(sessions), requireCsrf],
      buildBillingRouter(store, emails),
    );
    app.use(errorHandler);
    return {
      app,
      cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
      csrfToken: created.csrfToken,
    };
  }

  function pause(
    ctx: { app: express.Express; cookie: string; csrfToken: string },
    body: Record<string, unknown> = {},
  ) {
    return request(ctx.app)
      .post('/api/billing/pause')
      .set('Cookie', ctx.cookie)
      .set(CSRF_HEADER, ctx.csrfToken)
      .send(body);
  }

  beforeEach(() => {
    env.stripe.secretKey = 'sk_test_dummy';
    env.stripe.priceMonthly = MONTHLY_PRICE;
    env.stripe.priceAnnual = ANNUAL_PRICE;
    stubStripe();
  });

  afterEach(() => {
    Object.assign(env.stripe, saved);
    setStripeClient(null);
  });

  it('pauses for two months by default', async () => {
    const ctx = await pauseApp();
    const res = await pause(ctx);

    expect(res.status).toBe(200);
    expect(res.body.months).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].params.pause_collection).toMatchObject({ behavior: 'void' });
    // Voided rather than deferred: the paused months are not owed, and a
    // teacher told "not paying" must not return to backdated invoices.
    const resumesAt = new Date(res.body.resumesAt);
    const expected = new Date();
    expected.setUTCMonth(expected.getUTCMonth() + 2);
    expect(Math.abs(resumesAt.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  it('accepts one to three months and refuses anything outside that', async () => {
    const ctx = await pauseApp();
    expect((await pause(ctx, { months: 1 })).status).toBe(200);
    expect((await pause(ctx, { months: 4 })).status).toBe(400);
    expect((await pause(ctx, { months: 0 })).status).toBe(400);
  });

  /**
   * The refusal protects the teacher rather than tidying the dialog. The discount
   * expires on calendar months rather than on invoices, so a pause does not defer
   * it: they would spend two of their free months and the once-a-year pause
   * allowance they might want in a later summer, to stop being charged an amount
   * that is already zero.
   */
  it('refuses a pause while a promo still covers the subscription', async () => {
    const ctx = await pauseApp(
      testAccount({
        googleSub: SUB,
        stripeSubscriptionId: 'sub_1',
        promoEndsAt: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      }),
    );
    const res = await pause(ctx);
    expect(res.status).toBe(409);
    // The date is named, so the answer is actionable rather than a flat no.
    expect(res.body.message).toMatch(/already free until/i);
    expect(updates).toHaveLength(0);
  });

  it('allows a pause once the promo has ended', async () => {
    const ctx = await pauseApp(
      testAccount({
        googleSub: SUB,
        stripeSubscriptionId: 'sub_1',
        promoEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    );
    expect((await pause(ctx)).status).toBe(200);
  });

  it('refuses a second pause within twelve months', async () => {
    const recent = new Date();
    recent.setUTCMonth(recent.getUTCMonth() - 3);
    const ctx = await pauseApp(
      testAccount({
        googleSub: SUB,
        stripeSubscriptionId: 'sub_1',
        pauseStartedAt: recent.toISOString(),
      }),
    );
    const res = await pause(ctx);
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('allows a pause again once twelve months have passed', async () => {
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    const ctx = await pauseApp(
      testAccount({
        googleSub: SUB,
        stripeSubscriptionId: 'sub_1',
        pauseStartedAt: old.toISOString(),
      }),
    );
    expect((await pause(ctx)).status).toBe(200);
  });

  // An annual renewal in September already falls outside the summer, which is
  // that plan's whole advantage.
  it('refuses an annual subscription', async () => {
    stubStripe(ANNUAL_PRICE);
    const ctx = await pauseApp();
    const res = await pause(ctx);
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('refuses a subscription that is already paused', async () => {
    const ctx = await pauseApp(
      testAccount({ googleSub: SUB, stripeSubscriptionId: 'sub_1', collectionPaused: true }),
    );
    expect((await pause(ctx)).status).toBe(409);
  });

  it('answers NOT_FOUND when there is no subscription to pause', async () => {
    const ctx = await pauseApp(testAccount({ googleSub: SUB, stripeSubscriptionId: null }));
    expect((await pause(ctx)).status).toBe(404);
  });

  // The route records the pause for the cooldown rule, and writes nothing else:
  // the webhook remains the sole writer of subscription state, so the account
  // is not paused here even though Stripe has been told to pause it.
  it('records the pause start without writing subscription state or an override', async () => {
    const ctx = await pauseApp();
    await pause(ctx);
    const account = await store.getByGoogleSub(SUB);
    expect(account?.pauseStartedAt).not.toBeNull();
    expect(account?.collectionPaused).toBe(false);
    expect(account?.planOverride).toBeNull();
  });

  // The reminder row is unique per (account, type) for the life of the account,
  // so a pause taken a year after the last one would be silently skipped by the
  // row left behind. Clearing it is what lets the scan queue a fresh one.
  it('clears a previous pause reminder so the next one can be queued', async () => {
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    const ctx = await pauseApp(
      testAccount({
        googleSub: SUB,
        stripeSubscriptionId: 'sub_1',
        pauseStartedAt: old.toISOString(),
      }),
    );
    const account = await store.getByGoogleSub(SUB);
    await emails.enqueue({
      accountId: account!.id,
      messageType: 'pause_resuming',
      recipientEmail: 'teacher@example.com',
      recipientName: 'Test Teacher',
    });
    await pause(ctx);
    expect(emails.all()).toHaveLength(0);
  });
});

/**
 * The portal's cancel deep link (Step 6i follow-up).
 *
 * `stripe_subscription_id` is never cleared, so every account that has ever
 * cancelled still carries one. Handing a terminated subscription to Stripe's
 * `flow_data` makes it reject the whole request, and the teacher sees "Billing
 * could not be opened" on a portal that would have opened perfectly.
 */
describe('POST /billing/portal cancel flow', () => {
  const saved = { ...env.stripe };
  let created: Stripe.BillingPortal.SessionCreateParams[];

  function portalApp(account: ReturnType<typeof testAccount>) {
    return gatedApp(createMemoryAccountStore([account]));
  }

  beforeEach(() => {
    created = [];
    env.stripe.secretKey = 'sk_test_dummy';
    env.stripe.priceMonthly = MONTHLY_PRICE;
    env.stripe.priceAnnual = ANNUAL_PRICE;
    setStripeClient({
      billingPortal: {
        sessions: {
          create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
            created.push(params);
            return { url: 'https://portal.test/session' };
          },
        },
      },
    } as unknown as Stripe);
  });

  afterEach(() => {
    Object.assign(env.stripe, saved);
    setStripeClient(null);
  });

  function post(ctx: Awaited<ReturnType<typeof gatedApp>>, body: Record<string, unknown>) {
    return request(ctx.app)
      .post('/api/billing/portal')
      .set('Cookie', ctx.cookie)
      .set(CSRF_HEADER, ctx.csrfToken)
      .send(body);
  }

  const live = () =>
    testAccount({
      googleSub: SUB,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });

  it('deep-links into the cancellation flow for a live subscription', async () => {
    const res = await post(await portalApp(live()), { flow: 'cancel' });
    expect(res.status).toBe(200);
    expect(created[0].flow_data).toMatchObject({
      type: 'subscription_cancel',
      subscription_cancel: { subscription: 'sub_1' },
    });
  });

  it('opens the portal home when no flow is asked for', async () => {
    await post(await portalApp(live()), {});
    expect(created[0].flow_data).toBeUndefined();
  });

  // The regression. A canceled subscription id is the ordinary state of every
  // account that has ever cancelled, not an edge case.
  it('falls back to the portal home rather than failing on an ended subscription', async () => {
    const ended = testAccount({
      googleSub: SUB,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_old',
      subscriptionStatus: 'canceled',
    });
    const res = await post(await portalApp(ended), { flow: 'cancel' });
    expect(res.status).toBe(200);
    expect(created[0].flow_data).toBeUndefined();
  });

  it('rejects an unrecognised flow rather than ignoring it', async () => {
    const res = await post(await portalApp(live()), { flow: 'refund' });
    expect(res.status).toBe(400);
  });
});

/**
 * The founding-user promo's one code-level rule: the promotion-code field is
 * offered on the monthly price and not on the annual one, so an annual checkout
 * never presents a box that would then refuse what was typed into it.
 */
describe('createCheckoutSession promotion codes', () => {
  const saved = { ...env.stripe };
  let created: Stripe.Checkout.SessionCreateParams[];

  beforeEach(() => {
    created = [];
    env.stripe.priceMonthly = MONTHLY_PRICE;
    env.stripe.priceAnnual = ANNUAL_PRICE;
    setStripeClient({
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            created.push(params);
            return { url: 'https://checkout.example/session' };
          },
        },
      },
    } as unknown as Stripe);
  });

  afterEach(() => {
    Object.assign(env.stripe, saved);
    setStripeClient(null);
  });

  const urls = { success: 'https://app.example/ok', cancel: 'https://app.example/no' };

  it('allows promotion codes on the monthly price', async () => {
    await createCheckoutSession('cus_1', 'monthly', urls);
    expect(created[0].allow_promotion_codes).toBe(true);
  });

  // Offered on the annual price too, since the coupon became twelve months and
  // twelve months is one free year on either price. The earlier rule was
  // monthly-only, and this flag was its only enforcement: no Stripe mechanism
  // can restrict a promotion code to one price, because `restrictions` covers
  // only first-time-transaction and minimum amount while coupon `applies_to` is
  // per-product and both prices sit on one product.
  it('offers them on the annual price as well', async () => {
    await createCheckoutSession('cus_1', 'annual', urls);
    expect(created[0].allow_promotion_codes).toBe(true);
  });

  // The card is collected either way. That is the point of running the promo
  // through Checkout rather than by extending the trial: month seven bills by
  // default, so the default outcome is a paying customer.
  it('creates a subscription-mode session in both cases', async () => {
    await createCheckoutSession('cus_1', 'monthly', urls);
    await createCheckoutSession('cus_1', 'annual', urls);
    expect(created.map((p) => p.mode)).toEqual(['subscription', 'subscription']);
  });
});
