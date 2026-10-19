import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildInternalRouter } from './internal.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { requireCsrf, CSRF_HEADER } from '../middleware/csrf.js';
import { createMemorySessionStore, type SessionStore } from '../services/sessionStore.js';
import {
  createMemoryAccountStore,
  testAccount,
  type AccountStore,
} from '../services/accountStore.js';
import { env } from '../config/env.js';
import { recordApiCall, resetMetrics } from '../services/apiMetrics.js';
import { withBillingEnabled } from '../test/billing.js';

function buildApp(sessions: SessionStore, accounts?: AccountStore) {
  const app = express();
  app.use(
    '/api/internal',
    [requireSession(sessions), requireCsrf],
    buildInternalRouter(accounts ?? createMemoryAccountStore()),
  );
  app.use(errorHandler);
  return app;
}

function sessionCookie(sessionId: string): string {
  return `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(sessionId))}`;
}

// The operator allowlist is read through `env`, which is frozen at import time,
// so tests mutate the array in place rather than re-importing the module.
const operators = env.supportAdminGoogleSubs as unknown as string[];

describe('GET /api/internal/metrics', () => {
  let savedOperators: string[] = [];
  beforeEach(() => {
    resetMetrics();
    savedOperators = [...operators];
  });
  afterEach(() => operators.splice(0, operators.length, ...savedOperators));

  it('requires a session', async () => {
    const res = await request(buildApp(createMemorySessionStore())).get('/api/internal/metrics');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns the rolling call-count snapshot for an authenticated operator', async () => {
    recordApiCall('sheets', 'values.batchGet', 'ok');
    recordApiCall('sheets', 'values.batchGet', 'rate_limited');

    const sessions = createMemorySessionStore();
    const created = await sessions.create('user-1');
    operators.splice(0, operators.length, 'user-1');
    const res = await request(buildApp(sessions))
      .get('/api/internal/metrics')
      .set('Cookie', sessionCookie(created.id));

    expect(res.status).toBe(200);
    expect(res.body.windowSeconds).toBe(60);
    expect(res.body.totalCalls).toBe(2);
    expect(res.body.byResult).toMatchObject({ ok: 1, rate_limited: 1 });
    expect(res.body.byMethod[0]).toMatchObject({
      service: 'sheets',
      method: 'values.batchGet',
      total: 2,
    });
  });

  // Service telemetry is written for whoever runs the app, not for a teacher.
  // 404 rather than 403, so probing cannot confirm the endpoint exists.
  it('answers 404 for a signed-in account that is not an operator', async () => {
    operators.splice(0, operators.length);
    const sessions = createMemorySessionStore();
    const created = await sessions.create('teacher-1');
    const res = await request(buildApp(sessions))
      .get('/api/internal/metrics')
      .set('Cookie', sessionCookie(created.id));
    expect(res.status).toBe(404);
  });
});

/**
 * The diagnostic that establishes `TRUST_PROXY_HOPS`. It reports network
 * addresses, so the gate matters as much as the payload: the addresses are the
 * caller's own, but the shape of the deployment's proxy chain is not something
 * to hand to anyone who asks.
 */
describe('GET /api/internal/forwarding', () => {
  let savedOperators: string[] = [];
  beforeEach(() => {
    savedOperators = [...operators];
  });
  afterEach(() => operators.splice(0, operators.length, ...savedOperators));

  it('requires a session', async () => {
    const res = await request(buildApp(createMemorySessionStore())).get('/api/internal/forwarding');
    expect(res.status).toBe(401);
  });

  it('answers 404 for a signed-in account that is not an operator', async () => {
    operators.splice(0, operators.length);
    const sessions = createMemorySessionStore();
    const created = await sessions.create('teacher-1');
    const res = await request(buildApp(sessions))
      .get('/api/internal/forwarding')
      .set('Cookie', sessionCookie(created.id));
    expect(res.status).toBe(404);
  });

  it('reports the chain for an operator, including what a limiter would key on', async () => {
    operators.splice(0, operators.length, 'operator-1');
    const sessions = createMemorySessionStore();
    const created = await sessions.create('operator-1');
    const res = await request(buildApp(sessions))
      .get('/api/internal/forwarding')
      .set('Cookie', sessionCookie(created.id))
      .set('X-Forwarded-For', '203.0.113.7, 198.51.100.1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ip');
    expect(res.body.forwardedFor).toBe('203.0.113.7, 198.51.100.1');
    expect(res.body).toHaveProperty('trustProxyHops');
  });

  /**
   * The failure this whole exercise is about. With no trust configured, a
   * forwarded chain is not consulted at all, so `ip` is the socket peer and is
   * the same value for every caller — which is what turns a per-client limiter
   * into one shared bucket.
   */
  it('does not adopt a forwarded address while no hops are trusted', async () => {
    operators.splice(0, operators.length, 'operator-1');
    const sessions = createMemorySessionStore();
    const created = await sessions.create('operator-1');
    const app = buildApp(sessions);
    app.set('trust proxy', 0);
    const res = await request(app)
      .get('/api/internal/forwarding')
      .set('Cookie', sessionCookie(created.id))
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.ips).toEqual([]);
  });

  it('adopts the forwarded address once one hop is trusted', async () => {
    operators.splice(0, operators.length, 'operator-1');
    const sessions = createMemorySessionStore();
    const created = await sessions.create('operator-1');
    const app = buildApp(sessions);
    app.set('trust proxy', 1);
    const res = await request(app)
      .get('/api/internal/forwarding')
      .set('Cookie', sessionCookie(created.id))
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });
});

