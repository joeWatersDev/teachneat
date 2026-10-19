import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildPublicSupportRouter } from './publicSupport.js';
import { buildSupportRouter } from './support.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { requireCsrf } from '../middleware/csrf.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import {
  createMemoryAccountStore,
  testAccount,
  type AccountStore,
} from '../services/accountStore.js';
import { createMemorySupportStore, type SupportStore } from '../services/supportStore.js';
import { env } from '../config/env.js';
import { PUBLIC_SUPPORT_RATE_LIMIT, SUPPORT_LIMITS } from '../config/support.js';

/**
 * The signed-out contact route (Step 5). The point of most of these cases is
 * that this is the app's only unauthenticated write, so the things that are
 * merely tidy elsewhere — a strict schema, no echoed identifiers, no session
 * leakage — are the actual boundary here.
 */

const ADMIN_SUB = 'operator-1';
const past = new Date(Date.now() - 86_400_000).toISOString();

const allowlist = env.supportAdminGoogleSubs as unknown as string[];

function setup(support: SupportStore = createMemorySupportStore()) {
  const app = express();
  app.use(express.json());
  app.use('/api/public/support', buildPublicSupportRouter(support));
  app.use(errorHandler);
  return { app, support };
}

const body = {
  name: 'A Teacher',
  email: 'teacher@board.example',
  category: 'question' as const,
  subject: 'My board has blocked the app',
  message: 'Our admin will not approve it. What do I send them?',
};

describe('POST /api/public/support/contact', () => {
  it('accepts a submission with no session and no CSRF token', async () => {
    const { app, support } = setup();
    const res = await request(app).post('/api/public/support/contact').send(body);
    expect(res.status).toBe(204);
    // 204 means no body at all: an anonymous caller gets no id back.
    expect(res.body).toEqual({});

    const { requests } = await support.listAll();
    expect(requests).toHaveLength(1);
    expect(requests[0].googleSub).toBeNull();
    expect(requests[0].subject).toBe(body.subject);
  });

  it('records the typed contact details and marks the identity unverified', async () => {
    const { app, support } = setup();
    await request(app).post('/api/public/support/contact').send(body);

    const { requests } = await support.listAll();
    expect(requests[0].accountEmail).toBe(body.email);
    expect(requests[0].accountName).toBe(body.name);
    // The distinction the triage view has to show: this address is a claim.
    expect(requests[0].verifiedIdentity).toBe(false);
    // No account, so no plan to record.
    expect(requests[0].planAtSubmit).toBe('');
  });

  it('discards a honeypot submission with the same 204 a real one gets', async () => {
    const { app, support } = setup();
    const res = await request(app)
      .post('/api/public/support/contact')
      .send({ ...body, website: 'http://spam.example' });

    // Indistinguishable from success on the wire, deliberately.
    expect(res.status).toBe(204);
    const { requests } = await support.listAll();
    expect(requests).toHaveLength(0);
  });

  it('rejects an unparseable email address', async () => {
    const { app, support } = setup();
    const res = await request(app)
      .post('/api/public/support/contact')
      .send({ ...body, email: 'not-an-address' });
    expect(res.status).toBe(400);
    expect((await support.listAll()).requests).toHaveLength(0);
  });

  it('rejects unexpected fields rather than ignoring them', async () => {
    const { app } = setup();
    // Specifically: a caller must not be able to name the account a request
    // is filed against, which is the one thing this endpoint must never accept.
    const res = await request(app)
      .post('/api/public/support/contact')
      .send({ ...body, googleSub: 'someone-else' });
    expect(res.status).toBe(400);
  });

  it('enforces the message length cap', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/public/support/contact')
      .send({ ...body, message: 'x'.repeat(SUPPORT_LIMITS.messageMax + 1) });
    expect(res.status).toBe(400);
  });

  it('rejects an empty message', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/public/support/contact')
      .send({ ...body, message: '   ' });
    expect(res.status).toBe(400);
  });

  it('rate limits by connection once the hourly allowance is spent', async () => {
    const { app, support } = setup();
    for (let i = 0; i < PUBLIC_SUPPORT_RATE_LIMIT.limit; i += 1) {
      const ok = await request(app).post('/api/public/support/contact').send(body);
      expect(ok.status).toBe(204);
    }
    const blocked = await request(app).post('/api/public/support/contact').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    // The blocked one wrote nothing.
    expect((await support.listAll()).requests).toHaveLength(PUBLIC_SUPPORT_RATE_LIMIT.limit);
  });

  it('exposes no read path', async () => {
    const { app } = setup();
    await request(app).post('/api/public/support/contact').send(body);
    const res = await request(app).get('/api/public/support/contact');
    expect(res.status).toBe(404);
  });
});

describe('signed-out requests in the triage queue', () => {
  it('appears alongside account-backed requests rather than being filtered out by the join', async () => {
    // The regression this guards: the triage list joined `users` inner, so a
    // request with no account would have vanished from the queue entirely —
    // silently losing exactly the messages from people who could not sign in.
    const support = createMemorySupportStore([], {
      [ADMIN_SUB]: { email: 'ops@example.com', name: 'Ops' },
    });
    const { app: publicApp } = setup(support);
    await request(publicApp).post('/api/public/support/contact').send(body);

    const sessions = createMemorySessionStore();
    const accounts: AccountStore = createMemoryAccountStore([
      testAccount({ googleSub: ADMIN_SUB, email: 'ops@example.com', trialEndsAt: past }),
    ]);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/support',
      [requireSession(sessions), requireCsrf],
      buildSupportRouter(accounts, support),
    );
    app.use(errorHandler);

    const saved = [...allowlist];
    allowlist.splice(0, allowlist.length, ADMIN_SUB);
    try {
      const created = await sessions.create(ADMIN_SUB);
      const res = await request(app)
        .get('/api/support/admin/requests')
        .set(
          'Cookie',
          `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
        );
      expect(res.status).toBe(200);
      expect(res.body.requests).toHaveLength(1);
      expect(res.body.requests[0].verifiedIdentity).toBe(false);
      expect(res.body.requests[0].accountEmail).toBe(body.email);
    } finally {
      allowlist.splice(0, allowlist.length, ...saved);
    }
  });
});
