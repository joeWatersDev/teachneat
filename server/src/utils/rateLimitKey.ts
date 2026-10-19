import { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { readSessionId } from '../middleware/session.js';
import { hashSessionId } from '../services/sessionStore.js';

/**
 * The bucket key every per-user rate limiter uses: the session's account, with
 * an IP fallback.
 *
 * The fallback goes through `ipKeyGenerator` rather than using `req.ip`
 * directly. A raw IPv6 address identifies a single address out of the /64 a
 * client is typically handed, so an IPv6 caller could sidestep a limit entirely
 * just by picking a new address per request; `ipKeyGenerator` normalizes to a
 * subnet so the bucket covers the whole allocation. (This is also what
 * express-rate-limit's `ERR_ERL_KEY_GEN_IPV6` check warns about at startup.)
 *
 * In practice the fallback is nearly unreachable — every limiter that uses this
 * sits behind `requireSession` — but a limiter with a bypass in it is not worth
 * keeping on the strength of "nearly", and it should not be re-derived per
 * call site: the IPv6 subtlety was a real bug once already, and one shared key
 * function means it can only ever be fixed in one place.
 */
export function rateLimitKey(req: Request): string {
  return req.session?.googleSub ?? ipKeyGenerator(req.ip ?? '') ?? 'anon';
}

/**
 * The bucket key for the app-wide limiter, which unlike every other one is
 * mounted ahead of `requireSession` and so cannot read `req.session`.
 *
 * It keys on the signed cookie instead. That distinguishes one teacher from
 * another without a database round trip on every request, which matters because
 * this limiter runs on all of them, and the signature is what makes it safe to
 * trust for the purpose: a caller cannot mint a cookie for a session that is not
 * theirs, so they cannot spend someone else's allowance or dodge their own by
 * forging a fresh id.
 *
 * Why this matters more than it looks: the fallback is the caller's IP, and
 * behind a proxy with `TRUST_PROXY_HOPS` unset that is the proxy's address for
 * everyone. Without a session key the whole app shares a single 600/minute
 * bucket, so one busy teacher throttles the rest — a limiter that is supposed to
 * bound abuse becomes a way to cause it. Keying on the cookie means the shared
 * bucket only ever holds signed-out traffic.
 *
 * The **hash** rather than the id itself, so a session id never sits in the
 * limiter's key space in a form that could be replayed if that memory were ever
 * dumped or logged; it is the same value the sessions table stores, and it is
 * the reason this lives here rather than being written inline at the mount.
 *
 * The two branches are prefixed so they cannot collide: without them an IP
 * literal and a session hash share one namespace, and while no hex string is a
 * valid address today, that is a property of the formats rather than a
 * guarantee.
 *
 * Note that a validly signed cookie for a session that has since expired or been
 * revoked still gets its own bucket here. That is intended — such a request is
 * bounded by this limiter and then refused by `requireSession`, whereas skipping
 * the limiter for it would leave an attacker with one stolen-and-expired cookie
 * able to spend unbounded 401s.
 */
export function globalRateLimitKey(req: Request): string {
  const id = readSessionId(req);
  if (id) return `s:${hashSessionId(id)}`;
  return `i:${ipKeyGenerator(req.ip ?? '') ?? 'anon'}`;
}
