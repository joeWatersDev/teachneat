import { Router } from 'express';
import { z } from 'zod';
import { resolveSheetsContext } from '../middleware/sheetsContext.js';
import { createActivityRecorder, type ActivityRecorder } from '../services/activity.js';
import { createPgUsageStore } from '../services/usageStore.js';
import { requirePremium } from '../middleware/entitlements.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import { ApiError } from '../utils/errors.js';
import { ATTENDANCE_STATUS_KEYS } from '../config/schema.js';
import {
  listByDate,
  listByRange,
  submitAttendance,
  updateAttendance,
  getStats,
} from '../services/attendance.js';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    );
  }, 'Invalid calendar date');

const submitSchema = z
  .object({
    date: dateSchema,
    course: z.string().min(1).max(60),
    entries: z
      .array(
        z
          .object({
            studentId: z.string().min(1).max(40),
            statusKey: z.enum([...ATTENDANCE_STATUS_KEYS]),
            notes: z.string().max(500).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const courseQuerySchema = z.string().min(1).max(60);

const updateSchema = z
  .object({
    statusKey: z.enum([...ATTENDANCE_STATUS_KEYS]),
    notes: z.string().max(500).nullable(),
  })
  .partial()
  .strict();

const rangeQuerySchema = z
  .object({ startDate: dateSchema, endDate: dateSchema })
  .refine((q) => q.startDate <= q.endDate, 'startDate must not be after endDate');

export function buildAttendanceRouter(
  store: AccountStore = createPgAccountStore(),
  activity: ActivityRecorder = createActivityRecorder(store, createPgUsageStore()),
): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const date = dateSchema.parse(req.query.date);
      const course =
        req.query.course !== undefined ? courseQuerySchema.parse(req.query.course) : undefined;
      res.json(await listByDate(sheets, spreadsheetId, userKey, date, course));
    } catch (e) {
      next(e);
    }
  });

  // Free, like daily entry: the History grid and the student-detail heatmap
  // both read a range, and both are a record of what was taken rather than
  // analysis of it. Only the computed statistics are premium.
  router.get('/range', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { startDate, endDate } = rangeQuerySchema.parse({
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      const course =
        req.query.course !== undefined ? courseQuerySchema.parse(req.query.course) : undefined;
      res.json(await listByRange(sheets, spreadsheetId, userKey, startDate, endDate, course));
    } catch (e) {
      next(e);
    }
  });

  router.get('/stats', requirePremium(store, 'Attendance statistics'), async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { startDate, endDate } = req.query;
      if ((startDate === undefined) !== (endDate === undefined)) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'startDate and endDate must be provided together or omitted together.',
        );
      }
      const range =
        startDate !== undefined
          ? rangeQuerySchema.parse({ startDate, endDate })
          : undefined;
      const course =
        req.query.course !== undefined ? courseQuerySchema.parse(req.query.course) : undefined;
      res.json(await getStats(sheets, spreadsheetId, userKey, range, course));
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey, accountId } = await resolveSheetsContext(req, store);
      const { date, course, entries } = submitSchema.parse(req.body);
      const result = await submitAttendance(sheets, spreadsheetId, userKey, date, course, entries);
      // Counted here and not on the PUT below: submitting a day is the action,
      // and correcting one student's mark afterwards is the same day's work.
      await activity.recordToolUse({ googleSub: userKey, accountId }, 'attendance');
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const patch = updateSchema.parse(req.body);
      res.json(await updateAttendance(sheets, spreadsheetId, userKey, req.params.id, patch));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
