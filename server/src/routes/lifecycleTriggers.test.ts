import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSessionCookie } from '../middleware/session.js';
import { CSRF_HEADER } from '../middleware/csrf.js';
import { env } from '../config/env.js';
import { CURRENT_TERMS_VERSION } from '../config/legal.js';
import { createMemoryAccountStore, testAccount, type Account } from '../services/accountStore.js';
import { createMemorySessionStore } from '../services/sessionStore.js';
import {
  createMemoryLifecycleEmailStore,
  type LifecycleEmailStore,
} from '../services/lifecycleEmail.js';

/**
 * Where lifecycle messages are queued from (Phase 2 Step 6h): the two request
 * paths that cause one, and the guarantee that neither of them can be broken by
 * the queue.
 *
 * Mocked for the same reason accountLifecycle.test.ts mocks it — deletion
 * revokes the Google grant, which would otherwise reach the network.
 */
const revokeRefreshToken = vi.fn<(token: string) => Promise<boolean>>();

vi.mock('../services/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/googleAuth.js')>()),
  revokeRefreshToken: (token: string) => revokeRefreshToken(token),
}));

const { buildAuthRouter } = await import('./auth.js');

async function setup(seed?: Partial<Account>, lifecycle?: LifecycleEmailStore) {
  const queue = lifecycle ?? createMemoryLifecycleEmailStore();
  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([
    testAccount({ googleSub: 'user-1', id: 'acct-1', ...seed }),
  ]);
  const session = await sessions.create('user-1');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', buildAuthRouter(accounts, sessions, queue));
  app.use(errorHandler);
  const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(session.id))}`;
  return { app, accounts, queue, session, cookie };
}

const consentBody = {
  termsVersion: CURRENT_TERMS_VERSION,
  acceptedTerms: true,
  acceptedDataResponsibility: true,
};

beforeEach(() => {
  revokeRefreshToken.mockReset().mockResolvedValue(true);
});

describe('POST /api/auth/consent', () => {
  it('queues the welcome message for a new account', async () => {
    const { app, queue, session, cookie } = await setup({ createdAt: new Date().toISOString() });

    const res = await request(app)
      .post('/api/auth/consent')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, session.csrfToken)
      .send(consentBody);

    expect(res.status).toBe(204);
    const rows = (queue as ReturnType<typeof createMemoryLifecycleEmailStore>).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageType).toBe('welcome');
    expect(rows[0]?.recipientEmail).toBe('teacher@example.com');
  });

  /**
   * This endpoint runs again for every existing account whenever the terms
   * version is bumped — which is exactly what Step 6j will do. Without the age
   * check, that bump would welcome teachers who have used the app for a year.
   */
  it('stays quiet when an established account re-accepts revised terms', async () => {
    const lastYear = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const { app, queue, session, cookie } = await setup({ createdAt: lastYear });

    await request(app)
      .post('/api/auth/consent')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, session.csrfToken)
      .send(consentBody);

    expect((queue as ReturnType<typeof createMemoryLifecycleEmailStore>).all()).toHaveLength(0);
  });

  /**
   * TESTING_PLAN asks for this on the signup path specifically: an outbound
   * provider or a database hiccup must not cost a teacher their registration.
   */
  it('records consent even when the queue is broken', async () => {
    const broken: LifecycleEmailStore = {
      enqueue: () => Promise.reject(new Error('database down')),
      claimDue: async () => [],
      markSent: async () => undefined,
      markFailed: async () => undefined,
      queueTrialMessages: async () => 0,
    };
    const { app, accounts, session, cookie } = await setup(
      { createdAt: new Date().toISOString(), termsAcceptedAt: null, termsVersion: '' },
      broken,
    );

    const res = await request(app)
      .post('/api/auth/consent')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, session.csrfToken)
      .send(consentBody);

    expect(res.status).toBe(204);
    expect((await accounts.getByGoogleSub('user-1'))?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });
});

describe('DELETE /api/auth/account', () => {
  /**
   * The queue row has to outlive the account row, which is why it holds its own
   * copy of the address and no foreign key back to `users` (migration 0010).
   */
  it('queues the confirmation, and it survives the account it belongs to', async () => {
    const { app, accounts, queue, session, cookie } = await setup();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, session.csrfToken);

    expect(res.status).toBe(204);
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
    const rows = (queue as ReturnType<typeof createMemoryLifecycleEmailStore>).all();
    expect(rows[0]?.messageType).toBe('account_deleted');
    expect(rows[0]?.recipientEmail).toBe('teacher@example.com');
  });

  it('deletes the account even when the queue is broken', async () => {
    const broken: LifecycleEmailStore = {
      enqueue: () => Promise.reject(new Error('database down')),
      claimDue: async () => [],
      markSent: async () => undefined,
      markFailed: async () => undefined,
      queueTrialMessages: async () => 0,
    };
    const { app, accounts, session, cookie } = await setup(undefined, broken);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, session.csrfToken);

    expect(res.status).toBe(204);
    expect(await accounts.getByGoogleSub('user-1')).toBeNull();
  });
});
