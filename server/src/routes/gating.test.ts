import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildAttendanceRouter } from './attendance.js';
import { buildGroupingRouter } from './grouping.js';
import { buildSettingsRouter } from './settings.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { requireCsrf, CSRF_HEADER } from '../middleware/csrf.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import { createMemoryAccountStore, testAccount } from '../services/accountStore.js';
import { memoryActivity } from '../test/memoryActivity.js';
import { env } from '../config/env.js';
import { CURRENT_TERMS_VERSION } from '../config/legal.js';
import { buildApp } from '../index.js';
import { withBillingEnabled } from '../test/billing.js';

/**
 * Which endpoints actually carry the entitlement gate. The gate runs before the
 * handler, so a `free` account is refused without any Sheets call — which is
 * what lets this assert the wiring directly. Whether the gate itself resolves
 * plans correctly is entitlements.test.ts; this is only "is it mounted here".
 */

const SUB = 'user-1';
const past = new Date(Date.now() - 86_400_000).toISOString();

async function setup() {
  const sessions = createMemorySessionStore();
  // Expired trial, no subscription: a free account.
  const accounts = createMemoryAccountStore([testAccount({ googleSub: SUB, trialEndsAt: past })]);
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  const gated = [requireSession(sessions), requireCsrf];
  app.use('/api/attendance', gated, buildAttendanceRouter(accounts, memoryActivity(accounts)));
  app.use('/api/grouping', gated, buildGroupingRouter(accounts, memoryActivity(accounts)));
  app.use('/api/settings', gated, buildSettingsRouter(accounts));
  app.use(errorHandler);
  return {
    app,
    cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
    csrfToken: created.csrfToken,
  };
}

const GATED_READS = ['/api/attendance/stats', '/api/grouping/constraints'];

describe('premium gating on a free account', () => {
  withBillingEnabled();
  for (const path of GATED_READS) {
    it(`refuses GET ${path} with PREMIUM_REQUIRED`, async () => {
      const { app, cookie } = await setup();
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PREMIUM_REQUIRED');
    });
  }

  it('refuses creating a grouping constraint', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .post('/api/grouping/constraints')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ constraintTypeKey: 'keep_together', studentIds: ['a', 'b'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
  });

  it('refuses changing the high-absence threshold', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ highAbsence: { minAbsenceRate: 0.2 } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
  });

  // History is the record of what was taken, not analysis of it, so it stays
  // free alongside daily entry. Only the computed statistics are premium.
  it('does not refuse the attendance range read that History and the heatmap use', async () => {
    const { app, cookie } = await setup();
    const res = await request(app)
      .get('/api/attendance/range?startDate=2026-01-01&endDate=2026-01-31')
      .set('Cookie', cookie);
    expect(res.status).not.toBe(403);
  });

  // The indicators are free; only the analysis views are premium. Reading the
  // threshold has to work on every plan, because the tooltip names it.
  it('still serves GET /settings', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  // Enforcement is server-side: a client that never renders the lock still gets
  // the same answer, because the check does not depend on anything it sends.
  it('refuses a gated endpoint called directly, with no client involved', async () => {
    const { app, cookie } = await setup();
    const res = await request(app)
      .get('/api/attendance/stats')
      .set('Cookie', cookie)
      .set('X-Client-Says', 'premium');
    expect(res.status).toBe(403);
  });
});

/**
 * The launch shape (Phase 2 Step 8a), asserted as the default the suite runs
 * under rather than as a variation of it.
 *
 * Everything the block above describes is dormant: `BILLING_ENABLED` is off, so
 * a `free` account is entitled to all of it. This is the behaviour that ships,
 * and it is asserted through the same endpoints and the same account so the two
 * blocks cannot drift into describing different products.
 */
describe('premium gating with billing switched off', () => {
  for (const path of GATED_READS) {
    it(`serves GET ${path} to a free account`, async () => {
      const { app, cookie } = await setup();
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status).not.toBe(403);
    });
  }

  it('accepts a grouping constraint from a free account', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .post('/api/grouping/constraints')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ constraintTypeKey: 'keep_together', studentIds: ['a', 'b'] });
    expect(res.status).not.toBe(403);
  });

  it('accepts a high-absence threshold change from a free account', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ highAbsence: { minAbsenceRate: 0.2 } });
    expect(res.status).toBe(200);
  });
});

/**
 * The consent gate's mounting (Phase 2 Step 5c), asserted against the real
 * `buildApp` rather than a hand-assembled router list. That is the point: the
 * gate is only worth anything if it is on *every* tool router, and a test that
 * builds its own app would keep passing after someone mounts a new router
 * without it.
 */
describe('consent gating on an account that has not accepted', () => {
  async function setupApp() {
    const sessions = createMemorySessionStore();
    const accounts = createMemoryAccountStore([
      testAccount({
        googleSub: SUB,
        termsAcceptedAt: null,
        termsVersion: '',
        dataResponsibilityAcceptedAt: null,
      }),
    ]);
    const created = await sessions.create(SUB);
    return {
      app: buildApp(accounts, sessions),
      cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
      csrfToken: created.csrfToken,
    };
  }

  // One read per gated mount point. Reads rather than writes so the CSRF gate
  // is not what is being measured.
  const REFUSED = [
    '/api/students',
    '/api/attendance/range?startDate=2026-01-01&endDate=2026-01-31',
    '/api/grouping/constraints',
    '/api/settings',
    '/api/support/requests',
    '/api/email/templates',
  ];

  for (const path of REFUSED) {
    it(`refuses GET ${path}`, async () => {
      const { app, cookie } = await setupApp();
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });
  }

  // The exceptions, and why each has to be one: consent is recorded through
  // /auth, the profile that says it is needed is read there, and a teacher who
  // declines has to be able to sign out. Gating those would lock the account
  // out of the only screen that can unlock it.
  it('still serves the profile, so the client can learn consent is needed', async () => {
    const { app, cookie } = await setupApp();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.needsConsent).toBe(true);
  });

  it('still allows sign-out', async () => {
    const { app, cookie, csrfToken } = await setupApp();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken);
    expect(res.status).toBe(204);
  });

  it('opens the app up once consent is recorded', async () => {
    const sessions = createMemorySessionStore();
    const accounts = createMemoryAccountStore([
      testAccount({
        googleSub: SUB,
        termsAcceptedAt: null,
        termsVersion: '',
        dataResponsibilityAcceptedAt: null,
      }),
    ]);
    const created = await sessions.create(SUB);
    const app = buildApp(accounts, sessions);
    const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;

    const before = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(before.body.code).toBe('CONSENT_REQUIRED');

    const accepted = await request(app)
      .post('/api/auth/consent')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, created.csrfToken)
      .send({
        termsVersion: CURRENT_TERMS_VERSION,
        acceptedTerms: true,
        acceptedDataResponsibility: true,
      });
    expect(accepted.status).toBe(204);

    const after = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(after.status).toBe(200);
  });
});
