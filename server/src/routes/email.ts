import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rateLimitKey } from '../utils/rateLimitKey.js';
import { resolveSheetsContext, resolveEmailContext } from '../middleware/sheetsContext.js';
// The limiter runs behind requireSession, so the session is already on the request.
import { planOf } from '../middleware/entitlements.js';
import {
  createPgAccountStore,
  emailPeriodOf,
  type Account,
  type AccountStore,
} from '../services/accountStore.js';
import { effectiveHighAbsence, isPremium, type Plan } from '../services/plan.js';
import {
  EMAIL_BURST_MAX,
  EMAIL_BURST_WINDOW_MS,
  MAX_RECIPIENTS_PER_SEND,
} from '../config/email.js';
import { FREE_MONTHLY_EMAIL_CAP } from '../config/plan.js';
import { createActivityRecorder, type ActivityRecorder } from '../services/activity.js';
import { createPgUsageStore } from '../services/usageStore.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  softDeleteTemplate,
} from '../services/emailTemplates.js';
import {
  sendEmails,
  getSendStatus,
  utcDay,
  type DailyEmailCounter,
  listRecipientMetrics,
  nextMonthStart,
  type MonthlyEmailQuota,
} from '../services/emailSend.js';

const placeholderKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/);

/**
 * A subject line. The CR/LF refusal is the security half: the subject is
 * interpolated into an RFC 2822 header block, where a line break is not a
 * strange character but the start of a header the teacher did not write, or the
 * end of the header block entirely. Refused at the door so nothing downstream
 * has to cope with it — `renderSubject` folds and `buildRawMessage` throws, and
 * this is what makes both of those unreachable in practice rather than load
 * bearing. A subject is a single line in every mail client anyway, so nothing
 * legitimate is lost.
 */
const subjectLine = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !/[\r\n]/.test(v), { message: 'A subject line cannot contain a line break.' });

const templateCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    subject: subjectLine,
    bodyHtml: z.string().min(1).max(50_000),
    placeholdersUsed: z.array(placeholderKey).max(50),
  })
  .strict();

const templateUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    subject: subjectLine,
    bodyHtml: z.string().min(1).max(50_000),
    placeholdersUsed: z.array(placeholderKey).max(50),
  })
  .partial()
  .strict();

