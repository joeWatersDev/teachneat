import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildSupportRouter } from './support.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { requireCsrf, CSRF_HEADER } from '../middleware/csrf.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import {
  createMemoryAccountStore,
  testAccount,
  type Account,
  type AccountStore,
} from '../services/accountStore.js';
import { createMemorySupportStore, type SupportStore } from '../services/supportStore.js';
import { env } from '../config/env.js';
import { SUPPORT_LIMITS } from '../config/support.js';
import { withBillingEnabled } from '../test/billing.js';

const SUB = 'teacher-1';
const ADMIN_SUB = 'operator-1';
const past = new Date(Date.now() - 86_400_000).toISOString();
const future = new Date(Date.now() + 86_400_000).toISOString();

// The allowlist is read through `env`, which is frozen at import time, so tests
// mutate the array in place rather than re-importing the module.
const allowlist = env.supportAdminGoogleSubs as unknown as string[];
let savedAllowlist: string[] = [];

beforeEach(() => {
  savedAllowlist = [...allowlist];
});
afterEach(() => {
  allowlist.splice(0, allowlist.length, ...savedAllowlist);
});

function allowAdmin(sub: string) {
  allowlist.splice(0, allowlist.length, sub);
}

async function setup(accountsSeed: Account[], support: SupportStore = createMemorySupportStore()) {
  const sessions = createMemorySessionStore();
  const accounts: AccountStore = createMemoryAccountStore(accountsSeed);
  const app = express();
  app.use(express.json());
  app.use('/api/support', [requireSession(sessions), requireCsrf], buildSupportRouter(accounts, support));
  app.use(errorHandler);

  const asUser = async (sub: string) => {
    const created = await sessions.create(sub);
    return {
      cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
      csrfToken: created.csrfToken,
    };
  };
  return { app, accounts, support, asUser };
}

const teacher = () => testAccount({ googleSub: SUB, email: 'teacher@example.com', trialEndsAt: past });
const operator = () => testAccount({ googleSub: ADMIN_SUB, email: 'ops@example.com', trialEndsAt: past });

const body = { category: 'bug', subject: 'Attendance will not save', message: 'It spins forever.' };

describe('POST /api/support/requests', () => {
  withBillingEnabled();
  it('stores a request against the session account, never a client-supplied one', async () => {
    const { app, support, asUser } = await setup([teacher()]);
    const { cookie, csrfToken } = await asUser(SUB);
    const res = await request(app)
      .post('/api/support/requests')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ ...body, googleSub: 'someone-else' });
    // The extra field is rejected outright rather than ignored.
    expect(res.status).toBe(400);

    const ok = await request(app)
      .post('/api/support/requests')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.googleSub).toBe(SUB);
    expect(ok.body.status).toBe('new');
    expect((await support.listForUser(SUB)).requests).toHaveLength(1);
  });

  // The plan a teacher was on when they wrote is the plan they were describing,
  // and it may not be the plan they hold when the request is finally read.
  it('records the plan at submit time', async () => {
    const { app, asUser } = await setup([testAccount({ googleSub: SUB, trialEndsAt: future })]);
    const { cookie, csrfToken } = await asUser(SUB);
    const res = await request(app)
      .post('/api/support/requests')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send(body);
    expect(res.body.planAtSubmit).toBe('trial');
  });

  it('rejects an unknown category, an empty message, and an over-long one', async () => {
    const { app, asUser } = await setup([teacher()]);
    const { cookie, csrfToken } = await asUser(SUB);
    const send = (payload: unknown) =>
      request(app)
        .post('/api/support/requests')
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrfToken)
        .send(payload);
    expect((await send({ ...body, category: 'urgent' })).status).toBe(400);
    expect((await send({ ...body, message: '   ' })).status).toBe(400);
    expect((await send({ ...body, message: 'x'.repeat(SUPPORT_LIMITS.messageMax + 1) })).status).toBe(400);
  });

  it('requires a session and a CSRF token', async () => {
    const { app, asUser } = await setup([teacher()]);
    const { cookie } = await asUser(SUB);
    expect((await request(app).post('/api/support/requests').send(body)).status).toBe(401);
    const noCsrf = await request(app).post('/api/support/requests').set('Cookie', cookie).send(body);
    expect(noCsrf.status).toBe(403);
  });
});

describe('GET /api/support/requests', () => {
  it('returns only the caller own requests', async () => {
    const { app, asUser } = await setup([teacher(), operator()]);
    const mine = await asUser(SUB);
    const theirs = await asUser(ADMIN_SUB);
    await request(app)
      .post('/api/support/requests')
      .set('Cookie', mine.cookie)
      .set(CSRF_HEADER, mine.csrfToken)
      .send(body);

    const res = await request(app).get('/api/support/requests').set('Cookie', theirs.cookie);
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });
});

