import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import type { SessionStore } from '../services/sessionStore.js';

/**
 * Cookie-based sessions. The cookie carries only an opaque session id, signed
 * so a forged or truncated value is rejected without touching the database; the
 * session's actual state (which account, its CSRF token, its expiry) lives
 * server-side in the session store, which is what makes sign-out a real
 * revocation.
 */

const SIGNED_PREFIX = 's2.';

export interface SessionContext {
  /** Raw session id from the cookie — needed to revoke on logout. */
  id: string;
  googleSub: string;
  csrfToken: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionContext;
  }
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/** Wraps a raw session id in the signed cookie value. */
export function createSessionCookie(sessionId: string): string {
  return `${SIGNED_PREFIX}${sessionId}.${sign(sessionId, env.session.secret)}`;
}

/** Unwraps a signed cookie value back to the session id, or null if invalid. */
export function parseSessionCookie(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith(SIGNED_PREFIX)) return null;
  const rest = raw.slice(SIGNED_PREFIX.length);
  const idx = rest.lastIndexOf('.');
  if (idx <= 0) return null;
  const sessionId = rest.slice(0, idx);
  const sig = rest.slice(idx + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(sessionId, env.session.secret));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function cookieAttributes(value: string, maxAgeSeconds?: number): string {
  return [
    `${env.session.cookieName}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: the OAuth callback is a cross-site redirect back
    // into the app, and the session cookie has to be sent on that navigation.
    'SameSite=Lax',
    env.nodeEnv === 'production' ? 'Secure' : '',
    maxAgeSeconds === undefined ? '' : `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function setSessionCookieOnResponse(
  res: Response,
  sessionId: string,
  maxAgeSeconds?: number,
): void {
  res.setHeader(
    'Set-Cookie',
    cookieAttributes(encodeURIComponent(createSessionCookie(sessionId)), maxAgeSeconds),
  );
}

export function clearSessionCookieOnResponse(res: Response): void {
  res.setHeader('Set-Cookie', cookieAttributes('', 0));
}

/** The signed session id on this request, before any store lookup. */
export function readSessionId(req: Request): string | null {
  return parseSessionCookie(readCookie(req, env.session.cookieName));
}

/**
 * Loads the session for this request, if the cookie names a live one. Does not
 * reject anonymous requests — use requireSession for that.
 */
export async function loadSession(
  req: Request,
  store: SessionStore,
): Promise<SessionContext | null> {
  const id = readSessionId(req);
  if (!id) return null;
  const record = await store.get(id);
  if (!record) return null;
  const context: SessionContext = {
    id,
    googleSub: record.googleSub,
    csrfToken: record.csrfToken,
  };
  req.session = context;
  return context;
}

/**
 * Gates a router behind an authenticated session. Every tool route mounts
 * behind this, so a handler can rely on req.session being present.
 */
export function requireSession(store: SessionStore): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    loadSession(req, store)
      .then((session) => {
        if (!session) {
          next(new ApiError('UNAUTHORIZED', 'Not signed in.'));
          return;
        }
        next();
      })
      .catch(next);
  };
}

/** The session a gated route can assume exists. Throws if the gate was skipped. */
export function sessionOf(req: Request): SessionContext {
  if (!req.session) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
  return req.session;
}
