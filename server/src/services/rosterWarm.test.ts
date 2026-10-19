import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, listStudents } from './students.js';
import { listEnrollments } from './enrollments.js';
import { warmRoster } from './rosterWarm.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  const student = await createStudent(sheets, spreadsheetId, USER, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    courses: ['Period 1 Math'],
  });
  return { env, sheets, spreadsheetId, student };
}

/** Zeroes the counters so an assertion measures only what follows it. */
function resetCounts(env: FakeGoogleEnv) {
  env.callCounts['values.get'] = 0;
  env.callCounts['values.batchGet'] = 0;
}

function reads(env: FakeGoogleEnv) {
  return (env.callCounts['values.get'] ?? 0) + (env.callCounts['values.batchGet'] ?? 0);
}

describe('warmRoster', () => {
  beforeEach(() => clearCache());

  /**
   * The measurement the whole step is for. A cold roster costs two Sheets reads
   * without this — students and enrollments, both needed to build the list —
   * and one with it. Against the shared project ceiling that is the difference
   * between roughly 300 and roughly 600 simultaneous cold loads.
   *
   * It was three-to-one until Step 8a removed the IEP surface and with it the
   * third tab this batch used to fold in.
   */
  it('serves a cold roster in one Sheets read instead of two', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    resetCounts(env);

    await warmRoster(sheets, spreadsheetId, USER);
    const students = await listStudents(sheets, spreadsheetId, USER);

    expect(reads(env)).toBe(1);
    expect(env.callCounts['values.batchGet']).toBe(1);
    expect(students).toHaveLength(1);
  });

  // The baseline the above is measured against, asserted so the comparison is a
  // fact in the suite rather than a claim in a comment. If the underlying reads
  // ever get batched elsewhere, this fails and the numbers above need restating.
  it('costs two reads without the warm-up, for comparison', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    resetCounts(env);

    await listStudents(sheets, spreadsheetId, USER);

    expect(reads(env)).toBe(2);
  });

  it('reads nothing when the working set is already warm', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    await warmRoster(sheets, spreadsheetId, USER);
    resetCounts(env);

    await warmRoster(sheets, spreadsheetId, USER);
    expect(reads(env)).toBe(0);
  });

  it('reads nothing when the student list is already resident', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    await listStudents(sheets, spreadsheetId, USER); // warms students + enrollments
    resetCounts(env);

    await warmRoster(sheets, spreadsheetId, USER);
    expect(reads(env)).toBe(0);
    expect(await listEnrollments(sheets, spreadsheetId, USER)).toHaveLength(1);
  });

  /**
   * Two callers can still land in the same tick — the roster read and anything
   * else that warms before rendering — so without coalescing each would start
   * its own batch and one would be wasted.
   */
  it('coalesces concurrent warm-ups onto a single batch', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    resetCounts(env);

    await Promise.all([
      warmRoster(sheets, spreadsheetId, USER),
      warmRoster(sheets, spreadsheetId, USER),
      warmRoster(sheets, spreadsheetId, USER),
    ]);

    expect(env.callCounts['values.batchGet']).toBe(1);
  });

  it('keeps one teacher out of another teacher’s warm-up', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    await warmRoster(sheets, spreadsheetId, USER);
    resetCounts(env);

    // A different user key must not be served the first teacher's resident data,
    // and must not be blocked by their completed flight either.
    await warmRoster(sheets, spreadsheetId, 'user-sub-2');
    expect(env.callCounts['values.batchGet']).toBe(1);
  });

  it('leaves nothing pending when the read fails, so the next attempt retries', async () => {
    const { env, sheets, spreadsheetId } = await setup();
    clearCache();
    env.failNextBatchGet = true;

    await expect(warmRoster(sheets, spreadsheetId, USER)).rejects.toThrow();

    // The failed flight must not poison the key: a retry issues a real read.
    resetCounts(env);
    await warmRoster(sheets, spreadsheetId, USER);
    expect(env.callCounts['values.batchGet']).toBe(1);
    expect(await listStudents(sheets, spreadsheetId, USER)).toHaveLength(1);
  });
});
