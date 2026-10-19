import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';

/**
 * Reassigned before each test. The mock factories below call `env.build*()` at
 * request time rather than capturing a client, so a fresh env means a fresh
 * spreadsheet — without which one test's archived class is still archived in
 * the next, and the failures look like logic bugs rather than shared state.
 */
let env = new FakeGoogleEnv();

vi.mock('../services/googleAuth.js', () => ({
  authorizedClientForRefreshToken: () => ({}),
}));
vi.mock('../services/sheetsClient.js', () => ({
  buildGoogleClients: () => ({ sheets: env.buildSheets(), drive: env.buildDrive() }),
}));

const { buildClassesRouter } = await import('./classes.js');
const { buildAttendanceRouter } = await import('./attendance.js');
const { discoverOrCreateSpreadsheet } = await import('../services/bootstrap.js');
const { createStudent, listStudents, softDeleteStudent } = await import('../services/students.js');
const { clearCache } = await import('../services/cache.js');
const { clearLocks, withAccountLock, rejectWhileLocked } = await import(
  '../services/accountLock.js'
);
const { errorHandler } = await import('../middleware/errorHandler.js');
const { createSessionCookie, requireSession } = await import('../middleware/session.js');
const { requireCsrf, CSRF_HEADER } = await import('../middleware/csrf.js');
const { createMemorySessionStore } = await import('../services/sessionStore.js');
const { createMemoryAccountStore, testAccount } = await import('../services/accountStore.js');
const { env: appEnv } = await import('../config/env.js');
const { memoryActivity } = await import('../test/memoryActivity.js');

const SUB = 'user-1';
const A = 'Period A Science';
const B = 'Period B Math';

