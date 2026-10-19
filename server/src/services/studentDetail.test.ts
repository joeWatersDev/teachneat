import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, listStudents } from './students.js';
import { getStudentDetail } from './studentDetail.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

describe('getStudentDetail', () => {
  beforeEach(() => clearCache());

  it('returns the student profile', async () => {
    const { sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      courses: ['Period 1 Math'],
    });
    clearCache();

    const detail = await getStudentDetail(sheets, spreadsheetId, USER, s.id);
    expect(detail.student.firstName).toBe('Ada');
    expect(detail.student.courses).toEqual(['Period 1 Math']);
  });

  it('reads all cold tabs in a single batchGet (no per-tab values.get)', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      courses: ['Period 1 Math'],
    });
    clearCache();
    env.callCounts['values.get'] = 0;
    env.callCounts['values.batchGet'] = 0;

    await getStudentDetail(sheets, spreadsheetId, USER, s.id);
    expect(env.callCounts['values.batchGet']).toBe(1);
    expect(env.callCounts['values.get'] ?? 0).toBe(0);
  });

  it('serves a warm detail entirely from cache (no reads)', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      courses: ['Period 1 Math'],
    });
    clearCache();
    await getStudentDetail(sheets, spreadsheetId, USER, s.id); // warms caches
    env.callCounts['values.get'] = 0;
    env.callCounts['values.batchGet'] = 0;

    await getStudentDetail(sheets, spreadsheetId, USER, s.id);
    expect(env.callCounts['values.batchGet'] ?? 0).toBe(0);
    expect(env.callCounts['values.get'] ?? 0).toBe(0);
  });

  it('reads nothing when the student list is already cached', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      courses: ['Period 1 Math'],
    });
    clearCache();
    await listStudents(sheets, spreadsheetId, USER); // warms students + enrollments only
    env.callCounts['values.get'] = 0;
    env.callCounts['values.batchGet'] = 0;

    const detail = await getStudentDetail(sheets, spreadsheetId, USER, s.id);
    expect(detail.student.firstName).toBe('Ada');
    // The students and enrollments tabs were the only ones it needed, and both
    // are resident. It read the `iep` tab here too until Step 8a.
    expect(env.callCounts['values.batchGet'] ?? 0).toBe(0);
    expect(env.callCounts['values.get'] ?? 0).toBe(0);
  });

  it('throws NOT_FOUND for an unknown student', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(getStudentDetail(sheets, spreadsheetId, USER, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
