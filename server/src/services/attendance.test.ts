import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, createStudentsBatch, updateStudent } from './students.js';
import { listEnrollments } from './enrollments.js';
import { readTabRowsIndexed, isActive } from './sheets.js';
import {
  listByDate,
  listByRange,
  submitAttendance,
  updateAttendance,
  getStats,
  computeStats,
  exceedsThreshold,
  type AttendanceRecord,
  type AttendanceStats,
  type EnrollmentPair,
  type ClassDay,
} from './attendance.js';

const USER = 'user-sub-1';
const COURSE = 'C';

async function setup(studentCount = 2, courses: string[] = [COURSE]) {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  const ids: string[] = [];
  for (let i = 0; i < studentCount; i++) {
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: `S${i}`,
      lastName: `L${i}`,
      courses,
    });
    ids.push(s.id);
  }
  return { env, sheets, spreadsheetId, ids };
}

function record(over: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: 'r1',
    studentId: 's1',
    course: COURSE,
    date: '2026-09-01',
    statusKey: 'p',
    notes: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const pair = (studentId: string, course = COURSE): EnrollmentPair => ({ studentId, course });

/**
 * Converts a dense v4-shaped fixture into the v5 stored form, exactly as the
 * migration does: present rows disappear and every (course, date) that had any
 * row becomes a class-day marker.
 *
 * Every `computeStats` case below is asserted through this, which is how the
 * step's central criterion is tested — the numbers on each side of the
 * conversion are the same numbers, so the expectations are unchanged from the
 * ones that were written against the dense form.
 */
function stored(dense: AttendanceRecord[]): {
  records: AttendanceRecord[];
  classDays: ClassDay[];
} {
  const seen = new Set<string>();
  const classDays: ClassDay[] = [];
  for (const r of dense) {
    const key = `${r.course}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    classDays.push({ course: r.course, date: r.date });
  }
  return { records: dense.filter((r) => r.statusKey !== 'p'), classDays };
}

/**
 * Active rows actually on the `attendance` tab, which is what the step is
 * shrinking. Deliberately not `listByDate`/`listByRange`, which expand the
 * stored form back out and so would report the same figures either way.
 */
async function storedRowCount(
  sheets: Parameters<typeof listByDate>[0],
  spreadsheetId: string,
): Promise<number> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
  return rows.filter((r) => isActive(r.obj)).length;
}

/** `computeStats` over a dense fixture, via the stored form. */
function statsOf(
  dense: AttendanceRecord[],
  enrollments: EnrollmentPair[],
  range?: { startDate: string; endDate: string },
): AttendanceStats[] {
  const { records, classDays } = stored(dense);
  return computeStats(records, classDays, enrollments, range);
}

describe('attendance service', () => {
  beforeEach(() => clearCache());

  it('writes one row per (student, course, date) with the given statuses', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    const result = await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: ids[1], statusKey: 'a', notes: 'called home' },
    ]);
    expect(result).toEqual({ written: 2 });

    const day = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(day).toHaveLength(2);
    const absent = day.find((r) => r.studentId === ids[1]);
    expect(absent?.statusKey).toBe('a');
    expect(absent?.notes).toBe('called home');
    expect(absent?.course).toBe(COURSE);
  });

  it('overwrites existing records on resubmission without duplicating rows', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
      { studentId: ids[1], statusKey: 'p' },
    ]);
    const firstPass = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(firstPass.find((r) => r.studentId === ids[0])?.statusKey).toBe('a');

    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 't' },
    ]);
    const day = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(day).toHaveLength(2);
    const corrected = day.find((r) => r.studentId === ids[0]);
    expect(corrected?.statusKey).toBe('t');
    // Overwrite reuses the row: same record id, no new row appended.
    expect(corrected?.id).toBe(firstPass.find((r) => r.studentId === ids[0])?.id);
    // The unlisted student's record is untouched.
    expect(day.find((r) => r.studentId === ids[1])?.statusKey).toBe('p');
  });

  it('soft-deletes the row when a student is corrected back to present, and the day stays taken', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
      { studentId: ids[1], statusKey: 'p' },
    ]);
    expect(await storedRowCount(sheets, spreadsheetId)).toBe(2); // one absence, one marker

    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);

    // The absence row is no longer active, leaving the marker.
    expect(await storedRowCount(sheets, spreadsheetId)).toBe(1);

    // Soft-deleted, not erased. The row is still on the tab with `deletedAt`
    // stamped and its status untouched, which is how every delete in this schema
    // works — removing a row from a Sheet means rewriting the whole tab. Pinned
    // explicitly because "the row is gone" is the natural reading of the active
    // count above, and it is wrong: the row is visible in the spreadsheet.
    const all = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    const tombstone = all.find((r) => r.obj.studentId === ids[0]);
    expect(tombstone).toBeDefined();
    expect(tombstone?.obj.statusKey).toBe('a');
    expect(tombstone?.obj.deletedAt).toBeTruthy();

    // The day still reads as taken, with both students present.
    const day = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(day).toHaveLength(2);
    expect(day.every((r) => r.statusKey === 'p')).toBe(true);
  });

  it('appends a fresh row rather than reviving a tombstone when the mark comes back', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    for (const statusKey of ['a', 'p', 'a'] as const) {
      await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
        { studentId: ids[0], statusKey },
      ]);
    }
    // One active absence and one marker, so the reader is right.
    expect(await storedRowCount(sheets, spreadsheetId)).toBe(2);
    const day = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(day).toHaveLength(1);
    expect(day[0].statusKey).toBe('a');

    // But the tab carries the tombstone too. Repeated corrections accumulate
    // rows, bounded by corrections rather than by student-days, so this does not
    // threaten the saving the step exists for. Asserted so the growth is a known
    // quantity rather than a surprise found on someone's real sheet.
    const all = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    expect(all).toHaveLength(3);
  });

  it('writes a marker on a day where every student is present', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: ids[1], statusKey: 'p' },
    ]);
    // The one row written is the marker: no exception rows at all.
    expect(await storedRowCount(sheets, spreadsheetId)).toBe(1);
    // Which is what makes the day read as taken rather than as never recorded.
    const day = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(day).toHaveLength(2);
    expect(day.every((r) => r.statusKey === 'p')).toBe(true);
  });

  it('tells a fully-present day apart from a day nobody recorded', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: ids[1], statusKey: 'p' },
    ]);
    // Recorded and fully present: two present records.
    expect(await listByDate(sheets, spreadsheetId, USER, '2026-09-01')).toHaveLength(2);
    // 2026-09-02 was never taken: no records at all, not two present ones.
    expect(await listByDate(sheets, spreadsheetId, USER, '2026-09-02')).toHaveLength(0);
  });

  it('stores far fewer rows than marks taken', async () => {
    // Twenty students over five school days, one absence a day: a hundred marks.
    const { sheets, spreadsheetId, ids } = await setup(20);
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'];
    for (const [i, date] of dates.entries()) {
      await submitAttendance(
        sheets,
        spreadsheetId,
        USER,
        date,
        COURSE,
        ids.map((id, j) => ({ studentId: id, statusKey: j === i ? 'a' : 'p' }) as const),
      );
    }
    // Five markers plus five absences, against the 100 rows v4 would have held.
    expect(await storedRowCount(sheets, spreadsheetId)).toBe(10);
    // And all hundred marks still read back.
    expect(
      await listByRange(sheets, spreadsheetId, USER, '2026-09-01', '2026-09-07'),
    ).toHaveLength(100);
  });

  it('keeps per-class attendance independent for a student in two courses', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1, ['Period 1', 'Period 4']);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4', [
      { studentId: ids[0], statusKey: 'p' },
    ]);

    const all = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');
    expect(all).toHaveLength(2);
    const p1 = await listByDate(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1');
    expect(p1).toHaveLength(1);
    expect(p1[0].statusKey).toBe('a');
    const p4 = await listByDate(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4');
    expect(p4[0].statusKey).toBe('p');

    // Resubmitting Period 1 leaves Period 4 untouched.
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 't' },
    ]);
    const p4After = await listByDate(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4');
    expect(p4After[0].statusKey).toBe('p');
  });

  it('rejects students not enrolled in the course without writing anything', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await expect(
      submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
        { studentId: ids[0], statusKey: 'p' },
        { studentId: 'nope', statusKey: 'a' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await listByDate(sheets, spreadsheetId, USER, '2026-09-01')).toHaveLength(0);
  });

  it('rejects an unknown course', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await expect(
      submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Ghost Class', [
        { studentId: ids[0], statusKey: 'p' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects attendance submitted for a weekend date', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    await expect(
      // 2026-09-05 is a Saturday.
      submitAttendance(sheets, spreadsheetId, USER, '2026-09-05', COURSE, [
        { studentId: ids[0], statusKey: 'p' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await listByDate(sheets, spreadsheetId, USER, '2026-09-05')).toHaveLength(0);
  });

  it('rejects duplicate student ids within one submission', async () => {
    const { sheets, spreadsheetId, ids } = await setup();
    await expect(
      submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
        { studentId: ids[0], statusKey: 'p' },
        { studentId: ids[0], statusKey: 'a' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await listByDate(sheets, spreadsheetId, USER, '2026-09-01')).toHaveLength(0);
  });

  it('lists records within a date range, inclusive on both ends', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      await submitAttendance(sheets, spreadsheetId, USER, date, COURSE, [
        { studentId: ids[0], statusKey: 'p' },
      ]);
    }
    const range = await listByRange(sheets, spreadsheetId, USER, '2026-09-02', '2026-09-03');
    expect(range.map((r) => r.date).sort()).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('scopes a range to a single course when given, and to all courses when omitted', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1, ['Period 1', 'Period 4']);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4', [
      { studentId: ids[0], statusKey: 'p' },
    ]);

    const scoped = await listByRange(
      sheets,
      spreadsheetId,
      USER,
      '2026-09-01',
      '2026-09-01',
      'Period 1',
    );
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ course: 'Period 1', statusKey: 'a' });

    const all = await listByRange(sheets, spreadsheetId, USER, '2026-09-01', '2026-09-01');
    expect(all.map((r) => r.course).sort()).toEqual(['Period 1', 'Period 4']);
  });

  it('edits a single record and 404s for unknown ids', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    const [rec] = await listByDate(sheets, spreadsheetId, USER, '2026-09-01');

    const updated = await updateAttendance(sheets, spreadsheetId, USER, rec.id, {
      statusKey: 'e',
      notes: 'doctor visit',
    });
    expect(updated.statusKey).toBe('e');
    expect(updated.notes).toBe('doctor visit');

    await expect(
      updateAttendance(sheets, spreadsheetId, USER, 'missing', { statusKey: 'p' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('computes stats end to end, one row per (student, course)', async () => {
    const { sheets, spreadsheetId, ids } = await setup(2);
    // Student 0: p, a, a — two absences, current streak 2.
    // Student 1: never recorded.
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-02', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-03', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
    ]);

    const stats = await getStats(sheets, spreadsheetId, USER);
    expect(stats).toHaveLength(2);
    const s0 = stats.find((s) => s.studentId === ids[0]);
    expect(s0).toMatchObject({
      course: COURSE,
      totalAbsences: 2,
      daysRecorded: 3,
      consecutiveAbsences: 2,
    });
    expect(s0?.absenceRate).toBeCloseTo(2 / 3);
    // The second student has no rows at all, which from schemaVersion 5 means
    // present on every day the register was taken rather than "no data". Three
    // class-days, no absences.
    const s1 = stats.find((s) => s.studentId === ids[1]);
    expect(s1).toMatchObject({ totalAbsences: 0, daysRecorded: 3, absenceRate: 0 });
  });

  it('returns one stats row per course for a multi-course student, scopable by course', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1, ['Period 1', 'Period 4']);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4', [
      { studentId: ids[0], statusKey: 'p' },
    ]);

    const all = await getStats(sheets, spreadsheetId, USER);
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.course === 'Period 1')?.totalAbsences).toBe(1);
    expect(all.find((s) => s.course === 'Period 4')?.totalAbsences).toBe(0);

    const scoped = await getStats(sheets, spreadsheetId, USER, undefined, 'Period 1');
    expect(scoped).toHaveLength(1);
    expect(scoped[0].course).toBe('Period 1');
  });
});

describe('computeStats', () => {
  // All weekdays: 09-01 Tue … 09-04 Fri, 09-07 Mon, 09-08 Tue (09-05/06 are the weekend).
  const fixture: AttendanceRecord[] = [
    record({ id: '1', date: '2026-09-01', statusKey: 'p' }),
    record({ id: '2', date: '2026-09-02', statusKey: 'a' }),
    record({ id: '3', date: '2026-09-03', statusKey: 't' }),
    record({ id: '4', date: '2026-09-04', statusKey: 'e' }),
    record({ id: '5', date: '2026-09-07', statusKey: 'a' }),
    record({ id: '6', date: '2026-09-08', statusKey: 'a' }),
  ];

  it('produces exact aggregate numbers for a known fixture', () => {
    const [stats] = statsOf(fixture, [pair('s1')]);
    expect(stats).toEqual({
      studentId: 's1',
      course: COURSE,
      totalAbsences: 3,
      totalTardies: 1,
      totalExcused: 1,
      daysRecorded: 6,
      absenceRate: 0.5,
      consecutiveAbsences: 2, // 09-07 and 09-08 are the most recent recorded days
    });
  });

  it('breaks the streak on the most recent non-absent day', () => {
    const withPresent = [...fixture, record({ id: '7', date: '2026-09-09', statusKey: 'p' })];
    const [stats] = statsOf(withPresent, [pair('s1')]);
    expect(stats.consecutiveAbsences).toBe(0);
  });

  it('aggregates the same student separately per course', () => {
    const mixed: AttendanceRecord[] = [
      record({ id: '1', course: 'A', date: '2026-09-01', statusKey: 'a' }),
      record({ id: '2', course: 'A', date: '2026-09-02', statusKey: 'a' }),
      record({ id: '3', course: 'B', date: '2026-09-01', statusKey: 'p' }),
    ];
    const stats = statsOf(mixed, [pair('s1', 'A'), pair('s1', 'B')]);
    expect(stats.find((s) => s.course === 'A')?.totalAbsences).toBe(2);
    expect(stats.find((s) => s.course === 'B')?.totalAbsences).toBe(0);
    expect(stats.find((s) => s.course === 'B')?.daysRecorded).toBe(1);
  });

  it('excludes weekend records and does not let a weekend break a streak', () => {
    // Thu, Fri, then Mon all absent; a stray Saturday present-row sits between.
    const spanning: AttendanceRecord[] = [
      record({ id: '1', date: '2026-09-03', statusKey: 'a' }), // Thursday
      record({ id: '2', date: '2026-09-04', statusKey: 'a' }), // Friday
      record({ id: '3', date: '2026-09-05', statusKey: 'p' }), // Saturday (ignored)
      record({ id: '4', date: '2026-09-07', statusKey: 'a' }), // Monday
    ];
    const [stats] = statsOf(spanning, [pair('s1')]);
    expect(stats.daysRecorded).toBe(3); // Saturday excluded
    expect(stats.totalAbsences).toBe(3);
    expect(stats.consecutiveAbsences).toBe(3); // weekend does not break it
  });

  it('scopes aggregation to a date range', () => {
    const [stats] = statsOf(fixture, [pair('s1')], {
      startDate: '2026-09-02',
      endDate: '2026-09-04',
    });
    expect(stats.daysRecorded).toBe(3);
    expect(stats.totalAbsences).toBe(1);
    expect(stats.absenceRate).toBeCloseTo(1 / 3);
  });

  it('reads an enrollment with no rows of its own as present on every class-day', () => {
    // s2 is enrolled but appears nowhere in the fixture. Another student's rows
    // are not theirs, but the class-days those rows establish are shared: the
    // register was taken six times and s2 was present at all six. Before
    // schemaVersion 5 this read as `daysRecorded: 0`, and the difference is the
    // whole point of the marker.
    const stats = statsOf(fixture, [pair('s2')]);
    expect(stats).toEqual([
      {
        studentId: 's2',
        course: COURSE,
        totalAbsences: 0,
        totalTardies: 0,
        totalExcused: 0,
        daysRecorded: 6,
        absenceRate: 0,
        consecutiveAbsences: 0,
      },
    ]);
  });

  it('does not count class-days before the student joined the class', () => {
    // Joining on the 4th: the three class-days before it are not theirs, so the
    // denominator is the 4th, 7th and 8th rather than all six.
    const [stats] = statsOf(fixture, [{ ...pair('s2'), startDate: '2026-09-04' }]);
    expect(stats.daysRecorded).toBe(3);
  });

  it('still counts a recorded mark that predates the start date', () => {
    // The clamp suppresses a guess, never a fact: an absence recorded on the 2nd
    // is something the teacher said, and it survives a later start date.
    const [stats] = statsOf(fixture, [{ ...pair('s1'), startDate: '2026-09-04' }]);
    expect(stats.totalAbsences).toBe(3);
    expect(stats.daysRecorded).toBe(5); // the four from the 4th on, plus the 2nd
  });
});

describe('exceedsThreshold', () => {
  function stats(over: Partial<AttendanceStats>): AttendanceStats {
    return {
      studentId: 's1',
      course: COURSE,
      totalAbsences: 0,
      totalTardies: 0,
      totalExcused: 0,
      daysRecorded: 20,
      absenceRate: 0,
      consecutiveAbsences: 0,
      ...over,
    };
  }

  it('flags at exactly the absence-count threshold, not one below', () => {
    expect(exceedsThreshold(stats({ totalAbsences: 4 }), { minAbsences: 5 })).toBe(false);
    expect(exceedsThreshold(stats({ totalAbsences: 5 }), { minAbsences: 5 })).toBe(true);
    expect(exceedsThreshold(stats({ totalAbsences: 6 }), { minAbsences: 5 })).toBe(true);
  });

  it('flags at exactly the rate threshold, not one below', () => {
    expect(exceedsThreshold(stats({ absenceRate: 0.09 }), { minAbsenceRate: 0.1 })).toBe(false);
    expect(exceedsThreshold(stats({ absenceRate: 0.1 }), { minAbsenceRate: 0.1 })).toBe(true);
    expect(exceedsThreshold(stats({ absenceRate: 0.11 }), { minAbsenceRate: 0.1 })).toBe(true);
  });

  it('never rate-flags a student with no recorded days', () => {
    expect(
      exceedsThreshold(stats({ daysRecorded: 0, absenceRate: 0 }), { minAbsenceRate: 0 }),
    ).toBe(false);
  });

  it('flags when either bound of a combined threshold is met', () => {
    const t = { minAbsences: 5, minAbsenceRate: 0.1 };
    expect(exceedsThreshold(stats({ totalAbsences: 5, absenceRate: 0.05 }), t)).toBe(true);
    expect(exceedsThreshold(stats({ totalAbsences: 2, absenceRate: 0.2 }), t)).toBe(true);
    expect(exceedsThreshold(stats({ totalAbsences: 2, absenceRate: 0.05 }), t)).toBe(false);
  });
});

describe('attendance cache merge (read-quota backlog c)', () => {
  beforeEach(() => clearCache());

  it('keeps the cache warm after a submit — a following read hits no Sheets', async () => {
    const { env, sheets, spreadsheetId, ids } = await setup(2);
    // Daily Entry reads the date first (warming the cache), then saves.
    await listByDate(sheets, spreadsheetId, USER, '2026-09-01', COURSE);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: ids[1], statusKey: 'a' },
    ]);
    // The submit merged its writes into the warm cache, so this read touches no tab.
    env.callCounts['values.get'] = 0;
    const rows = await listByDate(sheets, spreadsheetId, USER, '2026-09-01', COURSE);
    expect(rows).toHaveLength(2);
    expect(env.callCounts['values.get'] ?? 0).toBe(0);
  });

  it('reflects a correction re-submit through the warm cache', async () => {
    const { env, sheets, spreadsheetId, ids } = await setup(1);
    await listByDate(sheets, spreadsheetId, USER, '2026-09-01', COURSE); // warm
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    env.callCounts['values.get'] = 0;
    const rows = await listByDate(sheets, spreadsheetId, USER, '2026-09-01', COURSE);
    expect(rows).toHaveLength(1);
    expect(rows[0].statusKey).toBe('p');
    expect(env.callCounts['values.get'] ?? 0).toBe(0);
  });
});

/**
 * Step 6k follow-up. Present is inferred from the absence of a row, so a student
 * added to a class that has already been recorded would otherwise read as
 * present for every session held before they arrived — inflating their
 * denominator and quietly diluting their absence rate, which is a false negative
 * on the high-absence flag rather than a false alarm.
 */
describe('enrollment start dates', () => {
  beforeEach(() => clearCache());

  async function startDateOf(
    sheets: Parameters<typeof listByDate>[0],
    spreadsheetId: string,
    studentId: string,
    course = COURSE,
  ): Promise<string | null> {
    const enrollments = await listEnrollments(sheets, spreadsheetId, USER);
    return enrollments.find((e) => e.studentId === studentId && e.course === course)?.startDate ?? null;
  }

  it('starts a student joining a recorded class the day after the last register', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    // 2026-09-01 Tue and 2026-09-02 Wed, both taken before the new student exists.
    for (const date of ['2026-09-01', '2026-09-02']) {
      await submitAttendance(sheets, spreadsheetId, USER, date, COURSE, [
        { studentId: ids[0], statusKey: 'p' },
      ]);
    }

    const joiner = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Mid',
      lastName: 'Year',
      courses: [COURSE],
    });
    clearCache();

    expect(await startDateOf(sheets, spreadsheetId, joiner.id)).toBe('2026-09-03');

    const stats = await getStats(sheets, spreadsheetId, USER);
    // Two class-days for the student who was there, none for the one who was not.
    expect(stats.find((s) => s.studentId === ids[0])?.daysRecorded).toBe(2);
    expect(stats.find((s) => s.studentId === joiner.id)?.daysRecorded).toBe(0);
  });

  it('counts the joiner from the next register taken', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    const joiner = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Mid',
      lastName: 'Year',
      courses: [COURSE],
    });
    clearCache();

    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-02', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: joiner.id, statusKey: 'a' },
    ]);

    const stats = await getStats(sheets, spreadsheetId, USER);
    const joined = stats.find((s) => s.studentId === joiner.id);
    // One class-day, one absence: a 100% rate over the days they were actually
    // in the class, rather than 50% diluted by a session they never attended.
    expect(joined).toMatchObject({ daysRecorded: 1, totalAbsences: 1 });
    expect(joined?.absenceRate).toBe(1);
  });

  it('leaves a student joining an unrecorded class unbounded, so backfill still counts', async () => {
    // The ordinary set-up sequence: build the roster, then enter last week.
    const { sheets, spreadsheetId, ids } = await setup(1);
    const second = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Also',
      lastName: 'New',
      courses: [COURSE],
    });
    clearCache();

    expect(await startDateOf(sheets, spreadsheetId, second.id)).toBeNull();

    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
      { studentId: second.id, statusKey: 'p' },
    ]);
    const stats = await getStats(sheets, spreadsheetId, USER);
    expect(stats.every((s) => s.daysRecorded === 1)).toBe(true);
  });

  it('applies the same rule to a bulk roster add', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    clearCache();

    const [bulk] = await createStudentsBatch(sheets, spreadsheetId, USER, [
      { firstName: 'Bulk', lastName: 'Joiner', courses: [COURSE] },
    ]);
    clearCache();

    expect(await startDateOf(sheets, spreadsheetId, bulk.id)).toBe('2026-09-02');
  });

  it('scopes the bound to the course being joined, not to any recorded class', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1, ['Period 1', 'Period 4']);
    // Only Period 1 has ever been recorded.
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    clearCache();

    const joiner = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Two',
      lastName: 'Classes',
      courses: ['Period 1', 'Period 4'],
    });
    clearCache();

    expect(await startDateOf(sheets, spreadsheetId, joiner.id, 'Period 1')).toBe('2026-09-02');
    expect(await startDateOf(sheets, spreadsheetId, joiner.id, 'Period 4')).toBeNull();
  });

  it('does not restamp an existing enrollment when the roster is re-saved', async () => {
    const { sheets, spreadsheetId, ids } = await setup(1, ['Period 1']);
    // The first student predates any attendance, so their start date is unset.
    expect(await startDateOf(sheets, spreadsheetId, ids[0], 'Period 1')).toBeNull();

    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    clearCache();

    // Adding a second class must not disturb the first enrollment's start date,
    // which records when the student joined rather than when the row was last
    // written.
    await updateStudent(sheets, spreadsheetId, USER, ids[0], {
      courses: ['Period 1', 'Period 4'],
    });
    clearCache();

    expect(await startDateOf(sheets, spreadsheetId, ids[0], 'Period 1')).toBeNull();
    expect(await startDateOf(sheets, spreadsheetId, ids[0], 'Period 4')).toBeNull();
  });
});

describe('the cost of the start-date rule', () => {
  beforeEach(() => clearCache());

  it('reads attendance once across a burst of adds, not once per student', async () => {
    const { env, sheets, spreadsheetId, ids } = await setup(1);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', COURSE, [
      { studentId: ids[0], statusKey: 'p' },
    ]);
    clearCache();

    // The first add pays for the attendance read; the working set holds it after
    // that, and nothing on the roster-add path invalidates it. A teacher adding
    // students one at a time would otherwise spend an extra Sheets read per
    // student against a 60-per-minute per-user limit.
    env.callCounts['values.get'] = 0;
    for (const n of [1, 2, 3]) {
      await createStudent(sheets, spreadsheetId, USER, {
        firstName: `Joiner${n}`,
        lastName: 'X',
        courses: [COURSE],
      });
    }
    const readsForThreeAdds = env.callCounts['values.get'] ?? 0;

    clearCache();
    env.callCounts['values.get'] = 0;
    await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Solo',
      lastName: 'X',
      courses: [COURSE],
    });
    const readsForOneAdd = env.callCounts['values.get'] ?? 0;

    // Three adds cost less than three times one cold add, which is what shows
    // the attendance read is amortised rather than repeated.
    expect(readsForThreeAdds).toBeLessThan(readsForOneAdd * 3);
  });
});
