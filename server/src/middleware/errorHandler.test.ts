import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ZodError, z } from 'zod';
import { errorHandler } from './errorHandler.js';
import { ApiError } from '../utils/errors.js';
import { initOperatorAlerts, resetOperatorAlerts } from '../services/operatorAlerts.js';
import type { Mailer, OutboundMessage } from '../services/mailer.js';

function buildAppWithErr(makeErr: () => unknown) {
  const app = express();
  app.get('/', (_req, _res, next) => next(makeErr()));
  app.use(errorHandler);
  return app;
}

describe('error handler', () => {
  it('maps ZodError to 400 VALIDATION_ERROR with fieldErrors', async () => {
    const app = buildAppWithErr(() => {
      try {
        z.object({ name: z.string() }).parse({});
      } catch (e) {
        return e as ZodError;
      }
      return new Error('unreachable');
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.fieldErrors).toBeTypeOf('object');
  });

  it('maps ApiError to the right status code', async () => {
    const app = buildAppWithErr(() => new ApiError('NOT_FOUND', 'gone'));
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'gone' });
  });

  it('does not leak Google API error details', async () => {
    const app = buildAppWithErr(() => {
      const err: any = new Error('googleapis: request to https://sheets.googleapis.com/v4 failed');
      err.code = 503;
      err.config = { url: 'https://sheets.googleapis.com/v4/spreadsheets/SECRET_ID' };
      return err;
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SHEET_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('SECRET_ID');
    expect(JSON.stringify(res.body)).not.toContain('googleapis');
  });

  it('returns a generic 500 for unknown errors and does not leak the message', async () => {
    const app = buildAppWithErr(() => new Error('internal detail: /etc/passwd'));
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('/etc/passwd');
  });

  it('maps a numeric 429 to SHEET_RATE_LIMITED with a Retry-After header', async () => {
    const app = buildAppWithErr(() => {
      const err: any = new Error('Quota exceeded');
      err.code = 429;
      return err;
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('SHEET_RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('maps the RESOURCE_EXHAUSTED message to SHEET_RATE_LIMITED even without a numeric code', async () => {
    const app = buildAppWithErr(() => new Error('Resource has been exhausted (e.g. check quota).'));
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('SHEET_RATE_LIMITED');
  });

  it('maps invalid_grant to REAUTH_REQUIRED', async () => {
    const app = buildAppWithErr(() => {
      const err: any = new Error('invalid_grant');
      return err;
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });
});

/**
 * The wiring, not the service. These go through the real error handler on a
 * real router mount, because the property being checked is that what the
 * handler *derives* from a request is safe — testing the alert service alone
 * would prove only that a hand-written payload is clean.
 */
describe('operator alerting from the error handler', () => {
  let sent: OutboundMessage[];

  function mountedApp(makeErr: () => unknown) {
    const app = express();
    const router = express.Router();
    router.get('/:studentId/at-risk', (_req, _res, next) => next(makeErr()));
    app.use('/api/students', router);
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    resetOperatorAlerts();
    sent = [];
    const mailer: Mailer = { name: 'fake', async send(m) { sent.push(m); } };
    initOperatorAlerts(mailer, 'ops@example.com');
  });

  it('alerts on a 500 without carrying the id from the path or the error message', async () => {
    const app = mountedApp(
      () => new Error('no student 01JABCDEF0123456789STUDENT (Genevieve Okonkwo) in SNC2D-01'),
    );
    const res = await request(app).get('/api/students/01JABCDEF0123456789STUDENT/at-risk');
    expect(res.status).toBe(500);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0].subject + sent[0].text + sent[0].html;
    expect(body).toContain('/api/students');
    expect(body).not.toContain('01JABCDEF0123456789STUDENT');
    expect(body).not.toContain('Genevieve');
    expect(body).not.toContain('SNC2D-01');
  });

  it('does not alert on a 4xx, which is the client being told no', async () => {
    const app = mountedApp(() => new ApiError('NOT_FOUND', 'gone'));
    await request(app).get('/api/students/abc/at-risk');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });

  it('does not alert on a validation failure', async () => {
    const app = mountedApp(() => {
      try {
        z.object({ name: z.string() }).parse({});
      } catch (e) {
        return e as ZodError;
      }
      return new Error('unreachable');
    });
    await request(app).get('/api/students/abc/at-risk');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });
});