async function setup() {
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  await createStudent(sheets, spreadsheetId, SUB, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    courses: [A, B],
  });
  await createStudent(sheets, spreadsheetId, SUB, {
    firstName: 'Grace',
    lastName: 'Hopper',
    courses: [A],
  });

  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([testAccount({ googleSub: SUB, spreadsheetId })]);
  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  const gated = [requireSession(sessions), requireCsrf];
  app.use('/api/classes', gated, buildClassesRouter(accounts));
  // Mounted the way index.ts mounts a tool router, so the lock's effect on other
  // writes is exercised rather than assumed.
  app.use('/api/attendance', [...gated, rejectWhileLocked], buildAttendanceRouter(accounts, memoryActivity(accounts)));
  app.use(errorHandler);
  return {
    app,
    cookie: `${appEnv.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
    csrfToken: created.csrfToken,
  };
}

describe('classes routes', () => {
  beforeEach(() => {
    env = new FakeGoogleEnv();
    clearCache();
    clearLocks();
  });

  it('lists live classes with their student counts', async () => {
    const { app, cookie } = await setup();
    const res = await request(app).get('/api/classes').set('Cookie', cookie);
    expect(res.status).toBe(200);

    const byName = Object.fromEntries(res.body.live.map((c: never) => [c.name, c]));
    expect(byName[A].studentCount).toBe(2);
    expect(byName[B].studentCount).toBe(1);
    expect(res.body.archived).toEqual([]);
  });

  /**
   * Classes predate the `courses` tab, so every existing account arrives with
   * classes that have no course row. They must appear anyway — reconciled from
   * the enrollment rows — or archiving would be unavailable to exactly the
   * accounts that need it.
   */
  it('reports classes that predate the courses tab, and gives them stable ids', async () => {
    const { app, cookie } = await setup();
    const first = await request(app).get('/api/classes').set('Cookie', cookie);
    clearCache();
    const second = await request(app).get('/api/classes').set('Cookie', cookie);

    const ids = (r: typeof first) =>
      [...r.body.live].map((c: { id: string }) => c.id).sort();
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first)).toHaveLength(2);
  });

  it('archives a class and reports it as archived', async () => {
    const { app, cookie, csrfToken } = await setup();
    const list = await request(app).get('/api/classes').set('Cookie', cookie);
    const aId = list.body.live.find((c: { name: string }) => c.name === A).id;

    const res = await request(app)
      .post('/api/classes/archive')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ classIds: [aId] });

    expect(res.status).toBe(200);
    expect(res.body.live.map((c: { name: string }) => c.name)).toEqual([B]);
    expect(res.body.archived.map((c: { name: string }) => c.name)).toEqual([A]);
    expect(res.body.renamed).toEqual([]);
  });

  it('carries student counts in the move response, not only in the listing', async () => {
    const { app, cookie, csrfToken } = await setup();
    const list = await request(app).get('/api/classes').set('Cookie', cookie);
    const aId = list.body.live.find((c: { name: string }) => c.name === A).id;

    const res = await request(app)
      .post('/api/classes/archive')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ classIds: [aId] });

    // The dialog re-renders straight from this response, so a missing count
    // reads as "undefined students" against every class.
    expect(res.body.live[0].studentCount).toBe(1);
    expect(res.body.archived[0].studentCount).toBe(2);
  });

  it('drops a live class once its last student is gone', async () => {
    const { app, cookie } = await setup();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    const students = await listStudents(env.buildSheets(), spreadsheetId, SUB);
    // B has exactly one student; removing them leaves the class with nobody.
    const onlyInB = students.find((s) => s.firstName === 'Ada');
    await softDeleteStudent(env.buildSheets(), spreadsheetId, SUB, onlyInB!.id);
    clearCache();

    const res = await request(app).get('/api/classes').set('Cookie', cookie);
    expect(res.body.live.map((c: { name: string }) => c.name)).toEqual([A]);
  });

  it('renames rather than refuses when restoring into a live name', async () => {
    const { app, cookie, csrfToken } = await setup();
    const list = await request(app).get('/api/classes').set('Cookie', cookie);
    const aId = list.body.live.find((c: { name: string }) => c.name === A).id;

    await request(app)
      .post('/api/classes/archive')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ classIds: [aId] });
    clearCache();

    // The teacher starts a new class with the same name, as they would in
    // September.
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    await createStudent(env.buildSheets(), spreadsheetId, SUB, {
      firstName: 'Alan',
      lastName: 'Turing',
      courses: [A],
    });
    clearCache();

    const res = await request(app)
      .post('/api/classes/unarchive')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ classIds: [aId] });

    expect(res.status).toBe(200);
    expect(res.body.renamed).toHaveLength(1);
    expect(res.body.renamed[0].from).toBe(A);
    expect(res.body.renamed[0].to).toMatch(/^Period A Science \(\d{4}\)/);
    // Both exist, and neither has been lost to the other.
    const liveNames = res.body.live.map((c: { name: string }) => c.name);
    expect(liveNames).toContain(A);
    expect(liveNames).toContain(res.body.renamed[0].to);
  });

  it('rejects an unknown class id', async () => {
    const { app, cookie, csrfToken } = await setup();
    const res = await request(app)
      .post('/api/classes/archive')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ classIds: ['not-a-real-id'] });
    expect(res.status).toBe(404);
  });

  it('rejects an empty or oversized batch, and unexpected fields', async () => {
    const { app, cookie, csrfToken } = await setup();
    const post = (body: Record<string, unknown>) =>
      request(app)
        .post('/api/classes/archive')
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrfToken)
        .send(body);

    expect((await post({ classIds: [] })).status).toBe(400);
    expect((await post({ classIds: Array.from({ length: 21 }, () => 'x') })).status).toBe(400);
    expect((await post({ classIds: ['x'], sneaky: true })).status).toBe(400);
  });

  describe('PATCH /classes/:classId', () => {
    async function aIdFor(app: express.Express, cookie: string): Promise<string> {
      const list = await request(app).get('/api/classes').set('Cookie', cookie);
      return list.body.live.find((c: { name: string }) => c.name === A).id;
    }

    it('renames a class and answers with the class list', async () => {
      const { app, cookie, csrfToken } = await setup();
      const aId = await aIdFor(app, cookie);
      const res = await request(app)
        .patch(`/api/classes/${aId}`)
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrfToken)
        .send({ name: '  Grade 9 Science ' });

      expect(res.status).toBe(200);
      expect(res.body.live.find((c: { id: string }) => c.id === aId)).toMatchObject({
        name: 'Grade 9 Science',
        studentCount: 2,
      });
      expect(res.body.archived).toEqual([]);
    });

    it('answers a taken name with 409', async () => {
      const { app, cookie, csrfToken } = await setup();
      const aId = await aIdFor(app, cookie);
      const res = await request(app)
        .patch(`/api/classes/${aId}`)
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrfToken)
        .send({ name: B });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('rejects an empty or overlong name, and unexpected fields', async () => {
      const { app, cookie, csrfToken } = await setup();
      const aId = await aIdFor(app, cookie);
      const patch = (body: Record<string, unknown>) =>
        request(app)
          .patch(`/api/classes/${aId}`)
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrfToken)
          .send(body);

      expect((await patch({ name: '   ' })).status).toBe(400);
      expect((await patch({ name: 'x'.repeat(61) })).status).toBe(400);
      expect((await patch({ name: 'Fine', sneaky: true })).status).toBe(400);
    });

    it('is refused while another class operation holds the lock', async () => {
      const { app, cookie, csrfToken } = await setup();
      const aId = await aIdFor(app, cookie);
      await withAccountLock(SUB, async () => {
        const res = await request(app)
          .patch(`/api/classes/${aId}`)
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrfToken)
          .send({ name: 'Grade 9 Science' });
        expect(res.status).toBe(409);
      });
    });
  });

  it('requires a session and a CSRF token', async () => {
    const { app, cookie } = await setup();
    expect((await request(app).post('/api/classes/archive').send({ classIds: ['x'] })).status).toBe(
      401,
    );
    const noCsrf = await request(app)
      .post('/api/classes/archive')
      .set('Cookie', cookie)
      .send({ classIds: ['x'] });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF_INVALID');
  });

  /**
   * The hazard the lock exists for: a whole-tab rewrite is in flight, so a write
   * that lands now would be read by nobody and then overwritten. Reads stay
   * available, because they cannot corrupt anything and blocking them would
   * freeze the app over an operation that takes seconds.
   */
  describe('while an archive is running', () => {
    it('refuses other writes but still serves reads', async () => {
      const { app, cookie, csrfToken } = await setup();

      await withAccountLock(SUB, async () => {
        const write = await request(app)
          .post('/api/attendance')
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrfToken)
          .send({ date: '2026-03-02', course: A, entries: [] });
        expect(write.status).toBe(409);
        expect(write.body.code).toBe('CONFLICT');

        const read = await request(app)
          .get('/api/attendance/range?startDate=2026-03-01&endDate=2026-03-31')
          .set('Cookie', cookie);
        expect(read.status).toBe(200);
      });
    });

    it('refuses a second archive rather than queueing it', async () => {
      const { app, cookie, csrfToken } = await setup();
      const list = await request(app).get('/api/classes').set('Cookie', cookie);
      const aId = list.body.live.find((c: { name: string }) => c.name === A).id;

      await withAccountLock(SUB, async () => {
        const res = await request(app)
          .post('/api/classes/archive')
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrfToken)
          .send({ classIds: [aId] });
        expect(res.status).toBe(409);
      });
    });

    it('releases the lock when the operation throws', async () => {
      await expect(
        withAccountLock(SUB, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      // A lock left held by a failure would lock the teacher out of their own
      // writes until the process restarted.
      await expect(withAccountLock(SUB, async () => 'ok')).resolves.toBe('ok');
    });
  });
});
