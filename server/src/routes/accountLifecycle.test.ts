import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Stripe from 'stripe';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie } from '../middleware/session.js';
import { CSRF_HEADER } from '../middleware/csrf.js';
import { env } from '../config/env.js';
import { createMemoryAccountStore, testAccount, type Account } from '../services/accountStore.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import { setStripeClient } from '../services/billing.js';

/**
 * The two account-lifecycle endpoints (Phase 2 Step 6f): signing out everywhere,
 * and deleting the account.
 *
 * A separate file from auth.test.ts because of the mock below. Deletion revokes
 * the Google grant, and the real implementation would reach Google over the
 * network from a unit test — so this file replaces that one function and leaves
 * the rest of the module alone, which is not something auth.test.ts's other
 * cases should have to opt into.
 */
const revokeRefreshToken = vi.fn<(token: string) => Promise<boolean>>();

vi.mock('../services/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/googleAuth.js')>()),
  revokeRefreshToken: (token: string) => revokeRefreshToken(token),
}));

const { buildAuthRouter } = await import('./auth.js');

async function setup(seed?: Partial<Account>) {
  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([
    testAccount({ googleSub: 'user-1', refreshToken: 'refresh-1', ...seed }),
  ]);
  const first = await sessions.create('user-1');
  const second = await sessions.create('user-1');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', buildAuthRouter(accounts, sessions));
  app.use(errorHandler);
  const cookieFor = (id: string) =>
    `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(id))}`;
  return { app, accounts, sessions, first, second, cookieFor };
}

beforeEach(() => {
  revokeRefreshToken.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  setStripeClient(null);
});

describe('DELETE /api/auth/sessions', () => {
  it('ends every session on the account, not just the calling one', async () => {
    const { app, sessions, first, second, cookieFor } = await setup();

    const res = await request(app)
      .delete('/api/auth/sessions')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(await sessions.get(first.id)).toBeNull();
    // The point of the feature: the classroom desktop the teacher is not sitting
    // at is the session they wanted gone.
    expect(await sessions.get(second.id)).toBeNull();
  });

  it('clears the cookie, so the calling browser is signed out too', async () => {
    const { app, first, cookieFor } = await setup();
    const res = await request(app)
      .delete('/api/auth/sessions')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);
    expect(res.headers['set-cookie']?.[0]).toContain(`${env.session.cookieName}=;`);
  });

  it('refuses without a session, and without CSRF', async () => {
    const { app, first, cookieFor } = await setup();
    expect((await request(app).delete('/api/auth/sessions')).status).toBe(401);
    const noCsrf = await request(app).delete('/api/auth/sessions').set('Cookie', cookieFor(first.id));
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF_INVALID');
  });
});

describe('DELETE /api/auth/account', () => {
  it('deletes the account, revokes the Google grant, and clears the cookie', async () => {
    const { app, accounts, sessions, first, second, cookieFor } = await setup();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
    expect(revokeRefreshToken).toHaveBeenCalledWith('refresh-1');
    expect(res.headers['set-cookie']?.[0]).toContain(`${env.session.cookieName}=;`);
    // Sessions go with the row. In Postgres that is ON DELETE CASCADE; the
    // memory store models the same thing, and either way no session may outlive
    // the account it authenticates.
    expect(await sessions.get(first.id)).toBeNull();
    expect(await sessions.get(second.id)).toBeNull();
  });

  it('proceeds when Google will not revoke the token', async () => {
    // The ordinary outcome for a token Google already considers dead. Refusing
    // to delete on it would trap a teacher in an account they asked to leave.
    revokeRefreshToken.mockResolvedValue(false);
    const { app, accounts, first, cookieFor } = await setup();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });

  it('cancels an active subscription before deleting anything', async () => {
    const cancel = vi.fn().mockResolvedValue({});
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_1', status: 'active' });
    setStripeClient({ subscriptions: { cancel, retrieve } } as unknown as Stripe);
    const { app, accounts, first, cookieFor } = await setup({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(cancel).toHaveBeenCalledWith('sub_1');
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });

  // The failure this endpoint exists to be careful about: a subscription that
  // outlives its account bills a card every month with nothing left that could
  // stop it, because the portal is reached through a session that no longer
  // exists.
  it('deletes nothing when the subscription cannot be cancelled', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('stripe is down'));
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_1', status: 'active' });
    setStripeClient({ subscriptions: { cancel, retrieve } } as unknown as Stripe);
    const { app, accounts, sessions, first, cookieFor } = await setup({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/could not be cancelled/i);
    // No stack trace, no Stripe error text.
    expect(JSON.stringify(res.body)).not.toMatch(/stripe is down/i);
    expect(await accounts.getByGoogleSub('user-1')).not.toBeNull();
    expect(await sessions.get(first.id)).not.toBeNull();
    expect(revokeRefreshToken).not.toHaveBeenCalled();
  });

  // The likeliest deletion of all, and the one that used to be impossible: a
  // teacher who cancelled, let the period run out, went back to free, and now
  // wants the account gone. The id stays on the row, and Stripe rejects
  // cancelling a subscription it has already cancelled.
  it('deletes an account whose subscription has already ended', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cannot cancel a canceled subscription'));
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_1', status: 'canceled' });
    setStripeClient({ subscriptions: { cancel, retrieve } } as unknown as Stripe);
    const { app, accounts, first, cookieFor } = await setup({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(cancel).not.toHaveBeenCalled();
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });

  // Same shape, different cause: a subscription Stripe has no record of at all
  // (test-mode data cleared, or an id from another environment). It bills
  // nobody, so it must not hold an account hostage either.
  it('deletes an account whose subscription no longer exists in Stripe', async () => {
    const cancel = vi.fn();
    const retrieve = vi.fn().mockRejectedValue(
      Object.assign(new Error('No such subscription'), { code: 'resource_missing' }),
    );
    setStripeClient({ subscriptions: { cancel, retrieve } } as unknown as Stripe);
    const { app, accounts, first, cookieFor } = await setup({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(204);
    expect(cancel).not.toHaveBeenCalled();
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });

  // A retrieve that fails for any other reason leaves the subscription's state
  // unknown, which is the case the refusal exists for.
  it('deletes nothing when the subscription state cannot be read', async () => {
    const cancel = vi.fn();
    const retrieve = vi.fn().mockRejectedValue(new Error('stripe is down'));
    setStripeClient({ subscriptions: { cancel, retrieve } } as unknown as Stripe);
    const { app, accounts, first, cookieFor } = await setup({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);

    expect(res.status).toBe(500);
    expect(cancel).not.toHaveBeenCalled();
    expect(await accounts.getByGoogleSub('user-1')).not.toBeNull();
  });

  it('skips Stripe entirely for an account that never subscribed', async () => {
    // No Stripe client is configured at all here: reaching for one would throw,
    // which is what makes this assert something.
    const { app, accounts, first, cookieFor } = await setup();
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookieFor(first.id))
      .set(CSRF_HEADER, first.csrfToken);
    expect(res.status).toBe(204);
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });

  it('refuses without a session, and without CSRF', async () => {
    const { app, accounts, first, cookieFor } = await setup();
    expect((await request(app).delete('/api/auth/account')).status).toBe(401);
    const noCsrf = await request(app).delete('/api/auth/account').set('Cookie', cookieFor(first.id));
    expect(noCsrf.status).toBe(403);
    expect(await accounts.getByGoogleSub('user-1')).not.toBeNull();
  });
});
