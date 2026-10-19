import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildAuthRouter, returningTeacherOnFreshAccount } from './auth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie } from '../middleware/session.js';
import { CSRF_HEADER } from '../middleware/csrf.js';
import { env } from '../config/env.js';
import { CURRENT_TERMS_VERSION } from '../config/legal.js';
import { createMemoryAccountStore, testAccount, type Account } from '../services/accountStore.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import { withBillingEnabled } from '../test/billing.js';

const account: Account = testAccount({ id: 'acct-1', googleSub: 'user-1', name: 'Teacher' });

async function setup(seed: Account = account) {
  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([seed]);
  const created = await sessions.create('user-1');
  const app = express();
  // Needed by POST /consent, which is the only route on this router with a
  // body. Mounted for every case rather than a second app, so the tests below
  // exercise the router as index.ts actually mounts it.
  app.use(express.json());
  app.use('/api/auth', buildAuthRouter(accounts, sessions));
  app.use(errorHandler);
  const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;
  return { app, sessions, cookie, sessionId: created.id, csrfToken: created.csrfToken };
}

describe('GET /api/auth/me', () => {
  withBillingEnabled();
  it('returns 401 with no session', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns the profile and the session CSRF token', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'teacher@example.com', csrfToken });
  });

  it('reports the resolved plan and, on trial, when it ends', async () => {
    const trialEndsAt = new Date(Date.now() + 86_400_000).toISOString();
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', trialEndsAt }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).toMatchObject({ plan: 'trial', trialEndsAt });
  });

  it('omits trialEndsAt once the account is not on trial', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', trialEndsAt: past }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.plan).toBe('free');
    expect(res.body).not.toHaveProperty('trialEndsAt');
  });

  /**
   * Why a `free` account lost premium. One flag meaning "the trial ended" told a
   * teacher who paid for a year and cancelled, and one whose subscription is
   * paused for the summer, about a trial that finished long before either event —
   * both have an expired trial on the record, which is why a single flag could
   * not tell them apart.
   */
  describe('lapsedFrom', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();

    it('names the trial for an account that only ever had one', async () => {
      const { app, cookie } = await setup(
        testAccount({ googleSub: 'user-1', trialEndsAt: past, stripeSubscriptionId: null }),
      );
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body).toMatchObject({ plan: 'free', lapsedFrom: 'trial' });
    });

    // The subscription id is never cleared, so holding one is the record that an
    // account has had a subscription — and that is the more recent loss.
    it('names the subscription once the account has ever had one', async () => {
      const { app, cookie } = await setup(
        testAccount({
          googleSub: 'user-1',
          trialEndsAt: past,
          stripeSubscriptionId: 'sub_1',
          subscriptionStatus: 'canceled',
        }),
      );
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body.lapsedFrom).toBe('subscription');
    });

    // A pause outranks both: it is not a loss, and the teacher chose it.
    it('names the pause ahead of the subscription and the trial', async () => {
      const { app, cookie } = await setup(
        testAccount({
          googleSub: 'user-1',
          trialEndsAt: past,
          stripeSubscriptionId: 'sub_1',
          subscriptionStatus: 'active',
          collectionPaused: true,
        }),
      );
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body).toMatchObject({ plan: 'free', lapsedFrom: 'paused' });
    });

    /**
     * Absent is the case the copy treats as an invitation rather than an
     * explanation, so it must not be reachable by an account that has lost
     * something.
     */
    it('is absent for an account that has never had premium', async () => {
      const { app, cookie } = await setup(
        testAccount({ googleSub: 'user-1', trialEndsAt: null, stripeSubscriptionId: null }),
      );
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body.plan).toBe('free');
      expect(res.body).not.toHaveProperty('lapsedFrom');
    });

    it('is absent while the account still has premium', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const { app, cookie } = await setup(
        testAccount({ googleSub: 'user-1', trialEndsAt: future }),
      );
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body.plan).toBe('trial');
      expect(res.body).not.toHaveProperty('lapsedFrom');
    });
  });

  /**
   * The promo end date, for the account page's badge. Wording rather than
   * permission, like the pause fields: until this was sent, the date existed
   * only inside the reminder email, so a teacher on the promo had no way to see
   * when their free period ended without going to find that message.
   */
  it('reports when a founding-user promo ends', async () => {
    const promoEndsAt = new Date(Date.now() + 300 * 86_400_000).toISOString();
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', promoEndsAt }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).toMatchObject({ promoEndsAt });
  });

  /**
   * The cancellation dialog needs this date to tell a promo-covered teacher that
   * cancelling ends their subscription now rather than when the offer does. It is
   * withheld without a live subscription because Stripe reports a terminated
   * subscription's original period end, so a `canceled` account carries a future
   * date that would read as "access until".
   */
  it('reports the current period end for a live subscription', async () => {
    const currentPeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { app, cookie } = await setup(
      testAccount({
        googleSub: 'user-1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'active',
        currentPeriodEnd,
      }),
    );
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).toMatchObject({ currentPeriodEnd });
  });

  it('withholds the period end once the subscription is not live', async () => {
    const { app, cookie } = await setup(
      testAccount({
        googleSub: 'user-1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'canceled',
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    );
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).not.toHaveProperty('currentPeriodEnd');
  });

  it('omits promoEndsAt for an account with no promo', async () => {
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', promoEndsAt: null }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).not.toHaveProperty('promoEndsAt');
  });

  // A rendering hint, never a permission — the toggle endpoint re-checks both
  // guards itself, so a client that forges this flag gains nothing.
  it('reports devTools false for a non-allowlisted account', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.devTools).toBe(false);
  });

  it('reports needsOnboarding for an account that has not finished the guide', async () => {
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', onboardedAt: null }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.needsOnboarding).toBe(true);
  });

  it('reports needsOnboarding false once it has', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.needsOnboarding).toBe(false);
  });

  // What the account menu uses to stop offering the first-run guide (Step 6f).
  // Separate from needsOnboarding above, and deliberately: a teacher can skip
  // the guide on day one, which finishes onboarding without their ever having
  // added anyone.
  it('reports hasStudents from the account record', async () => {
    const { app, cookie } = await setup();
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.hasStudents).toBe(
      false,
    );

    const withStudents = await setup(
      testAccount({ googleSub: 'user-1', firstStudentAt: new Date().toISOString() }),
    );
    const res = await request(withStudents.app)
      .get('/api/auth/me')
      .set('Cookie', withStudents.cookie);
    expect(res.body.hasStudents).toBe(true);
  });
});

