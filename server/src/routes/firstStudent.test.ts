import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';

/**
 * The first-student signal (Phase 2 Step 6f), which is what decides whether the
 * account menu still offers the first-run guide.
 *
 * Driven through the real routes rather than against the store, because the
 * whole point of the design is *where* it is recorded from: a create is the
 * obvious path, and the roster read is the one that matters for an account that
 * predates the column, since nothing in our database knows whether such an
 * account has students.
 */

const env = new FakeGoogleEnv();

vi.mock('../services/googleAuth.js', () => ({
  authorizedClientForRefreshToken: () => ({}),
}));
vi.mock('../services/sheetsClient.js', () => ({
  buildGoogleClients: () => ({ sheets: env.buildSheets(), drive: env.buildDrive() }),
}));

const { buildStudentsRouter } = await import('./students.js');
const { discoverOrCreateSpreadsheet } = await import('../services/bootstrap.js');
const { createStudent } = await import('../services/students.js');
const { clearCache } = await import('../services/cache.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { createSessionCookie, requireSession } = await import('../middleware/session.js');
const { createMemorySessionStore } = await import('../services/sessionStore.js');
const { createMemoryAccountStore, testAccount } = await import('../services/accountStore.js');
const { env: appEnv } = await import('../config/env.js');
const { memoryActivity } = await import('../test/memoryActivity.js');

const SUB = 'user-1';

/** `seedStudent` puts a student in the sheet without the app having seen it. */
async function setup(seedStudent: boolean) {
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  if (seedStudent) {
    await createStudent(sheets, spreadsheetId, SUB, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      courses: ['Period 1 Math'],
    });
  }

  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([testAccount({ googleSub: SUB, spreadsheetId })]);
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/students',
    requireSession(sessions),
    buildStudentsRouter(accounts, memoryActivity(accounts)),
  );
  app.use(errorHandler);
  return {
    app,
    accounts,
    cookie: `${appEnv.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
  };
}

const firstStudentAt = async (accounts: { getByGoogleSub: (s: string) => Promise<unknown> }) =>
  ((await accounts.getByGoogleSub(SUB)) as { firstStudentAt: string | null }).firstStudentAt;

describe('recording that an account has students', () => {
  beforeEach(() => {
    clearCache();
    // The fake Drive is module-level state, so a sheet created by an earlier
    // case would still be found by `discoverOrCreateSpreadsheet` in the next
    // one — and half of these cases turn on the roster being empty. Clearing it
    // gives each case its own spreadsheet rather than making them order-
    // dependent.
    env.files.clear();
    env.spreadsheets.clear();
  });

  it('starts null for an account that has never added one', async () => {
    const { accounts } = await setup(false);
    expect(await firstStudentAt(accounts)).toBeNull();
  });

  it('is set by creating a student', async () => {
    const { app, accounts, cookie } = await setup(false);
    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ firstName: 'Grace', lastName: 'Hopper', courses: ['Period 2 Math'] });
    expect(res.status).toBe(201);
    expect(await firstStudentAt(accounts)).not.toBeNull();
  });

  it('is set by a bulk add', async () => {
    const { app, accounts, cookie } = await setup(false);
    const res = await request(app)
      .post('/api/students/batch')
      .set('Cookie', cookie)
      .send({ students: [{ firstName: 'Alan', lastName: 'Turing', courses: ['Period 3 Math'] }] });
    expect(res.status).toBe(201);
    expect(await firstStudentAt(accounts)).not.toBeNull();
  });

  // The case a migration could not have answered: the students were already in
  // the teacher's sheet before this column existed.
  it('is set by a roster read that comes back non-empty', async () => {
    const { app, accounts, cookie } = await setup(true);
    expect(await firstStudentAt(accounts)).toBeNull();
    await request(app).get('/api/students').set('Cookie', cookie);
    expect(await firstStudentAt(accounts)).not.toBeNull();
  });

  it('is left alone by a roster read that comes back empty', async () => {
    const { app, accounts, cookie } = await setup(false);
    const res = await request(app).get('/api/students').set('Cookie', cookie);
    expect(res.body).toHaveLength(0);
    expect(await firstStudentAt(accounts)).toBeNull();
  });

  // Write-once: it records activation, not the most recent visit. Without the
  // COALESCE in the store this would drift forward on every roster read.
  it('keeps the original timestamp across later reads', async () => {
    const { app, accounts, cookie } = await setup(true);
    await request(app).get('/api/students').set('Cookie', cookie);
    const first = await firstStudentAt(accounts);
    await new Promise((r) => setTimeout(r, 5));
    await request(app).get('/api/students').set('Cookie', cookie);
    expect(await firstStudentAt(accounts)).toBe(first);
  });

  // Bookkeeping for a menu item must never fail a save that worked.
  it('still answers the request when the flag cannot be written', async () => {
    const { app, accounts, cookie } = await setup(false);
    accounts.markFirstStudent = () => Promise.reject(new Error('database is down'));
    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ firstName: 'Katherine', lastName: 'Johnson', courses: ['Period 4 Math'] });
    expect(res.status).toBe(201);
  });
});
