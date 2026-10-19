import { Router, type Request } from 'express';
import { z } from 'zod';
import { resolveSheetsContext } from '../middleware/sheetsContext.js';
import { createActivityRecorder, type ActivityRecorder } from '../services/activity.js';
import { createPgUsageStore } from '../services/usageStore.js';
import { loadAccount, planOf } from '../middleware/entitlements.js';
import { logger } from '../config/logger.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import { effectiveHighAbsence } from '../services/plan.js';
import { warmRoster } from '../services/rosterWarm.js';
import {
  listStudents,
  getStudent,
  createStudent,
  createStudentsBatch,
  updateStudent,
  softDeleteStudent,
  setStudentAtRisk,
} from '../services/students.js';
import { getStudentDetail } from '../services/studentDetail.js';
import { listRiskSummary } from '../services/risk.js';
import { emailAddressSchema } from '../utils/emailAddress.js';

/**
 * Shared with the send path rather than declared here, so what may be stored and
 * what may be sent to are one rule. See utils/emailAddress.ts for why they must
 * not drift.
 */
const emailField = emailAddressSchema;

const coursesField = z
  .array(z.string().min(1).max(60))
  .min(1)
  .max(20)
  .refine((list) => new Set(list.map((c) => c.trim())).size === list.length, {
    message: 'Courses must be unique.',
  });

const studentCreateSchema = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    goesBy: z.string().max(80).nullish(),
    pronouns: z.string().max(40).nullish(),
    courses: coursesField,
    studentEmail: emailField.nullish(),
    parentEmails: z.array(emailField).max(5).optional(),
    notes: z.string().max(2000).nullish(),
  })
  .strict();

// Bulk add sends one call per grid submission. Capped well above a realistic
// class size so a single append stays bounded; the client validates each row first.
const studentBatchSchema = z
  .object({
    students: z.array(studentCreateSchema).min(1).max(100),
  })
  .strict();

const studentUpdateSchema = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    goesBy: z.string().max(80).nullable(),
    pronouns: z.string().max(40).nullable(),
    courses: coursesField,
    studentEmail: emailField.nullable(),
    parentEmails: z.array(emailField).max(5),
    notes: z.string().max(2000).nullable(),
  })
  .partial()
  .strict();

const atRiskSchema = z
  .object({
    course: z.string().min(1).max(60),
    atRisk: z.boolean(),
  })
  .strict();

/**
 * Records that this account has had a student, so the account menu can stop
 * offering the first-run guide (Step 6f).
 *
 * Called from a create and from a non-empty roster read. The read matters as
 * much as the create: nothing in our database knows whether an account that
 * predates the column has students, and the roster is the app's index route, so
 * a teacher who added their class months ago is corrected on their next visit
 * rather than by a migration guessing on their behalf.
 *
 * The account is already memoized on the request, so the common case — a flag
 * that is already set — costs a property read and no query at all.
 *
 * **Failures are swallowed deliberately.** This is bookkeeping for a menu item.
 * A teacher whose class list saved correctly must not be told the save failed
 * because a `UPDATE users` afterwards did.
 */
async function noteHasStudents(req: Request, store: AccountStore): Promise<void> {
  try {
    const account = await loadAccount(req, store);
    if (account.firstStudentAt !== null) return;
    await store.markFirstStudent(account.googleSub);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Could not record first student');
  }
}

export function buildStudentsRouter(
  store: AccountStore = createPgAccountStore(),
  activity: ActivityRecorder = createActivityRecorder(store, createPgUsageStore()),
): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey, accountId } = await resolveSheetsContext(req, store);
      // One Sheets request for the roster's two cold tabs instead of two
      // (Step 6a). A no-op when the working set is warm.
      await warmRoster(sheets, spreadsheetId, userKey);
      const students = await listStudents(sheets, spreadsheetId, userKey);
      if (students.length > 0) await noteHasStudents(req, store);
      // The Name Picker's usage counter (Step 6j). The picker is entirely
      // client-side by the Step 8 decision and has no endpoint of its own, so
      // it declares itself on the roster read it already makes rather than
      // being given a request that exists only to report usage. The cost is
      // that this counts opening the picker, not running a round — see
      // PICKER_COUNTS_PAGE_OPENS in usageStore, and the note the metrics page
      // carries so the number is never read as comparable to the other three.
      //
      // Unvalidated beyond this equality check on purpose: the parameter is
      // client-supplied and reaches nothing but a fixed string here.
      if (req.query.for === 'picker') {
        await activity.recordToolUse({ googleSub: userKey, accountId }, 'picker');
      }
      res.json(students);
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const input = studentCreateSchema.parse(req.body);
      const created = await createStudent(sheets, spreadsheetId, userKey, input);
      await noteHasStudents(req, store);
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  });

  // Bulk create for the bulk-add grid: one append per tab instead of N creates.
  router.post('/batch', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { students } = studentBatchSchema.parse(req.body);
      const created = await createStudentsBatch(sheets, spreadsheetId, userKey, students);
      await noteHasStudents(req, store);
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  });

  // Must precede '/:id' so the literal path is not captured as a student id.
  // Per-student academic-risk and high-absence flags for
  // the roster's warning indicators. Deliberately not gated — the indicators are
  // free, only the analysis views are premium — but the threshold behind the
  // high-absence flag is the account's effective one, so the roster agrees with
  // the Statistics view rather than each computing its own.
  router.get('/risk-summary', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { account, plan } = await planOf(req, store);
      const { threshold } = effectiveHighAbsence(account, plan);
      res.json(await listRiskSummary(sheets, spreadsheetId, userKey, threshold));
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await getStudent(sheets, spreadsheetId, userKey, req.params.id));
    } catch (e) {
      next(e);
    }
  });

  // The detail view's read. It combined the profile with the student's IEP
  // accommodations in one batched Sheets read until Step 8a removed the IEP
  // surface; it is kept as a distinct endpoint because the shape is the API
  // contract's and the client's detail pane calls it by name.
  router.get('/:id/detail', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await getStudentDetail(sheets, spreadsheetId, userKey, req.params.id));
    } catch (e) {
      next(e);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const patch = studentUpdateSchema.parse(req.body);
      res.json(await updateStudent(sheets, spreadsheetId, userKey, req.params.id, patch));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      await softDeleteStudent(sheets, spreadsheetId, userKey, req.params.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.put('/:studentId/at-risk', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { course, atRisk } = atRiskSchema.parse(req.body);
      await setStudentAtRisk(sheets, spreadsheetId, userKey, req.params.studentId, course, atRisk);
      res.json({ studentId: req.params.studentId, course, atRisk });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
