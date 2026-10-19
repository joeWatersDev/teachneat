import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { createPgSupportStore, type SupportStore } from '../services/supportStore.js';
import {
  PUBLIC_SUPPORT_RATE_LIMIT,
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
} from '../config/support.js';

/**
 * The signed-out contact route (Phase 2 Step 5).
 *
 * Step 4 shipped support as signed-in only and said why: the account is the
 * identity, so the form asked for nothing we already knew, and the router
 * carried no anonymous write path. This is the other half, and the reason it
 * exists is specific to this product rather than general politeness — a teacher
 * whose school board has blocked the OAuth app cannot sign in at all, and that
 * is precisely the person most likely to need to reach us. A contact form only
 * reachable from behind a sign-in wall would be unreachable to them.
 *
 * It is the app's only unauthenticated write endpoint, so everything here is
 * built around that being true: one route, no reads, no ids echoed back, a
 * tight IP-keyed rate limit, a honeypot, and a strict schema. It creates a row
 * and returns 204 — there is nothing an anonymous caller should be able to read
 * back, including the id of what they just wrote.
 */

/**
 * The honeypot. `website` is rendered off-screen and left empty by a person;
 * a naive form-filler completes every field it finds. Anything in it means the
 * submission is discarded — quietly, with the same 204 a real one gets, because
 * telling a bot which check it failed is how it learns to pass.
 */
const publicContactSchema = z
  .object({
    name: z.string().trim().min(1).max(SUPPORT_LIMITS.contactNameMax),
    email: z.string().trim().email().max(SUPPORT_LIMITS.contactEmailMax),
    category: z.enum(SUPPORT_CATEGORIES),
    subject: z.string().trim().min(1).max(SUPPORT_LIMITS.subjectMax),
    message: z.string().trim().min(1).max(SUPPORT_LIMITS.messageMax),
    website: z.string().max(SUPPORT_LIMITS.contactNameMax).optional(),
  })
  .strict();

/**
 * Built per router rather than at module scope, because the limiter holds
 * counters: at module scope every app built in a process would share one
 * bucket. That is invisible in production (one app per process) and wrong
 * everywhere else, and it is what makes the limit itself testable.
 */
function buildLimiter() {
  return rateLimit({
    windowMs: PUBLIC_SUPPORT_RATE_LIMIT.windowMs,
    limit: PUBLIC_SUPPORT_RATE_LIMIT.limit,
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed on the IP subnet rather than the shared `rateLimitKey` helper: that
    // one prefers the session's account, and there is deliberately no session
    // here. `ipKeyGenerator` normalizes IPv6 to its subnet, so a caller cannot
    // sidestep the limit by moving within the /64 they were handed.
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') ?? 'anon',
    handler: (_req, res) => {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many messages from this connection. Please try again later.',
      });
    },
  });
}

export function buildPublicSupportRouter(
  support: SupportStore = createPgSupportStore(),
): Router {
  const router = Router();
  const limiter = buildLimiter();

  router.post('/contact', limiter, async (req, res, next) => {
    try {
      const body = publicContactSchema.parse(req.body);

      // Discarded, not rejected. A 400 here would tell an automated filler
      // exactly which field to leave alone next time.
      if (body.website && body.website.length > 0) {
        res.status(204).end();
        return;
      }

      await support.createPublic({
        contactName: body.name,
        contactEmail: body.email,
        category: body.category,
        subject: body.subject,
        message: body.message,
      });

      // 204, not the created row. Nothing an anonymous caller writes should be
      // readable back to them, and an echoed id is a handle they have no use
      // for and we would then have to guard.
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
