import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildSettingsRouter } from './settings.js';
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
import { DEFAULT_HIGH_ABSENCE } from '../config/plan.js';
import { env } from '../config/env.js';
import { withBillingEnabled } from '../test/billing.js';

const SUB = 'user-1';
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const freeAccount = () => testAccount({ googleSub: SUB, trialEndsAt: past });
const trialAccount = () => testAccount({ googleSub: SUB, trialEndsAt: future });

async function setup(account: Account) {
  const sessions = createMemorySessionStore();
  const accounts: AccountStore = createMemoryAccountStore([account]);
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  app.use('/api/settings', [requireSession(sessions), requireCsrf], buildSettingsRouter(accounts));
  app.use(errorHandler);
  return {
    app,
    accounts,
    cookie: `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
    csrfToken: created.csrfToken,
  };
}

describe('GET /api/settings', () => {
  withBillingEnabled();
  it('returns the default threshold on free, so the tooltip can name it', async () => {
    const { app, cookie } = await setup(freeAccount());
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.highAbsence).toEqual({ ...DEFAULT_HIGH_ABSENCE, isDefault: true });
    expect(res.body.storedOverride).toBeNull();
  });

  it('reports a stored threshold as effective on trial', async () => {
    const stored = { minAbsenceRate: 0.25, minDaysRecorded: 8 };
    const { app, cookie } = await setup(testAccount({ ...trialAccount(), highAbsence: stored }));
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.body.highAbsence).toEqual({ ...stored, isDefault: false });
    expect(res.body.storedOverride).toBeNull();
  });

  // A lapsed account is shown what upgrading would restore rather than being
  // told its setting is gone.
  it('surfaces a lapsed accountstored threshold separately from the effective one', async () => {
    const stored = { minAbsenceRate: 0.25, minDaysRecorded: 8 };
    const { app, cookie } = await setup(testAccount({ ...freeAccount(), highAbsence: stored }));
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.body.highAbsence).toEqual({ ...DEFAULT_HIGH_ABSENCE, isDefault: true });
    expect(res.body.storedOverride).toEqual(stored);
  });
});

describe('PUT /api/settings', () => {
  withBillingEnabled();
  const put = (app: express.Express, cookie: string, csrfToken: string, body: unknown) =>
    request(app).put('/api/settings').set('Cookie', cookie).set(CSRF_HEADER, csrfToken).send(body);

  it('saves a threshold on a trial account and returns it as effective', async () => {
    const { app, accounts, cookie, csrfToken } = await setup(trialAccount());
    const res = await put(app, cookie, csrfToken, { highAbsence: { minAbsenceRate: 0.2 } });
    expect(res.status).toBe(200);
    expect(res.body.highAbsence).toEqual({
      minAbsenceRate: 0.2,
      minDaysRecorded: DEFAULT_HIGH_ABSENCE.minDaysRecorded,
      isDefault: false,
    });
    const saved = await accounts.getByGoogleSub(SUB);
    expect(saved?.highAbsence).toEqual({
      minAbsenceRate: 0.2,
      minDaysRecorded: DEFAULT_HIGH_ABSENCE.minDaysRecorded,
    });
  });

  // The sample floor is a fixed statistical guard, not a policy choice, so it is
  // written from the default and a client cannot move it.
  it('ignores a client-supplied sample minimum rather than storing it', async () => {
    const { app, accounts, cookie, csrfToken } = await setup(trialAccount());
    const res = await put(app, cookie, csrfToken, {
      highAbsence: { minAbsenceRate: 0.2, minDaysRecorded: 40 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await accounts.getByGoogleSub(SUB))?.highAbsence).toBeNull();
  });

  it('refuses a free account and leaves the stored value untouched', async () => {
    const stored = { minAbsenceRate: 0.25, minDaysRecorded: 8 };
    const { app, accounts, cookie, csrfToken } = await setup(
      testAccount({ ...freeAccount(), highAbsence: stored }),
    );
    const res = await put(app, cookie, csrfToken, {
      highAbsence: { minAbsenceRate: 0.5, minDaysRecorded: 20 },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    expect((await accounts.getByGoogleSub(SUB))?.highAbsence).toEqual(stored);
  });

  const invalid: Array<[string, unknown]> = [
    ['a rate of zero', { minAbsenceRate: 0 }],
    ['a rate above 1', { minAbsenceRate: 1.5 }],
    ['a negative rate', { minAbsenceRate: -0.2 }],
    ['a missing rate', {}],
    ['a non-numeric rate', { minAbsenceRate: '20%' }],
  ];
  for (const [label, highAbsence] of invalid) {
    it(`rejects ${label} and leaves the stored value untouched`, async () => {
      const { app, accounts, cookie, csrfToken } = await setup(trialAccount());
      const res = await put(app, cookie, csrfToken, { highAbsence });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect((await accounts.getByGoogleSub(SUB))?.highAbsence).toBeNull();
    });
  }
});
