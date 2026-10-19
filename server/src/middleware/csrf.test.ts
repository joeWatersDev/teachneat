import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireSession, createSessionCookie } from './session.js';
import { requireCsrf, CSRF_HEADER } from './csrf.js';
import { errorHandler } from './errorHandler.js';
import { env } from '../config/env.js';
import { createMemorySessionStore } from '../services/sessionStore.js';

async function setup() {
  const sessions = createMemorySessionStore();
  const created = await sessions.create('user-1');
  const app = express();
  app.use(express.json());
  app.use('/api/thing', [requireSession(sessions), requireCsrf], (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  const cookie = `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;
  return { app, cookie, csrfToken: created.csrfToken };
}

describe('requireCsrf', () => {
  it('allows a safe method without a token', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/thing').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('rejects a state-changing request with no token', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).post('/api/thing').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('rejects a token belonging to another session', async () => {
    const { app, cookie } = await setup();
    const other = await createMemorySessionStore().create('user-2');
    const res = await request(app)
      .post('/api/thing')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, other.csrfToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('allows a state-changing request carrying the session token', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .post('/api/thing')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({});
    expect(res.status).toBe(200);
  });

  it('rejects before CSRF when there is no session at all', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/thing').send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
