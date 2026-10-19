import pg from 'pg';
import { migrations } from './migrations.js';
import { logger } from '../config/logger.js';

/**
 * Applies any migrations not yet recorded in the _migrations table, each in its
 * own transaction, in array order. Idempotent: already-applied migrations are
 * skipped. Called once at server boot, before the HTTP listener starts.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name       TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );`,
  );
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      logger.info({ migration: migration.name }, 'Applied database migration');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
