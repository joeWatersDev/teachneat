import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { globalRateLimitKey, rateLimitKey } from './rateLimitKey.js';
import { createSessionCookie } from '../middleware/session.js';
import { hashSessionId } from '../services/sessionStore.js';
import { env } from '../config/env.js';

/** The minimum of a request these key functions actually read. */
function req(opts: { ip?: string; cookie?: string; googleSub?: string }): Request {
  return {
    ip: opts.ip,
    headers: opts.cookie === undefined ? {} : { cookie: opts.cookie },
    session: opts.googleSub === undefined ? undefined : { googleSub: opts.googleSub },
  } as unknown as Request;
}

const cookieFor = (id: string) =>
  `${env.session.cookieName}=${encodeURIComponent(createSessionCookie(id))}`;

describe('rateLimitKey', () => {
  it('prefers the session account', () => {
    expect(rateLimitKey(req({ ip: '203.0.113.9', googleSub: 'sub-1' }))).toBe('sub-1');
  });

  it('collapses an IPv6 address to its subnet so a new address is not a new bucket', () => {
    const a = rateLimitKey(req({ ip: '2001:db8:1234:5678:1:2:3:4' }));
    const b = rateLimitKey(req({ ip: '2001:db8:1234:5678:9:a:b:c' }));
    expect(a).toBe(b);
  });
});

describe('globalRateLimitKey', () => {
  it('keys on the session hash when the cookie is validly signed', () => {
    const key = globalRateLimitKey(req({ ip: '203.0.113.9', cookie: cookieFor('abc') }));
    expect(key).toBe(`s:${hashSessionId('abc')}`);
    // The raw id never enters the key space.
    expect(key).not.toContain('abc');
  });

  it('gives two sessions behind one address separate buckets', () => {
    const a = globalRateLimitKey(req({ ip: '203.0.113.9', cookie: cookieFor('one') }));
    const b = globalRateLimitKey(req({ ip: '203.0.113.9', cookie: cookieFor('two') }));
    expect(a).not.toBe(b);
  });

  it('falls back to the IP subnet with no cookie', () => {
    expect(globalRateLimitKey(req({ ip: '203.0.113.9' }))).toBe('i:203.0.113.9');
  });

  it('falls back to the IP for a cookie whose signature does not verify', () => {
    // Otherwise anyone could mint a bucket of their own and the limiter would be
    // decorative.
    const forged = `${env.session.cookieName}=${encodeURIComponent('s2.abc.notasignature')}`;
    expect(globalRateLimitKey(req({ ip: '203.0.113.9', cookie: forged }))).toBe('i:203.0.113.9');
  });

  it('cannot collide a session bucket with an address bucket', () => {
    const session = globalRateLimitKey(req({ ip: '203.0.113.9', cookie: cookieFor('x') }));
    const address = globalRateLimitKey(req({ ip: '203.0.113.9' }));
    expect(session.startsWith('s:')).toBe(true);
    expect(address.startsWith('i:')).toBe(true);
  });
});
