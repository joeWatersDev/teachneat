import crypto from 'node:crypto';
import pg from 'pg';
import { getPool } from '../db/pool.js';

/**
 * Server-side session records.
 *
 * The cookie carries an opaque session id; everything else about the session
 * lives here, so a sign-out revokes the session server-side instead of relying
 * on the client to discard a self-describing cookie. Only the SHA-256 of the id
 * is stored, so the table never holds a value that could be replayed as a
 * cookie. A session row holds no student PII — the account it belongs to, its
 * CSRF token, and its timestamps.
 */

/** Hard ceiling on a session's life, regardless of activity. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session unused for this long is treated as expired. */
export const SESSION_IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * last_seen_at is only rewritten once the recorded value is this stale, so an
 * active session costs one write an hour rather than one per request.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionRecord {
  googleSub: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface CreatedSession extends SessionRecord {
  /** The raw id that goes in the cookie. Never stored; only its hash is. */
  id: string;
}

export interface SessionStore {
  create(googleSub: string): Promise<CreatedSession>;
  /**
   * Returns the session for a raw cookie id, or null if it is unknown, expired
   * (absolute or idle), or belongs to a deleted account. Refreshes last_seen_at
   * at most once per SESSION_TOUCH_INTERVAL_MS.
   */
  get(id: string): Promise<SessionRecord | null>;
  destroy(id: string): Promise<void>;
  /** Revokes every session for an account (account deletion, forced sign-out). */
  destroyAllForUser(googleSub: string): Promise<void>;
  /** Housekeeping: removes rows past their absolute or idle expiry. */
  deleteExpired(): Promise<number>;
}

export function newSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function newCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex');
}

type SessionRow = {
  google_sub: string;
  csrf_token: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
};

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    googleSub: row.google_sub,
    csrfToken: row.csrf_token,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export function createPgSessionStore(pool: pg.Pool = getPool()): SessionStore {
  return {
    async create(googleSub) {
      const id = newSessionId();
      const csrfToken = newCsrfToken();
      const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);
      const { rows } = await pool.query<SessionRow>(
        `INSERT INTO sessions (id_hash, google_sub, csrf_token, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [hashSessionId(id), googleSub, csrfToken, expiresAt],
      );
      return { id, ...rowToRecord(rows[0]) };
    },
    async get(id) {
      const idleCutoff = new Date(Date.now() - SESSION_IDLE_TTL_MS);
      const { rows } = await pool.query<SessionRow>(
        `SELECT * FROM sessions
          WHERE id_hash = $1 AND expires_at > now() AND last_seen_at > $2`,
        [hashSessionId(id), idleCutoff],
      );
      if (!rows[0]) return null;
      const record = rowToRecord(rows[0]);
      if (Date.now() - rows[0].last_seen_at.getTime() > SESSION_TOUCH_INTERVAL_MS) {
        await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1', [
          hashSessionId(id),
        ]);
      }
      return record;
    },
    async destroy(id) {
      await pool.query('DELETE FROM sessions WHERE id_hash = $1', [hashSessionId(id)]);
    },
    async destroyAllForUser(googleSub) {
      await pool.query('DELETE FROM sessions WHERE google_sub = $1', [googleSub]);
    },
    async deleteExpired() {
      const idleCutoff = new Date(Date.now() - SESSION_IDLE_TTL_MS);
      const { rowCount } = await pool.query(
        'DELETE FROM sessions WHERE expires_at <= now() OR last_seen_at <= $1',
        [idleCutoff],
      );
      return rowCount ?? 0;
    },
  };
}

/** In-memory session store for tests. Same semantics, no database. */
export function createMemorySessionStore(): SessionStore {
  const byHash = new Map<string, SessionRecord>();
  const isLive = (s: SessionRecord) =>
    Date.parse(s.expiresAt) > Date.now() &&
    Date.now() - Date.parse(s.lastSeenAt) < SESSION_IDLE_TTL_MS;

  return {
    async create(googleSub) {
      const id = newSessionId();
      const now = new Date().toISOString();
      const record: SessionRecord = {
        googleSub,
        csrfToken: newCsrfToken(),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS).toISOString(),
      };
      byHash.set(hashSessionId(id), record);
      return { id, ...record };
    },
    async get(id) {
      const record = byHash.get(hashSessionId(id));
      if (!record || !isLive(record)) return null;
      const snapshot = { ...record };
      if (Date.now() - Date.parse(record.lastSeenAt) > SESSION_TOUCH_INTERVAL_MS) {
        record.lastSeenAt = new Date().toISOString();
      }
      return snapshot;
    },
    async destroy(id) {
      byHash.delete(hashSessionId(id));
    },
    async destroyAllForUser(googleSub) {
      for (const [hash, record] of byHash) {
        if (record.googleSub === googleSub) byHash.delete(hash);
      }
    },
    async deleteExpired() {
      let removed = 0;
      for (const [hash, record] of byHash) {
        if (!isLive(record)) {
          byHash.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
