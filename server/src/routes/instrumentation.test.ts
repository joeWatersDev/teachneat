import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';

/**
 * Does the instrumentation actually fire from the real routes (Step 6j)?
 *
 * usageStore.test.ts covers the store and the recorder in isolation, which is
 * the layer least likely to break. This file covers the wiring, which is the
 * layer that will rot silently: the failure mode of a dropped call site is a
 * permanently-zero column on the operator metrics page, and a zero there reads
 * like a real product finding ("nobody uses grouping") rather than like a bug.
 *
 * The picker case matters most. Its trigger is a query string on an endpoint
 * shared with every other roster read, so it can break in both directions —
 * silently stopping, or silently counting reads that are not the picker.
 */

let env = new FakeGoogleEnv();

vi.mock('../services/googleAuth.js', () => ({
  authorizedClientForRefreshToken: () => ({}),
}));
vi.mock('../services/sheetsClient.js', () => ({
  buildGoogleClients: () => ({ sheets: env.buildSheets(), drive: env.buildDrive() }),
}));
vi.mock('../services/gmailClient.js', () => ({
  buildGmailClient: () => env.buildGmail(),
}));

const { buildAttendanceRouter } = await import('./attendance.js');
const { buildGroupingRouter } = await import('./grouping.js');
const { buildStudentsRouter } = await import('./students.js');
const { buildEmailRouter } = await import('./email.js');
const { discoverOrCreateSpreadsheet } = await import('../services/bootstrap.js');
const { createStudent, listStudents } = await import('../services/students.js');
const { createTemplate } = await import('../services/emailTemplates.js');
const { clearCache } = await import('../services/cache.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { createSessionCookie, requireSession } = await import('../middleware/session.js');
const { requireCsrf, CSRF_HEADER } = await import('../middleware/csrf.js');
const { createMemorySessionStore } = await import('../services/sessionStore.js');
const { createMemoryAccountStore, testAccount } = await import('../services/accountStore.js');
const { createMemoryUsageStore } = await import('../services/usageStore.js');
const { createActivityRecorder } = await import('../services/activity.js');
const { env: appEnv } = await import('../config/env.js');
import { withBillingEnabled } from '../test/billing.js';

const SUB = 'user-1';
const ACCOUNT_ID = 'acct-1';
const COURSE = 'Period A Science';

async function setup() {
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  await createStudent(sheets, spreadsheetId, SUB, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    courses: [COURSE],
  });
  await createStudent(sheets, spreadsheetId, SUB, {
    firstName: 'Grace',
    lastName: 'Hopper',
    courses: [COURSE],
  });

  const sessions = createMemorySessionStore();
  const accounts = createMemoryAccountStore([
    // A paid account, so the premium gate never intercepts a request this file
    // means to reach the handler.
    testAccount({ googleSub: SUB, id: ACCOUNT_ID, spreadsheetId, planOverride: 'paid' }),
  ]);

  // Injected rather than defaulted. The routers' default is the Postgres usage
  // store, which in a unit test would mean a real connection attempt whose
  // failure the recorder silently swallows — a live-network dependency that
  // would also make this file assert nothing.
  const usage = createMemoryUsageStore();
  const activity = createActivityRecorder(accounts, usage);

  const created = await sessions.create(SUB);
  const app = express();
  app.use(express.json());
  const gated = [requireSession(sessions), requireCsrf];
  app.use('/api/attendance', gated, buildAttendanceRouter(accounts, activity));
  app.use('/api/grouping', gated, buildGroupingRouter(accounts, activity));
  app.use('/api/students', gated, buildStudentsRouter(accounts, activity));
  app.use('/api/email', gated, buildEmailRouter(accounts, activity));
  app.use(errorHandler);

  const roster = await listStudents(sheets, spreadsheetId, SUB);
  const template = await createTemplate(sheets, spreadsheetId, SUB, {
    name: 'Weekly note',
    subject: 'An update',
    bodyHtml: '<p>Hello.</p>',
    placeholdersUsed: [],
  });

  return {
    app,
    accounts,
    usage,
    // The submit schema requires at least one entry, so a real student id is
    // needed rather than an empty day.
    studentId: roster[0].id,
    templateId: template.id,
    cookie: `${appEnv.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
    csrfToken: created.csrfToken,
  };
}

/** This month's count for a tool, or 0 if nothing has been recorded. */
async function countOf(
  usage: Awaited<ReturnType<typeof setup>>['usage'],
  tool: 'attendance' | 'grouping' | 'email' | 'picker',
): Promise<number> {
  const rows = await usage.forAccount(ACCOUNT_ID, 12);
  return rows[0]?.counts[tool] ?? 0;
}

describe('route instrumentation', () => {
  beforeEach(() => {
    env = new FakeGoogleEnv();
    clearCache();
  });

  it('counts a saved attendance day and sets the milestone', async () => {
    const { app, accounts, usage, cookie, csrfToken, studentId } = await setup();

    const res = await request(app)
      .post('/api/attendance')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({
        date: '2026-03-02',
        course: COURSE,
        entries: [{ studentId, statusKey: 'p' }],
      });

    expect(res.status).toBe(200);
    expect(await countOf(usage, 'attendance')).toBe(1);
    expect((await accounts.getByGoogleSub(SUB))?.firstAttendanceAt).not.toBeNull();
  });

  it('counts a generated grouping and sets the milestone', async () => {
    const { app, accounts, usage, cookie, csrfToken } = await setup();

    const res = await request(app)
      .post('/api/grouping/generate')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ course: COURSE, groupSize: 2 });

    expect(res.status).toBe(200);
    expect(await countOf(usage, 'grouping')).toBe(1);
    expect((await accounts.getByGoogleSub(SUB))?.firstGroupingAt).not.toBeNull();
  });

  it('does not count saving a grouping, only generating one', async () => {
    const { app, usage, cookie, csrfToken } = await setup();

    // The auto-save fires on every drag. Counting it would measure fiddling
    // rather than use, which is why the counter sits on generate.
    await request(app)
      .put('/api/grouping/current')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({ course: COURSE, groupSize: 2, groups: [] });

    expect(await countOf(usage, 'grouping')).toBe(0);
  });

  it('counts a roster read that identifies itself as the picker', async () => {
    const { app, accounts, usage, cookie } = await setup();

    const res = await request(app).get('/api/students?for=picker').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(await countOf(usage, 'picker')).toBe(1);
    expect((await accounts.getByGoogleSub(SUB))?.firstPickerAt).not.toBeNull();
  });

  it('does not count an ordinary roster read', async () => {
    const { app, accounts, usage, cookie } = await setup();

    await request(app).get('/api/students').set('Cookie', cookie);

    // The marker is the whole trigger. Without this assertion the picker column
    // could silently become a count of every roster read in the app, which is
    // most page loads.
    expect(await countOf(usage, 'picker')).toBe(0);
    expect((await accounts.getByGoogleSub(SUB))?.firstPickerAt).toBeNull();
  });

  it('does not count a roster read carrying some other marker value', async () => {
    const { app, usage, cookie } = await setup();

    await request(app).get('/api/students?for=students').set('Cookie', cookie);

    expect(await countOf(usage, 'picker')).toBe(0);
  });

  it('counts one email send regardless of recipient count', async () => {
    const { app, accounts, usage, cookie, csrfToken, templateId, studentId } = await setup();

    const res = await request(app)
      .post('/api/email/send')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send({
        templateId,
        recipients: [
          { studentId, course: COURSE, includeStudent: false, includeParents: true },
        ],
      });

    expect(res.status).toBe(200);
    // One count per send, not per recipient: the counter says how often the
    // teacher reached for the tool, and a class of thirty would otherwise
    // outweigh a month of everything else. Recipient volume is tracked
    // separately, against the cap, in monthly_email_count.
    expect(await countOf(usage, 'email')).toBe(1);
    expect((await accounts.getByGoogleSub(SUB))?.firstEmailAt).not.toBeNull();
  });

  it('accumulates across repeated use while the milestone stays put', async () => {
    const { app, accounts, usage, cookie, csrfToken, studentId } = await setup();
    const day = (date: string) => ({
      date,
      course: COURSE,
      entries: [{ studentId, statusKey: 'p' as const }],
    });

    await request(app)
      .post('/api/attendance')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send(day('2026-03-02'));
    const first = (await accounts.getByGoogleSub(SUB))?.firstAttendanceAt;

    await request(app)
      .post('/api/attendance')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrfToken)
      .send(day('2026-03-03'));

    expect(await countOf(usage, 'attendance')).toBe(2);
    expect((await accounts.getByGoogleSub(SUB))?.firstAttendanceAt).toBe(first);
  });
});

describe('premium-attempt milestone', () => {
  withBillingEnabled();
  beforeEach(() => {
    env = new FakeGoogleEnv();
    clearCache();
  });

  it('is set when a free account is refused at a gate', async () => {
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

    const sessions = createMemorySessionStore();
    // Expired trial, no subscription: a free account.
    const accounts = createMemoryAccountStore([
      testAccount({
        googleSub: SUB,
        id: ACCOUNT_ID,
        spreadsheetId,
        trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ]);
    const created = await sessions.create(SUB);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/grouping',
      [requireSession(sessions), requireCsrf],
      buildGroupingRouter(accounts, createActivityRecorder(accounts, createMemoryUsageStore())),
    );
    app.use(errorHandler);

    const cookie = `${appEnv.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`;
    const res = await request(app)
      .post('/api/grouping/constraints')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, created.csrfToken)
      .send({ course: COURSE, kind: 'keepApart', studentIds: ['a', 'b'] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    // Recorded at requirePremium, the choke point every gate funnels through,
    // so this one assertion stands in for every gated feature.
    expect((await accounts.getByGoogleSub(SUB))?.firstPremiumAttemptAt).not.toBeNull();
  });
});