/**
 * The profile under the launch flag (Phase 2 Step 8a). Everything the block
 * above describes is what returns when billing does; this is what ships.
 *
 * The fields are *withheld* rather than sent with falsy values, deliberately: a
 * `trialEndsAt` that arrives on every profile is a date the client has to know
 * to ignore, and the one thing worse than an upgrade affordance during a free
 * launch is a trial countdown behind it.
 */
describe('GET /api/auth/me with billing switched off', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it('reports billingEnabled false and resolves every account to paid', async () => {
    const { app, cookie } = await setup(testAccount({ googleSub: 'user-1', trialEndsAt: past }));
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.billingEnabled).toBe(false);
    expect(res.body.plan).toBe('paid');
  });

  it('withholds every field that describes a trial or a subscription', async () => {
    const { app, cookie } = await setup(
      testAccount({
        googleSub: 'user-1',
        trialEndsAt: future,
        stripeCustomerId: 'cus_1',
        subscriptionStatus: 'active',
        currentPeriodEnd: future,
        promoEndsAt: future,
        collectionPaused: true,
        pauseResumesAt: future,
      }),
    );
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    for (const field of [
      'trialEndsAt',
      'lapsedFrom',
      'paused',
      'pauseResumesAt',
      'promoEndsAt',
      'currentPeriodEnd',
    ]) {
      expect(res.body).not.toHaveProperty(field);
    }
    expect(res.body.canCancel).toBe(false);
    expect(res.body.pauseAvailable).toBe(false);
    expect(res.body.hasBilling).toBe(false);
  });
});

