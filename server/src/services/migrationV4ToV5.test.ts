import { describe, it, expect } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { migrateV4ToV5 } from './migrationV4ToV5.js';
import { computeStats, getStats, listByRange, type EnrollmentPair } from './attendance.js';
import { readTabRowsIndexed, isActive } from './sheets.js';
import { CLASS_DAY_MARKER_KEY } from '../config/schema.js';

const USER = 'user-sub-1';
const COURSE = 'C';

// v4 headers: `attendance` is unchanged in v5; `enrollments` is one column shorter.
const V4_ATTENDANCE_HEADER = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09'];
const V4_ENROLLMENT_HEADER = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06'];

/** id, studentId, date, statusKey, notes, createdAt, updatedAt, deletedAt, course */
function attRow(
  id: string,
  studentId: string,
  date: string,
  statusKey: string,
  course = COURSE,
  deletedAt = '',
): string[] {
  return [id, studentId, date, statusKey, '', '2026-01-01', '2026-01-01', deletedAt, course];
}

/** id, studentId, course, createdAt, deletedAt, atRisk */
function enrRow(id: string, studentId: string, course = COURSE): string[] {
  return [id, studentId, course, '2026-08-01T00:00:00.000Z', '', 'FALSE'];
}

async function write(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
  rows: string[][],
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  } as never);
}

/**
 * A sheet in its v4 shape: dense attendance (a row per student per class-day,
 * whatever the status) and a six-column enrollments tab.
 *
 * Two students over four school days in one class. S1 is absent twice and tardy
 * once; S2 is present throughout and so has no exception at all, which is the
 * case the marker exists for.
 */
const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

async function setupV4() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

  const s1Statuses = ['p', 'a', 't', 'a'];
  const attendance: string[][] = [V4_ATTENDANCE_HEADER];
  DATES.forEach((date, i) => {
    attendance.push(attRow(`a1-${i}`, 's1', date, s1Statuses[i]));
    attendance.push(attRow(`a2-${i}`, 's2', date, 'p'));
  });
  await write(sheets, spreadsheetId, 'attendance', attendance);
  await write(sheets, spreadsheetId, 'enrollments', [
    V4_ENROLLMENT_HEADER,
    enrRow('e1', 's1'),
    enrRow('e2', 's2'),
  ]);
  clearCache();
  return { env, sheets, spreadsheetId };
}

async function activeRows(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
  return rows.filter((r) => isActive(r.obj)).map((r) => r.obj);
}

const pairs: EnrollmentPair[] = [
  { studentId: 's1', course: COURSE },
  { studentId: 's2', course: COURSE },
];

