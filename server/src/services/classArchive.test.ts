import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, listStudents } from './students.js';
import { submitAttendance, listByRange } from './attendance.js';
import { listCourses, resolveNameCollision } from './courses.js';
import { moveClasses } from './classArchive.js';
import { readTabRowsIndexed, isActive } from './sheets.js';
import { CLASS_DAY_MARKER_KEY } from '../config/schema.js';

const USER = 'user-sub-1';

/** Every attendance record, whatever the class or date. */
function allAttendance(sheets: Parameters<typeof listByRange>[0], spreadsheetId: string) {
  return listByRange(sheets, spreadsheetId, USER, '2000-01-01', '2100-01-01');
}
const A = 'Period A Science';
const B = 'Period B Math';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

  // Ada is in both classes; Grace is only in the class that gets archived.
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
    { studentId: ada.id, statusKey: 'p' },
  ]);
  clearCache();
  return { env, sheets, spreadsheetId, ada, grace };
}

async function idOf(sheets: never, spreadsheetId: string, name: string): Promise<string>;
async function idOf(
  sheets: Parameters<typeof listCourses>[0],
  spreadsheetId: string,
  name: string,
): Promise<string> {
  const courses = await listCourses(sheets, spreadsheetId, USER);
  const found = courses.find((c) => c.name === name);
  if (!found) throw new Error(`No course named ${name}`);
  return found.id;
}

