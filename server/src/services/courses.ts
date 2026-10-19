import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, invalidate } from './cache.js';
import {
  appendRows,
  readTabsRowsIndexed,
  updateRowsByNumber,
  isActive,
  type RowObject,
  type IndexedRow,
} from './sheets.js';
import { listEnrollments } from './enrollments.js';

/**
 * Classes as records (Phase 2 Step 6e).
 *
 * Until this service a class existed only as text repeated across enrollment
 * rows: the list of classes was `new Set(enrollments.map(e => e.course))`. That
 * is why a class could not be archived, renamed, or distinguished from another
 * class with the same name, and why a class with no remaining students simply
 * ceased to exist.
 *
 * The name is still the join key. Enrollment and attendance rows carry the
 * course string exactly as before, and this tab sits beside them rather than
 * replacing them — which is what makes the change additive and lets an existing
 * account keep working with no backfill.
 */

export const COURSES_RESOURCE = 'courses';

export interface CourseRecord {
  id: string;
  name: string;
  createdAt: string;
  /** Null while the class is live. */
  archivedAt: string | null;
}

export function deriveCourses(rows: IndexedRow[]): CourseRecord[] {
  return rows
    .filter((r) => isActive(r.obj))
    .map((r) => ({
      id: String(r.obj.id),
      name: String(r.obj.name ?? ''),
      createdAt: String(r.obj.createdAt ?? ''),
      archivedAt: r.obj.archivedAt ? String(r.obj.archivedAt) : null,
    }));
}

/**
 * Every class the teacher has, reconciling the `courses` tab against the course
 * names actually present on live enrollments.
 *
 * The reconciliation is the important part, and it runs in one direction only:
 * a name found on an enrollment with no course row is **live** and gets a row
 * written for it. That is what lets an account created before this step work
 * untouched, and it means no backfill migration can lose a class — the data
 * itself is the fallback.
 *
 * The reverse reconciliation also runs, but only over **live** rows: a live
 * course whose last student has been removed is soft-deleted. A class exists in
 * this app only by having students put in it — there is no create-a-class form —
 * so an empty live class is not a class the teacher made and is waiting to fill,
 * it is the remains of one they emptied. Every other tool already derives its
 * class list from enrollments and so drops it immediately; leaving the course row
 * alone made the archive dialog the one place a deleted class lingered.
 *
 * Archived rows are exempt, since having no *live* enrollments is what being
 * archived means.
 */
export async function listCourses(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<CourseRecord[]> {
  const existing = await getOrLoad(cacheKey(userKey, COURSES_RESOURCE), async () => {
    const read = await readTabsRowsIndexed(sheets, spreadsheetId, ['courses']);
    return deriveCourses(read.get('courses') ?? []);
  });

  /**
   * Enrollments come from their own service rather than being read and cached
   * here beside the course rows.
   *
   * Caching a second copy under this key was a real bug: adding a student
   * invalidates the enrollments cache, but nothing invalidated *this* key, so a
   * class brought into being by adding a student did not appear in the archive
   * dialog until the stale copy aged out — up to five minutes of a class the
   * teacher had just created simply being missing. Deriving from the canonical
   * cache means every existing invalidation applies here too, with no second set
   * of invalidation rules to keep in step.
   */
  const enrollments = await listEnrollments(sheets, spreadsheetId, userKey);

  // **Live** names only, not every name on record. Comparing against archived
  // rows too would break the case this feature exists for: a teacher who
  // archives "Period A Science" in February and starts a new one under the same
  // name in September has live enrollments whose only matching course row is the
  // archived one, so no live class would be created and their new class would be
  // invisible — unarchivable and unarchiveable both.
  const liveNames = new Set<string>();
  for (const enrollment of enrollments) {
    const name = enrollment.course.trim();
    if (name) liveNames.add(name);
  }

  const live = existing.filter((c) => c.archivedAt === null);
  const known = new Set(live.map((c) => c.name));
  const seen = new Set([...liveNames].filter((name) => !known.has(name)));
  const emptied = live.filter((c) => !liveNames.has(c.name));
  if (seen.size === 0 && emptied.length === 0) return existing;

  let result = existing;

  if (emptied.length > 0) {
    await softDeleteCourses(sheets, spreadsheetId, new Set(emptied.map((c) => c.id)));
    const gone = new Set(emptied.map((c) => c.id));
    result = result.filter((c) => !gone.has(c.id));
  }

  // Backfill the classes that predate this tab. Written rather than merely
  // returned, because the archive dialog needs a stable id to act on.
  if (seen.size > 0) {
    const now = nowIso();
    const created: RowObject[] = [...seen].map((name) => ({
      id: ulid(),
      name,
      createdAt: now,
      archivedAt: null,
      deletedAt: null,
    }));
    await appendRows(sheets, spreadsheetId, 'courses', created);
    result = [
      ...result,
      ...created.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        createdAt: String(r.createdAt),
        archivedAt: null,
      })),
    ];
  }

  invalidate(cacheKey(userKey, COURSES_RESOURCE));
  return result;
}

