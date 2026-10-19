import type { sheets_v4 } from 'googleapis';
import { ARCHIVE_OF, type TabName } from '../config/schema.js';
import { ApiError } from '../utils/errors.js';
import { invalidatePrefix } from './cache.js';
import { readTabsRowsIndexed, updateRowsInTabs, type TabRowWrite } from './sheets.js';
import { listCourses, deriveCourses, buildClassList, type ClassListPayload } from './courses.js';

/**
 * Renaming a class.
 *
 * A class's name is the join key: enrollment, attendance and grouping rows carry
 * the name rather than the course id (see `courses` in SHEETS_SCHEMA.md). So a
 * rename is a rewrite of the name on every row that carries it, and it runs under
 * the account lock for the same reason archiving does — a write landing mid-way
 * would be written under the old name and split the class in two.
 *
 * ## Only the tabs the class lives in
 *
 * A live class's rows are in the live tabs and an archived class's rows are in
 * the archive tabs. The other side can legitimately hold a *different* class of
 * the same name — reusing "Period A Science" each year is the normal case — so
 * touching both would rename that class too.
 *
 * ## One write, including the course row
 *
 * The rows and the course row go in a single `values.batchUpdate`, and this is
 * not an optimisation. `classArchive.ts` writes its course row last as a commit
 * record, and the same order here would be a bug: `listCourses` reconciles live
 * course rows against live enrollment names on every read, so a live class left
 * with renamed rows and an old-named course row reads as one emptied class
 * (soft-deleted) and one new class (created under a fresh id). The retry would
 * then find no class to rename. Writing the course row first fails the same way
 * in reverse. With everything in one call there is no state between the two for
 * the reconciliation to find.
 *
 * Nothing is cleared, so even a failure inside that call cannot lose a row.
 *
 * Soft-deleted rows are renamed along with active ones. Left under the old name,
 * they would be swept into whichever class next takes that name when it is
 * archived.
 */

const LIVE_TABS: TabName[] = ['enrollments', 'attendance', 'groupings'];

export async function renameClass(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  classId: string,
  newName: string,
): Promise<ClassListPayload> {
  const all = await listCourses(sheets, spreadsheetId, userKey);
  const course = all.find((c) => c.id === classId);
  if (!course) throw new ApiError('NOT_FOUND', 'That class no longer exists.');

  const archived = course.archivedAt !== null;
  const name = newName.trim();

  // Unique among classes on the same side, which is the invariant every
  // name-matched read and move depends on. The same name on the other side is
  // allowed, as it is everywhere else.
  if (
    name !== course.name &&
    all.some((c) => c.id !== course.id && (c.archivedAt !== null) === archived && c.name === name)
  ) {
    throw new ApiError(
      'CONFLICT',
      archived
        ? `You already have an archived class called “${name}”.`
        : `You already have a class called “${name}”.`,
    );
  }

  const dataTabs = archived ? LIVE_TABS.map((t) => ARCHIVE_OF[t]) : LIVE_TABS;
  // Both enrollment tabs are read, whichever side is renamed, because the
  // response carries student counts for both lists.
  const read = await readTabsRowsIndexed(sheets, spreadsheetId, [
    ...new Set<TabName>([...dataTabs, 'enrollments', 'enrollmentsArchive', 'courses']),
  ]);

  if (name !== course.name) {
    const writes: TabRowWrite[] = [];
    for (const tab of [...dataTabs, 'courses'] as TabName[]) {
      for (const r of read.get(tab) ?? []) {
        const matches =
          tab === 'courses'
            ? String(r.obj.id) === course.id
            : String(r.obj.course ?? '') === course.name;
        if (!matches) continue;
        // Mutated in place so the class list below is built from the post-write
        // state without a second read.
        r.obj = tab === 'courses' ? { ...r.obj, name } : { ...r.obj, course: name };
        writes.push({ tab, rowNumber: r.rowNumber, obj: r.obj });
      }
    }

    await updateRowsInTabs(sheets, spreadsheetId, writes);
    invalidatePrefix(`${userKey}::`);
  }

  // Built from the rows just rewritten in memory rather than re-read through the
  // cache this has just dropped.
  return buildClassList(
    deriveCourses(read.get('courses') ?? []),
    (read.get('enrollments') ?? []).map((r) => r.obj),
    (read.get('enrollmentsArchive') ?? []).map((r) => r.obj),
  );
}
