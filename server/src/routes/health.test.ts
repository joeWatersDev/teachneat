import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../index.js';
import * as pool from '../db/pool.js';

/**
 * Step 6d. The point of the health check is that it fails when the database is
 * unreachable, so the test that matters is the failing one — an endpoint that
 * answers `ok` unconditionally would pass a happy-path test just as well.
 */
afterEach(() => vi.restoreAllMocks());

function fakePool(query: () => Promise<unknown>) {
  vi.spyOn(pool, 'getPool').mockReturnValue({ query } as unknown as ReturnType<
    typeof pool.getPool
  >);
}

describe('GET /api/health', () => {
  it('reports ok when the database answers', async () => {
    fakePool(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports 503 when the database refuses', async () => {
    fakePool(() => Promise.reject(new Error('ECONNREFUSED 10.0.0.1:5432')));
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });

  it('leaks nothing about the failure to the caller', async () => {
    fakePool(() => Promise.reject(new Error('password authentication failed for user "app"')));
    const res = await request(buildApp()).get('/api/health');
    expect(JSON.stringify(res.body)).not.toMatch(/password|user|authentication/i);
  });
});


/**
 * The build stamp. Added after a failed deploy went unnoticed and confirming
 * which code was live meant reconstructing it from CI history and the
 * DigitalOcean API — one curl should answer that.
 */
describe('the build stamp on /api/health', () => {
  it('reports when this process started', async () => {
    fakePool(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(Number.isNaN(Date.parse(res.body.startedAt))).toBe(false);
  });

  it('reports it on the degraded response too', async () => {
    // Which run of the app is failing is exactly the question during an
    // incident, and the moment the console is least pleasant to go and ask.
    fakePool(() => Promise.reject(new Error('down')));
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(Number.isNaN(Date.parse(res.body.startedAt))).toBe(false);
  });

  it('carries nothing beyond the status and the start time', async () => {
    // Deliberately narrow: this endpoint is public and unauthenticated. It
    // gains a way to tell one run of the app from another and nothing that
    // describes the environment.
    fakePool(() => Promise.resolve({ rows: [] }));
    const res = await request(buildApp()).get('/api/health');
    expect(Object.keys(res.body).sort()).toEqual(['startedAt', 'status']);
  });

  /**
   * The commit hash is deliberately absent. It was here, resolved from
   * `git rev-parse`, and reported `unknown` in production because the buildpack
   * leaves no `.git` in the workspace — a field that is honest locally and
   * empty where it matters. `source_commit_hash` on the deployment record
   * answers that question exactly.
   */
  it('does not claim to know the commit', async () => {
    fakePool(() => Promise.resolve({ rows: [] }));
    const res = await request(buildApp()).get('/api/health');
    expect(res.body.commit).toBeUndefined();
  });
});
