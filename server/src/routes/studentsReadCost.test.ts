import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';

/**
 * The roster's read cost, measured through the real routes (Phase 2 Step 6a).
 *
 * This exists because the service-level tests in rosterWarm.test.ts pass whether
 * or not the warm-up is actually wired into the endpoints — removing the call
 * from students.ts broke nothing, which is how this gap was found. What is
 * asserted here is the thing the step promised: **a cold roster page costs one
 * Sheets request, not two.**
 *
 * It was one-instead-of-three, taken across the list call and the `/iep-summary`
 * call the client issued beside it, until Step 8a removed the IEP surface. The
 * list call is now the whole of the roster load.
 */

const env = new FakeGoogleEnv();

// Substituted before the router is imported: the route builds its Sheets client
// through these, so this is what puts the fake in the real call path.
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

async function setup() {
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  await createStudent(sheets, spreadsheetId, SUB, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    courses: ['Period 1 Math'],
  });
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
    cookie: `${appEnv.session.cookieName}=${encodeURIComponent(createSessionCookie(created.id))}`,
  };
}

function reads() {
  return (env.callCounts['values.get'] ?? 0) + (env.callCounts['values.batchGet'] ?? 0);
}

describe('roster read cost through the routes', () => {
  beforeEach(() => {
    clearCache();
  });

  it('serves a cold roster page in one Sheets request', async () => {
    const { app, cookie } = await setup();
    clearCache();
    env.callCounts['values.get'] = 0;
    env.callCounts['values.batchGet'] = 0;

    const list = await request(app).get('/api/students').set('Cookie', cookie);

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(reads()).toBe(1);
  });

  it('serves a warm roster page with no Sheets request at all', async () => {
    const { app, cookie } = await setup();
    clearCache();
    await request(app).get('/api/students').set('Cookie', cookie);
    env.callCounts['values.get'] = 0;
    env.callCounts['values.batchGet'] = 0;

    const res = await request(app).get('/api/students').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(reads()).toBe(0);
  });
});
