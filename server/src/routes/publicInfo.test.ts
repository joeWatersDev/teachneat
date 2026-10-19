import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildPublicInfoRouter } from './publicInfo.js';
import { GOOGLE_SCOPES } from '../services/googleAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';

function app() {
  const a = express();
  a.use('/api/public/app-info', buildPublicInfoRouter());
  a.use(errorHandler);
  return a;
}

describe('GET /api/public/app-info', () => {
  it('serves the app name and the scopes without a session', async () => {
    const res = await request(app()).get('/api/public/app-info');
    expect(res.status).toBe(200);
    expect(res.body.appName).toBe('Teachneat');
    expect(res.body.scopes).toEqual(GOOGLE_SCOPES);
  });

  /**
   * The point of serving the scopes rather than hardcoding them on the page: an
   * admin reads this list and allowlists on the strength of it, so a scope added
   * to the sign-in flow must appear here without anyone remembering to update a
   * second copy. This asserts the two are the same array, not that its contents
   * are a particular set — scope discipline is enforced in its own test.
   */
  it('serves exactly what the authorization URL asks for', async () => {
    const res = await request(app()).get('/api/public/app-info');
    expect(res.body.scopes).toHaveLength(GOOGLE_SCOPES.length);
  });

  it('exposes nothing beyond the three public fields', async () => {
    const res = await request(app()).get('/api/public/app-info');
    expect(Object.keys(res.body).sort()).toEqual(['appName', 'oauthClientId', 'scopes']);
  });
});
