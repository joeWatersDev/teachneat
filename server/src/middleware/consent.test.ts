import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireConsent } from './consent.js';
import { errorHandler } from './errorHandler.js';
import { createSessionCookie, requireSession } from './session.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import { createMemoryAccountStore, testAccount } from '../services/accountStore.js';
import { CURRENT_TERMS_VERSION } from '../config/legal.js';
import { env } from '../config/env.js';

/**
 * The consent gate (Phase 2 Step 5c). These assert the gate itself: that it
 * refuses before the handler runs, that it recognises each of the ways consent
 * can be absent or stale, and that it does not mistake a deleted account for an
 * un-consented one. Where it is mounted is asserted in gating.test.ts.
 */

const SUB = 'user-1';

async function setup(accountOverrides: Parameters<typeof testAccount>[0] = {}) {
  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([testAccount({ googleSub: SUB, ...accountOverrides })]);
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  app.get(
    '/api/thing',
    requireSession(sessions),
    requireConsent(accounts),
    // Reached only if the gate lets the request past, so a 200 here is the
    // assertion that it did.
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandler);
  return {
    app,
    accounts,
    cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
  };
}

describe('requireConsent', () => {
  it('lets a fully consented account through', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('refuses an account that has never accepted', async () => {
    const { app, cookie } = await setup({
      termsAcceptedAt: null,
      termsVersion: '',
      dataResponsibilityAcceptedAt: null,
    });
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('refuses an account whose accepted version is stale', async () => {
    // The whole point of versioning: this account accepted, and is still
    // refused, because what it accepted is no longer the text in force.
    const { app, cookie } = await setup({ termsVersion: 'some-older-version' });
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('refuses an account that accepted the terms but not the data responsibility', async () => {
    // Not reachable through the endpoint, which writes both together — asserted
    // so that a future change permitting them separately cannot let a
    // half-consented account through unnoticed.
    const { app, cookie } = await setup({ dataResponsibilityAcceptedAt: null });
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('reports a session whose account is gone as unauthorized, not as consent', async () => {
    const { app, accounts, cookie } = await setup();
    await accounts.delete(SUB);
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('lets an account through once it records consent at the current version', async () => {
    const { app, accounts, cookie } = await setup({
      termsAcceptedAt: null,
      termsVersion: '',
      dataResponsibilityAcceptedAt: null,
    });
    expect((await request(app).get('/api/thing').set('Cookie', cookie)).status).toBe(403);
    await accounts.recordConsent(SUB, CURRENT_TERMS_VERSION);
    expect((await request(app).get('/api/thing').set('Cookie', cookie)).status).toBe(200);
  });
});
