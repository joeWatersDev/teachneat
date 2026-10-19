import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import {
  listEnrollments,
  listCoursesForStudent,
  setEnrollments,
  softDeleteEnrollmentsForStudent,
} from './enrollments.js';
import { nowIso } from '../utils/time.js';
import { readTabRowsIndexed, isActive } from './sheets.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

describe('enrollments service', () => {
  beforeEach(() => clearCache());

  it('setEnrollments writes one active row per course', async () => {
    const { sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math', 'Science']);
    const courses = await listCoursesForStudent(sheets, spreadsheetId, USER, 'stu1');
    expect(new Set(courses)).toEqual(new Set(['Math', 'Science']));
  });

  it('setEnrollments dedupes and trims input', async () => {
    const { sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math', ' Math ', 'Science', '']);
    const courses = await listCoursesForStudent(sheets, spreadsheetId, USER, 'stu1');
    expect(new Set(courses)).toEqual(new Set(['Math', 'Science']));
  });

  it('setEnrollments diffs: adds new, removes dropped, keeps unchanged rows', async () => {
    const { sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math', 'Science']);
    const before = (await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments')).find(
      (r) => r.obj.studentId === 'stu1' && r.obj.course === 'Science',
    );

    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Science', 'History']);
    const courses = await listCoursesForStudent(sheets, spreadsheetId, USER, 'stu1');
    expect(new Set(courses)).toEqual(new Set(['Science', 'History']));

    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
    const scienceRows = rows.filter((r) => r.obj.studentId === 'stu1' && r.obj.course === 'Science');
    // Science kept its original id (not re-created).
    expect(scienceRows).toHaveLength(1);
    expect(scienceRows[0].obj.id).toBe(before!.obj.id);
    const mathRow = rows.find((r) => r.obj.studentId === 'stu1' && r.obj.course === 'Math');
    expect(isActive(mathRow!.obj)).toBe(false);
  });

  it('setEnrollments is a no-op when the set is unchanged (no extra writes)', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math']);
    const writesBefore = env.callCounts['values.append'] ?? 0;
    const updatesBefore = env.callCounts['values.batchUpdate'] ?? 0;
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math']);
    expect(env.callCounts['values.append'] ?? 0).toBe(writesBefore);
    expect(env.callCounts['values.batchUpdate'] ?? 0).toBe(updatesBefore);
  });

  it('re-adding a soft-deleted course creates a fresh active row', async () => {
    const { sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math']);
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', []); // remove Math
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math']); // re-add

    const active = await listCoursesForStudent(sheets, spreadsheetId, USER, 'stu1');
    expect(active).toEqual(['Math']);
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
    const mathRows = rows.filter((r) => r.obj.studentId === 'stu1' && r.obj.course === 'Math');
    expect(mathRows).toHaveLength(2); // one soft-deleted, one active
    expect(mathRows.filter((r) => isActive(r.obj))).toHaveLength(1);
  });

  it('softDeleteEnrollmentsForStudent clears all active rows for the student', async () => {
    const { sheets, spreadsheetId } = await setup();
    await setEnrollments(sheets, spreadsheetId, USER, 'stu1', ['Math', 'Science']);
    await setEnrollments(sheets, spreadsheetId, USER, 'stu2', ['Math']);

    await softDeleteEnrollmentsForStudent(sheets, spreadsheetId, USER, 'stu1', nowIso());

    const all = await listEnrollments(sheets, spreadsheetId, USER);
    expect(all.filter((e) => e.studentId === 'stu1')).toHaveLength(0);
    expect(all.filter((e) => e.studentId === 'stu2')).toHaveLength(1);
  });
});
