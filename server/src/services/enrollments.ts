import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { ApiError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, updateCached, invalidate } from './cache.js';
import {
  appendRows,
  readTabRowsIndexed,
  updateRowByNumber,
  updateRowsByNumber,
  isActive,
  type RowObject,
  type RowWrite,
  type IndexedRow,
} from './sheets.js';

export interface Enrollment {
  id: string;
  studentId: string;
  course: string;
  /** Per-class "academic risk" flag, toggled on the student detail page. */
  atRisk: boolean;
  createdAt: string;
  /**
   * The date (YYYY-MM-DD) the student joined this class, or null when not
   * stated. Attendance infers present from a marked class-day with no exception
   * row, so this is what stops a student who joined in November being counted
   * present for September. Resolve it through `effectiveStartDate` rather than
   * reading it directly — null falls back to `createdAt`.
   */
  startDate: string | null;
}

export const ENROLLMENTS_RESOURCE = 'enrollments';
const RESOURCE = ENROLLMENTS_RESOURCE;

function parseBool(v: RowObject[string]): boolean {
  return v === true || v === 'TRUE';
}

function rowToEnrollment(obj: RowObject): Enrollment {
  const startDate = obj.startDate === undefined ? '' : String(obj.startDate ?? '');
  return {
    id: String(obj.id),
    studentId: String(obj.studentId),
    course: String(obj.course ?? ''),
    atRisk: parseBool(obj.atRisk),
    createdAt: String(obj.createdAt ?? ''),
    startDate: startDate === '' ? null : startDate,
  };
}

/**
 * The date from which this student counts as being in the class, or null for no
 * bound. Only an explicit `startDate` bounds it.
 *
 * **`createdAt` is deliberately not used as a fallback**, though it looks like an
 * obvious one. It is the date the enrollment row was written, not the date the
 * student joined the class, and the two come apart in the ordinary case of a
 * teacher setting up their roster today and then entering last week's
 * attendance: every one of those days precedes every `createdAt`, so the whole
 * backfill would be clamped away and the History view would show nothing for it.
 * Suppressing real records to guess at a join date is the wrong trade, so an
 * unset start date means unbounded.
 *
 * The v4→v5 migration fills `startDate` in from each student's earliest recorded
 * attendance date, which is what makes statistics computed before the migration
 * identical to those computed after it, including for a student who joined
 * mid-year. A student enrolled into an already-running class after that point is
 * inferred present from the class's first recorded day until a start date is set
 * for them; see NEXT_STEPS for the follow-up that surfaces it in the UI.
 */
export function effectiveStartDate(enrollment: { startDate: string | null }): string | null {
  return enrollment.startDate ?? null;
}

/** Active enrollments from already-read `enrollments` rows. */
export function deriveEnrollments(rows: IndexedRow[]): Enrollment[] {
  return rows.filter((r) => isActive(r.obj)).map((r) => rowToEnrollment(r.obj));
}

/** Groups a list of enrollments by studentId. */
export function enrollmentsByStudent(enrollments: Enrollment[]): Map<string, Enrollment[]> {
  const map = new Map<string, Enrollment[]>();
  for (const e of enrollments) {
    const list = map.get(e.studentId) ?? [];
    list.push(e);
    map.set(e.studentId, list);
  }
  return map;
}

/** All active enrollment rows, cached per user. Derived reads filter in memory.
 * Single-flighted so concurrent cold reads collapse to one Sheets call. */
export async function listEnrollments(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<Enrollment[]> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
    return deriveEnrollments(rows);
  });
}

/** Course names a student is actively enrolled in. */
export async function listCoursesForStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  studentId: string,
): Promise<string[]> {
  const all = await listEnrollments(sheets, spreadsheetId, userKey);
  return all.filter((e) => e.studentId === studentId).map((e) => e.course);
}

function invalidateEnrollments(userKey: string): void {
  invalidate(cacheKey(userKey, RESOURCE));
}

/**
 * Reconciles a student's active enrollments to exactly `courses`: appends rows
 * for courses newly added and soft-deletes rows for courses removed, leaving
 * unchanged enrollments untouched. Duplicate course names in the input are
 * ignored (deduped). Both writes honor the header-validation invariant once.
 */
/**
 * @param startDateFor Start date to stamp on a *newly created* enrollment, by
 *   course name. Supplied by the caller rather than computed here: the answer
 *   depends on the course's recorded attendance, and reading that from this
 *   module would make `enrollments` and `attendance` import each other. See
 *   `startDateForNewEnrollment` in attendance.ts. Existing enrollments are never
 *   restamped, since their start date is a fact about when the student joined
 *   and re-saving the roster is not that.
 */
export async function setEnrollments(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  studentId: string,
  courses: string[],
  startDateFor: (course: string) => string | null = () => null,
): Promise<void> {
  const desired = Array.from(new Set(courses.map((c) => c.trim()).filter(Boolean)));
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
  const activeForStudent = rows.filter(
    (r) => r.obj.studentId === studentId && isActive(r.obj),
  );
  const currentCourses = new Set(activeForStudent.map((r) => String(r.obj.course)));
  const desiredSet = new Set(desired);

  const now = nowIso();
  const appends: RowObject[] = desired
    .filter((c) => !currentCourses.has(c))
    .map((course) => ({
      id: ulid(),
      studentId,
      course,
      atRisk: false,
      createdAt: now,
      deletedAt: null,
      startDate: startDateFor(course),
    }));

  const removals: RowWrite[] = activeForStudent
    .filter((r) => !desiredSet.has(String(r.obj.course)))
    .map((r) => ({ rowNumber: r.rowNumber, obj: { ...r.obj, deletedAt: now } }));

  if (appends.length === 0 && removals.length === 0) return;

  await appendRows(sheets, spreadsheetId, 'enrollments', appends, { headerValidated: true });
  await updateRowsByNumber(sheets, spreadsheetId, 'enrollments', removals, {
    headerValidated: true,
  });
  invalidateEnrollments(userKey);
}

/** Sets the academic-risk flag on one active (student, course) enrollment. */
export async function setEnrollmentAtRisk(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  studentId: string,
  course: string,
  atRisk: boolean,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
  const match = rows.find(
    (r) => r.obj.studentId === studentId && String(r.obj.course) === course && isActive(r.obj),
  );
  if (!match) throw new ApiError('NOT_FOUND', 'Enrollment not found.');
  await updateRowByNumber(
    sheets,
    spreadsheetId,
    'enrollments',
    match.rowNumber,
    { ...match.obj, atRisk },
    { headerValidated: true },
  );
  // Merge the flag change into the warm cache rather than dropping it, so the
  // roster/detail stay warm through at-risk toggling. Keyed by id.
  const id = String(match.obj.id);
  updateCached<Enrollment[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.map((e) => (e.id === id ? { ...e, atRisk } : e)),
  );
}

/** Soft-deletes every active enrollment for a student — used by the student delete cascade. */
export async function softDeleteEnrollmentsForStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  studentId: string,
  now: string,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
  const targets = rows.filter((r) => r.obj.studentId === studentId && isActive(r.obj));
  if (targets.length === 0) return;
  const writes: RowWrite[] = targets.map((r) => ({
    rowNumber: r.rowNumber,
    obj: { ...r.obj, deletedAt: now },
  }));
  await updateRowsByNumber(sheets, spreadsheetId, 'enrollments', writes, { headerValidated: true });
  invalidateEnrollments(userKey);
}
