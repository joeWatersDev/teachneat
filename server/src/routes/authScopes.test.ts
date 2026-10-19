import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/errorHandler.js';
import { createMemoryAccountStore } from '../services/accountStore.js';
import { createMemorySessionStore } from '../services/sessionStore.js';

// The exchange is the only thing replaced: everything the callback does before
// and after it runs as mounted.
vi.mock('../services/googleAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleAuth.js')>();
  return { ...actual, exchangeCodeForTokens: vi.fn() };
});

const { exchangeCodeForTokens, MissingScopesError } = await import('../services/googleAuth.js');
const { buildAuthRouter } = await import('./auth.js');

describe('GET /api/auth/google/callback — a partial grant', () => {
  beforeEach(() => {
    vi.mocked(exchangeCodeForTokens).mockReset();
  });

  it('refuses the sign-in with SCOPES_MISSING and writes no account or session', async () => {
    vi.mocked(exchangeCodeForTokens).mockImplementation(async () => {
      throw new MissingScopesError(['https://www.googleapis.com/auth/gmail.send']);
    });
    const accounts = createMemoryAccountStore([]);
    const sessions = createMemorySessionStore();
    const upsert = vi.spyOn(accounts, 'upsert');
    const create = vi.spyOn(sessions, 'create');
    const app = express();
    app.use('/api/auth', buildAuthRouter(accounts, sessions));
    app.use(errorHandler);

    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=s1')
      .set('Cookie', 'ttk_oauth_state=s1');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/error?code=SCOPES_MISSING');
    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