describe('support admin', () => {
  it('answers 404 for a signed-in account that is not allowlisted', async () => {
    allowAdmin(ADMIN_SUB);
    const { app, asUser } = await setup([teacher()]);
    const { cookie } = await asUser(SUB);
    const res = await request(app).get('/api/support/admin/requests').set('Cookie', cookie);
    // 404, not 403: a 403 would confirm the endpoint exists to anyone probing.
    expect(res.status).toBe(404);
  });

  it('answers 404 for everyone when the allowlist is empty', async () => {
    allowlist.splice(0, allowlist.length);
    const { app, asUser } = await setup([operator()]);
    const { cookie } = await asUser(ADMIN_SUB);
    expect((await request(app).get('/api/support/admin/requests').set('Cookie', cookie)).status).toBe(404);
  });

  it('lists every request with the submitting account attached, and filters by status', async () => {
    allowAdmin(ADMIN_SUB);
    const support = createMemorySupportStore([], { [SUB]: { email: 'teacher@example.com', name: 'Teacher' } });
    const { app, asUser } = await setup([teacher(), operator()], support);
    const mine = await asUser(SUB);
    const ops = await asUser(ADMIN_SUB);
    await request(app)
      .post('/api/support/requests')
      .set('Cookie', mine.cookie)
      .set(CSRF_HEADER, mine.csrfToken)
      .send(body);

    const all = await request(app).get('/api/support/admin/requests').set('Cookie', ops.cookie);
    expect(all.status).toBe(200);
    expect(all.body.requests).toHaveLength(1);
    expect(all.body.requests[0].accountEmail).toBe('teacher@example.com');

    const resolved = await request(app)
      .get('/api/support/admin/requests?status=resolved')
      .set('Cookie', ops.cookie);
    expect(resolved.body.requests).toEqual([]);

    const bad = await request(app)
      .get('/api/support/admin/requests?status=nonsense')
      .set('Cookie', ops.cookie);
    expect(bad.status).toBe(400);
  });

  it('triages a request and 404s on an unknown id', async () => {
    allowAdmin(ADMIN_SUB);
    const support = createMemorySupportStore();
    const { app, asUser } = await setup([teacher(), operator()], support);
    const mine = await asUser(SUB);
    const ops = await asUser(ADMIN_SUB);
    const created = await request(app)
      .post('/api/support/requests')
      .set('Cookie', mine.cookie)
      .set(CSRF_HEADER, mine.csrfToken)
      .send(body);

    const patched = await request(app)
      .patch(`/api/support/admin/requests/${created.body.id}`)
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({ status: 'resolved', adminNote: 'Cache issue, fixed.' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('resolved');
    expect(patched.body.adminNote).toBe('Cache issue, fixed.');

    const missing = await request(app)
      .patch('/api/support/admin/requests/nope')
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({ status: 'open' });
    expect(missing.status).toBe(404);

    const empty = await request(app)
      .patch(`/api/support/admin/requests/${created.body.id}`)
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({});
    expect(empty.status).toBe(400);
  });

  // The comp path writes plan_override and nothing else, so a comped account's
  // Stripe-managed fields stay exactly as Stripe left them.
  it('comps an account through plan_override without touching billing state', async () => {
    allowAdmin(ADMIN_SUB);
    const target = testAccount({
      googleSub: SUB,
      trialEndsAt: past,
      subscriptionStatus: 'canceled',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
    const { app, accounts, asUser } = await setup([target, operator()]);
    const ops = await asUser(ADMIN_SUB);

    const res = await request(app)
      .post(`/api/support/admin/accounts/${SUB}/plan-override`)
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({ override: 'paid' });
    expect(res.status).toBe(200);

    const after = await accounts.getByGoogleSub(SUB);
    expect(after?.planOverride).toBe('paid');
    expect(after?.subscriptionStatus).toBe('canceled');
    expect(after?.stripeSubscriptionId).toBe('sub_1');

    const cleared = await request(app)
      .post(`/api/support/admin/accounts/${SUB}/plan-override`)
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({ override: null });
    expect(cleared.status).toBe(200);
    expect((await accounts.getByGoogleSub(SUB))?.planOverride).toBeNull();
  });

  // A queue that quietly stops at the cap looks exactly like a queue with
  // exactly that many things in it, and the difference matters most when the
  // queue is busiest.
  it('reports when the list was cut short by the cap', async () => {
    allowAdmin(ADMIN_SUB);
    const support = createMemorySupportStore();
    const { app, asUser } = await setup([teacher(), operator()], support);
    const mine = await asUser(SUB);
    const ops = await asUser(ADMIN_SUB);
    for (let i = 0; i <= SUPPORT_LIMITS.listLimit; i += 1) {
      await support.create({
        googleSub: SUB,
        category: 'other',
        subject: `Request ${i}`,
        message: 'x',
        planAtSubmit: 'free',
      });
    }

    const res = await request(app).get('/api/support/admin/requests').set('Cookie', ops.cookie);
    expect(res.body.requests).toHaveLength(SUPPORT_LIMITS.listLimit);
    expect(res.body.truncated).toBe(true);

    const own = await request(app).get('/api/support/requests').set('Cookie', mine.cookie);
    expect(own.body.truncated).toBe(true);
  });

  it('404s the comp endpoint for an unknown account', async () => {
    allowAdmin(ADMIN_SUB);
    const { app, asUser } = await setup([operator()]);
    const ops = await asUser(ADMIN_SUB);
    const res = await request(app)
      .post('/api/support/admin/accounts/ghost/plan-override')
      .set('Cookie', ops.cookie)
      .set(CSRF_HEADER, ops.csrfToken)
      .send({ override: 'paid' });
    expect(res.status).toBe(404);
  });
});