const sendSchema = z
  .object({
    templateId: z.string().min(1).max(40),
    recipients: z
      .array(
        z
          .object({
            studentId: z.string().min(1).max(40),
            course: z.string().min(1).max(60),
            includeStudent: z.boolean(),
            includeParents: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_RECIPIENTS_PER_SEND),
    placeholderValues: z
      .record(z.string(), z.record(placeholderKey, z.string().max(1000)))
      .optional(),
    // Optional teacher-entered address copied on every message.
    copyAddress: z.email().max(254).optional(),
    copyMode: z.enum(['cc', 'bcc']).optional(),
  })
  .strict();

/**
 * Burst guard on the send endpoint, keyed per user (falls back to IP, see
 * `rateLimitKey`). Trips well before the "100 in 10s" threshold in
 * IMPLEMENTATION_PLAN.md.
 */
const sendBurstLimiter = rateLimit({
  windowMs: EMAIL_BURST_WINDOW_MS,
  limit: EMAIL_BURST_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  handler: (_req, res) => {
    res.status(429).json({
      code: 'EMAIL_RATE_LIMIT',
      message: 'Too many sends in a short period. Please wait a moment and try again.',
    });
  },
});

/**
 * The account's daily allowance, backed by the atomic Postgres counter.
 *
 * Built per request rather than held, so `peek` reflects the row as it stands
 * now: a send that landed a moment ago on another request has already moved it.
 * `release` is a negative `reserve`, and the store clamps at zero so a refund
 * cannot drive a day below empty.
 */
function dailyCounter(store: AccountStore, account: Account): DailyEmailCounter {
  const day = utcDay();
  return {
    reserve: (n) => store.addDailyEmailCount(account.googleSub, day, n),
    release: async (n) => {
      await store.addDailyEmailCount(account.googleSub, day, -n);
    },
    // A claim of zero returns the current total without changing it, which
    // keeps one code path for reading the day rather than a second query that
    // could disagree with it about when the day rolls over.
    peek: () => store.addDailyEmailCount(account.googleSub, day, 0),
  };
}

/**
 * The `free` plan's monthly allowance for this account, or `undefined` on
 * `trial` and `paid`, which have no monthly cap. The stored count belongs to a
 * specific calendar month; a count carried over from a previous month reads as
 * zero, and the store's increment resets it in the same statement.
 */
function monthlyQuota(
  store: AccountStore,
  account: Account,
  plan: Plan,
): MonthlyEmailQuota | undefined {
  if (isPremium(plan)) return undefined;
  const period = emailPeriodOf();
  return {
    used: account.monthlyEmailPeriod === period ? account.monthlyEmailCount : 0,
    cap: FREE_MONTHLY_EMAIL_CAP,
    resetsAt: nextMonthStart(),
    record: async (count) => {
      await store.addMonthlyEmailCount(account.googleSub, period, count);
    },
  };
}

export function buildEmailRouter(
  store: AccountStore = createPgAccountStore(),
  activity: ActivityRecorder = createActivityRecorder(store, createPgUsageStore()),
): Router {
  const router = Router();

  router.get('/templates', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await listTemplates(sheets, spreadsheetId, userKey));
    } catch (e) {
      next(e);
    }
  });

  router.post('/templates', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const input = templateCreateSchema.parse(req.body);
      res.status(201).json(await createTemplate(sheets, spreadsheetId, userKey, input));
    } catch (e) {
      next(e);
    }
  });

  router.get('/templates/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await getTemplate(sheets, spreadsheetId, userKey, req.params.id));
    } catch (e) {
      next(e);
    }
  });

  router.put('/templates/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const patch = templateUpdateSchema.parse(req.body);
      res.json(await updateTemplate(sheets, spreadsheetId, userKey, req.params.id, patch));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/templates/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      await softDeleteTemplate(sheets, spreadsheetId, userKey, req.params.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Free: the attendance figures the Compose view previews and selects on. The
  // statistics *view* is premium; these per-recipient numbers belong to a tool
  // the free tier has, so they get their own ungated read.
  router.get('/recipient-metrics', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { account, plan } = await planOf(req, store);
      const { threshold } = effectiveHighAbsence(account, plan);
      res.json(await listRecipientMetrics(sheets, spreadsheetId, userKey, threshold));
    } catch (e) {
      next(e);
    }
  });

  router.get('/send-status', async (req, res, next) => {
    try {
      const { account, plan } = await planOf(req, store);
      res.json(
        await getSendStatus(dailyCounter(store, account), plan, monthlyQuota(store, account, plan)),
      );
    } catch (e) {
      next(e);
    }
  });

  router.post('/send', sendBurstLimiter, async (req, res, next) => {
    try {
      const { gmail, sheets, spreadsheetId, userKey, accountId, senderEmail } =
        await resolveEmailContext(req, store);
      const { account, plan } = await planOf(req, store);
      const input = sendSchema.parse(req.body);
      const result = await sendEmails(
        gmail,
        sheets,
        spreadsheetId,
        userKey,
        senderEmail,
        input,
        { daily: dailyCounter(store, account), monthly: monthlyQuota(store, account, plan) },
        { accountId },
      );
      // One count per send, not per recipient. The counter is meant to say how
      // often a teacher reaches for the tool; a class of thirty would otherwise
      // outweigh a month of everything else. Recipient volume is already
      // tracked, against the cap, in monthly_email_count.
      await activity.recordToolUse({ googleSub: userKey, accountId }, 'email');
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