describe('GET /api/auth/google/callback — Google reported an error', () => {
  // Google sends no `code` at all on these, so before Step 5a every one of them
  // was reported to the teacher as a malformed request.
  async function callback(query: string) {
    const { app } = await setup();
    return request(app).get(`/api/auth/google/callback?${query}`);
  }

  it('names the blocked-domain case from error_subtype', async () => {
    const res = await callback('error=access_denied&error_subtype=admin_policy_enforced');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/error?code=ADMIN_POLICY_BLOCKED');
  });

  // The same condition, signalled the other way Google signals it.
  it('names it from error_description when there is no subtype', async () => {
    const res = await callback(
      'error=access_denied&error_description=Blocked%3A%20admin_policy_enforced',
    );
    expect(res.headers.location).toContain('code=ADMIN_POLICY_BLOCKED');
  });

  it('distinguishes a teacher declining consent from a blocked domain', async () => {
    const res = await callback('error=access_denied');
    expect(res.headers.location).toContain('code=CONSENT_DECLINED');
  });

  it('falls back to a generic OAuth code for anything else', async () => {
    const res = await callback('error=server_error');
    expect(res.headers.location).toContain('code=OAUTH_ERROR');
  });

  // The error branch must not swallow the malformed-request case it sits in
  // front of: a callback with neither an error nor a usable code is still bad.
  it('still reports a missing code with no error as a validation failure', async () => {
    const res = await callback('state=abc');
    expect(res.headers.location).toContain('code=VALIDATION_ERROR');
  });
});

describe('POST /api/auth/onboarding/complete', () => {
  it('marks the account onboarded, so /me stops asking', async () => {
    const { app, cookie, csrfToken } = await setup(
      testAccount({ googleSub: 'user-1', onboardedAt: null }),
    );
    const res = await request(app)
      .post('/api/auth/onboarding/complete')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken);
    expect(res.status).toBe(204);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.needsOnboarding).toBe(false);
  });

  it('is idempotent, so re-opening the guide does not move the timestamp', async () => {
    const { app, cookie, csrfToken } = await setup(
      testAccount({ googleSub: 'user-1', onboardedAt: null }),
    );
    const post = () =>
      request(app)
        .post('/api/auth/onboarding/complete')
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrfToken);
    await post();
    const second = await post();
    expect(second.status).toBe(204);
  });

  it('rejects an anonymous caller', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/auth/onboarding/complete');
    expect(res.status).toBe(401);
  });

  it('rejects a caller with a session but no CSRF token', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).post('/api/auth/onboarding/complete').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });
});

