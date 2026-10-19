import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { ApiError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, updateCached, invalidate } from './cache.js';
import {
  appendRow,
  appendRows,
  readTabRowsIndexed,
  updateRowByNumber,
  isActive,
  type RowObject,
  type IndexedRow,
} from './sheets.js';
import { lastRecordedDayByCourse, startDateForNewEnrollment } from './attendance.js';
import {
  listEnrollments,
  enrollmentsByStudent,
  setEnrollments,
  setEnrollmentAtRisk,
  softDeleteEnrollmentsForStudent,
  ENROLLMENTS_RESOURCE,
  type Enrollment,
} from './enrollments.js';

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  goesBy: string | null;
  pronouns: string | null;
  courses: string[];
  /** Subset of `courses` in which the student is flagged as at academic risk. */
  atRiskCourses: string[];
  studentEmail: string | null;
  parentEmails: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreateInput {
  firstName: string;
  lastName: string;
  goesBy?: string | null;
  pronouns?: string | null;
  courses: string[];
  studentEmail?: string | null;
  parentEmails?: string[];
  notes?: string | null;
}

export type StudentUpdateInput = Partial<StudentCreateInput>;

export const STUDENTS_RESOURCE = 'students';
const RESOURCE = STUDENTS_RESOURCE;

function str(v: RowObject[string]): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** Trim, drop empties, and de-duplicate a course list (order-preserving). */
function dedupeCourses(courses: string[]): string[] {
  return Array.from(new Set(courses.map((c) => c.trim()).filter(Boolean)));
}

function rowToStudent(obj: RowObject, courses: string[], atRiskCourses: string[]): Student {
  const parentRaw = str(obj.parentEmails);
  return {
    id: String(obj.id),
    firstName: String(obj.firstName ?? ''),
    lastName: String(obj.lastName ?? ''),
    goesBy: str(obj.goesBy),
    pronouns: str(obj.pronouns),
    courses,
    atRiskCourses,
    studentEmail: str(obj.studentEmail),
    parentEmails: parentRaw ? parentRaw.split('|').filter(Boolean) : [],
    notes: str(obj.notes),
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

/** Courses and the at-risk subset for one student, from their enrollment rows. */
function courseInfo(enrollments: Enrollment[]): { courses: string[]; atRiskCourses: string[] } {
  return {
    courses: enrollments.map((e) => e.course),
    atRiskCourses: enrollments.filter((e) => e.atRisk).map((e) => e.course),
  };
}

/**
 * Builds the active-student list from already-read `students` rows and a
 * map of enrollments by studentId. Shared by `listStudents` and the batched
 * `getStudentDetail` so both derive students (courses + at-risk courses) the
 * same way.
 */
export function deriveStudents(
  studentRows: IndexedRow[],
  byStudent: Map<string, Enrollment[]>,
): Student[] {
  return studentRows.filter((r) => isActive(r.obj)).map((r) => {
    const info = courseInfo(byStudent.get(String(r.obj.id)) ?? []);
    return rowToStudent(r.obj, info.courses, info.atRiskCourses);
  });
}

export async function listStudents(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<Student[]> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const [rows, enrollments] = await Promise.all([
      readTabRowsIndexed(sheets, spreadsheetId, 'students'),
      listEnrollments(sheets, spreadsheetId, userKey),
    ]);
    return deriveStudents(rows, enrollmentsByStudent(enrollments));
  });
}

export async function getStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<Student> {
  const students = await listStudents(sheets, spreadsheetId, userKey);
  const found = students.find((s) => s.id === id);
  if (!found) throw new ApiError('NOT_FOUND', 'Student not found.');
  return found;
}

/**
 * The start date to stamp on each enrollment this write creates.
 *
 * A student added to a class that has already had attendance taken starts the
 * day after the last register, so they are not inferred present for sessions
 * held before they arrived. A class with no recorded days yields null, leaving
 * the enrollment unbounded so a teacher can still enter attendance predating the
 * roster — which is the ordinary set-up-then-backfill sequence, and the reason
 * the clock is not used for this.
 *
 * Composed here rather than inside `setEnrollments` because it needs both the
 * enrollment and the attendance service, and this module is the one that already
 * depends on both.
 */
