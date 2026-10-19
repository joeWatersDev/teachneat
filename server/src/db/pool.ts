import pg from 'pg';
import { env } from '../config/env.js';

let pool: pg.Pool | undefined;

/**
 * Builds the pool configuration.
 *
 * Two shapes, and the reason for the second one is a trap in `pg`. Passing both
 * `connectionString` and `ssl` does not do what it looks like: `pg` parses the
 * connection string and merges the result *over* the explicit options, so a
 * `sslmode=require` in the URL replaces the `ssl` object rather than being
 * complemented by it, and the CA is silently discarded.
 *
 * So when a CA is configured the URL is decomposed into discrete fields and the
 * TLS settings are supplied on their own, where nothing can overwrite them.
 * Without a CA — local development, where Postgres is a native install with no
 * TLS — the connection string is passed through untouched.
 *
 * The CA itself is needed because DigitalOcean's managed Postgres presents a
 * certificate from DigitalOcean's own CA, which is not in Node's trust store,
 * and `pg` treats `sslmode=require` as `verify-full`. Verification stays on:
 * `rejectUnauthorized: false` would encrypt the connection while authenticating
 * nothing, which is the failure mode this is meant to avoid.
 */
function buildConfig(): pg.PoolConfig {
  const url = env.database.url;
  if (!url) return {};
  if (!env.database.caCert) return { connectionString: url };

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '') || undefined,
    ssl: { ca: env.database.caCert, rejectUnauthorized: true },
  };
}

/**
 * Lazily constructs the shared connection pool. Construction does not open a
 * connection (pg connects on first query), so this is safe to call at build
 * time and in tests that never touch the database.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(buildConfig());
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}
