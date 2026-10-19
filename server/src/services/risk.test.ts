import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, updateStudent, listStudents, setStudentAtRisk } from './students.js';
import { getStudentDetail } from './studentDetail.js';
import { submitAttendance, isHighAbsenceRisk, type AttendanceStats } from './attendance.js';
import { listRiskSummary } from './risk.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

// Mon–Fri; verified weekdays so submitAttendance accepts them.
const WEEK = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];

function stats(over: Partial<AttendanceStats>): AttendanceStats {
  return {
    studentId: 's',
    course: 'c',
    totalAbsences: 0,
    totalTardies: 0,
    totalExcused: 0,
    daysRecorded: 0,
    absenceRate: 0,
    consecutiveAbsences: 0,
    ...over,
  };
}

describe('academic risk', () => {
  beforeEach(() => clearCache());

  it('isHighAbsenceRisk requires an absence rate over 15% and at least 5 recorded days', () => {
    expect(isHighAbsenceRisk(stats({ daysRecorded: 5, totalAbsences: 2, absenceRate: 0.4 }))).toBe(true);
    // Just over 15% flags.
    expect(isHighAbsenceRisk(stats({ daysRecorded: 20, totalAbsences: 4, absenceRate: 0.2 }))).toBe(true);
    // Exactly 15% is not "over" 15%.
    expect(isHighAbsenceRisk(stats({ daysRecorded: 20, totalAbsences: 3, absenceRate: 0.15 }))).toBe(false);
    // Fewer than 5 recorded days never flags, even at 100%.
    expect(isHighAbsenceRisk(stats({ daysRecorded: 4, totalAbsences: 4, absenceRate: 1 }))).toBe(false);
  });

  it('toggles atRisk per course and reflects it on the student', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['Math', 'Science'],
    });
    expect(s.atRiskCourses).toEqual([]);

    await setStudentAtRisk(sheets, spreadsheetId, USER, s.id, 'Math', true);
    const detail = await getStudentDetail(sheets, spreadsheetId, USER, s.id);
    expect(detail.student.atRiskCourses).toEqual(['Math']);

    await setStudentAtRisk(sheets, spreadsheetId, USER, s.id, 'Math', false);
    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list[0].atRiskCourses).toEqual([]);
  });

  it('preserves atRisk on a course kept through a course-set change', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'One',
      courses: ['Math', 'Science'],
    });
    await setStudentAtRisk(sheets, spreadsheetId, USER, s.id, 'Math', true);

    // Drop Science, add History, keep Math — Math's flag must survive.
    await updateStudent(sheets, spreadsheetId, USER, s.id, { courses: ['Math', 'History'] });
    const list = await listStudents(sheets, spreadsheetId, USER);
    expect(list[0].atRiskCourses).toEqual(['Math']);
  });

  it('summary flags atRisk (any course) and computed high absence separately', async () => {
    const { sheets, spreadsheetId } = await setup();
    const flagged = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Flag',
      lastName: 'Ged',
      courses: ['Math'],
    });
    const absent = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Ab',
      lastName: 'Sent',
      courses: ['Math'],
    });
    const clean = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Cl',
      lastName: 'Ean',
      courses: ['Math'],
    });
    await setStudentAtRisk(sheets, spreadsheetId, USER, flagged.id, 'Math', true);

    // absent: 2 absences over 5 days = 40%; the others present every day.
    for (let i = 0; i < WEEK.length; i++) {
      await submitAttendance(sheets, spreadsheetId, USER, WEEK[i], 'Math', [
        { studentId: absent.id, statusKey: i < 2 ? 'a' : 'p' },
        { studentId: clean.id, statusKey: 'p' },
        { studentId: flagged.id, statusKey: 'p' },
      ]);
    }

    const summary = await listRiskSummary(sheets, spreadsheetId, USER);
    const byId = new Map(summary.map((e) => [e.studentId, e]));
    expect(byId.get(flagged.id)).toMatchObject({ atRiskCourses: ['Math'], highAbsenceCourses: [] });
    expect(byId.get(absent.id)).toMatchObject({ atRiskCourses: [], highAbsenceCourses: ['Math'] });
    expect(byId.get(clean.id)).toMatchObject({ atRiskCourses: [], highAbsenceCourses: [] });
  });
});