describe('migrateV4ToV5', () => {
  /**
   * The test the step turns on. Statistics are the thing every other reader is
   * built on, so if they survive the migration unchanged, nothing was lost.
   */
  it('leaves every statistic exactly as it was', async () => {
    const { sheets, spreadsheetId } = await setupV4();

    // What v4 computed, from the dense rows, using v4's own rule: one row per
    // student per day, and `daysRecorded` is the count of that student's rows.
    const before = [
      {
        studentId: 's1',
        course: COURSE,
        totalAbsences: 2,
        totalTardies: 1,
        totalExcused: 0,
        daysRecorded: 4,
        absenceRate: 0.5,
        consecutiveAbsences: 1,
      },
      {
        studentId: 's2',
        course: COURSE,
        totalAbsences: 0,
        totalTardies: 0,
        totalExcused: 0,
        daysRecorded: 4,
        absenceRate: 0,
        consecutiveAbsences: 0,
      },
    ];

    await migrateV4ToV5(sheets, spreadsheetId);
    clearCache();

    expect(await getStats(sheets, spreadsheetId, USER)).toEqual(before);
  });

  it('keeps every recorded mark readable, present ones included', async () => {
    const { sheets, spreadsheetId } = await setupV4();
    await migrateV4ToV5(sheets, spreadsheetId);
    clearCache();

    const expanded = await listByRange(sheets, spreadsheetId, USER, DATES[0], DATES[3]);
    // Eight marks went in and eight come back out, at the same statuses.
    expect(expanded).toHaveLength(8);
    const s1 = expanded.filter((r) => r.studentId === 's1').sort((a, b) => a.date.localeCompare(b.date));
    expect(s1.map((r) => r.statusKey)).toEqual(['p', 'a', 't', 'a']);
    const s2 = expanded.filter((r) => r.studentId === 's2');
    expect(s2.every((r) => r.statusKey === 'p')).toBe(true);
  });

  it('drops the present rows and writes one marker per class-day', async () => {
    const { sheets, spreadsheetId } = await setupV4();
    expect(await activeRows(sheets, spreadsheetId)).toHaveLength(8);

    await migrateV4ToV5(sheets, spreadsheetId);

    const rows = await activeRows(sheets, spreadsheetId);
    // Three exceptions plus four markers, against the eight rows v4 held.
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.statusKey === CLASS_DAY_MARKER_KEY)).toHaveLength(4);
    expect(rows.filter((r) => r.statusKey === 'p')).toHaveLength(0);
    // Markers belong to no student.
    for (const marker of rows.filter((r) => r.statusKey === CLASS_DAY_MARKER_KEY)) {
      expect(marker.studentId ?? '').toBe('');
      expect(marker.course).toBe(COURSE);
    }
  });

  it('backfills startDate from each student’s earliest recorded day', async () => {
    const { env, sheets, spreadsheetId } = await setupV4();
    // A third student who joins on the 3rd: no rows on the first two days.
    await write(sheets, spreadsheetId, 'enrollments', [
      V4_ENROLLMENT_HEADER,
      enrRow('e1', 's1'),
      enrRow('e2', 's2'),
      enrRow('e3', 's3'),
    ]);
    const attendance = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    await write(sheets, spreadsheetId, 'attendance', [
      V4_ATTENDANCE_HEADER,
      ...attendance.map((r) => [
        String(r.obj.id),
        String(r.obj.studentId),
        String(r.obj.date),
        String(r.obj.statusKey),
        '',
        '2026-01-01',
        '2026-01-01',
        '',
        String(r.obj.course),
      ]),
      attRow('a3-2', 's3', DATES[2], 'p'),
      attRow('a3-3', 's3', DATES[3], 'a'),
    ]);
    clearCache();
    void env;

    await migrateV4ToV5(sheets, spreadsheetId);
    clearCache();

    const stats = await getStats(sheets, spreadsheetId, USER);
    const s3 = stats.find((s) => s.studentId === 's3');
    // Two class-days, not four: the days before they joined are not theirs, and
    // the absence rate stays 1/2 rather than being diluted to 1/4.
    expect(s3).toMatchObject({ daysRecorded: 2, totalAbsences: 1 });
    expect(s3?.absenceRate).toBeCloseTo(0.5);
  });

  it('starts an enrolled student with no rows after the last recorded day', async () => {
    const { sheets, spreadsheetId } = await setupV4();
    // Enrolled, but never present for a register that was taken. Under v4 that
    // read as no data, and it must not become four inferred present days.
    await write(sheets, spreadsheetId, 'enrollments', [
      V4_ENROLLMENT_HEADER,
      enrRow('e1', 's1'),
      enrRow('e2', 's2'),
      enrRow('e3', 's3'),
    ]);
    clearCache();

    await migrateV4ToV5(sheets, spreadsheetId);
    clearCache();

    const stats = await getStats(sheets, spreadsheetId, USER);
    expect(stats.find((s) => s.studentId === 's3')).toMatchObject({ daysRecorded: 0 });
  });

  describe('ordering on failure', () => {
    it('leaves the old rows untouched when the marker append fails', async () => {
      const { env, sheets, spreadsheetId } = await setupV4();
      env.failNextAppend = true;

      await expect(migrateV4ToV5(sheets, spreadsheetId)).rejects.toThrow();

      // Every original row is still there, still dense, still present-carrying.
      const rows = await activeRows(sheets, spreadsheetId);
      expect(rows).toHaveLength(8);
      expect(rows.filter((r) => r.statusKey === 'p')).toHaveLength(5);
      expect(rows.filter((r) => r.statusKey === CLASS_DAY_MARKER_KEY)).toHaveLength(0);
    });

    it('converges on retry when the destructive rewrite fails', async () => {
      const { env, sheets, spreadsheetId } = await setupV4();
      // The attendance rewrite writes the survivors and then clears the tail.
      // Failing that clear is the half-applied case: the new form is in place
      // with stale present rows still sitting below it. It is the *second*
      // clear the migration issues — the enrollments rewrite goes first — so
      // `failNextClear` would hit the wrong one.
      env.failClearAfter = 1;
      await expect(migrateV4ToV5(sheets, spreadsheetId)).rejects.toThrow();

      // Precondition for the retry being meaningful: the sheet really is in the
      // half-applied state, carrying both the new rows and the stale tail.
      const halfway = await activeRows(sheets, spreadsheetId);
      expect(halfway.filter((r) => r.statusKey === 'p').length).toBeGreaterThan(0);

      clearCache();
      await migrateV4ToV5(sheets, spreadsheetId);
      clearCache();

      const rows = await activeRows(sheets, spreadsheetId);
      // Exactly the migrated shape: no duplicated markers from the second run.
      expect(rows).toHaveLength(7);
      expect(rows.filter((r) => r.statusKey === CLASS_DAY_MARKER_KEY)).toHaveLength(4);
      expect(rows.filter((r) => r.statusKey === 'p')).toHaveLength(0);
    });

    it('is idempotent when run again on an already-migrated sheet', async () => {
      const { sheets, spreadsheetId } = await setupV4();
      await migrateV4ToV5(sheets, spreadsheetId);
      const first = await activeRows(sheets, spreadsheetId);
      clearCache();

      await migrateV4ToV5(sheets, spreadsheetId);
      const second = await activeRows(sheets, spreadsheetId);

      expect(second).toHaveLength(first.length);
      expect(second.filter((r) => r.statusKey === CLASS_DAY_MARKER_KEY)).toHaveLength(4);
    });
  });

  it('keeps soft-deleted exception rows and drops soft-deleted present rows', async () => {
    const { sheets, spreadsheetId } = await setupV4();
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    await write(sheets, spreadsheetId, 'attendance', [
      V4_ATTENDANCE_HEADER,
      ...rows.map((r) => [
        String(r.obj.id),
        String(r.obj.studentId),
        String(r.obj.date),
        String(r.obj.statusKey),
        '',
        '2026-01-01',
        '2026-01-01',
        '',
        String(r.obj.course),
      ]),
      attRow('gone-p', 's1', '2026-09-07', 'p', COURSE, '2026-09-08'),
      attRow('kept-a', 's1', '2026-09-08', 'a', COURSE, '2026-09-09'),
    ]);

    await migrateV4ToV5(sheets, spreadsheetId);

    const all = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    const ids = all.map((r) => String(r.obj.id));
    expect(ids).toContain('kept-a');
    expect(ids).not.toContain('gone-p');
  });
});

describe('computeStats over the migrated form', () => {
  it('divides by class-days taken, not by days in the calendar', async () => {
    // Ten class-days recorded out of a term; a student absent once is at 1/10,
    // not 1/100. The denominator is what the markers establish.
    const classDays = Array.from({ length: 10 }, (_, i) => ({
      course: COURSE,
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    })).filter((d) => !['2026-09-05', '2026-09-06'].includes(d.date));

    const [stats] = computeStats(
      [
        {
          id: 'x',
          studentId: 's1',
          course: COURSE,
          date: '2026-09-02',
          statusKey: 'a',
          notes: null,
        },
      ],
      classDays,
      [pairs[0]],
    );
    expect(stats.daysRecorded).toBe(8);
    expect(stats.absenceRate).toBeCloseTo(1 / 8);
  });
});
