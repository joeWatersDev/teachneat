import pg from 'pg';
import { ulid } from 'ulid';
import { getPool } from '../db/pool.js';
import { SUPPORT_LIMITS, type SupportCategory, type SupportStatus } from '../config/support.js';

/**
 * A support request, as the teacher who wrote it sees it. Carries no account
 * identity beyond the sub it belongs to — the operator's view below adds the
 * teacher's own contact fields by joining, rather than this table copying them.
 */
export interface SupportRequest {
  id: string;
  /** Null for a request submitted from the signed-out contact form (Step 5). */
  googleSub: string | null;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportStatus;
  adminNote: string;
  /** The plan the account held when the request was written, not when it is read. */
  planAtSubmit: string;
  createdAt: string;
  updatedAt: string;
  /** When the request last entered a resolved state; null while it is open. */
  resolvedAt: string | null;
}

/**
 * A request plus whatever an operator needs to answer it.
 *
 * For an account-backed request that is the joined account row. For a
 * signed-out one there is no account, so `accountEmail` / `accountName` carry
 * what the sender typed and `verifiedIdentity` is false — the distinction the
 * triage view has to show, because an unverified address is a claim rather than
 * a fact and an operator should know which one they are replying to.
 */
export interface SupportRequestWithAccount extends SupportRequest {
  accountEmail: string;
  accountName: string;
  /** True when the contact details come from the account record rather than the form. */
  verifiedIdentity: boolean;
  /** The plan the account holds *now*, which a comp may already have changed. Null with no account. */
  currentPlanOverride: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

/**
 * A capped list plus whether the cap cut it short. The flag exists because the
 * alternative is silent truncation: a queue that quietly stops at 100 looks
 * exactly like a queue with 100 things in it, and the difference matters most
 * when the queue is busiest. One extra row is fetched and dropped to answer it
 * exactly, rather than inferring "probably more" from a full page.
 */
export interface SupportPage<T> {
  requests: T[];
  truncated: boolean;
}

/**
 * A submission from a signed-in teacher: the account supplies the identity, so
 * the form asks only for what the account record does not already hold.
 */
export interface CreateSupportRequestInput {
  googleSub: string;
  category: SupportCategory;
  subject: string;
  message: string;
  planAtSubmit: string;
}

/**
 * A submission from the signed-out contact form. No account, so the sender's
 * name and address come from the form and are unverified; there is no plan to
 * record, which is why `plan_at_submit` gained a `''` default.
 */
export interface CreatePublicRequestInput {
  contactName: string;
  contactEmail: string;
  category: SupportCategory;
  subject: string;
  message: string;
}

export interface SupportStore {
  create(input: CreateSupportRequestInput): Promise<SupportRequest>;
  /**
   * Signed-out submission. A separate method rather than a nullable field on
   * `create` so a caller cannot accidentally write an identity-less row: the
   * two paths have genuinely different inputs, and the public one can never
   * reach the account-backed columns.
   */
  createPublic(input: CreatePublicRequestInput): Promise<SupportRequest>;
  /** The submitter's own requests, newest first, so they can see what happened. */
  listForUser(googleSub: string): Promise<SupportPage<SupportRequest>>;
  /** The triage list. Omitting `status` returns every request. */
  listAll(status?: SupportStatus): Promise<SupportPage<SupportRequestWithAccount>>;
  get(id: string): Promise<SupportRequestWithAccount | null>;
  /**
   * Triage write. Both fields are optional so a status change and a note are
   * independent, and returns null for an id that does not exist rather than
   * silently succeeding.
   */
  update(
    id: string,
    changes: { status?: SupportStatus; adminNote?: string },
  ): Promise<SupportRequestWithAccount | null>;
  /**
   * Retention (Step 6d). Deletes requests resolved longer ago than
   * {@link SUPPORT_RETENTION_MONTHS}, and returns how many went. The privacy
   * policy states this interval, so this is a promise being kept rather than a
   * table being tidied — the same standing as the usage-counter prune, and
   * unlike the session sweep, which is only housekeeping.
   */
  prune(): Promise<number>;
}

/** The ceiling the privacy policy commits to for a resolved support request. */
export const SUPPORT_RETENTION_MONTHS = 24;

type SupportRow = {
  id: string;
  google_sub: string | null;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_note: string;
  plan_at_submit: string;
  contact_email: string;
  contact_name: string;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

type SupportJoinRow = SupportRow & {
  // Null on a signed-out request: the LEFT JOIN finds no account row.
  email: string | null;
  name: string | null;
  plan_override: string | null;
  subscription_status: string | null;
  trial_ends_at: Date | null;
};

function rowToRequest(row: SupportRow): SupportRequest {
  return {
    id: row.id,
    googleSub: row.google_sub,
    category: row.category as SupportCategory,
    subject: row.subject,
    message: row.message,
    status: row.status as SupportStatus,
    adminNote: row.admin_note,
    planAtSubmit: row.plan_at_submit,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

function rowToJoined(row: SupportJoinRow): SupportRequestWithAccount {
  // The account row wins when there is one: it is the verified address. The
  // form's fields are the fallback, and only a signed-out request has them.
  const verifiedIdentity = row.email !== null;
  return {
    ...rowToRequest(row),
    accountEmail: row.email ?? row.contact_email,
    accountName: row.name ?? row.contact_name,
    verifiedIdentity,
    currentPlanOverride: row.plan_override,
    subscriptionStatus: row.subscription_status ?? '',
    trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : null,
  };
}

/** Trims an over-fetched result back to the cap and reports whether it had to. */
function page<T>(rows: T[]): SupportPage<T> {
  return rows.length > SUPPORT_LIMITS.listLimit
    ? { requests: rows.slice(0, SUPPORT_LIMITS.listLimit), truncated: true }
    : { requests: rows, truncated: false };
}

// LEFT JOIN, because a signed-out request (Step 5) has no account row behind it
// and must still appear in the triage queue. An inner join here would silently
// hide exactly the requests from people who could not sign in to ask.
const JOIN_SELECT = `
  SELECT s.*, u.email, u.name, u.plan_override, u.subscription_status, u.trial_ends_at
    FROM support_requests s
    LEFT JOIN users u ON u.google_sub = s.google_sub`;

export function createPgSupportStore(pool: pg.Pool = getPool()): SupportStore {
  return {
    async create(input) {
      const { rows } = await pool.query<SupportRow>(
        `INSERT INTO support_requests (id, google_sub, category, subject, message, plan_at_submit)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          ulid(),
          input.googleSub,
          input.category,
          input.subject,
          input.message,
          input.planAtSubmit,
        ],
      );
      return rowToRequest(rows[0]);
    },
    async createPublic(input) {
      const { rows } = await pool.query<SupportRow>(
        `INSERT INTO support_requests
           (id, category, subject, message, contact_name, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [ulid(), input.category, input.subject, input.message, input.contactName, input.contactEmail],
      );
      return rowToRequest(rows[0]);
    },
    async listForUser(googleSub) {
      const { rows } = await pool.query<SupportRow>(
        `SELECT * FROM support_requests
          WHERE google_sub = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        // One past the cap, so a full page can be told from an overflowing one.
        [googleSub, SUPPORT_LIMITS.listLimit + 1],
      );
      return page(rows.map(rowToRequest));
    },
    async listAll(status) {
      const limit = SUPPORT_LIMITS.listLimit + 1;
      const { rows } = status
        ? await pool.query<SupportJoinRow>(
            `${JOIN_SELECT} WHERE s.status = $1 ORDER BY s.created_at DESC LIMIT $2`,
            [status, limit],
          )
        : await pool.query<SupportJoinRow>(`${JOIN_SELECT} ORDER BY s.created_at DESC LIMIT $1`, [
            limit,
          ]);
      return page(rows.map(rowToJoined));
    },
    async get(id) {
      const { rows } = await pool.query<SupportJoinRow>(`${JOIN_SELECT} WHERE s.id = $1`, [id]);
      return rows[0] ? rowToJoined(rows[0]) : null;
    },
    async update(id, changes) {
      // COALESCE rather than a built-up SET list: two optional fields do not
      // justify dynamic SQL, and this keeps the parameter positions fixed.
      const { rows } = await pool.query<SupportJoinRow>(
        `WITH updated AS (
           UPDATE support_requests
              SET status     = COALESCE($2, status),
                  admin_note = COALESCE($3, admin_note),
                  -- Set on the way into a resolved state and cleared on the way
                  -- out, so the retention clock always measures from the last
                  -- resolution. A note-only edit leaves it alone.
                  resolved_at = CASE
                    WHEN $2 IS NULL THEN resolved_at
                    WHEN $2 IN ('resolved', 'closed')
                      THEN COALESCE(resolved_at, now())
                    ELSE NULL
                  END,
                  updated_at = now()
            WHERE id = $1
            RETURNING *
         )
         SELECT s.*, u.email, u.name, u.plan_override, u.subscription_status, u.trial_ends_at
           FROM updated s
           LEFT JOIN users u ON u.google_sub = s.google_sub`,
        [id, changes.status ?? null, changes.adminNote ?? null],
      );
      return rows[0] ? rowToJoined(rows[0]) : null;
    },
    async prune() {
      const { rowCount } = await pool.query(
        `DELETE FROM support_requests
          WHERE resolved_at IS NOT NULL
            AND resolved_at < now() - ($1 || ' months')::interval`,
        [String(SUPPORT_RETENTION_MONTHS)],
      );
      return rowCount ?? 0;
    },
  };
}

/** In-memory store for tests. Same contract, no database. */
export function createMemorySupportStore(
  seed: SupportRequest[] = [],
  accounts: Record<string, { email: string; name: string }> = {},
): SupportStore {
  const byId = new Map<string, SupportRequest>();
  for (const r of seed) byId.set(r.id, { ...r });

  // Mirrors the LEFT JOIN above: a request with no googleSub falls back to the
  // contact fields the form supplied and is marked unverified.
  const contact = new Map<string, { name: string; email: string }>();

  const join = (r: SupportRequest): SupportRequestWithAccount => {
    const account = r.googleSub === null ? undefined : accounts[r.googleSub];
    const typed = contact.get(r.id);
    return {
      ...r,
      accountEmail: account?.email ?? typed?.email ?? (r.googleSub ? 'unknown@example.com' : ''),
      accountName: account?.name ?? typed?.name ?? '',
      verifiedIdentity: r.googleSub !== null,
      currentPlanOverride: null,
      subscriptionStatus: r.googleSub !== null ? 'inactive' : '',
      trialEndsAt: null,
    };
  };
  const newestFirst = (a: SupportRequest, b: SupportRequest) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

  return {
    async create(input) {
      const now = new Date().toISOString();
      const request: SupportRequest = {
        id: ulid(),
        googleSub: input.googleSub,
        category: input.category,
        subject: input.subject,
        message: input.message,
        status: 'new',
        adminNote: '',
        planAtSubmit: input.planAtSubmit,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      byId.set(request.id, request);
      return { ...request };
    },
    async createPublic(input) {
      const now = new Date().toISOString();
      const request: SupportRequest = {
        id: ulid(),
        googleSub: null,
        category: input.category,
        subject: input.subject,
        message: input.message,
        status: 'new',
        adminNote: '',
        planAtSubmit: '',
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      byId.set(request.id, request);
      contact.set(request.id, { name: input.contactName, email: input.contactEmail });
      return { ...request };
    },
    async listForUser(googleSub) {
      return page([...byId.values()].filter((r) => r.googleSub === googleSub).sort(newestFirst));
    },
    async listAll(status) {
      return page(
        [...byId.values()]
          .filter((r) => !status || r.status === status)
          .sort(newestFirst)
          .map(join),
      );
    },
    async get(id) {
      const request = byId.get(id);
      return request ? join(request) : null;
    },
    async update(id, changes) {
      const request = byId.get(id);
      if (!request) return null;
      if (changes.status !== undefined) {
        request.status = changes.status;
        request.resolvedAt =
          changes.status === 'resolved' || changes.status === 'closed'
            ? (request.resolvedAt ?? new Date().toISOString())
            : null;
      }
      if (changes.adminNote !== undefined) request.adminNote = changes.adminNote;
      request.updatedAt = new Date().toISOString();
      return join(request);
    },
    async prune() {
      const cutoff = new Date();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - SUPPORT_RETENTION_MONTHS);
      let removed = 0;
      for (const [id, r] of byId) {
        if (r.resolvedAt && new Date(r.resolvedAt) < cutoff) {
          byId.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
