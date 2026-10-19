import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { loadAccount, planOf } from '../middleware/entitlements.js';
import { requireOperator } from '../middleware/operator.js';
import { rateLimitKey } from '../utils/rateLimitKey.js';
import {
  createPgAccountStore,
  type AccountStore,
  type PlanOverride,
} from '../services/accountStore.js';
import { createPgSupportStore, type SupportStore } from '../services/supportStore.js';
import { createPgMetricsStore, type MetricsStore } from '../services/metricsStore.js';
import {
  createPgUsageStore,
  PICKER_COUNTS_PAGE_OPENS,
  USAGE_RETENTION_MONTHS,
  type UsageStore,
} from '../services/usageStore.js';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  SUPPORT_RATE_LIMIT,
  SUPPORT_STATUSES,
} from '../config/support.js';
import { ApiError } from '../utils/errors.js';

/**
 * Contact / support (Phase 2 Step 4).
 *
 * Two audiences on one router. The submit-and-read-my-own endpoints are open to
 * any signed-in teacher; everything under `/admin` requires the operator
 * allowlist. Submission is signed-in only, which is what keeps this router free
 * of an anonymous write path, a captcha, and an email-address validation
 * problem: the account is the identity, and its email, name, and plan are read
 * from the account record rather than typed into the form.
 *
 * A public, signed-out contact route belongs with the landing page (Step 5),
 * where the people who need it actually are.
 */

/**
 * How far back the metrics view reads. Under the counters' 24-month retention,
 * so the view never shows a window that is partly pruned and reads as a decline
 * that did not happen.
 */
const METRICS_MONTHS = 12;

const createSchema = z
  .object({
    category: z.enum(SUPPORT_CATEGORIES),
    subject: z.string().trim().min(1).max(SUPPORT_LIMITS.subjectMax),
    message: z.string().trim().min(1).max(SUPPORT_LIMITS.messageMax),
  })
  .strict();

const triageSchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    adminNote: z.string().max(SUPPORT_LIMITS.adminNoteMax).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, {
    message: 'Provide a status, a note, or both.',
  });

/**
 * The comp mechanism. `plan_override` already exists for exactly this (Step 3),
 * so support grants a plan the same way the dev toggle does and the
 * Stripe-managed subscription fields stay untouched — a comped teacher's real
 * billing state is still whatever Stripe says it is, which is what makes the
 * comp removable without unpicking anything.
 */
const compSchema = z
  .object({ override: z.enum(['free', 'trial', 'paid']).nullable() })
  .strict();

const statusQuerySchema = z.object({ status: z.enum(SUPPORT_STATUSES).optional() }).strict();

/**
 * Keeps a stuck client from filling the table. Not a security boundary — the
 * route is already behind a session — so it is generous enough that a teacher
 * reporting three separate problems in one sitting never meets it.
 */
const submitLimiter = rateLimit({
  windowMs: SUPPORT_RATE_LIMIT.windowMs,
  limit: SUPPORT_RATE_LIMIT.limit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  handler: (_req, res) => {
    res.status(429).json({
      code: 'RATE_LIMITED',
      message: 'Too many support requests in a short period. Please try again later.',
    });
  },
});

export function buildSupportRouter(
  accounts: AccountStore = createPgAccountStore(),
  support: SupportStore = createPgSupportStore(),
  metrics: MetricsStore = createPgMetricsStore(),
  usage: UsageStore = createPgUsageStore(),
): Router {
  const router = Router();

  router.post('/requests', submitLimiter, async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const { account, plan } = await planOf(req, accounts);
      const created = await support.create({
        googleSub: account.googleSub,
        category: body.category,
        subject: body.subject,
        message: body.message,
        planAtSubmit: plan,
      });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  });

  // A teacher can see what they sent and what came of it. Cheap, and it is the
  // difference between a form that might have worked and a record that did.
  router.get('/requests', async (req, res, next) => {
    try {
      const account = await loadAccount(req, accounts);
      res.json(await support.listForUser(account.googleSub));
    } catch (e) {
      next(e);
    }
  });

  const admin = Router();
  admin.use(requireOperator);

  admin.get('/requests', async (req, res, next) => {
    try {
      const { status } = statusQuerySchema.parse(req.query);
      res.json(await support.listAll(status));
    } catch (e) {
      next(e);
    }
  });

  admin.patch('/requests/:id', async (req, res, next) => {
    try {
      const changes = triageSchema.parse(req.body);
      const updated = await support.update(req.params.id, changes);
      if (!updated) throw new ApiError('NOT_FOUND', 'Support request not found.');
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });

  /**
   * Grant or clear a comp. Keyed on the account rather than on a request id:
   * the reason for a comp usually arrives in a support request, but the grant
   * is an account action and outlives the conversation that prompted it.
   */
  admin.post('/accounts/:googleSub/plan-override', async (req, res, next) => {
    try {
      const { override } = compSchema.parse(req.body);
      const target = await accounts.getByGoogleSub(req.params.googleSub);
      if (!target) throw new ApiError('NOT_FOUND', 'Account not found.');
      await accounts.setPlanOverride(target.googleSub, override as PlanOverride | null);
      res.json({ googleSub: target.googleSub, override });
    } catch (e) {
      next(e);
    }
  });

  /**
   * The operator metrics view (Step 6j). Totals only: the funnel counts
   * accounts per milestone and the usage block counts tool invocations per
   * month across all of them. Nothing here returns or names an account.
   *
   * `pickerCountsPageOpens` and `retentionMonths` are served rather than
   * duplicated in the client, so the caveat the picker column needs and the
   * retention window the privacy policy states both come from the same
   * constants the server enforces them with.
   */
  admin.get('/metrics', async (_req, res, next) => {
    try {
      const [funnel, signups, usageByPeriod] = await Promise.all([
        metrics.funnel(),
        metrics.signups(METRICS_MONTHS),
        usage.totalsByPeriod(METRICS_MONTHS),
      ]);
      res.json({
        funnel,
        signups,
        usage: usageByPeriod,
        pickerCountsPageOpens: PICKER_COUNTS_PAGE_OPENS,
        retentionMonths: USAGE_RETENTION_MONTHS,
      });
    } catch (e) {
      next(e);
    }
  });

  /**
   * One account's activation state, for the support ticket view.
   *
   * Deliberately not a search: it is keyed on a google_sub the operator already
   * holds because a request from that account is open in front of them, which
   * is the same key the comp grant above uses. There is no listing endpoint and
   * no lookup by email, so an operator cannot browse accounts that have not
   * written in.
   *
   * Returns milestones and counts only — never the refresh token, the
   * spreadsheet id, or anything from the teacher's Sheet.
   */
  admin.get('/accounts/:googleSub/activity', async (req, res, next) => {
    try {
      const target = await accounts.getByGoogleSub(req.params.googleSub);
      if (!target) throw new ApiError('NOT_FOUND', 'Account not found.');
      res.json({
        createdAt: target.createdAt,
        milestones: {
          onboardedAt: target.onboardedAt,
          firstStudentAt: target.firstStudentAt,
          firstAttendanceAt: target.firstAttendanceAt,
          firstGroupingAt: target.firstGroupingAt,
          firstPickerAt: target.firstPickerAt,
          firstEmailAt: target.firstEmailAt,
          firstPremiumAttemptAt: target.firstPremiumAttemptAt,
        },
        usage: await usage.forAccount(target.id, METRICS_MONTHS),
      });
    } catch (e) {
      next(e);
    }
  });

  router.use('/admin', admin);

  return router;
}
