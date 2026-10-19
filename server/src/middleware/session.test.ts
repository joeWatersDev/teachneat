import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createSessionCookie,
  parseSessionCookie,
  requireSession,
  sessionOf,
} from './session.js';
import { errorHandler } from './errorHandler.js';
import { env } from '../config/env.js';
import { createMemorySessionStore, type SessionStore } from '../services/sessionStore.js';

function cookieHeader(sessionId: string): string {
  return `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(sessionId))}`;
}

function buildGatedApp(sessions: SessionStore) {
  const app = express();
  app.get('/gated', requireSession(sessions), (req, res) => {
    res.json({ googleSub: sessionOf(req).googleSub });
  });
  app.use(errorHandler);
  return app;
}

describe('session cookie signing', () => {
  it('roundtrips a session id', () => {
    const cookie = createSessionCookie('session-id-1');
    expect(parseSessionCookie(cookie)).toBe('session-id-1');
  });

  it('rejects a tampered id', () => {
    const cookie = createSessionCookie('session-id-1');
    const parts = cookie.split('.');
    expect(parseSessionCookie(`${parts[0]}.session-id-2.${parts[2]}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const cookie = createSessionCookie('session-id-1');
    const parts = cookie.split('.');
    const flipped = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect(parseSessionCookie(`${parts[0]}.${parts[1]}.${flipped}`)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie('garbage')).toBeNull();
    expect(parseSessionCookie('s2.foo')).toBeNull();
    // The Phase 1 stateless cookie format is no longer accepted.
    expect(parseSessionCookie('s1.body.sig')).toBeNull();
  });
});

describe('requireSession', () => {
  it('rejects a request with no cookie', async () => {
    const res = await request(buildGatedApp(createMemorySessionStore())).get('/gated');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a correctly signed id that names no live session', async () => {
    const res = await request(buildGatedApp(createMemorySessionStore()))
      .get('/gated')
      .set('Cookie', cookieHeader('never-issued'));
    expect(res.status).toBe(401);
  });

  it('resolves the account for a live session', async () => {
    const sessions = createMemorySessionStore();
    const created = await sessions.create('user-1');
    const res = await request(buildGatedApp(sessions))
      .get('/gated')
      .set('Cookie', cookieHeader(created.id));
    expect(res.status).toBe(200);
    expect(res.body.googleSub).toBe('user-1');
  });

  it('rejects a destroyed session, so sign-out revokes server-side', async () => {
    const sessions = createMemorySessionStore();
    const created = await sessions.create('user-1');
    await sessions.destroy(created.id);
    const res = await request(buildGatedApp(sessions))
      .get('/gated')
      .set('Cookie', cookieHeader(created.id));
    expect(res.status).toBe(401);
  });
});