/**
 * Soft-deletes course rows by id.
 *
 * Soft, like every other removal in the schema: the row keeps its id, so an
 * archived class that still references the name is never left dangling and the
 * teacher's own spreadsheet keeps a record of what was there.
 */
async function softDeleteCourses(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  ids: Set<string>,
): Promise<void> {
  const read = await readTabsRowsIndexed(sheets, spreadsheetId, ['courses']);
  const now = nowIso();
  const writes = (read.get('courses') ?? [])
    .filter((r) => isActive(r.obj) && ids.has(String(r.obj.id)))
    .map((r) => ({ rowNumber: r.rowNumber, obj: { ...r.obj, deletedAt: now } }));
  await updateRowsByNumber(sheets, spreadsheetId, 'courses', writes, { headerValidated: true });
}

export function liveCourses(all: CourseRecord[]): CourseRecord[] {
  return all.filter((c) => c.archivedAt === null);
}

export function archivedCourses(all: CourseRecord[]): CourseRecord[] {
  return all.filter((c) => c.archivedAt !== null);
}

export interface ClassListPayload {
  live: { id: string; name: string; createdAt: string; studentCount: number }[];
  archived: {
    id: string;
    name: string;
    createdAt: string;
    archivedAt: string | null;
    studentCount: number;
  }[];
}

/**
 * The list both class endpoints answer with, as a pure function of rows the
 * caller already holds.
 *
 * Pure because the two callers get those rows differently: `GET /classes` reads
 * them, and a move already has the post-move state in memory and must not spend
 * a read re-learning it. Sharing the shape rather than duplicating it is not
 * cosmetic — the move endpoints answering with a *narrower* shape than GET was a
 * real bug, and every student count in the dialog read "undefined students" the
 * moment an archive finished.
 */
export function buildClassList(
  all: CourseRecord[],
  liveEnrollments: RowObject[],
  archivedEnrollments: RowObject[],
): ClassListPayload {
  const countBy = (rows: RowObject[]) => {
    const counts = new Map<string, number>();
    for (const obj of rows) {
      if (!isActive(obj)) continue;
      const name = String(obj.course ?? '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  };
  const live = countBy(liveEnrollments);
  const archived = countBy(archivedEnrollments);

  return {
    live: liveCourses(all).map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      studentCount: live.get(c.name) ?? 0,
    })),
    archived: archivedCourses(all).map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      studentCount: archived.get(c.name) ?? 0,
    })),
  };
}

/**
 * The name an archived class should take when restored, given the names already
 * live.
 *
 * Unarchiving into a collision renames rather than refuses: refusing to give a
 * teacher back their own records is the worse failure, and the collision is
 * entirely foreseeable — reusing "Period A Science" every year is the normal
 * case this feature exists to support.
 *
 * The creation year is tried first because it is the meaningful disambiguator.
 * A numeric suffix follows only when that is taken too, which happens when two
 * archived classes from the same year are restored alongside a live one. **The
 * rule must always terminate with a name**, never reject — a loop bound would be
 * a way for a teacher to be permanently unable to restore a class.
 */
export function resolveNameCollision(
  desired: string,
  createdAt: string,
  taken: Set<string>,
): string {
  if (!taken.has(desired)) return desired;
  const year = createdAt.slice(0, 4) || 'archived';
  const withYear = `${desired} (${year})`;
  if (!taken.has(withYear)) return withYear;
  for (let n = 2; ; n++) {
    const candidate = `${withYear} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
