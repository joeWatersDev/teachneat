import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/errors.js';

/**
 * CSRF protection for state-changing requests.
 *
 * Every session carries a random token, handed to the client by GET /auth/me
 * and echoed back in this header on every unsafe request. An attacker's site
 * can cause the browser to send the session cookie, but cannot read the token,
 * so the echo is what distinguishes our own client from a forged request. This
 * sits on top of SameSite=Lax rather than replacing it: Lax alone still permits
 * top-level cross-site POST navigations in some browsers.
 */

export const CSRF_HEADER = 'x-csrf-token';

/** Methods that cannot change state, so they carry no token requirement. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Requires a valid per-session CSRF token on unsafe methods. Mounts after
 * requireSession, which is what puts the session (and its token) on the request.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const session = req.session;
  if (!session) {
    next(new ApiError('UNAUTHORIZED', 'Not signed in.'));
    return;
  }
  const provided = req.headers[CSRF_HEADER];
  const token = Array.isArray(provided) ? provided[0] : provided;
  if (!token || !tokensMatch(token, session.csrfToken)) {
    next(new ApiError('CSRF_INVALID', 'Your session token is missing or stale. Retry the action.'));
    return;
  }
  next();
}
