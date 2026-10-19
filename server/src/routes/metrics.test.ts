import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildSupportRouter } from './support.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie, requireSession } from '../middleware/session.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import { createMemoryAccountStore, testAccount } from '../services/accountStore.js';
import { createMemorySupportStore } from '../services/supportStore.js';
import { createMemoryMetricsStore } from '../services/metricsStore.js';
import { createMemoryUsageStore } from '../services/usageStore.js';
import { env } from '../config/env.js';

/**
 * The operator metrics view and the per-account activity read (Step 6j).
 *
 * The gating assertions matter more than the arithmetic: these two endpoints
 * are the only places account activation state is readable, and they sit behind
 * the same allowlist as support triage.
 */

const TEACHER = 'teacher-1';
const OPERATOR = 'operator-1';

const allowlist = env.supportAdminGoogleSubs as unknown as string[];
let saved: string[] = [];
beforeEach(() => {
  saved = [...allowlist];
});
afterEach(() => {
  allowlist.splice(0, allowlist.length, ...saved);
});

function setup() {
  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([
    testAccount({ googleSub: TEACHER, id: 'acct-1' }),
    testAccount({ googleSub: OPERATOR, id: 'acct-2' }),
  ]);
  const usage = createMemoryUsageStore();
  const metrics = createMemoryMetricsStore([
    { createdAt: new Date().toISOString(), milestones: { onboarded: true, firstStudent: true } },
    { createdAt: new Date().toISOString(), milestones: { onboarded: true } },
  ]);

  const app = express();
  app.use(express.json());
  app.use(
    '/api/support',
    requireSession(sessions),
    buildSupportRouter(accounts, createMemorySupportStore(), metrics, usage),
  );
  app.use(errorHandler);

  const as = async (sub: string) => {
    const created = await sessions.create(sub);
    return `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;
  };
  return { app, as, usage };
}

describe('GET /support/admin/metrics', () => {
  it('is invisible to a signed-in teacher who is not an operator', async () => {
    const { app, as } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);

    const res = await request(app).get('/api/support/admin/metrics').set('Cookie', await as(TEACHER));
    // 404 rather than 403: the operator surface does not confirm it exists.
    expect(res.status).toBe(404);
  });

  it('returns the funnel, signups and usage totals to an operator', async () => {
    const { app, as, usage } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    await usage.record('acct-1', 'attendance');
    await usage.record('acct-1', 'attendance');

    const res = await request(app)
      .get('/api/support/admin/metrics')
      .set('Cookie', await as(OPERATOR));

    expect(res.status).toBe(200);
    expect(res.body.funnel).toMatchObject({ signedUp: 2, onboarded: 2, firstStudent: 1 });
    expect(res.body.usage[0].counts.attendance).toBe(2);
    // Served rather than duplicated client-side, so the caveat and the
    // retention window cannot drift from what the server enforces.
    expect(res.body.pickerCountsPageOpens).toBe(true);
    expect(res.body.retentionMonths).toBe(24);
  });

  it('reports no account identifiers', async () => {
    const { app, as } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    const res = await request(app)
      .get('/api/support/admin/metrics')
      .set('Cookie', await as(OPERATOR));

    // The aggregate view is totals only. If an account id, email or google_sub
    // ever appears in this payload, the privacy policy's description of it has
    // stopped being true.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TEACHER);
    expect(body).not.toContain('acct-1');
    expect(body).not.toContain('@');
  });
});

describe('GET /support/admin/accounts/:googleSub/activity', () => {
  it('returns milestones and counts for a known account', async () => {
    const { app, as, usage } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    await usage.record('acct-1', 'email');

    const res = await request(app)
      .get(`/api/support/admin/accounts/${TEACHER}/activity`)
      .set('Cookie', await as(OPERATOR));

    expect(res.status).toBe(200);
    expect(res.body.milestones).toHaveProperty('firstAttendanceAt');
    expect(res.body.usage[0].counts.email).toBe(1);
  });

  it('never returns the refresh token or the spreadsheet id', async () => {
    const { app, as } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    const res = await request(app)
      .get(`/api/support/admin/accounts/${TEACHER}/activity`)
      .set('Cookie', await as(OPERATOR));

    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.body).not.toHaveProperty('spreadsheetId');
    expect(res.body).not.toHaveProperty('email');
  });

  it('404s for an unknown account', async () => {
    const { app, as } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    const res = await request(app)
      .get('/api/support/admin/accounts/nobody/activity')
      .set('Cookie', await as(OPERATOR));
    expect(res.status).toBe(404);
  });

  it('is closed to a non-operator', async () => {
    const { app, as } = setup();
    allowlist.splice(0, allowlist.length, OPERATOR);
    const res = await request(app)
      .get(`/api/support/admin/accounts/${TEACHER}/activity`)
      .set('Cookie', await as(TEACHER));
    expect(res.status).toBe(404);
  });
});
