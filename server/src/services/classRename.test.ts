import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, listStudents } from './students.js';
import { submitAttendance, listByRange } from './attendance.js';
import { saveCurrentGrouping, getCurrentGrouping } from './groupings.js';
import { listCourses } from './courses.js';
import { moveClasses } from './classArchive.js';
import { renameClass } from './classRename.js';
import { readTabRowsIndexed } from './sheets.js';

const USER = 'user-sub-1';
const A = 'Period A Science';
const B = 'Period B Math';

type Sheets = Parameters<typeof listCourses>[0];

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

  const ada = await createStudent(sheets, spreadsheetId, USER, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    courses: [A, B],
  });
  const grace = await createStudent(sheets, spreadsheetId, USER, {
    firstName: 'Grace',
    lastName: 'Hopper',
    courses: [A],
  });
  // 2026-03-02 is a Monday; entry is refused at weekends.
  await submitAttendance(sheets, spreadsheetId, USER, '2026-03-02', A, [
    { studentId: ada.id, statusKey: 'a' },
    { studentId: grace.id, statusKey: 'p' },
  ]);
  await submitAttendance(sheets, spreadsheetId, USER, '2026-03-02', B, [
    { studentId: ada.id, statusKey: 'a' },
  ]);
  await saveCurrentGrouping(sheets, spreadsheetId, USER, A, { groupSize: 2 }, [
    { studentIds: [ada.id, grace.id] },
  ] as never);
  clearCache();
  return { env, sheets, spreadsheetId, ada, grace };
}

async function idOf(sheets: Sheets, spreadsheetId: string, name: string): Promise<string> {
  const courses = await listCourses(sheets, spreadsheetId, USER);
  const found = courses.find((c) => c.name === name);
  if (!found) throw new Error(`No course named ${name}`);
  return found.id;
}

function attendanceCourses(sheets: Sheets, spreadsheetId: string) {
  return listByRange(sheets, spreadsheetId, USER, '2000-01-01', '2100-01-01').then((rows) =>
    rows.map((r) => r.course).sort(),
  );
}

describe('renameClass', () => {
  beforeEach(() => clearCache());

  it('renames the class everywhere it is carried, and nothing else', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    const beforeCourses = await attendanceCourses(sheets, spreadsheetId);
    clearCache();

    const result = await renameClass(sheets, spreadsheetId, USER, aId, 'Grade 9 Science');
    clearCache();

    expect(result.live.map((c) => c.name).sort()).toEqual(['Grade 9 Science', B]);
    expect(result.live.find((c) => c.id === aId)?.studentCount).toBe(2);

    const students = await listStudents(sheets, spreadsheetId, USER);
    expect(students.find((s) => s.firstName === 'Ada')?.courses.sort()).toEqual([
      'Grade 9 Science',
      B,
    ]);
    expect(students.find((s) => s.firstName === 'Grace')?.courses).toEqual(['Grade 9 Science']);

    // Same number of attendance rows, with only class A's relabelled.
    const after = await attendanceCourses(sheets, spreadsheetId);
    expect(after).toHaveLength(beforeCourses.length);
    expect(after.filter((c) => c === A)).toEqual([]);
    expect(after.filter((c) => c === B)).toHaveLength(beforeCourses.filter((c) => c === B).length);

    expect(await getCurrentGrouping(sheets, spreadsheetId, USER, 'Grade 9 Science')).not.toBeNull();
    expect(await getCurrentGrouping(sheets, spreadsheetId, USER, A)).toBeNull();
  });

  it('refuses a name another live class already has', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await expect(renameClass(sheets, spreadsheetId, USER, aId, B)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('treats the current name, padded or not, as a no-op', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    const writesBefore = env.callCounts['values.batchUpdate'] ?? 0;
    const result = await renameClass(sheets, spreadsheetId, USER, aId, `  ${A} `);
    expect(result.live.map((c) => c.name)).toContain(A);
    expect(env.callCounts['values.batchUpdate'] ?? 0).toBe(writesBefore);
  });

  it('rejects an unknown class', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(renameClass(sheets, spreadsheetId, USER, 'nope', 'X')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  /**
   * The case the tab scoping exists for. An archived class and a live class may
   * share a name, and renaming one must not relabel the other's rows.
   */
  it('renames an archived class without touching a live class of the same name', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    // A new term's class under the old name.
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alan',
      lastName: 'Turing',
      courses: [A],
    });
    clearCache();

    const result = await renameClass(sheets, spreadsheetId, USER, aId, 'Science 2025');
    clearCache();

    expect(result.archived.map((c) => c.name)).toEqual(['Science 2025']);
    expect(result.live.map((c) => c.name)).toContain(A);
    const liveEnrollments = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollments');
    expect(liveEnrollments.filter((r) => r.obj.course === A)).toHaveLength(1);
    const archivedEnrollments = await readTabRowsIndexed(sheets, spreadsheetId, 'enrollmentsArchive');
    expect(archivedEnrollments.every((r) => r.obj.course === 'Science 2025')).toBe(true);

    // And it still restores whole under its new name.
    const restored = await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    expect(restored.classes.live.find((c) => c.id === aId)).toMatchObject({
      name: 'Science 2025',
      studentCount: 2,
    });
  });

  it('allows an archived class to take a live class’s name', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    const result = await renameClass(sheets, spreadsheetId, USER, aId, B);
    expect(result.archived.map((c) => c.name)).toEqual([B]);
    expect(result.live.map((c) => c.name)).toEqual([B]);
  });

  /**
   * Rows and course row go in one write. Split across two, a failure between
   * them reads back through `listCourses` as an emptied class plus a new one,
   * and the class's id is gone before the retry can use it.
   */
  it('writes the rows and the course record in a single call', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    const before = env.callCounts['values.batchUpdate'] ?? 0;
    await renameClass(sheets, spreadsheetId, USER, aId, 'Grade 9 Science');
    expect((env.callCounts['values.batchUpdate'] ?? 0) - before).toBe(1);
  });

  it('keeps the class intact and renameable after a failed write', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    env.failBatchUpdateAfter = 0;

    await expect(renameClass(sheets, spreadsheetId, USER, aId, 'Grade 9 Science')).rejects.toThrow();
    clearCache();
    expect(await idOf(sheets, spreadsheetId, A)).toBe(aId);

    const result = await renameClass(sheets, spreadsheetId, USER, aId, 'Grade 9 Science');
    clearCache();
    expect(result.live.find((c) => c.id === aId)).toMatchObject({
      name: 'Grade 9 Science',
      studentCount: 2,
    });
    const names = (await listCourses(sheets, spreadsheetId, USER)).map((c) => c.name).sort();
    expect(names).toEqual(['Grade 9 Science', B]);
    expect((await attendanceCourses(sheets, spreadsheetId)).includes(A)).toBe(false);
  });
});