describe('moveClasses', () => {
  beforeEach(() => clearCache());

  /**
   * The test the whole feature turns on. Everything else is detail: if a
   * round trip is not lossless, nothing about archiving is safe to ship.
   */
  it('archives and restores a class losslessly', async () => {
    const { sheets, spreadsheetId } = await setup();
    const before = {
      students: await listStudents(sheets, spreadsheetId, USER),
      attendance: await allAttendance(sheets, spreadsheetId),
    };
    clearCache();

    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();

    const after = {
      students: await listStudents(sheets, spreadsheetId, USER),
      attendance: await allAttendance(sheets, spreadsheetId),
    };
    const sortById = <T extends { id: string }>(xs: T[]) =>
      [...xs].sort((x, y) => x.id.localeCompare(y.id));
    // `courses` is sorted on both sides because a student's class list is in
    // enrollment-row order, and restored rows are appended at the end of the
    // tab rather than back in their original positions. That is the one thing a
    // round trip does not preserve, and it is cosmetic — the order of the class
    // chips on a roster row. Every field that carries meaning is compared
    // as-is.
    const normalise = (xs: Awaited<ReturnType<typeof listStudents>>) =>
      sortById(xs).map((s) => ({ ...s, courses: [...s.courses].sort() }));

    expect(normalise(after.students)).toEqual(normalise(before.students));
    expect(sortById(after.attendance)).toEqual(sortById(before.attendance));
  });

  // Stated as its own expectation so the limitation above is recorded rather
  // than hidden inside a normalisation helper.
  it('restores the same set of classes per student, though not their original order', async () => {
    const { sheets, spreadsheetId, ada } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();

    const restored = (await listStudents(sheets, spreadsheetId, USER)).find((s) => s.id === ada.id);
    expect([...(restored?.courses ?? [])].sort()).toEqual([B, A].sort());
  });

  /**
   * Class-day markers (Step 6k) are rows on the `attendance` tab carrying a
   * course like any other, so the move handles them with no code of its own.
   * That is an argument for where markers live, so it is asserted rather than
   * assumed: a marker left behind would make an archived class's days look
   * recorded, and one that failed to come back would turn a restored class's
   * perfect attendance into a class nobody ever took.
   */
  it('moves the class-day markers with the class, in both directions', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);

    const markers = async (tab: 'attendance' | 'attendanceArchive') => {
      const rows = await readTabRowsIndexed(sheets, spreadsheetId, tab);
      return rows.filter(
        (r) => isActive(r.obj) && String(r.obj.statusKey ?? '') === CLASS_DAY_MARKER_KEY,
      );
    };

    // One marker per class, both live.
    expect((await markers('attendance')).map((r) => r.obj.course).sort()).toEqual([A, B].sort());
    expect(await markers('attendanceArchive')).toHaveLength(0);

    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    expect((await markers('attendance')).map((r) => r.obj.course)).toEqual([B]);
    expect((await markers('attendanceArchive')).map((r) => r.obj.course)).toEqual([A]);
    // And the archived class's day is invisible to every reader.
    expect(await listByRange(sheets, spreadsheetId, USER, '2026-03-02', '2026-03-02', A)).toEqual([]);

    await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();
    expect((await markers('attendance')).map((r) => r.obj.course).sort()).toEqual([A, B].sort());
    expect(await markers('attendanceArchive')).toHaveLength(0);
    // Grace was present that day and never had a row; the marker is the only
    // thing that brings her back as present rather than as unrecorded.
    const restored = await listByRange(sheets, spreadsheetId, USER, '2026-03-02', '2026-03-02', A);
    expect(restored).toHaveLength(2);
  });

  it('keeps a student who is still in another class, and their other attendance', async () => {
    const { sheets, spreadsheetId, ada } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    const students = await listStudents(sheets, spreadsheetId, USER);
    const stillHere = students.find((s) => s.id === ada.id);
    expect(stillHere).toBeDefined();
    expect(stillHere?.courses).toEqual([B]);

    const attendance = await allAttendance(sheets, spreadsheetId);
    expect(attendance.every((r) => r.course === B)).toBe(true);
    expect(attendance.filter((r) => r.studentId === ada.id)).toHaveLength(1);
  });

  it('removes a student whose only class was archived, and brings them back', async () => {
    const { sheets, spreadsheetId, grace } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);

    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    expect((await listStudents(sheets, spreadsheetId, USER)).map((s) => s.id)).not.toContain(
      grace.id,
    );

    clearCache();
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();
    expect((await listStudents(sheets, spreadsheetId, USER)).map((s) => s.id)).toContain(grace.id);
  });

  /**
   * The measurable justification for moving rows rather than flagging them. If
   * this stops being true the feature has lost its point, whatever the UI does.
   */
  it('shrinks the live attendance tab, which flagging would not', async () => {
    const { sheets, spreadsheetId } = await setup();
    expect(await allAttendance(sheets, spreadsheetId)).toHaveLength(3);
    clearCache();

    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    expect(await allAttendance(sheets, spreadsheetId)).toHaveLength(1);
  });

  it('leaves a class the teacher did not name alone', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    const courses = await listCourses(sheets, spreadsheetId, USER);
    expect(courses.find((c) => c.name === B)?.archivedAt).toBeNull();
    expect(courses.find((c) => c.name === A)?.archivedAt).not.toBeNull();
  });

  /**
   * The September case, and a bug found by the route tests rather than by
   * design: reconciliation compared enrollment course names against *every*
   * course on record, archived included. A teacher who archives "Period A
   * Science" in February and starts a new one under the same name in September
   * therefore got no live class row at all — their new class was invisible to
   * the dialog, so it could be neither archived nor told apart from the old one.
   * Live names only.
   */
  it('creates a live class when an archived class name is reused', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alan',
      lastName: 'Turing',
      courses: [A],
    });
    clearCache();

    const courses = await listCourses(sheets, spreadsheetId, USER);
    const named = courses.filter((c) => c.name === A);
    expect(named).toHaveLength(2);
    expect(named.filter((c) => c.archivedAt === null)).toHaveLength(1);
    expect(named.filter((c) => c.archivedAt !== null)).toHaveLength(1);
  });

  it('treats re-archiving an already archived class as a no-op, not an error', async () => {
    const { sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();
    await expect(moveClasses(sheets, spreadsheetId, USER, [aId], 'archive')).resolves.toMatchObject(
      { renamed: [] },
    );
  });

  it('does not sweep up a student who simply has no class yet', async () => {
    const { sheets, spreadsheetId } = await setup();
    // Enrolled only in A, then removed from it — so no live enrollment, but
    // also nothing to do with the class being archived.
    const loner = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alan',
      lastName: 'Turing',
      courses: [B],
    });
    clearCache();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    expect((await listStudents(sheets, spreadsheetId, USER)).map((s) => s.id)).toContain(loner.id);
  });

  /**
   * The constraint the shape of this service answers to. Sheets allows 60 reads
   * and 60 writes a minute *per user*, and an earlier version spent about forty
   * calls on a single move — so a teacher who archived one class and then
   * changed their mind was rate-limited by their own second click, which is
   * exactly what happened in manual testing.
   *
   * A budget rather than an exact count, since the number moves with the tabs a
   * class actually has rows in. What it pins is the order of magnitude, and that
   * it does not grow with the size of the class.
   */
  it('costs a bounded number of Sheets calls', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    env.callCounts = {};

    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');

    const calls = Object.entries(env.callCounts)
      .filter(([k]) => k.startsWith('values.') || k.startsWith('sheets.'))
      .reduce((n, [, count]) => n + count, 0);
    // 11 as measured: 2 batchGet, 3 append, 3 verifying counts, 2 for the
    // batched rewrite, 1 for the course stamp.
    expect(calls).toBeLessThanOrEqual(12);
    // The whole-tab reads are one batched call, not one per tab.
    expect(env.callCounts['values.batchGet'] ?? 0).toBeLessThanOrEqual(2);
    // And no header round trips: every header was validated by that same read.
    expect(env.callCounts['values.get'] ?? 0).toBeLessThanOrEqual(4);
  });

  describe('failure ordering', () => {
    /**
     * The reason the sequence is append → verify → rewrite. These two assert the
     * property that ordering buys: a crash costs duplicates, never rows.
     */
    it('leaves the source intact when the archive append fails', async () => {
      const { env, sheets, spreadsheetId } = await setup();
      const aId = await idOf(sheets, spreadsheetId, A);
      env.failNextAppend = true;

      await expect(moveClasses(sheets, spreadsheetId, USER, [aId], 'archive')).rejects.toThrow();
      clearCache();

      // Nothing left the live tabs.
      expect(await allAttendance(sheets, spreadsheetId)).toHaveLength(3);
      expect(await listStudents(sheets, spreadsheetId, USER)).toHaveLength(2);
    });

    /**
     * The course row is the operation's commit record: `moveClasses` decides
     * there is nothing left to do by reading `archivedAt`. Stamping it before
     * the rows are actually where they belong would mark the class archived over
     * a rewrite that failed, and the retry that should repair it would find
     * nothing to do and report success. Found by the retry test below rather
     * than by design, and asserted here directly so the ordering is pinned.
     */
    it('leaves the class unstamped when the source rewrite fails', async () => {
      const { env, sheets, spreadsheetId } = await setup();
      const aId = await idOf(sheets, spreadsheetId, A);
      env.failNextClear = true;

      await expect(moveClasses(sheets, spreadsheetId, USER, [aId], 'archive')).rejects.toThrow();
      clearCache();

      const courses = await listCourses(sheets, spreadsheetId, USER);
      expect(courses.find((c) => c.id === aId)?.archivedAt).toBeNull();
    });

    it('recovers on retry after the source rewrite fails midway', async () => {
      const { env, sheets, spreadsheetId } = await setup();
      const aId = await idOf(sheets, spreadsheetId, A);
      // Fails at the clear, i.e. after rows are safely in the archive.
      env.failNextClear = true;

      await expect(moveClasses(sheets, spreadsheetId, USER, [aId], 'archive')).rejects.toThrow();
      clearCache();

      // The retry must not double-write the already-archived rows.
      await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
      clearCache();
      expect(await allAttendance(sheets, spreadsheetId)).toHaveLength(1);

      // And the round trip is still lossless afterwards.
      await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
      clearCache();
      expect(await allAttendance(sheets, spreadsheetId)).toHaveLength(3);
    });
  });
});