describe('POST /api/internal/dev/plan', () => {
  withBillingEnabled();
  // The guard reads these at call time; `as const` is compile-time only.
  const mutable = env as unknown as { nodeEnv: string; devToolsGoogleSubs: string[] };
  const originalEnv = mutable.nodeEnv;
  const originalSubs = mutable.devToolsGoogleSubs;

  afterEach(() => {
    mutable.nodeEnv = originalEnv;
    mutable.devToolsGoogleSubs = originalSubs;
  });

  async function setup({
    nodeEnv = 'development',
    allowlist = ['user-1'],
    trialEndsAt = null as string | null,
    subscriptionStatus = 'inactive',
  } = {}) {
    mutable.nodeEnv = nodeEnv;
    mutable.devToolsGoogleSubs = allowlist;
    const sessions = createMemorySessionStore();
    const accounts = createMemoryAccountStore([
      testAccount({ googleSub: 'user-1', trialEndsAt, subscriptionStatus }),
    ]);
    const created = await sessions.create('user-1');
    return {
      app: buildApp(sessions, accounts),
      accounts,
      cookie: sessionCookie(created.id),
      csrfToken: created.csrfToken,
    };
  }

  const toggle = (app: express.Express, cookie: string, csrfToken: string) =>
    request(app).post('/api/internal/dev/plan').set('Cookie', cookie).set(CSRF_HEADER, csrfToken);

  /**
   * The regression this endpoint actually had. An account with an unexpired
   * trial AND an active subscription resolves to `trial` the moment the override
   * clears; cycling on the *resolved plan* therefore looped trial → paid → clear
   * → trial forever, never reaching `free`, with the cleared position looking
   * identical to a forced `trial`. Cycling on the stored override visits all
   * four positions regardless of the underlying plan.
   */
  it('visits all four positions even when the real plan is trial-and-subscribed', async () => {
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const { app, accounts, cookie, csrfToken } = await setup({
      trialEndsAt: future,
      subscriptionStatus: 'active',
    });

    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push((await toggle(app, cookie, csrfToken)).body.override);
    }
    expect(seen).toEqual(['free', 'trial', 'paid', null]);
    expect((await accounts.getByGoogleSub('user-1'))?.planOverride).toBeNull();
  });

  it('cycles free to trial to paid, then clears the override', async () => {
    const { app, accounts, cookie, csrfToken } = await setup();
    expect((await toggle(app, cookie, csrfToken)).body).toEqual({ plan: 'free', override: 'free' });
    expect((await toggle(app, cookie, csrfToken)).body).toEqual({
      plan: 'trial',
      override: 'trial',
    });
    expect((await toggle(app, cookie, csrfToken)).body).toEqual({ plan: 'paid', override: 'paid' });
    // The fourth position clears rather than forcing a plan, which is what makes
    // the toggle reversible.
    expect((await toggle(app, cookie, csrfToken)).body).toEqual({ plan: 'free', override: null });
    expect((await accounts.getByGoogleSub('user-1'))?.planOverride).toBeNull();
  });

  /**
   * The reason the cycle has a fourth position. `plan_override` outranks
   * subscription state by design, so without a way to clear it the first use of
   * this endpoint pinned the account permanently and silently masked any real
   * Stripe subscription — the trap waiting for exactly the person testing
   * billing. Clearing must reveal the true plan, not force `free`.
   */
  it('reveals the real subscription-derived plan when the override clears', async () => {
    const { app, accounts, cookie, csrfToken } = await setup({ subscriptionStatus: 'active' });
    await toggle(app, cookie, csrfToken); // -> free
    await toggle(app, cookie, csrfToken); // -> trial
    await toggle(app, cookie, csrfToken); // -> paid
    const cleared = await toggle(app, cookie, csrfToken);

    expect(cleared.body).toEqual({ plan: 'paid', override: null });
    expect((await accounts.getByGoogleSub('user-1'))?.planOverride).toBeNull();
    // Cleared, but still paid — because the subscription says so, not the toggle.
    expect((await accounts.getByGoogleSub('user-1'))?.subscriptionStatus).toBe('active');
  });

  // The Stripe-managed fields stay Stripe's alone, so billing state and app
  // state can never disagree (re-verified against a real webhook in Step 3b).
  it('writes plan_override only, never the subscription fields', async () => {
    const { app, accounts, cookie, csrfToken } = await setup();
    await toggle(app, cookie, csrfToken);
    const account = await accounts.getByGoogleSub('user-1');
    expect(account?.planOverride).toBe('free');
    expect(account?.subscriptionStatus).toBe('inactive');
  });

  // 404, not 403: a 403 would confirm the endpoint exists to anyone probing.
  it('returns 404 in production even for an allowlisted sub', async () => {
    const { app, accounts, cookie, csrfToken } = await setup({ nodeEnv: 'production' });
    const res = await toggle(app, cookie, csrfToken);
    expect(res.status).toBe(404);
    expect((await accounts.getByGoogleSub('user-1'))?.planOverride).toBeNull();
  });

  it('returns 404 for a non-allowlisted sub outside production', async () => {
    const { app, accounts, cookie, csrfToken } = await setup({ allowlist: ['someone-else'] });
    const res = await toggle(app, cookie, csrfToken);
    expect(res.status).toBe(404);
    expect((await accounts.getByGoogleSub('user-1'))?.planOverride).toBeNull();
  });

  it('returns 404 when the allowlist is empty, so an unset env var opens nothing', async () => {
    const { app, cookie, csrfToken } = await setup({ allowlist: [] });
    expect((await toggle(app, cookie, csrfToken)).status).toBe(404);
  });

  it('requires a session', async () => {
    mutable.nodeEnv = 'development';
    mutable.devToolsGoogleSubs = ['user-1'];
    const res = await request(buildApp(createMemorySessionStore())).post('/api/internal/dev/plan');
    expect(res.status).toBe(401);
  });
});
