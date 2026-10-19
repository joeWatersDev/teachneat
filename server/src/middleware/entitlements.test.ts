import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requirePremium, loadAccount } from './entitlements.js';
import { errorHandler } from './errorHandler.js';
import { createSessionCookie, requireSession } from './session.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import {
  createMemoryAccountStore,
  testAccount,
  type Account,
  type AccountStore,
} from '../services/accountStore.js';
import { env } from '../config/env.js';
import { withBillingEnabled } from '../test/billing.js';

const SUB = 'user-1';
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

async function setup(account: Account, store?: AccountStore) {
  const sessions = createMemorySessionStore();
  const accounts = store ?? createMemoryAccountStore([account]);
  const created = await sessions.create(SUB);
  const app = express();
  app.get(
    '/gated',
    requireSession(sessions),
    requirePremium(accounts, 'Attendance statistics'),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandler);
  const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;
  return { app, cookie };
}

describe('requirePremium', () => {
  withBillingEnabled();
  it('rejects a free account with 403 PREMIUM_REQUIRED', async () => {
    const { app, cookie } = await setup(testAccount({ googleSub: SUB, trialEndsAt: past }));
    const res = await request(app).get('/gated').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    // Names the feature in plain language, with no upsell copy.
    expect(res.body.message).toBe('Attendance statistics is part of Premium.');
  });

  it('admits a trial account', async () => {
    const { app, cookie } = await setup(testAccount({ googleSub: SUB, trialEndsAt: future }));
    const res = await request(app).get('/gated').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('admits a paid account whose trial has expired', async () => {
    const account = testAccount({
      googleSub: SUB,
      trialEndsAt: past,
      subscriptionStatus: 'active',
    });
    const { app, cookie } = await setup(account);
    const res = await request(app).get('/gated').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('rejects an anonymous request before it reaches the plan check', async () => {
    const { app } = await setup(testAccount({ googleSub: SUB, trialEndsAt: future }));
    const res = await request(app).get('/gated');
    expect(res.status).toBe(401);
  });
});

describe('loadAccount', () => {
  it('reads the account once per request even when the gate and the handler both need it', async () => {
    const base = createMemoryAccountStore([testAccount({ googleSub: SUB, trialEndsAt: future })]);
    const getByGoogleSub = vi.fn(base.getByGoogleSub);
    const store: AccountStore = { ...base, getByGoogleSub };
    const sessions = createMemorySessionStore();
    const created = await sessions.create(SUB);
    const app = express();
    app.get(
      '/gated',
      requireSession(sessions),
      requirePremium(store, 'Attendance statistics'),
      (req, res, next) => {
        loadAccount(req, store)
          .then((account) => res.json({ email: account.email }))
          .catch(next);
      },
    );
    app.use(errorHandler);
    const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;

    const res = await request(app).get('/gated').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(getByGoogleSub).toHaveBeenCalledTimes(1);
  });
});
