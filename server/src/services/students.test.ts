import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import {
  listStudents,
  getStudent,
  createStudent,
  createStudentsBatch,
  updateStudent,
  softDeleteStudent,
} from './students.js';
import { listEnrollments } from './enrollments.js';
import { submitAttendance } from './attendance.js';
import { readTabRowsIndexed, isActive } from './sheets.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

describe('students service', () => {
  beforeEach(() => clearCache());

  it('creates a student with a generated id and matching timestamps', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Rivera',
      courses: ['Period 1 Math'],
      parentEmails: ['mom@example.com', 'dad@example.com'],
    });

    expect(created.id).toHaveLength(26);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.parentEmails).toEqual(['mom@example.com', 'dad@example.com']);
    expect(created.goesBy).toBeNull();
    expect(created.courses).toEqual(['Period 1 Math']);
  });

  it('writes one enrollment row per course and returns them on the student', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Multi',
      lastName: 'Course',
      courses: ['Period 1 Math', 'Period 4 Math'],
    });
    expect(new Set(created.courses)).toEqual(new Set(['Period 1 Math', 'Period 4 Math']));

    const enrollments = await listEnrollments(sheets, spreadsheetId, USER);
    expect(enrollments.filter((e) => e.studentId === created.id)).toHaveLength(2);

    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(new Set(list[0].courses)).toEqual(new Set(['Period 1 Math', 'Period 4 Math']));
  });

  it('lists only active students', async () => {
    const { sheets, spreadsheetId } = await setup();
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
    });
    const two = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'B',
      lastName: 'Two',
      courses: ['C'],
    });
    await softDeleteStudent(sheets, spreadsheetId, USER, two.id);

    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list.map((s) => s.firstName)).toEqual(['A']);
  });

  it('persists parentEmails as a pipe-delimited string in the sheet', async () => {
    const { sheets, spreadsheetId } = await setup();
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
      parentEmails: ['a@x.com', 'b@x.com'],
    });
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'students');
    expect(rows[0].obj.parentEmails).toBe('a@x.com|b@x.com');
  });

  it('updates only provided fields and clears nullable fields on explicit null', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
      goesBy: 'AJ',
      notes: 'keep me',
    });
    const updated = await updateStudent(sheets, spreadsheetId, USER, s.id, {
      goesBy: null,
    });
    expect(updated.goesBy).toBeNull();
    expect(updated.notes).toBe('keep me');
    expect(updated.firstName).toBe('A');
    expect(updated.courses).toEqual(['C']);
  });

  it('diffs enrollments on update: adds new, soft-deletes removed, keeps unchanged', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['Math', 'Science'],
    });

    const updated = await updateStudent(sheets, spreadsheetId, USER, s.id, {
      courses: ['Science', 'History'],
    });
    expect(new Set(updated.courses)).toEqual(new Set(['Science', 'History']));

    // Raw rows: Math soft-deleted, Science untouched (single active row), History appended.
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
    const forStudent = rows.filter((r) => r.obj.studentId === s.id);
    const active = forStudent.filter((r) => isActive(r.obj)).map((r) => String(r.obj.course));
    expect(new Set(active)).toEqual(new Set(['Science', 'History']));
    const mathRow = forStudent.find((r) => r.obj.course === 'Math');
    expect(mathRow && isActive(mathRow.obj)).toBe(false);
    // Science kept its original row rather than being re-created.
    expect(forStudent.filter((r) => r.obj.course === 'Science')).toHaveLength(1);
  });

  it('throws NOT_FOUND for an unknown or deleted student', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(getStudent(sheets, spreadsheetId, USER, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('soft-deletes the student and cascades to attendance and enrollment rows', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
    });
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'C', [
      { studentId: s.id, statusKey: 'a' },
    ]);

    await softDeleteStudent(sheets, spreadsheetId, USER, s.id);

    const attendanceRows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    expect(attendanceRows[0].obj.deletedAt).not.toBeNull();
    // Enrollments cascaded too.
    const enrollments = await listEnrollments(sheets, spreadsheetId, USER);
    expect(enrollments.filter((e) => e.studentId === s.id)).toHaveLength(0);
  });

  it('serves a cached list within the TTL (no second sheet read)', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
    });
    await listStudents(sheets, spreadsheetId, USER);
    const reads = env.callCounts['values.get'];
    await listStudents(sheets, spreadsheetId, USER);
    expect(env.callCounts['values.get']).toBe(reads);
  });

  it('invalidates the cache on mutation', async () => {
    const { sheets, spreadsheetId } = await setup();
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['C'],
    });
    await listStudents(sheets, spreadsheetId, USER);
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'B',
      lastName: 'Two',
      courses: ['C'],
    });
    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list).toHaveLength(2);
  });
});

describe('students batch service', () => {
  beforeEach(() => clearCache());

  it('creates the whole batch with two appends (one per tab) regardless of size', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const appendsBefore = env.callCounts['values.append'] ?? 0;
    const created = await createStudentsBatch(sheets, spreadsheetId, USER, [
      { firstName: 'A', lastName: 'One', courses: ['Math'] },
      { firstName: 'B', lastName: 'Two', courses: ['Math', 'Science'] },
      { firstName: 'C', lastName: 'Three', courses: ['History'] },
    ]);

    expect(created).toHaveLength(3);
    // One append for all student rows, one for all enrollment rows — the point of the batch.
    expect((env.callCounts['values.append'] ?? 0) - appendsBefore).toBe(2);

    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list).toHaveLength(3);
    const enrollments = await listEnrollments(sheets, spreadsheetId, USER);
    expect(enrollments).toHaveLength(4); // 1 + 2 + 1 courses
  });

  it('gives each student a distinct id and dedupes courses per row', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createStudentsBatch(sheets, spreadsheetId, USER, [
      { firstName: 'A', lastName: 'One', courses: ['Math'], parentEmails: ['p@x.com'] },
      { firstName: 'B', lastName: 'Two', courses: ['Science', 'Science'] },
    ]);

    expect(created[0].id).toHaveLength(26);
    expect(created[1].id).toHaveLength(26);
    expect(created[0].id).not.toBe(created[1].id);
    expect(created[0].parentEmails).toEqual(['p@x.com']);
    expect(created[0].atRiskCourses).toEqual([]);
    expect(created[1].courses).toEqual(['Science']);
  });

  it('invalidates the students cache so a later list includes the batch', async () => {
    const { sheets, spreadsheetId } = await setup();
    await listStudents(sheets, spreadsheetId, USER); // prime the (empty) cache
    await createStudentsBatch(sheets, spreadsheetId, USER, [
      { firstName: 'A', lastName: 'One', courses: ['Math'] },
    ]);
    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list).toHaveLength(1);
  });
});