/**
 * Regressions from manual testing, and the reason the rename now happens on rows
 * as they move rather than after they land. Reported sequence: archive a class,
 * create a new student in a new class of the same name, then restore.
 */
describe('restoring into a live class of the same name', () => {
  beforeEach(() => clearCache());

  async function archiveThenRecreate() {
    const { sheets, spreadsheetId, ada, grace } = await setup();
    const aId = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [aId], 'archive');
    clearCache();

    // A brand-new student in a brand-new class that reuses the archived name.
    const fresh = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Katherine',
      lastName: 'Johnson',
      courses: [A],
    });
    await submitAttendance(sheets, spreadsheetId, USER, '2026-03-09', A, [
      { studentId: fresh.id, statusKey: 'p' },
    ]);
    clearCache();
    return { sheets, spreadsheetId, aId, fresh, ada, grace };
  }

  it('leaves the new class and its student exactly where they are', async () => {
    const { sheets, spreadsheetId, aId, fresh } = await archiveThenRecreate();

    const result = await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();
    expect(result.renamed).toHaveLength(1);
    const restoredName = result.renamed[0].to;

    // The new student stays in the class they were actually put in. Previously
    // the rename pass ran over the destination tab and swept them into the
    // restored class, because both carried the same name at that moment.
    const students = await listStudents(sheets, spreadsheetId, USER);
    expect(students.find((s) => s.id === fresh.id)?.courses).toEqual([A]);

    const attendance = await allAttendance(sheets, spreadsheetId);
    expect(attendance.find((r) => r.studentId === fresh.id)?.course).toBe(A);
    expect(restoredName).not.toBe(A);
  });

  it('brings back every student of the archived class', async () => {
    const { sheets, spreadsheetId, aId, ada, grace } = await archiveThenRecreate();

    const result = await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();
    const restoredName = result.renamed[0].to;

    const students = await listStudents(sheets, spreadsheetId, USER);
    // Grace was only ever in the archived class, so she had to come back out of
    // studentsArchive. Previously nobody did: the orphan check matched on the
    // old name, which no row carried any more.
    expect(students.map((s) => s.id)).toContain(grace.id);
    expect(students.find((s) => s.id === grace.id)?.courses).toEqual([restoredName]);
    expect(students.find((s) => s.id === ada.id)?.courses).toContain(restoredName);
  });

  it('restores the archived attendance under the new name and loses none of it', async () => {
    const { sheets, spreadsheetId, aId, fresh } = await archiveThenRecreate();

    const result = await moveClasses(sheets, spreadsheetId, USER, [aId], 'unarchive');
    clearCache();
    const restoredName = result.renamed[0].to;

    const attendance = await allAttendance(sheets, spreadsheetId);
    // Three originals (two in the archived class, one in B) plus the new one.
    expect(attendance).toHaveLength(4);
    expect(attendance.filter((r) => r.course === restoredName)).toHaveLength(2);
    expect(attendance.filter((r) => r.course === A)).toHaveLength(1);
    expect(attendance.find((r) => r.studentId === fresh.id)?.course).toBe(A);
  });
});

