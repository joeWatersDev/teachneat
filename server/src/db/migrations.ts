export interface Migration {
  name: string;
  sql: string;
}

/**
 * Ordered, append-only list of schema migrations applied at server boot by
 * runMigrations. Each entry runs once, in a transaction, and is recorded in the
 * _migrations table. Never edit or reorder a shipped migration — add a new one.
 *
 * The users table holds account state only: Google identity, the teacher's own
 * contact fields, where their spreadsheet lives, subscription status, and the
 * encrypted refresh token. It never holds student PII, which stays in the
 * teacher's Google Sheet.
 */
export const migrations: Migration[] = [
  {
    name: '0001_create_users',
    sql: `
      CREATE TABLE users (
        id                  TEXT PRIMARY KEY,
        google_sub          TEXT NOT NULL UNIQUE,
        email               TEXT NOT NULL,
        name                TEXT NOT NULL DEFAULT '',
        avatar_url          TEXT NOT NULL DEFAULT '',
        spreadsheet_id      TEXT,
        refresh_token_enc   TEXT NOT NULL,
        subscription_status TEXT NOT NULL DEFAULT 'inactive',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Server-side session records, so signing out (or an admin revoking access)
    // invalidates a session immediately rather than waiting for a stateless
    // cookie to expire. id_hash is a SHA-256 of the cookie's session id: a
    // database dump therefore yields no usable session tokens. Holds no student
    // PII — only the account it belongs to and the session's own timestamps.
    name: '0002_create_sessions',
    sql: `
      CREATE TABLE sessions (
        id_hash      TEXT PRIMARY KEY,
        google_sub   TEXT NOT NULL REFERENCES users(google_sub) ON DELETE CASCADE,
        csrf_token   TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX sessions_google_sub_idx ON sessions (google_sub);
      CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
    `,
  },
  {
    // Plan state, the one server-applied setting, and the free tier's monthly
    // email counter. plan_override is deliberately separate from
    // subscription_status: Stripe (Step 3b) owns the subscription fields alone,
    // so a support comp or the dev toggle can set plan without the two ever
    // disagreeing. The counter is a bare integer — a paywall cannot be enforced
    // from a spreadsheet the teacher can edit, and a count carries no PII.
    name: '0003_add_plan_and_settings',
    sql: `
      ALTER TABLE users
        ADD COLUMN plan_override         TEXT,
        ADD COLUMN trial_ends_at         TIMESTAMPTZ,
        ADD COLUMN high_absence_min_rate DOUBLE PRECISION,
        ADD COLUMN high_absence_min_days INTEGER,
        ADD COLUMN monthly_email_period  TEXT,
        ADD COLUMN monthly_email_count   INTEGER NOT NULL DEFAULT 0;
      -- Accounts that predate this column get the trial they were promised,
      -- measured from when they signed up rather than from today.
      UPDATE users SET trial_ends_at = created_at + INTERVAL '30 days';
    `,
  },
  {
    // Stripe's own fields. These four plus subscription_status are written by
    // exactly one thing — the webhook handler — because billing state that the
    // app can also write is billing state the two can disagree about. The dev
    // toggle and support comps go through plan_override instead (0003).
    //
    // stripe_customer_id is UNIQUE and indexed: a webhook arrives identifying a
    // customer, not a google_sub, so this is the lookup path on every event.
    // It is nullable because an account has no Stripe customer until its first
    // checkout, and most accounts (free tier) never get one.
    //
    // No PII beyond what the account row already holds: these are opaque Stripe
    // identifiers and a timestamp.
    name: '0004_add_stripe_fields',
    sql: `
      ALTER TABLE users
        ADD COLUMN stripe_customer_id     TEXT UNIQUE,
        ADD COLUMN stripe_subscription_id TEXT,
        ADD COLUMN current_period_end     TIMESTAMPTZ,
        ADD COLUMN cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX users_stripe_customer_id_idx ON users (stripe_customer_id);
    `,
  },
  {
    // Support requests (Phase 2 Step 4). A row is written by the teacher who
    // submits it and read by an allowlisted operator; nothing else touches it.
    //
    // On the PII boundary: this table holds a teacher's own words about their
    // own account, which is account data, not student data. The form says
    // plainly not to include student names, and neither the subject nor the
    // message is ever logged — but a free-text field is the one place in the
    // app where a teacher could put student PII into our database despite the
    // design, so it is the field to remember when a retention policy is
    // written. Nothing else on the row is free text.
    //
    // google_sub rather than a copied email: the account is the identity, and
    // ON DELETE CASCADE means deleting an account takes its requests with it.
    // The plan is copied at submit time because it is the plan the teacher was
    // complaining about, which is not necessarily the plan they hold when the
    // request is finally read.
    name: '0005_create_support_requests',
    sql: `
      CREATE TABLE support_requests (
        id           TEXT PRIMARY KEY,
        google_sub   TEXT NOT NULL REFERENCES users(google_sub) ON DELETE CASCADE,
        category     TEXT NOT NULL,
        subject      TEXT NOT NULL,
        message      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'new',
        admin_note   TEXT NOT NULL DEFAULT '',
        plan_at_submit TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- The triage view's only ordering: open requests, newest first.
      CREATE INDEX support_requests_status_idx ON support_requests (status, created_at DESC);
      CREATE INDEX support_requests_google_sub_idx ON support_requests (google_sub, created_at DESC);
    `,
  },
  {
    // The signed-out contact route (Phase 2 Step 5). Step 4 deliberately shipped
    // a signed-in-only form; the landing page puts a contact form in front of
    // people who cannot sign in at all — which, for this product, is the most
    // important group of them, because a teacher whose board has blocked the
    // OAuth app has no way to reach us from inside the app.
    //
    // google_sub becomes nullable rather than a second table: a request is a
    // request, the triage view should show one queue, and an anonymous row
    // differs from an account row only in where the identity comes from. The
    // triage join becomes a LEFT JOIN and reads the contact fields when there
    // is no account behind the row.
    //
    // contact_email and contact_name are supplied by whoever filled the form and
    // are therefore unverified — the triage view says so. They default to ''
    // so existing account-backed rows need no backfill; the invariant is that
    // exactly one of (google_sub, contact_email) is present, enforced by the
    // CHECK below so a malformed insert cannot create an unanswerable request.
    //
    // On the PII boundary: this widens the free-text exposure noted in 0005 to
    // people we have no account relationship with, so the public form carries
    // the same "no student names" instruction and nothing here is ever logged.
    // A retention policy has to cover both paths.
    name: '0006_public_support_requests',
    sql: `
      ALTER TABLE support_requests
        ALTER COLUMN google_sub DROP NOT NULL,
        ALTER COLUMN plan_at_submit SET DEFAULT '',
        ADD COLUMN contact_email TEXT NOT NULL DEFAULT '',
        ADD COLUMN contact_name  TEXT NOT NULL DEFAULT '';
      ALTER TABLE support_requests
        ADD CONSTRAINT support_requests_identity_chk
        CHECK (google_sub IS NOT NULL OR contact_email <> '');
    `,
  },
  {
    // Onboarding and the managed-domain record (Phase 2 Step 5a).
    //
    // onboarded_at is null until the teacher finishes the first-run guide, which
    // is what makes "is this a new account" a server-side fact rather than a
    // localStorage flag. Per-browser would be wrong twice: a teacher who signs
    // in on the classroom desktop and again on their laptop would be walked
    // through it a second time, and clearing site data would resurrect it years
    // later. Existing accounts are backfilled to created_at — they have been
    // using the app, so a welcome screen would be an insult rather than help.
    //
    // workspace_domain is the `hd` claim from Google, present only for a managed
    // Workspace account and empty for a personal gmail.com one. It is recorded
    // because the allowlisting gate is per-domain, not per-teacher: knowing that
    // four blocked sign-ins came from one board turns four support tickets into
    // one conversation with one admin. It is the teacher's own employer's
    // domain, not student data, and it is deliberately the whole of what we
    // learn about their institution.
    name: '0007_add_onboarding_and_domain',
    sql: `
      ALTER TABLE users
        ADD COLUMN onboarded_at     TIMESTAMPTZ,
        ADD COLUMN workspace_domain TEXT NOT NULL DEFAULT '';
      UPDATE users SET onboarded_at = created_at;
    `,
  },
  {
    // Terms and data-responsibility consent (Phase 2 Step 5c).
    //
    // Three columns rather than one boolean, for three reasons.
    //
    // terms_version, because consent to an unversioned document is unusable: if
    // the terms are revised there is no way to tell who agreed to which text,
    // and no way to re-prompt. Recording the version makes a future revision a
    // one-line change (bump CURRENT_TERMS_VERSION) that re-prompts everyone.
    //
    // Two separate timestamps, because these are two distinct agreements and the
    // second is the one that matters most here: a teacher acknowledging that
    // storing student data in their own Google account leaves the legal
    // obligations with them. Bundling it into a single "I agree to the terms"
    // checkbox would make the record of it materially weaker.
    //
    // No backfill, deliberately, and this is the opposite of 0007's choice.
    // Existing accounts have not agreed to anything, and writing a timestamp
    // that says they did would fabricate exactly the record this migration
    // exists to create. They are prompted on their next request instead.
    name: '0008_add_consent',
    sql: `
      ALTER TABLE users
        ADD COLUMN terms_accepted_at               TIMESTAMPTZ,
        ADD COLUMN terms_version                   TEXT NOT NULL DEFAULT '',
        ADD COLUMN data_responsibility_accepted_at TIMESTAMPTZ;
    `,
  },
  {
    // Whether this account has ever had a student (Phase 2 Step 6f).
    //
    // It exists to answer one question in the account menu — whether to still
    // offer "Getting started" — and the shape of the answer is what makes this a
    // column rather than a lookup. The roster lives in the teacher's Google
    // Sheet, so asking it directly would put a Sheets read behind a menu that
    // renders on every page of the app, against a per-project quota that Step 6a
    // exists to protect. A boolean in a row we already load per request costs
    // nothing.
    //
    // A timestamp rather than a boolean because it is free to store and answers
    // "when did this account become real", which is the question any later look
    // at activation will ask.
    //
    // **Deliberately not backfilled**, and this is the third variation on that
    // choice in this file. 0007 backfilled onboarding because showing a welcome
    // screen to an established teacher is an insult; 0008 refused to backfill
    // consent because writing it would fabricate a record. Here the honest value
    // is unknown: nothing in this database knows whether an existing account has
    // students, since that fact lives in Google's. So it starts null and is set
    // by the first roster read that comes back non-empty — which is the app's
    // index route, so an existing teacher converges on their next visit, and the
    // only cost of being wrong meanwhile is one extra menu item.
    name: '0009_add_first_student_at',
    sql: `
      ALTER TABLE users
        ADD COLUMN first_student_at TIMESTAMPTZ;
    `,
  },
  {
    // The lifecycle email queue (Phase 2 Step 6h).
    //
    // Queued rather than sent inline, for two reasons that point the same way.
    // The trial-ending message has no request behind it — it fires five days
    // before a date, when nobody is signed in — so something has to hold the
    // intent until a sweep runs. And an outbound HTTP call inside the signup
    // path would turn a provider outage into a failed registration.
    //
    // UNIQUE (account_id, message_type) is the whole design in one line. A
    // retried sweep, a double-triggered sweep, and two sweeps running at once
    // each insert the same row and lose to the constraint. A duplicate welcome
    // is embarrassing; a duplicate "your trial is ending" is worse.
    //
    // **account_id, not google_sub, and no foreign key**, which is the one place
    // this table deliberately breaks the pattern every other table here follows.
    // The deletion confirmation has to be sent *after* the account row is gone,
    // so an ON DELETE CASCADE would destroy the queued message before the sweep
    // could ever see it. Keying on users.id (a ULID, new for every account) also
    // means someone who deletes their account and signs up again gets a genuine
    // welcome rather than being silently skipped by their own old row — which
    // keying on the Google subject id, stable across both accounts, would do.
    //
    // recipient_email and recipient_name are copied onto the row for the same
    // reason: after deletion there is no account left to read them from. They
    // are the teacher's own contact fields, which the users table already holds.
    //
    // On the PII boundary: message_type is an enum-like string and context_date
    // is a date. **No message body is stored here** — bodies are rendered from
    // templates at send time — so this table cannot accumulate the student data
    // that the templates have no way to reference in the first place.
    name: '0010_create_lifecycle_emails',
    sql: `
      CREATE TABLE lifecycle_emails (
        id             TEXT PRIMARY KEY,
        account_id     TEXT NOT NULL,
        message_type   TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT NOT NULL DEFAULT '',
        context_date   TIMESTAMPTZ,
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT NOT NULL DEFAULT '',
        queued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        attempted_at   TIMESTAMPTZ,
        sent_at        TIMESTAMPTZ,
        abandoned_at   TIMESTAMPTZ,
        CONSTRAINT lifecycle_emails_once UNIQUE (account_id, message_type)
      );
      -- The sweep's only query: rows not yet sent or abandoned, oldest first.
      CREATE INDEX lifecycle_emails_pending_idx
        ON lifecycle_emails (queued_at)
        WHERE sent_at IS NULL AND abandoned_at IS NULL;
    `,
  },
  {
    // The summer pause and the founding-user promo (Phase 2 Step 6i).
    //
    // Three of the four columns mirror Stripe and are written only by the
    // webhook, which stays the sole writer of subscription state. The fourth,
    // pause_started_at, is ours: it is what the once-per-twelve-months rule is
    // checked against, and it has to survive the pause ending, which Stripe's
    // own pause_collection does not — Stripe clears that field the moment
    // collection resumes, so a rule read from it would allow a new pause every
    // month.
    //
    // collection_paused is a boolean beside the resume date rather than derived
    // from it, because Stripe allows an indefinite pause with no resumes_at and
    // "paused" then has no date to infer it from. Entitlement reads the boolean
    // (see plan.ts); the date is for the reminder and the wording.
    //
    // promo_ends_at is when a repeating discount stops applying, which is the
    // date of the first real charge and the thing the Step 6h reminder is
    // seven days ahead of. It is not current_period_end: a discounted
    // subscription renews on schedule at zero, so the period end moves every
    // month while the promo end does not.
    //
    // None of these hold student data. They are dates and a flag about a
    // payment arrangement.
    name: '0011_add_pause_and_promo',
    sql: `
      ALTER TABLE users
        ADD COLUMN collection_paused BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN pause_resumes_at  TIMESTAMPTZ,
        ADD COLUMN pause_started_at  TIMESTAMPTZ,
        ADD COLUMN promo_ends_at     TIMESTAMPTZ;
    `,
  },
  {
    // Which of the two prices a subscription is on (Phase 2 Step 6i follow-up).
    //
    // Added when the founding-user promo was widened from the monthly price to
    // both. The promo-ending reminder names a figure — it is the one lifecycle
    // message that does, because its purpose is that the first real charge is
    // not a surprise — and it had no way to know which figure, so it named the
    // monthly one unconditionally. That was correct while the promo was
    // monthly-only and became a wrong number in an uneditable email the moment
    // an annual subscriber could redeem it.
    //
    // Mirrored from Stripe and written only by the webhook, like every other
    // subscription field beside it. Nullable with no backfill: an existing row
    // learns its interval at the next event Stripe sends for it, and until then
    // the copy names no figure rather than a guessed one.
    //
    // Holds no student data. It is one of two words about a payment
    // arrangement.
    name: '0012_add_subscription_interval',
    sql: `
      ALTER TABLE users
        ADD COLUMN subscription_interval TEXT;
    `,
  },
  {
    // Activation milestones (Phase 2 Step 6j).
    //
    // Five more nullable timestamps in the onboarded_at / first_student_at
    // pattern, and for the same purpose: to answer where a new account stops,
    // which is not a question the account row could answer before. Each is set
    // once and never rewritten, so a column records when a teacher first did a
    // thing rather than when they last did it.
    //
    // They are milestones rather than events on purpose, and the distinction is
    // the whole reason this is describable in the privacy policy. A one-time
    // "first generated a grouping on the 3rd" cannot be assembled into a
    // teacher's working day; a timestamp per action could. If a later step
    // wants per-action timestamps it should have to argue for them here rather
    // than arrive at them by drift.
    //
    // first_premium_attempt_at is the odd one out: it records a refusal, not a
    // use. It is written from requirePremium, which every premium gate already
    // funnels through, so it is one call site covering all of them.
    //
    // None of these hold student data. They are dates about the teacher's own
    // use of the app, and no student action can set one.
    name: '0013_add_activation_milestones',
    sql: `
      ALTER TABLE users
        ADD COLUMN first_attendance_at      TIMESTAMPTZ,
        ADD COLUMN first_grouping_at        TIMESTAMPTZ,
        ADD COLUMN first_picker_at          TIMESTAMPTZ,
        ADD COLUMN first_email_at           TIMESTAMPTZ,
        ADD COLUMN first_premium_attempt_at TIMESTAMPTZ;
    `,
  },
  {
    // Monthly per-tool usage counters (Phase 2 Step 6j).
    //
    // A count per account per tool per UTC calendar month, and deliberately
    // nothing finer. The counter answers which tools get adopted and whether
    // use holds up over a school year; it cannot answer when on Tuesday a
    // teacher opened Attendance, because the only thing stored is how many
    // times in the month. That ceiling is the point, not a limitation to lift
    // later: what makes this safe to describe to a school board is that it is
    // arithmetic about a product, not a record of a person's day.
    //
    // period reuses emailPeriodOf's YYYY-MM UTC key rather than a second
    // month function, so the free-email allowance and these counters can never
    // disagree about which month a write fell in.
    //
    // ON DELETE CASCADE, which is the opposite of the choice lifecycle_emails
    // made and for the opposite reason: that queue has to outlive the account
    // to confirm its deletion, while these have to die with it. Deleting an
    // account must leave nothing behind that says what it used.
    //
    // Counters carry no student data and no free text. The tool column is one
    // of a fixed set of names written by the server, never by a client.
    name: '0014_create_usage_counters',
    sql: `
      CREATE TABLE usage_counters (
        account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool       TEXT NOT NULL,
        period     TEXT NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, tool, period)
      );
      CREATE INDEX usage_counters_period_idx ON usage_counters (period);
    `,
  },
  {
    // Support-request retention (Step 6d). The privacy policy states that a
    // request is kept for up to 24 months after it is resolved, and until now
    // nothing measured that interval, let alone enforced it.
    //
    // A dedicated column rather than `updated_at`: a note added to an already
    // resolved request would push its retention past the 24 months the policy
    // promises, which is the direction that matters. Reopening clears it, so the
    // clock starts from the last resolution rather than the first.
    //
    // Backfilled from `updated_at` for rows already resolved, which is the
    // closest thing to a resolution time that exists for them.
    name: '0015_support_requests_resolved_at',
    sql: `
      ALTER TABLE support_requests ADD COLUMN resolved_at TIMESTAMPTZ;
      UPDATE support_requests
         SET resolved_at = updated_at
       WHERE status IN ('resolved', 'closed');
      CREATE INDEX support_requests_resolved_at_idx
        ON support_requests (resolved_at)
        WHERE resolved_at IS NOT NULL;
    `,
  },
  {
    /**
     * The daily send cap moves out of the spreadsheet (Step 7).
     *
     * It was counted by reading `emailLog` rows out of the teacher's own Sheet,
     * which they can edit. Deleting the rows reset the cap to a full 200 with no
     * tooling and no race — measured, not theorised. The monthly free-tier
     * allowance was already in Postgres for exactly this reason, recorded in
     * accountStore as "a paywall cannot be enforced from a spreadsheet the
     * teacher can edit"; the same argument was never applied to the daily cap,
     * which is the harder limit and the one the Gmail scope depends on.
     *
     * `emailLog` stays the audit record. This is a counter, not a log: two
     * integers holding no PII, mirroring monthly_email_period / _count exactly
     * so there is one pattern rather than two.
     *
     * Deliberately not backfilled. There is nothing to backfill from that is
     * trustworthy — the Sheet is the thing being distrusted — and the column
     * governs a single day, so the worst case is one generous day at the
     * cutover.
     */
    name: '0016_add_daily_email_counter',
    sql: `
      ALTER TABLE users ADD COLUMN daily_email_date TEXT;
      ALTER TABLE users ADD COLUMN daily_email_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    /**
     * Subscription state gains a clock and a watchdog (Step 7).
     *
     * `subscription_event_at` is when the change that last wrote this row
     * happened, according to Stripe. Applying state was an unconditional UPDATE,
     * and Stripe does not guarantee event ordering — a retry can deliver an
     * older event after a newer one. A `customer.subscription.updated`
     * redelivered after the `.deleted` it precedes would put a cancelled account
     * back to active and leave it paid indefinitely, which is the same outcome
     * as the missed-webhook question this step also settles, reached by a
     * different route.
     *
     * `subscription_checked_at` is what the reconciliation sweep orders on, so
     * it can take the least-recently-verified accounts and be bounded by
     * construction rather than by however many accounts happen to exist. NULL
     * sorts first, so an account that has never been checked is checked next.
     */
    name: '0017_add_subscription_reconciliation',
    sql: `
      ALTER TABLE users ADD COLUMN subscription_event_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN subscription_checked_at TIMESTAMPTZ;
      CREATE INDEX users_subscription_checked_at_idx
        ON users (subscription_checked_at NULLS FIRST)
        WHERE stripe_customer_id IS NOT NULL;
    `,
  },
];