describe('POST /api/auth/consent', () => {
  const unconsented = () =>
    testAccount({
      googleSub: 'user-1',
      termsAcceptedAt: null,
      termsVersion: '',
      dataResponsibilityAcceptedAt: null,
    });

  const accept = (
    app: express.Express,
    cookie: string,
    csrfToken: string,
    body: Record<string, unknown>,
  ) =>
    request(app)
      .post('/api/auth/consent')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send(body);

  const validBody = {
    termsVersion: CURRENT_TERMS_VERSION,
    acceptedTerms: true,
    acceptedDataResponsibility: true,
  };

  it('records both agreements, so /me stops asking', async () => {
    const { app, cookie, csrfToken } = await setup(unconsented());
    const before = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(before.body.needsConsent).toBe(true);

    const res = await accept(app, cookie, csrfToken, validBody);
    expect(res.status).toBe(204);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.body.needsConsent).toBe(false);
  });

  it('reports the version in force, so the client can echo it back', async () => {
    const { app, cookie } = await setup(unconsented());
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  // The core of it: neither agreement may be arrived at by omission. A client
  // bug that drops a field must not be recorded as consent.
  it.each([
    ['the terms flag missing', { termsVersion: CURRENT_TERMS_VERSION, acceptedDataResponsibility: true }],
    ['the responsibility flag missing', { termsVersion: CURRENT_TERMS_VERSION, acceptedTerms: true }],
    ['the terms flag false', { ...validBody, acceptedTerms: false }],
    ['the responsibility flag false', { ...validBody, acceptedDataResponsibility: false }],
    ['both flags false', { termsVersion: CURRENT_TERMS_VERSION, acceptedTerms: false, acceptedDataResponsibility: false }],
  ])('refuses %s, and records nothing', async (_label, body) => {
    const { app, cookie, csrfToken } = await setup(unconsented());
    const res = await accept(app, cookie, csrfToken, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.needsConsent).toBe(true);
  });

  it('refuses a stale version, so a cached client cannot accept unseen terms', async () => {
    const { app, cookie, csrfToken } = await setup(unconsented());
    const res = await accept(app, cookie, csrfToken, {
      ...validBody,
      termsVersion: 'an-older-version',
    });
    expect(res.status).toBe(400);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.needsConsent).toBe(true);
  });

  it('rejects unexpected fields', async () => {
    const { app, cookie, csrfToken } = await setup(unconsented());
    const res = await accept(app, cookie, csrfToken, { ...validBody, plan: 'paid' });
    expect(res.status).toBe(400);
  });

  it('rejects an anonymous caller', async () => {
    const { app } = await setup(unconsented());
    const res = await request(app).post('/api/auth/consent').send(validBody);
    expect(res.status).toBe(401);
  });

  it('rejects a caller with a session but no CSRF token', async () => {
    const { app, cookie } = await setup(unconsented());
    const res = await request(app).post('/api/auth/consent').send(validBody).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session server-side and clears the cookie', async () => {
    const { app, sessions, cookie, sessionId, csrfToken } = await setup();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken);

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toContain('Max-Age=0');
    // The cookie value would still verify; the session behind it is gone.
    expect(await sessions.get(sessionId)).toBeNull();
  });

  it('rejects a logout with no CSRF token, leaving the session intact', async () => {
    const { app, sessions, cookie, sessionId } = await setup();
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
    expect(await sessions.get(sessionId)).not.toBeNull();
  });

  it('is a no-op when there is no session', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

// The predicate the OAuth callback uses to decide whether a teacher signing in
// is returning to data they already have (Step 6d). Tested directly rather than
// through the callback: the success path needs the whole Google exchange
// mocked, and the decision worth pinning is this one.
describe('returningTeacherOnFreshAccount', () => {
  const freshRow = { onboardedAt: null, spreadsheetId: null };

  it('is true for a new account row whose Drive already held a spreadsheet', () => {
    expect(returningTeacherOnFreshAccount(freshRow, false)).toBe(true);
  });

  it('is false when bootstrap created the spreadsheet, which is a genuinely new teacher', () => {
    expect(returningTeacherOnFreshAccount(freshRow, true)).toBe(false);
  });

  // The case the spreadsheetId condition exists for: someone who opened the
  // guide, abandoned it, and signed back in also discovers rather than creates,
  // and must keep being offered it.
  it('is false for an account that already has a spreadsheet recorded', () => {
    expect(
      returningTeacherOnFreshAccount({ onboardedAt: null, spreadsheetId: 'sheet-1' }, false),
    ).toBe(false);
  });

  it('is false once onboarding is already recorded, there being nothing to suppress', () => {
    expect(
      returningTeacherOnFreshAccount(
        { onboardedAt: '2026-08-01T00:00:00.000Z', spreadsheetId: null },
        false,
      ),
    ).toBe(false);
  });
});