/**
 * The other half of the same invariant. Archive rows carry only the course name,
 * so two archived classes sharing one would have indistinguishable rows — and
 * archiving the same class name in two successive years is entirely ordinary.
 */
describe('archiving into an archived class of the same name', () => {
  beforeEach(() => clearCache());

  it('renames the second one so archived rows stay attributable', async () => {
    const { sheets, spreadsheetId } = await setup();
    const first = await idOf(sheets, spreadsheetId, A);
    await moveClasses(sheets, spreadsheetId, USER, [first], 'archive');
    clearCache();

    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Katherine',
      lastName: 'Johnson',
      courses: [A],
    });
    clearCache();

    const second = (await listCourses(sheets, spreadsheetId, USER)).find(
      (c) => c.name === A && c.archivedAt === null,
    )!.id;
    const result = await moveClasses(sheets, spreadsheetId, USER, [second], 'archive');
    clearCache();

    expect(result.renamed).toHaveLength(1);
    const archived = (await listCourses(sheets, spreadsheetId, USER)).filter(
      (c) => c.archivedAt !== null,
    );
    // Two archived classes, two distinct names.
    expect(archived).toHaveLength(2);
    expect(new Set(archived.map((c) => c.name)).size).toBe(2);
  });
});

describe('resolveNameCollision', () => {
  it('leaves a free name alone', () => {
    expect(resolveNameCollision(A, '2023-09-01T00:00:00Z', new Set())).toBe(A);
  });

  it('appends the creation year when the name is live', () => {
    expect(resolveNameCollision(A, '2023-09-01T00:00:00Z', new Set([A]))).toBe(`${A} (2023)`);
  });

  /**
   * Two archived classes from the same year, restored alongside a live one. The
   * rule has to terminate with a usable name rather than reject — a teacher
   * being permanently unable to restore their own class is the worse failure.
   */
  it('falls back to a numeric suffix when the year is taken too', () => {
    const taken = new Set([A, `${A} (2023)`]);
    expect(resolveNameCollision(A, '2023-09-01T00:00:00Z', taken)).toBe(`${A} (2023) 2`);
    taken.add(`${A} (2023) 2`);
    expect(resolveNameCollision(A, '2023-09-01T00:00:00Z', taken)).toBe(`${A} (2023) 3`);
  });
});
