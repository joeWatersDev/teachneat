import type { sheets_v4 } from 'googleapis';
import { ApiError } from '../utils/errors.js';
import type { TabName } from '../config/schema.js';
import { cacheKey, getCached, setCached } from './cache.js';
import { readTabsRowsIndexed } from './sheets.js';
import {
  deriveStudents,
  STUDENTS_RESOURCE,
  type Student,
} from './students.js';
import {
  deriveEnrollments,
  enrollmentsByStudent,
  ENROLLMENTS_RESOURCE,
} from './enrollments.js';

export interface StudentDetail {
  student: Student;
}

/**
 * Loads a student's profile, reading only the tabs that aren't already cached
 * and collapsing them into a single Sheets `values.batchGet`. A cold detail
 * open costs one Sheets request (students + enrollments); a warm open costs
 * zero. The derived list is written back to the same shared cache the list
 * endpoint uses, so this call also warms it (and reuses it when warm).
 *
 * It also returned a student's IEP accommodations, from a third tab, until Step
 * 8a removed the IEP surface from the product. The return stays an object with
 * one field rather than collapsing to `Student`, because the shape is the API
 * contract's and the detail view is where a second per-student resource would
 * land if one is ever added.
 */
export async function getStudentDetail(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<StudentDetail> {
  const studentsKey = cacheKey(userKey, STUDENTS_RESOURCE);
  let students = getCached<Student[]>(studentsKey);

  // Building the student list needs both the students and enrollments tabs.
  // Read them only when cold, in one batch.
  if (!students) {
    const tabsToRead: TabName[] = ['students', 'enrollments'];
    const read = await readTabsRowsIndexed(sheets, spreadsheetId, tabsToRead);
    const enrollments = deriveEnrollments(read.get('enrollments') ?? []);
    setCached(cacheKey(userKey, ENROLLMENTS_RESOURCE), enrollments);
    students = deriveStudents(read.get('students') ?? [], enrollmentsByStudent(enrollments));
    setCached(studentsKey, students);
  }

  const student = students.find((s) => s.id === id);
  if (!student) throw new ApiError('NOT_FOUND', 'Student not found.');
  return { student };
}