async function newEnrollmentStartDates(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<(course: string) => string | null> {
  const lastDays = await lastRecordedDayByCourse(sheets, spreadsheetId, userKey);
  return (course) => startDateForNewEnrollment(lastDays.get(course));
}

export async function createStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  input: StudentCreateInput,
): Promise<Student> {
  const now = nowIso();
  const id = ulid();
  const row: RowObject = {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    goesBy: input.goesBy ?? null,
    pronouns: input.pronouns ?? null,
    studentEmail: input.studentEmail ?? null,
    parentEmails: (input.parentEmails ?? []).join('|') || null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await appendRow(sheets, spreadsheetId, 'students', row);
  const startDateFor = await newEnrollmentStartDates(sheets, spreadsheetId, userKey);
  await setEnrollments(sheets, spreadsheetId, userKey, id, input.courses, startDateFor);
  invalidate(cacheKey(userKey, RESOURCE));
  // A brand-new student's enrollments all default to not-at-risk.
  return rowToStudent(row, dedupeCourses(input.courses), []);
}

/**
 * Creates many students in a single pair of Sheets appends — one for the
 * `students` rows and one for all their `enrollments` rows — instead of the
 * per-student round-trips `createStudent` incurs. Because every student is
 * brand-new (fresh ULIDs), there is nothing to reconcile: enrollment rows are
 * appended directly rather than through `setEnrollments`. All-or-nothing: an
 * append failure rejects the whole batch (callers keep the rows for retry), and
 * per-row shape is validated by the route's Zod schema before this runs.
 */
export async function createStudentsBatch(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  inputs: StudentCreateInput[],
): Promise<Student[]> {
  if (inputs.length === 0) return [];
  const startDateFor = await newEnrollmentStartDates(sheets, spreadsheetId, userKey);
  const now = nowIso();
  const studentRows: RowObject[] = [];
  const enrollmentRows: RowObject[] = [];
  const created: Student[] = [];

  for (const input of inputs) {
    const id = ulid();
    const courses = dedupeCourses(input.courses);
    const row: RowObject = {
      id,
      firstName: input.firstName,
      lastName: input.lastName,
      goesBy: input.goesBy ?? null,
      pronouns: input.pronouns ?? null,
      studentEmail: input.studentEmail ?? null,
      parentEmails: (input.parentEmails ?? []).join('|') || null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    studentRows.push(row);
    for (const course of courses) {
      enrollmentRows.push({
        id: ulid(),
        studentId: id,
        course,
        atRisk: false,
        createdAt: now,
        deletedAt: null,
        startDate: startDateFor(course),
      });
    }
    // Brand-new students carry no at-risk courses.
    created.push(rowToStudent(row, courses, []));
  }

  await appendRows(sheets, spreadsheetId, 'students', studentRows);
  await appendRows(sheets, spreadsheetId, 'enrollments', enrollmentRows);
  invalidate(cacheKey(userKey, RESOURCE));
  invalidate(cacheKey(userKey, ENROLLMENTS_RESOURCE));
  return created;
}

export async function updateStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
  patch: StudentUpdateInput,
): Promise<Student> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'students');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Student not found.');

  const next: RowObject = { ...match.obj };
  if (patch.firstName !== undefined) next.firstName = patch.firstName;
  if (patch.lastName !== undefined) next.lastName = patch.lastName;
  if (patch.goesBy !== undefined) next.goesBy = patch.goesBy;
  if (patch.pronouns !== undefined) next.pronouns = patch.pronouns;
  if (patch.studentEmail !== undefined) next.studentEmail = patch.studentEmail;
  if (patch.parentEmails !== undefined) next.parentEmails = patch.parentEmails.join('|') || null;
  if (patch.notes !== undefined) next.notes = patch.notes;
  next.updatedAt = nowIso();

  await updateRowByNumber(sheets, spreadsheetId, 'students', match.rowNumber, next, {
    headerValidated: true,
  });
  if (patch.courses !== undefined) {
    const startDateFor = await newEnrollmentStartDates(sheets, spreadsheetId, userKey);
    await setEnrollments(sheets, spreadsheetId, userKey, id, patch.courses, startDateFor);
  }
  const enrollments = await listEnrollments(sheets, spreadsheetId, userKey);
  const info = courseInfo(enrollments.filter((e) => e.studentId === id));
  const updated = rowToStudent(next, info.courses, info.atRiskCourses);
  // Merge the edited student into the warm roster cache rather than dropping it,
  // so profile/notes editing keeps the roster warm. Keyed by id; a course change
  // has already refreshed the enrollments cache via setEnrollments.
  updateCached<Student[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.map((s) => (s.id === id ? updated : s)),
  );
  return updated;
}

/**
 * Toggles the academic-risk flag for one (student, course). Delegates the write
 * to the enrollments service, then invalidates the students cache since a
 * student's derived `atRiskCourses` changed.
 */
export async function setStudentAtRisk(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  studentId: string,
  course: string,
  atRisk: boolean,
): Promise<void> {
  // setEnrollmentAtRisk writes through and merges the enrollments cache; here we
  // recompute just this student's derived atRiskCourses in the warm roster cache
  // so at-risk toggling keeps the roster/detail warm. No-op when cold.
  await setEnrollmentAtRisk(sheets, spreadsheetId, userKey, studentId, course, atRisk);
  updateCached<Student[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.map((s) => {
      if (s.id !== studentId) return s;
      const flagged = new Set(s.atRiskCourses);
      if (atRisk) flagged.add(course);
      else flagged.delete(course);
      // Keep atRiskCourses a subset of courses, in the same (enrollment) order.
      return { ...s, atRiskCourses: s.courses.filter((c) => flagged.has(c)) };
    }),
  );
}

export async function softDeleteStudent(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'students');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Student not found.');

  const now = nowIso();
  const deleted: RowObject = { ...match.obj, updatedAt: now, deletedAt: now };
  await updateRowByNumber(sheets, spreadsheetId, 'students', match.rowNumber, deleted, {
    headerValidated: true,
  });

  await cascadeSoftDelete(sheets, spreadsheetId, 'attendance', id, now);
  await softDeleteEnrollmentsForStudent(sheets, spreadsheetId, userKey, id, now);

  // A delete cascades across tabs, so drop the affected caches rather than merge.
  // 'enrollments' is dropped by softDeleteEnrollmentsForStudent.
  //
  // It also cascaded into the `iep` tab until Step 8a removed the IEP surface.
  // Rows already written there for a student deleted after that are left
  // `active`, which is inert: nothing reads the tab. See config/schema.ts.
  invalidate(cacheKey(userKey, RESOURCE));
  invalidate(cacheKey(userKey, 'attendance'));
}

/** Soft-deletes every active row in a child tab whose studentId matches. */
async function cascadeSoftDelete(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: 'attendance',
  studentId: string,
  now: string,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, tab);
  const targets = rows.filter((r) => r.obj.studentId === studentId && isActive(r.obj));
  for (const r of targets) {
    await updateRowByNumber(
      sheets,
      spreadsheetId,
      tab,
      r.rowNumber,
      { ...r.obj, updatedAt: now, deletedAt: now },
      { headerValidated: true },
    );
  }
}
