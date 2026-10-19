import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { resolveSheetsContext } from '../middleware/sheetsContext.js';
import { sessionOf } from '../middleware/session.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import { listCourses, buildClassList, type ClassListPayload } from '../services/courses.js';
import { moveClasses, type Direction } from '../services/classArchive.js';
import { renameClass } from '../services/classRename.js';
import { withAccountLock } from '../services/accountLock.js';
import { readTabsRowsIndexed } from '../services/sheets.js';

/**
 * Classes (Phase 2 Step 6e). The first endpoints to treat a class as an object
 * rather than as a string on enrollment rows.
 */

const moveSchema = z
  .object({
    // Bounded, like every other array in the contract. Twenty is far above a
    // real timetable and well below anything that would make one request run
    // long enough to matter.
    classIds: z.array(z.string().min(1).max(40)).min(1).max(20),
  })
  .strict();

// The same bound as a class name on a student, since this writes the same value.
const renameSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
  })
  .strict();

/**
 * The list `GET` answers with.
 *
 * Counting archived classes is the one read of the archive tabs outside an
 * unarchive; the alternative is a dialog that cannot say how many students
 * restoring a class would bring back. The move endpoints answer with the same
 * shape but build it from the state the move already holds, so this read is not
 * repeated the moment after those tabs have been rewritten.
 */
async function readClassList(
  sheets: Awaited<ReturnType<typeof resolveSheetsContext>>['sheets'],
  spreadsheetId: string,
  userKey: string,
): Promise<ClassListPayload> {
  const all = await listCourses(sheets, spreadsheetId, userKey);
  const read = await readTabsRowsIndexed(sheets, spreadsheetId, [
    'enrollments',
    'enrollmentsArchive',
  ]);
  return buildClassList(
    all,
    (read.get('enrollments') ?? []).map((r) => r.obj),
    (read.get('enrollmentsArchive') ?? []).map((r) => r.obj),
  );
}

export function buildClassesRouter(store: AccountStore = createPgAccountStore()): Router {
  const router = Router();

  /**
   * Every class, live and archived, with the counts and dates the dialog needs
   * to tell three classes called "Period A Science" apart. The name alone
   * cannot, which is the whole reason duplicate names across time are allowed.
   */
  router.get('/', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await readClassList(sheets, spreadsheetId, userKey));
    } catch (e) {
      next(e);
    }
  });

  /**
   * Both directions share a handler: the move is symmetric, and the only
   * asymmetry (renaming on a live-name collision) lives in the service.
   *
   * Held under the account lock, which is what stops a concurrent attendance
   * write being silently overwritten by a whole-tab rewrite. The response is the
   * same shape as GET so the dialog re-renders from the result instead of
   * issuing a second request against data that just moved — and the move
   * computes it from the state it already has, rather than reading those tabs
   * again through a cache it has just dropped.
   */
  const move = (direction: Direction): RequestHandler => async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { classIds } = moveSchema.parse(req.body);
      const googleSub = sessionOf(req).googleSub;

      const result = await withAccountLock(googleSub, () =>
        moveClasses(sheets, spreadsheetId, userKey, classIds, direction),
      );

      res.json({ renamed: result.renamed, ...result.classes });
    } catch (e) {
      next(e);
    }
  };

  router.post('/archive', move('archive'));
  router.post('/unarchive', move('unarchive'));

  /**
   * Renames one class, live or archived. Under the same lock as a move, because
   * it rewrites the name on every row that carries it and a write landing
   * part-way would be filed under the old name. Answers with the class list, like
   * the moves, so the page re-renders from the result.
   */
  router.patch('/:classId', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const classId = z.string().min(1).max(40).parse(req.params.classId);
      const { name } = renameSchema.parse(req.body);
      const googleSub = sessionOf(req).googleSub;

      const classes = await withAccountLock(googleSub, () =>
        renameClass(sheets, spreadsheetId, userKey, classId, name),
      );

      res.json(classes);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
