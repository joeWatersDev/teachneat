# Teachneat — API Contract

The authoritative specification for the HTTP API the client and server agree on. Server route handlers derive their Zod schemas from this document. Client API functions derive their TypeScript types from this document. When this document conflicts with [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), or [TESTING_PLAN.md](TESTING_PLAN.md), flag the conflict rather than guessing.

This contract is not a runtime artifact. Neither side imports it. Both sides implement against it.

---

## Conventions

### Base URL and prefix
All endpoints below are relative to `/api`. The full path of `GET /students` is `GET /api/students`. The `/api` prefix is omitted from the rest of this document for readability.

### Field naming
All request bodies, response bodies, and query parameters use `camelCase`. This matches the in-memory field names in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md). The Sheets service layer maps these names to opaque column codes (`c01`, `c02`, …) when reading or writing. The API never exposes column codes.

### Identifiers
All `id` fields are ULIDs (26-character Crockford base32) generated server-side. The client never supplies an `id` on `POST`. URL path parameters use the literal `id` for the resource's own identifier, e.g., `/students/:id`; nested routes name the parent's parameter after the parent, e.g., `/students/:studentId/at-risk`.

### Timestamps
ISO 8601 UTC with trailing `Z`, e.g., `2026-04-21T14:30:00Z`. Dates without time use `YYYY-MM-DD`.

### Booleans
Native JSON `true` / `false`. The Sheets layer converts to/from the `TRUE` / `FALSE` strings used in storage.

### Response envelope
Responses are flat. Success responses contain the resource directly. Error responses use the shape defined in [Errors](#errors). HTTP status codes carry the success/failure signal; there is no `{ data, error }` wrapper.

### Plan entitlements (Phase 2)

Every request resolves the account's plan state — `free`, `trial`, or `paid` — from the account record.
`trial` and `paid` are entitlement-identical; only `free` is restricted. The feature split is specified in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2 Step 3.

Entitlements are enforced **server-side** on the endpoint, never only in the client. Client-side lock
state is presentation. The endpoints gated to `trial`/`paid` are:

- `GET /attendance/stats` — the statistics view and the student-detail attendance summary, the only two
  readers of computed aggregates. Neither `GET /attendance?date=` (daily entry) nor `GET /attendance/range`
  (the History grid and the student-detail heatmap) is gated: both return the record of what was taken
  rather than analysis of it, and the line is drawn at the computation, not at looking back.
- The student-detail attendance **summary**. `GET /students/:id/detail` itself is **not** gated — it serves
  contact details and notes — and it carries no attendance payload to
  withhold: the summary is built from `GET /attendance/stats`, so gating that endpoint is what gates the
  summary. On `free` the rest of the detail view still serves, the heatmap beneath the summary still
  renders, and only the summary itself is replaced with the premium notice.
- `PUT /settings` when it changes the high-absence threshold. `GET /settings` is **not** gated: the
  threshold is shown in the roster's high-absence tooltip on every plan, so the client must be able to
  read it while unable to change it.
- All of `/grouping/constraints` (`GET`, `POST`, `PUT /:id`, `DELETE /:id`) — keep-together / keep-apart
  rules. A `free` account may still generate and save groupings; the server ignores any stored constraints
  for a `free` account rather than erroring, so a lapsed account's saved rules survive and re-apply on
  upgrade.
- `POST /email/send` beyond the free monthly allowance (see below).

**Not gated, deliberately:** `GET /students/risk-summary` (the roster's warning icons),
`GET /email/recipient-metrics` (the Compose view's per-recipient attendance figures), and the email
template conditions over `atRisk`, `lateCount`, and `unexcusedAbsences`. The indicators stay free; only the
analysis views are premium. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2 Step 3.

Both ungated reads compute the high-absence flag **server-side with the account's effective threshold**, so
the roster icons, the student-detail summary, the Statistics flag, and the email tool's "High absences"
selection cannot disagree about which students are flagged. The client never re-derives the flag from a
hardcoded constant.

Display and styling preferences (Grouping and Name Picker Display options) are client-side localStorage
preferences with no endpoint, and are gated client-side only. This is deliberate and proportionate: they
are cosmetic, and bypassing the check yields nothing.

A gated endpoint reached by a `free` account returns **403 `PREMIUM_REQUIRED`**. The `message` names the
feature in plain language and carries no upsell copy; the client decides how to present the upgrade path.

### Soft delete
`DELETE` endpoints perform a soft delete (set `deletedAt`). Subsequent `GET` requests do not return soft-deleted records. The API does not expose a way to read or restore soft-deleted records in Phase 1.

### Authentication
Every endpoint except those under `/auth` requires an authenticated session, enforced by middleware at the router mount rather than per handler. A session is created by the OAuth callback and recorded server-side; the cookie carries only an opaque, signed session id, so signing out revokes the session immediately rather than waiting for a cookie to expire. Sessions last 30 days absolute, or 14 days idle, whichever comes first. Unauthenticated requests return `401 UNAUTHORIZED`.

### Consent
Every endpoint except those under `/auth`, the `/public` routers, and the Stripe webhook also requires the
account to have accepted the current terms and the data-responsibility acknowledgement (Phase 2 Step 5c).
Enforced by `requireConsent` at the router mount, alongside the session and CSRF gates and after both, so a
cross-site forgery is still reported as CSRF rather than as a consent prompt. Requests from an account that
has not accepted return `403 CONSENT_REQUIRED`.

The exceptions are exactly the routes a teacher needs in order to resolve it or leave: `/auth/consent`
records the acceptance, `/auth/me` is how the client learns it is needed, and `/auth/logout` is the exit for
a teacher who declines. Support is deliberately **not** an exception — the public contact form at `/contact`
needs no account at all, so nobody is left unable to ask a question about what they are being asked to sign.

The gate is server-side because a client-side prompt is defeated by calling the API directly, which would
leave the app reading and writing a teacher's student data on the strength of a checkbox that was never
ticked.

### Field validation
Every string field has a maximum length, enforced server-side via Zod. Lengths are listed inline with each schema. Requests that exceed any length, omit a required field, or include unexpected fields return `400 VALIDATION_ERROR`. Service functions never receive raw `req.body`; they receive only validated, typed objects.

### Sheet ID resolution
The server resolves the user's spreadsheet ID from the authenticated session, never from a request parameter. There is no `sheetId` field on any request body.

---

## Errors

All error responses share the shape:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable description, safe to surface to the user."
}
```

The `message` never contains stack traces, file paths, Google API error details, or student PII. The `code` is one of the values in the catalog below. Additional fields may appear on specific errors (e.g., `fieldErrors` for validation failures); they are noted where applicable.

### Error code catalog

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body, query params, or path params failed schema validation. Includes `fieldErrors: { [path]: string }`. |
| `UNAUTHORIZED` | 401 | No valid session. |
| `FORBIDDEN` | 403 | Authenticated, but the resource does not belong to the user (Phase 2 IDOR guard). |
| `CSRF_INVALID` | 403 | State-changing request with a missing or stale `X-CSRF-Token` header. The request had no effect; the client refreshes the token from `GET /auth/me` and retries once. |
| `NOT_FOUND` | 404 | Resource does not exist or has been soft-deleted. |
| `CONFLICT` | 409 | App-enforced uniqueness violation (e.g., duplicate `(studentId, date)`, conflicting grouping constraints). |
| `PREMIUM_REQUIRED` | 403 | Authenticated, but the account is on the `free` plan and the endpoint requires `trial` or `paid` (Phase 2). |
| `CONSENT_REQUIRED` | 403 | Authenticated, but the account has not accepted the current terms and data-responsibility acknowledgement (Phase 2 Step 5c). Every router except `/auth` and the public routes returns this until `POST /auth/consent` succeeds. |
| `DAILY_EMAIL_CAP` | 429 | The 200-email daily cap has been reached for this user. |
| `MONTHLY_EMAIL_CAP` | 429 | The `free` plan's 30-emails-per-calendar-month cap has been reached (Phase 2). Does not apply to `trial` or `paid`. |
| `EMAIL_RATE_LIMIT` | 429 | Burst send protection triggered. |
| `RATE_LIMITED` | 429 | Generic per-user rate limit. |
| `SHEET_RATE_LIMITED` | 429 | Google's Sheets API rejected the request for quota / rate-limit reasons (`RESOURCE_EXHAUSTED`). The request never took effect; the response carries a `Retry-After` header and the client retries with bounded backoff. |
| `SHEET_HEADER_MISMATCH` | 500 | Header validation invariant failed; the spreadsheet's row 1 does not match the expected column codes. |
| `SHEET_UNAVAILABLE` | 503 | Google Sheets API unreachable or returned an unrecoverable error. |
| `GMAIL_UNAVAILABLE` | 503 | Gmail API unreachable. |
| `REAUTH_REQUIRED` | 401 | The refresh token was revoked. The client should redirect to the OAuth flow. |
| `INTERNAL_ERROR` | 500 | Catch-all for unexpected failures. The message is generic. |

---

## Auth

### `GET /auth/google`
Starts the OAuth flow. The endpoint content-negotiates: browser navigation (HTML requested) receives a redirect to Google's consent screen; clients requesting JSON receive the URL instead.

**Response 302 (browser):** redirect to Google's consent screen.

**Response 200 (JSON requested)**
```json
{ "redirectUrl": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

The client navigates the browser to `redirectUrl`.

### `GET /auth/google/callback?code=...&state=...`
Handles the OAuth callback. Exchanges the authorization code for tokens, stores the refresh token, runs the spreadsheet bootstrap (see [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) Discovery), and redirects the browser to the app root. This endpoint is not consumed programmatically.

**Response:** 302 redirect to `/` on success, or to `/auth/error?code=<code>` on failure.

Google returns a failed consent as `error=...` with **no `code` parameter at all**, so the error branch is
evaluated before the `code`/`state` schema. The failure is classified into one of these codes (Phase 2 Step
5a), each of which the error page renders differently because they call for different actions:

| Condition | Code | What it means |
| --- | --- | --- |
| `error_subtype` or `error_description` contains `admin_policy_enforced` | `ADMIN_POLICY_BLOCKED` | The teacher's Workspace domain blocks unconfigured third-party apps. **Not retryable** — an admin has to allowlist the app (see `/for-admins`). |
| `error=access_denied` otherwise | `CONSENT_DECLINED` | The teacher dismissed the consent screen. Retryable. |
| any other `error` | `OAUTH_ERROR` | Google failed for some other reason. Retryable. |
| no `error`, but `code`/`state` missing or invalid | `VALIDATION_ERROR` | A malformed callback. Retryable. |

One further code is raised after a successful exchange rather than from Google's `error` parameter:

| Condition | Code | What it means |
| --- | --- | --- |
| the token response's `scope` lacks `drive.file` or `gmail.send` | `SCOPES_MISSING` | Google's granular consent let the teacher untick a required permission. No account row or session is written and the token is discarded, not revoked. Retryable. An absent `scope` field is treated as a full grant. |

`admin_policy_enforced` is checked in both `error_subtype` and `error_description` because Google signals it
in either depending on the flow. Nothing is exchanged or stored on the error path, so no state cookie is
verified; the only value carried to the redirect is a code chosen server-side, never one from the query
string.

### `GET /auth/me`
Returns the authenticated user's profile.

**Response 200**
```json
{
  "email": "teacher@example.com",
  "name": "Jane Doe",
  "avatarUrl": "https://lh3.googleusercontent.com/a/...",
  "csrfToken": "8f3a…",
  "plan": "trial",
  "trialEndsAt": "2026-08-27T00:00:00Z"
}
```

`plan` is `free`, `trial`, or `paid`, resolved server-side from the account record on every call. The
client uses it for presentation only (badges, disabled controls); it is never the security boundary.
`trialEndsAt` is present only when `plan` is `trial`.

`devTools` (boolean, Phase 2 Step 3) tells the client whether to render the development-only plan toggle
in the account menu. It is `true` only when the server is not in production **and** the session's
`google_sub` is in the `DEV_TOOLS_GOOGLE_SUBS` allowlist. It is a rendering hint, never a permission: the
toggle endpoint re-checks both conditions itself, so a client that sets the flag by hand gains nothing.

`hasBilling` (boolean, Phase 2 Step 3b) is whether a Stripe customer exists for this account. It decides
between offering "Upgrade" and "Manage billing" in the account menu, and it is **not** the same question as
the plan: a lapsed account is `free` but still has invoices, receipts, and a card worth managing, so both
can be offered at once.

`planOverride` (Phase 2 Step 3b) is the stored override — `free`, `trial`, `paid`, or `null` — and is
returned **only alongside `devTools`**, being a development concern with no place in an ordinary profile
payload. The toggle's label needs it because a forced plan and a cleared override can resolve to the same
plan (an account can resolve to the same plan with or without an override), so a label
derived from `plan` alone cannot tell the two apart.

`needsOnboarding` (boolean, Phase 2 Step 5a) is whether the account has yet to complete the first-run guide
— true until `POST /auth/onboarding/complete` has been called. Server state rather than a client-side flag,
so a teacher who signs in on a second device is not walked through it again. Unlike the hints above it gates
nothing at all, so there is nothing for any endpoint to re-check: forging it shows or skips a page of prose.

`hasStudents` (boolean, Phase 2 Step 6f) is whether this account has ever had a student. The account menu
offers "Getting started" only while it is false, so the first-run guide is a first-week affordance rather
than a permanent item. It is **not** the same question as `needsOnboarding`: skipping the guide completes
onboarding without adding anyone, and that teacher is exactly the one who should still be offered it. A
rendering hint like the others; forging it shows or hides a page of prose.

It is set server-side by a student create, a bulk add, **or a roster read that comes back non-empty**. The
last is what handles accounts that predate the column: nothing in our database knows whether such an account
has students, because the roster lives in the teacher's Google Sheet, so it converges on the next visit to
the roster rather than on a migration's guess. Write-once — it records activation, not the latest add.

`needsConsent` (boolean, Phase 2 Step 5c) is whether the terms and the data-responsibility acknowledgement
are still outstanding — true for an account that has never accepted, and true again after the terms version
is bumped. `termsVersion` accompanies it and is the version the client must echo back to `POST /auth/consent`.
Unlike `needsOnboarding` this **is** a permission, but it is not enforced from here: `requireConsent` re-reads
the account on every gated request, so a forged `false` buys nothing but an app shell whose every call comes
back `CONSENT_REQUIRED`.

`canCancel` (boolean, Phase 2 Step 6i) is whether there is a subscription worth offering to cancel, and it is
**not** `hasBilling`: the Stripe customer id and the subscription id both survive a cancellation, so an
account that cancelled last term has both and nothing left to cancel. Nor is it the plan — a `plan_override`
comp resolves to `paid` with no subscription behind it. The account page gates its cancellation row on this.

`paused` and `pauseResumesAt` (Phase 2 Step 6i) are present only while billing is paused. They are wording
rather than permission — a paused account already resolves to `free` — and they exist so the account page can
say "paused until 1 September" instead of leaving a teacher who chose the pause to conclude they had been
cancelled. `pauseAvailable` (boolean) is whether the cancellation flow should offer a pause; it is answered
from the account row alone, so it cannot check the monthly-only rule and is deliberately the weaker of the
two tests. `POST /billing/pause` re-checks everything, including the interval, and refuses.

`promoEndsAt` (Phase 2 Step 6i) is when a founding-user promo stops covering the subscription, absent when
there is none. Wording rather than permission, like the pause fields. It is **not** `currentPeriodEnd`: a
fully discounted subscription still renews monthly at zero, so the period end moves every month while this
date stays put.

`currentPeriodEnd` is present **only while there is a live subscription**, and that guard is the whole
reason it can be shown at all — Stripe reports a terminated subscription's original period end, so a
`canceled` account carries a date well in the future that would read as "access until". The cancellation
dialog needs it to tell a promo-covered teacher that cancelling ends their subscription at that date rather
than when the offer runs out, a distinction worth most of a free year to them.

`lapsedFrom` (`trial` | `subscription` | `paused`, Phase 2 Step 6h) is **why** a `free` account lost premium,
and is absent for one that never had it. It chooses the words on a locked control and never whether it locks.
It replaced a single "the trial expired" flag, which was true of every lapsed account whatever had actually
happened — so a teacher who paid for a year and cancelled, and one whose subscription was merely paused, were
both told about a trial that ended long before. Resolution is most-recent-cause-first: a pause outranks
everything because it is not a loss, then a subscription (the id is never cleared, so holding one is the
record that an account had one), then the trial.

`csrfToken` is the session's CSRF token (see [CSRF](#csrf)). This endpoint is the client's only source for it; the client calls it on load, before any state-changing request is possible.

**Response 401:** `UNAUTHORIZED`.

### `POST /auth/onboarding/complete`
Records that the teacher has finished the first-run guide. Session-gated and CSRF-checked like any other
write. **Idempotent and write-once:** a repeat call leaves the original timestamp alone, so a double submit,
a retry, or re-opening the guide from the account menu are all safe.

Takes no body. The client calls it when leaving the guide and does not wait on the result — the flag is
cleared locally either way, so a failed write costs the teacher seeing the guide once more rather than
holding them on it.

**Response 204:** no body.

**Response 401:** `UNAUTHORIZED` with no session.

**Response 403:** `CSRF_INVALID` when a session exists but the header is missing or stale.

### `POST /auth/consent`
Records the teacher's acceptance of the terms and privacy policy, and — separately — of the
data-responsibility acknowledgement (Phase 2 Step 5c). Session-gated and CSRF-checked.

```json
{ "termsVersion": "2026-08-13", "acceptedTerms": true, "acceptedDataResponsibility": true }
```

All three fields are required and `.strict()`. Both flags must be **literally `true`**: an omitted field is
a client bug, and defaulting it to consent is the one mistake this endpoint exists to prevent. Two separate
flags rather than one, because these are two agreements — bundling them would make the record of the second,
which is the one that matters most for this product, materially weaker.

`termsVersion` must equal the server's current version (`CURRENT_TERMS_VERSION`, reported by `/auth/me`);
the value above is illustrative and moves every time the documents change substantively. A mismatch is a
`VALIDATION_ERROR` rather than a silent acceptance, so a stale cached client cannot record agreement to text
the teacher was never shown; the reload that follows puts the current wording in front of them.

**Not idempotent, unlike `/auth/onboarding/complete`.** A repeat call overwrites both timestamps and the
version. That is the point of versioning consent: when the terms change, the teacher is genuinely accepting
again, and preserving the old timestamp would record them as having agreed to the current text before it
existed.

**Response 204:** no body. The client re-reads `/auth/me` rather than trusting its own success.

**Response 400:** `VALIDATION_ERROR` on a missing flag, a `false` flag, an unexpected field, or a stale
version. Nothing is recorded.

**Response 401:** `UNAUTHORIZED` with no session.

**Response 403:** `CSRF_INVALID` when a session exists but the header is missing or stale.

### `POST /auth/logout`
Revokes the session server-side (the session record is deleted, so the cookie cannot be replayed) and clears the session cookie. Requires the CSRF header, like any other state-changing request. Calling it without a session is a no-op that still returns 204.

**Response 204:** no body.

**Response 403:** `CSRF_INVALID` when a session exists but the header is missing or stale.

### `DELETE /auth/sessions`
Ends **every** session on the account, including the calling one (Phase 2 Step 6f). Session-gated and
CSRF-checked. The session cookie is cleared on the response, so the calling browser is signed out as a
consequence and the client must navigate somewhere public.

Not "all sessions except this one": that would be a different feature needing a list of devices to choose
from, and this one is the panic button for a teacher who has left themselves signed in on a classroom
computer. It is on the auth router deliberately — the same family as logout, and exempt from the consent
gate, which a teacher declining the terms needs it to be.

**Response 204:** no body.

**Response 401:** `UNAUTHORIZED` with no session.

**Response 403:** `CSRF_INVALID` when a session exists but the header is missing or stale.

### `DELETE /auth/account`
Deletes the account (Phase 2 Step 6f). Session-gated and CSRF-checked. Irreversible.

Four steps, in this order:

1. **Cancel the Stripe subscription**, immediately rather than at period end, if one exists. **A failure
   here aborts the whole operation and nothing is deleted** — a subscription that outlives its account keeps
   charging a card with nothing left that could stop it, since the portal is reached through a session that
   no longer exists.
2. **Revoke the Google refresh token**, so the grant disappears from the teacher's own list of authorized
   apps. Best-effort: a token Google will not revoke is usually one it already considers dead, and the row
   holding it is about to be destroyed either way. Failure is logged and the deletion proceeds.
3. **Revoke every session**, explicitly rather than relying on `ON DELETE CASCADE`.
4. **Delete the account row.** Sessions and support requests follow it through their foreign keys.

**It does not touch the teacher's spreadsheet**, which stays on their Drive with everything in it. The
client's confirmation dialog leads with that fact.

There is deliberately no unauthenticated deletion path. A teacher who cannot sign in — a blocked domain, or
access already revoked — asks through the contact form, which the public "Managing your data" page tells
them to do.

**Response 204:** no body. The cookie is cleared.

**Response 401:** `UNAUTHORIZED` with no session.

**Response 403:** `CSRF_INVALID` when a session exists but the header is missing or stale.

**Response 500:** `INTERNAL_ERROR` when the subscription could not be cancelled. The message names the
condition and the action that clears it, and is safe to show the teacher; nothing has been deleted.

---

## Bootstrap

### `GET /bootstrap/status`
Reports whether the user's spreadsheet is present and healthy.

**Response 200**
```json
{
  "spreadsheetReady": true,
  "schemaVersion": "4",
  "headerValidation": "ok"
}
```

`headerValidation` is one of `ok` or `mismatch`. If `mismatch`, every other endpoint will return `SHEET_HEADER_MISMATCH` until the discrepancy is resolved.

---

## Students

The `Student` resource shape (used in responses):

```ts
{
  id: string;             // ULID
  firstName: string;      // 1..80
  lastName: string;       // 1..80
  goesBy: string | null;  // 0..80
  pronouns: string | null;// 0..40
  courses: string[];      // 1..20 entries, each 1..60; the student's course enrollments
  atRiskCourses: string[];// subset of `courses` flagged as at academic risk (read-only here)
  studentEmail: string | null;   // valid email, 0..254
  parentEmails: string[];        // each entry valid email, 0..254; max 5 entries
  notes: string | null;          // 0..2000
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

`parentEmails` is exposed as a JSON array. The Sheets layer joins/splits on `|` per the schema's pipe-delimited convention.

`courses` is the student's set of course enrollments. It is stored in the `enrollments` tab (one row
per `(studentId, course)`), not on the student row, but the API exposes it as an array on the student
for convenience — there are no separate enrollment endpoints in Phase 1. On `POST`/`PUT`, the server
diffs the submitted `courses` against the student's active enrollments, appending new ones and
soft-deleting removed ones. Duplicate course names within one request are rejected with
`VALIDATION_ERROR`.

`atRiskCourses` is the subset of `courses` flagged as at academic risk (a per-`(student, course)`
boolean on the enrollment row). It is read-only on the `Student` object; it is toggled through the
dedicated `PUT /students/:studentId/at-risk` endpoint, not through `POST`/`PUT /students`.

### `GET /students`
Returns all active students.

**Query parameters:** none in Phase 1. Filter and sort happen client-side.

**Response 200**
```json
[ { "id": "...", "firstName": "...", ... }, ... ]
```

### `GET /students/risk-summary`
Returns, for every active student, the warning indicators shown on the roster: the courses in which they are flagged as at academic risk, and the courses in which they cross the high-absence threshold. The specific courses are returned so the roster can name them in a tooltip. This is a roster read optimization and must be routed before `GET /students/:id` so the literal path is not captured as an `:id`.

**Query parameters:** none.

**Response 200**
```ts
Array<{
  studentId: string;
  atRiskCourses: string[];      // courses flagged at academic risk (stored flag)
  highAbsenceCourses: string[]; // courses over the high-absence threshold (computed)
}>
```

Every active student appears exactly once. `atRiskCourses` reflects the stored per-enrollment flag; `highAbsenceCourses` is computed from attendance and never stored. The high-absence threshold is the single app-wide definition (over 15% absence rate with at least 5 recorded days) — see [Attendance](#attendance).

### `POST /students`
Creates a student.

**Request body**
```ts
{
  firstName: string;
  lastName: string;
  goesBy?: string | null;
  pronouns?: string | null;
  courses: string[];      // 1..20 entries, each 1..60; at least one required
  studentEmail?: string | null;
  parentEmails?: string[];
  notes?: string | null;
}
```

Unexpected fields are rejected with `VALIDATION_ERROR`. `courses` must contain at least one entry and
no duplicates.

**Response 201:** the created `Student`.

### `POST /students/batch`
Creates many students in one request, backing the bulk-add grid. Server-side this is one Sheets append
for all `students` rows and one for all their `enrollments` rows, rather than a create call per student.

**Request body**
```ts
{
  students: Array<{  // 1..100 entries; each element is the POST /students body
    firstName: string;
    lastName: string;
    goesBy?: string | null;
    pronouns?: string | null;
    courses: string[];      // 1..20 entries, each 1..60; at least one required
    studentEmail?: string | null;
    parentEmails?: string[];
    notes?: string | null;
  }>;
}
```

Each element is validated by the same schema as `POST /students`; any invalid element (or an unexpected
field, an empty array, or more than 100 entries) rejects the **whole** request with `VALIDATION_ERROR`
and creates nothing. The operation is all-or-nothing: on an append failure no students are created.

**Response 201:** `Student[]`, in request order.

### `GET /students/:id`
Returns a single student.

**Response 200:** a `Student`.
**Response 404:** `NOT_FOUND`.

### `GET /students/:id/detail`
Returns a student's profile for the detail view, resolving it from cache or from a single batched Sheets read. It carried the student's IEP accommodations alongside the profile until Phase 2 Step 8a removed that surface; the response stays an object with one field rather than collapsing to a bare `Student`, because the detail view is where a second per-student resource would land if one is ever added.

**Response 200:** `{ student: Student }`.
**Response 404:** `NOT_FOUND`.

### `PUT /students/:id`
Updates a student. All fields in the request body are optional; omitted fields are not modified. Pass `null` explicitly to clear a nullable field. Unexpected fields are rejected. When `courses` is supplied it replaces the student's enrollment set (the server diffs and applies adds/removals); if `courses` is present it must still contain at least one entry.

**Response 200:** the updated `Student`.
**Response 404:** `NOT_FOUND`.

### `DELETE /students/:id`
Soft-deletes the student and cascades the soft delete to the student's enrollment rows and attendance rows. It cascaded into the `iep` tab until Step 8a; rows already written there for a student deleted after that are left active, which is inert because nothing reads the tab (see SHEETS_SCHEMA.md).

**Response 204:** no body.
**Response 404:** `NOT_FOUND`.

### `PUT /students/:studentId/at-risk`
Sets the academic-risk flag for one of the student's courses (the per-`(student, course)` boolean on the enrollment row).

**Request body**
```ts
{
  course: string;   // 1..60; must be an active enrollment for this student
  atRisk: boolean;
}
```
Unexpected fields are rejected.

**Response 200:** `{ studentId: string, course: string, atRisk: boolean }`.
**Response 404:** `NOT_FOUND` when the student has no active enrollment in that course.

---

## Attendance

The `AttendanceRecord` resource shape:

```ts
{
  id: string;
  studentId: string;
  course: string;             // the enrolled course this record is for
  date: string;               // YYYY-MM-DD
  statusKey: "p" | "a" | "t" | "e";
  notes: string | null;       // 0..500
}
```

**No `createdAt` / `updatedAt`, unlike every other resource here.** Both are still written to the sheet;
neither is returned. Nothing in the client has ever rendered them, and attendance is the largest thing the
server holds in memory — two ISO strings on every row cost about a quarter of it (Step 6d).

Attendance is taken per class, so a record is keyed on `(studentId, course, date)`. A student in two
of the teacher's sections has an independent record in each on the same day.

**The wire format is unchanged by Step 6k, but the storage behind it is not.** From schemaVersion 5 only
non-present marks are stored, with *present* inferred from a class-day marker and the absence of a row.
The read endpoints expand that back out, so `GET /attendance` and `GET /attendance/range` return exactly
the dense per-student records they always did. Three consequences are visible through the API:

- **A record with an id beginning `~p:` exists only by inference.** There is no row behind it and
  `PUT /attendance/:id` will not find it. Correct a present student through `POST /attendance` like any
  other mark.
- **A day nobody recorded returns no records at all**, where a day everyone was present returns a present
  record for each enrolled student. These are different answers, which is the point of the marker.
- **A student is only expanded from their enrollment's `startDate`**, when one is set. A mark actually
  recorded before that date is still returned: the bound suppresses inference, never a stored fact.

### `GET /attendance?date=YYYY-MM-DD&course=...`
Returns attendance records for a single date. Used to populate the entry view when the teacher selects a past date.

**Query parameters**
- `date` (required): `YYYY-MM-DD`.
- `course` (optional): scope the result to a single course. Omitted returns every course's records for the date.

**Response 200:** `AttendanceRecord[]`.

### `GET /attendance/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&course=`
Returns attendance records within a date range, inclusive on both ends. Underlies the student-detail heatmap and the Attendance History view.

- `startDate`, `endDate` (required): inclusive bounds; `startDate` must not be after `endDate`.
- `course` (optional): scope the result to a single course, mirroring `GET /attendance`. Omitted returns every course's records in the range. The History view always passes it (the view is single-class); the student-detail heatmap omits it and filters client-side, as it does today.

**Response 200:** `AttendanceRecord[]`.

### `POST /attendance`
Submits attendance for a set of students in one course on a given date. The request is atomic: either every entry is written, or none is. Submitting for a `(course, date)` that already has records overwrites the existing records for the listed students in that course (it does not affect students absent from the request or records in other courses).

`date` must be a weekday. Saturdays and Sundays are non-instructional and are rejected with `VALIDATION_ERROR`; no write occurs. This is a defensive server-side guard — the entry UI already disables weekend submission.

**Request body**
```ts
{
  date: string;               // YYYY-MM-DD
  course: string;             // 1..60; the course being recorded
  entries: Array<{
    studentId: string;
    statusKey: "p" | "a" | "t" | "e";
    notes?: string | null;
  }>;
}
```

`entries` must have at least one item and at most 200. Every `studentId` must be actively enrolled in `course`.

**Response 200**
```json
{ "written": 28 }
```

**Response 400:** `VALIDATION_ERROR` (unknown `course`, any `studentId` not enrolled in `course`, or any duplicate `studentId` within `entries`). No partial write occurs.

### `PUT /attendance/:id`
Edits a single attendance record. Used for after-the-fact corrections.

**Request body**
```ts
{
  statusKey?: "p" | "a" | "t" | "e";
  notes?: string | null;
}
```

**Response 200:** the updated `AttendanceRecord`.

**Setting `statusKey` to `p` soft-deletes the row** (stamps `deletedAt`), since present is stored as the
absence of an *active* one. The row stays on the tab, as every soft delete in this schema does. The day
stays taken — its class-day marker is untouched — and any note on the row goes with it, because there is
nothing left to hang it on. The response is the record as it now reads: present, at an inferred id.

**Response 404:** `NOT_FOUND` for an unknown id, for a `~p:` inferred id, and for a class-day marker's id.
Markers are not addressable through this endpoint: editing one into a student status, or deleting it, would
change what an entire class-day means.

### `GET /attendance/stats?startDate=&endDate=&course=`
Returns aggregate statistics per `(student, course)` across all active enrollments.

**`daysRecorded` counts class-days, not the student's own rows** (schemaVersion 5). A student with no
absences reads as present on every day the register was taken for their class, rather than as having no
data. Days before the enrollment's `startDate` are excluded, so a student who joined mid-year is not
credited with attendance from before they arrived; a day they actually have a mark on always counts. If `startDate` and `endDate` are omitted, the statistics cover all recorded attendance data. The client passes an explicit range to scope the view; the server defines no school-year boundary. An optional `course` query scopes the result to a single course; omitted returns one row per `(student, course)` enrollment, so a student in two courses appears twice (once per class).

**Response 200**
```ts
Array<{
  studentId: string;
  course: string;
  totalAbsences: number;
  totalTardies: number;
  totalExcused: number;
  daysRecorded: number;
  absenceRate: number;          // 0..1, absences / daysRecorded; 0 if daysRecorded == 0
  consecutiveAbsences: number;  // current streak, computed from the most recent recorded days
}>
```

Weekend-dated records (should any exist) are excluded from every aggregate, including `daysRecorded` and the `consecutiveAbsences` streak, so an intervening weekend never breaks a streak of school-day absences.

The single-student attendance summary and the attendance heatmap on the student detail page both read from attendance endpoints (`stats` and `range` respectively) and filter client-side. For a student in more than one course, the detail page offers a class dropdown that scopes both to the selected course (passing `course` to `stats` and filtering `range` records by course); a single-course student is shown that one course's data.

---

## Email Templates

The `EmailTemplate` resource shape:

```ts
{
  id: string;
  name: string;               // 1..120
  subject: string;            // 1..200
  bodyHtml: string;           // 1..50000, output from the rich-text editor
  placeholdersUsed: string[]; // each entry matches /^[a-zA-Z][a-zA-Z0-9]{0,40}$/
  createdAt: string;
  updatedAt: string;
}
```

`bodyHtml` is the rich-text editor's serialized output. The server validates that it contains only an allowlisted set of tags and attributes (no `<script>`, no event handlers, no `style` attributes). Raw HTML authored outside the editor is rejected.

A block element (`p`, `ul`, `ol`, `li`) may carry a `data-if` conditional attribute so those lines only send to recipients whose data matches. Its value is a bounded, space-separated triple — never an expression — parsed by a fixed grammar:

- `<numericMetric> gte <0..999>`, where `numericMetric` is `lateCount` or `unexcusedAbsences` (e.g. `lateCount gte 3`)
- `<booleanMetric> is <true|false>`, where `booleanMetric` is `atRisk` (e.g. `atRisk is true`). `hasAccommodations` was a second boolean metric until Step 8a retired it with the IEP surface; it no longer parses, so a template saved before that has the block dropped at send time and fails validation on the next save.

A body whose `data-if` value does not match the grammar is rejected with `VALIDATION_ERROR`. The attribute is preserved on the saved template and evaluated per recipient at send time (see [Email Send](#email-send)); it is stripped from the final message.

### `GET /email/templates`
**Response 200:** `EmailTemplate[]`.

### `POST /email/templates`
**Request body:** `{ name, subject, bodyHtml, placeholdersUsed }`.
**Response 201:** the created `EmailTemplate`.

### `GET /email/templates/:id`
**Response 200:** an `EmailTemplate`.

### `PUT /email/templates/:id`
**Request body:** all fields optional.
**Response 200:** the updated `EmailTemplate`.

### `DELETE /email/templates/:id`
**Response 204.**

---

## Email Send

### `POST /email/send`
Sends an email to a set of student-derived recipients. The server resolves recipient addresses from the student records — the client selects addresses **by position, never by value**, so a client can never inject an arbitrary student/guardian recipient. This is load-bearing for security (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Email Security). The one exception is the optional `copyAddress` (see below), which is a deliberate teacher-entered CC/BCC recipient, validated as an email.

**Request body**
```ts
{
  templateId: string;             // required; one-off sends still go through a saved template in Phase 1
  recipients: Array<{
    studentId: string;
    course: string;                 // the course this send is for; scopes the course/attendance placeholders
    includeStudent: boolean;        // send to the student's own email if one is on file
    includeParents: boolean;        // send to every guardian email on the student's record
  }>;
  placeholderValues?: {
    [studentId: string]: { [placeholder: string]: string }; // optional per-student overrides
  };
  copyAddress?: string;             // optional; valid email, <=254. CC'd/BCC'd on every message.
  copyMode?: "cc" | "bcc";          // defaults to "bcc" when copyAddress is present
}
```

`recipients` must have at least one and at most 200 entries. A student enrolled in more than one course appears as one entry per course when selected in multiple classes; the same address may therefore receive one message per course, each with that course's placeholders.

The server:
1. Looks up each `studentId` and resolves the selected addresses: the `studentEmail` when `includeStudent` is true, plus every `parentEmails` entry when `includeParents` is true.
2. Skips students not found (`student_not_found`) or with no resolvable selected address (`no_email`) and reports them in `skipped`.
2a. Validates each resolved address against the same schema the write path enforces, and reports any that fail as `invalid_address` in `failed`. The spreadsheet is editable by hand, so an address read back from it has not necessarily been through the app's validation; an unusable one is reported rather than silently dropped, and no `emailLog` row is written for it because no send was attempted. A student with one usable address and one unusable one is still sent to on the usable one.
3. Evaluates each conditional block (`data-if`) in `bodyHtml` for this `(student, course)` and drops the blocks whose condition is false, then strips the markers. `atRisk` is true when the student is flagged at academic risk in this `(student, course)`; `lateCount` / `unexcusedAbsences` are that course's totals. A malformed or retired condition fails closed, so the block is dropped rather than sent.
4. Renders the template's `subject` and `bodyHtml` with placeholder substitution. Default placeholder values come from the student record (`firstName`, `lastName`, `goesBy`, `pronouns`) plus `courseName` = the entry's `course` and that course's attendance totals (`lateCount` = tardies, `unexcusedAbsences` = absences, for that `(student, course)`). Per-student overrides in `placeholderValues` take precedence. Body substitutions are HTML-escaped. The rendered subject is folded to a single line, covering both the substituted values and the template's own text, and a subject containing a line break is rejected at save time; a line break in any header value is refused outright when the message is built.
5. Calls Gmail to send each message, from the authenticated teacher's own address, with `copyAddress` added as a `Cc`/`Bcc` header when present.
6. Writes one row per send to the `emailLog` tab (the copy recipient is a header on each message and is not logged separately).

**Response 200**
```ts
{
  sent: number;
  // "invalid_address" | "daily_cap" | "send_failed"
  failed: Array<{ studentId: string; reason: string }>;
  skipped: Array<{ studentId: string; reason: "no_email" | "student_not_found" }>;
}
```

**Response 429:** `DAILY_EMAIL_CAP` (with `message` indicating the cap and reset time), `MONTHLY_EMAIL_CAP`, or `EMAIL_RATE_LIMIT`.

The daily cap is a per-account counter in Postgres (`users.daily_email_date` / `daily_email_count`), reset on the first send of a new UTC day. It is **claimed before the messages are sent**, not counted after: the claim and the read are one atomic statement, so two concurrent sends cannot both find the day clear. Whatever is claimed and not sent — messages the cap stopped, and messages Gmail refused — is returned at the end of the batch, so only what actually left counts against the day.

It is deliberately **not** derived from `emailLog`. That tab lives in the teacher's own spreadsheet and is editable by hand, so counting it made a hard limit resettable by deleting rows. `emailLog` remains the audit record and nothing else, which is the same reasoning already applied to the free plan's monthly allowance.

**Free-plan monthly cap (Phase 2).** A `free` account is additionally capped at **30 sends per calendar month** (UTC), counted the same way over the current month, as an integer in Postgres. `trial` and `paid` accounts are not subject to it. Both caps apply to a `free` account and the **lower remaining allowance wins**; a request whose recipient count would cross either cap is rejected in full before any message is sent, so a send is never partially applied because of a cap. The monthly counter is not a rolling window — it resets at the start of each calendar month, which is simpler to explain to a teacher and aligns with how they think about reporting periods.

### `GET /email/recipient-metrics`
Per-(student, course) attendance figures for the Compose view: the `lateCount` / `unexcusedAbsences`
placeholder previews and the "High absences" quick select.

**Not gated.** The Email tool and its attendance conditions are free-tier, so they get their own read
rather than depending on the premium `GET /attendance/stats`. The endpoint returns only the figures the
email tool uses, not the full statistics row.

**Response 200**
```ts
Array<{
  studentId: string;
  course: string;
  lateCount: number;           // tardies for this (student, course)
  unexcusedAbsences: number;
  daysRecorded: number;
  highAbsence: boolean;        // computed with the account's effective threshold
}>
```

### `GET /email/send-status`
Returns the user's current daily send count and remaining quota. Used by the client to show a quota indicator before the teacher commits to a large send. In Phase 2 this also reports the plan state and, for `free` accounts, the monthly count and remaining monthly allowance, so the client can show the more binding of the two limits.

**Response 200**
```json
{ "sentToday": 47, "dailyCap": 200, "remaining": 153 }
```

**Response 200 (Phase 2, `free` account)**
```json
{
  "sentToday": 4,
  "dailyCap": 200,
  "remaining": 18,
  "plan": "free",
  "sentThisMonth": 12,
  "monthlyCap": 30,
  "remainingThisMonth": 18,
  "monthlyResetsAt": "2026-08-01T00:00:00.000Z"
}
```

`remaining` is always the **lower** of the two allowances, so a client that reads only that field cannot
overstate what a teacher may send. On `free` the client shows the monthly figures — the limit that actually
binds — rather than the daily one. `monthlyResetsAt` is the first instant of the next UTC calendar month,
so a capped account can be told when its allowance comes back rather than merely refused. `trial` and
`paid` accounts omit every monthly field; `plan` is present on both.

---

## Attendance Rules (deferred — Phase 3 candidate)

> Automated Attendance Communications (originally Phase 1 Step 6) was tabled and moved to Phase 3 as a
> candidate feature. The endpoints below are **provisional** and predate both that decision and the
> 2026-09-09 lever expansion. Three known changes before this is built: absence rules are to be scoped
> **per course**, so the queue shape gains a course dimension; the dedupe key gains a **period**
> dimension, because a recurring-cadence rule is meant to re-queue the same `(rule, student)` each
> period; and `ruleTypeKey` needs a value for **cumulative absences** plus a representation for a
> cadence rule, which is configured by a period rather than by `threshold`/`windowDays`. See
> [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3 for the current design decisions, including
> the reaffirmed rule that no send is ever unattended.

The `AttendanceRule` resource shape:

```ts
{
  id: string;
  ruleTypeKey: "absencesInWindow" | "consecutiveAbsences" | "tardyCount";
  threshold: number;            // positive integer
  windowDays: number | null;    // required for absencesInWindow; null otherwise
  templateId: string;           // FK to EmailTemplate
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### `GET /attendance/rules`
**Response 200:** `AttendanceRule[]`.

### `POST /attendance/rules`
**Request body:** all fields except `id`/`createdAt`/`updatedAt`.
**Response 201:** the created `AttendanceRule`.

### `PUT /attendance/rules/:id`
**Response 200:** the updated `AttendanceRule`.

### `DELETE /attendance/rules/:id`
**Response 204.**

---

## Attendance Queue (deferred — Phase 3 candidate)

> Provisional and predates the tabling decision; see the note under Attendance Rules above. The dedupe
> key and `QueueItem` shape are to gain a course dimension (per-course absence scope) and a period
> dimension (recurring-cadence rules). Batch approval, which a cadence rule needs and per-item approval
> serves badly, is an open design question rather than a settled endpoint shape.

The `QueueItem` resource shape:

```ts
{
  id: string;
  ruleId: string;
  studentId: string;
  triggeredAt: string;
  statusKey: "pending" | "approved" | "rejected" | "sent";
  reviewedAt: string | null;
  sentLogId: string | null;
}
```

Rule evaluation queues at most one item per `(ruleId, studentId)` pair, regardless of status — a student who already has a queue item for a rule is never re-queued by that rule. Phase 1 has no repeat option. In Phase 1, approval transitions `statusKey` directly from `pending` to `sent`; the `approved` value is reserved for a future asynchronous send path.

### `GET /attendance/queue?status=pending`
Returns items in the queue. The `status` query parameter is optional; if omitted, returns all non-`sent` items.

**Response 200:** `QueueItem[]`.

### `POST /attendance/queue/:id/approve`
Approves a queued item and dispatches the email through the same path as `POST /email/send` (subject to the same caps and rate limits). Sets `statusKey = "sent"` and `sentLogId` on success.

**Response 200**
```json
{ "id": "...", "statusKey": "sent", "sentLogId": "..." }
```

**Response 429:** `DAILY_EMAIL_CAP` or `EMAIL_RATE_LIMIT`. The queue item remains `pending`.

### `POST /attendance/queue/:id/reject`
Marks the item as `rejected`. No email is sent.

**Response 200:** the updated `QueueItem`.

---

## Grouping (Phase 1 Step 7)

The `Grouping` resource shape (returned by `generate` and `current`):

```ts
{
  id: string | null;          // null until saved
  groupSize: number | null;   // the size parameter used; null if generated by group count
  groupCount: number | null;  // the count parameter used; null if generated by group size
  groups: Array<{
    studentIds: string[];
  }>;
  generatedAt: string;
  savedAt: string | null;
}
```

Exactly one of `groupSize` / `groupCount` is non-null, matching the parameter used at generation time.

The `GroupingConstraint` resource shape:

```ts
{
  id: string;
  constraintTypeKey: "together" | "apart";
  studentIds: string[];       // 2..10 entries
  notes: string | null;       // 0..200
  createdAt: string;
  updatedAt: string;
}
```

### `POST /grouping/generate`
Generates groups without persisting. Constraints stored via the constraints endpoints below are applied automatically; ad-hoc constraints can be passed in the request body for one-off use.

**Request body**
```ts
{
  course: string;             // 1..60; the class to group. The server resolves the population
                              // from this course's active enrollments — the client never sends
                              // a student list (mirrors the attendance/email "scope by course"
                              // pattern and keeps population resolution server-side).
  groupSize?: number;         // 2..10; target students per group
  groupCount?: number;        // 2..20; target number of groups
  adHocConstraints?: Array<{
    constraintTypeKey: "together" | "apart";
    studentIds: string[];     // 2..10 entries
  }>;
}
```

Exactly one of `groupSize` or `groupCount` must be provided; supplying both or neither returns `VALIDATION_ERROR`. The grouping is scoped to one class at a time (Step 7 is class-scoped per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)); students enrolled in `course` form the population, and stored/ad-hoc constraints are filtered to that population (constraints naming students outside it are ignored).

**Response 200:** a `Grouping` with `id: null` and `savedAt: null`.
**Response 409:** `CONFLICT` (constraints are unsatisfiable, e.g., the same pair is both `together` and `apart`).

### `PUT /grouping/current`
Upserts the **current** grouping for a course, overwriting any prior one (see
[SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) — each course keeps exactly one active grouping). This is the
auto-save endpoint: the client calls it after every change (generate, drag a student between groups,
renumber groups), so the class's grouping is persisted until it changes again. There is no separate
"save" step and no multi-grouping history.

**Request body**
```ts
{
  course: string;             // 1..60; the class this grouping belongs to
  groupSize?: number;         // exactly one of groupSize / groupCount, as in generate
  groupCount?: number;
  groups: Array<{ studentIds: string[] }>;  // 1..100 groups; a group may be empty after edits
}
```

**Response 200:** the saved `Grouping` with `id` and `savedAt` set.

### `GET /grouping/current?course=...`
Returns the saved grouping for a course, restored when the grouping page opens or the class changes.

**Query parameters**
- `course` (required): `1..60`.

**Response 200:** a `Grouping`, or `null` when the class has no saved grouping.

### `GET /grouping/constraints`
**Response 200:** `GroupingConstraint[]`.

### `POST /grouping/constraints`
**Request body:** `{ constraintTypeKey, studentIds, notes? }`.
**Response 201:** the created `GroupingConstraint`.

### `PUT /grouping/constraints/:id`
**Response 200:** the updated `GroupingConstraint`.

### `DELETE /grouping/constraints/:id`
**Response 204.**

---

## Name Picker (Phase 1 Step 8)

The name picker uses `GET /students` and runs the selection animation entirely client-side. No new endpoints.

---

## Internal endpoints

Not part of the product surface and not called by the client UI. Listed here so the shape is recorded
rather than discovered in the route file. Both sit behind an authenticated session like every other
router, and each adds its own guard on top of that.

**The two guards are different on purpose.** The metrics read takes the **operator allowlist**
(`SUPPORT_ADMIN_GOOGLE_SUBS`) and nothing else, because reading the counters is a production task. The plan
toggle takes the **development pair** — the `DEV_TOOLS_GOOGLE_SUBS` allowlist *and* a non-production
`NODE_ENV` — because a live entitlement endpoint has no business existing in production at all. Both answer
**404, not 403**, on refusal: a 403 confirms the endpoint exists to anyone probing for it.

### `GET /api/health`
Unauthenticated. The platform's health check, and the only endpoint outside `/auth` and the Stripe webhook
that is not session-gated.

**Response 200:** `{ "status": "ok" }` — the process is up and Postgres answered.

**Response 503:** `{ "status": "degraded" }` — Postgres did not answer within 3 seconds. Deliberately carries
no detail: the response is public and the failure would otherwise describe the connection. The reason is in
the log.

It probes the database rather than answering unconditionally, because an instance that cannot reach Postgres
serves nothing and would otherwise keep reporting healthy through the one outage that matters. Note what it
does **not** check: Google API reachability. A failing health check restarts the instance, restarting cannot
fix a Google outage, and including it would convert someone else's downtime into a restart loop of our own.

### `GET /internal/metrics`
A rolling per-minute count of outbound Google API calls, by service, method, and result — the gauge for how
close aggregate load is to the shared Sheets quota ceiling (see the read-quota strategy under Decisions
Made in [HISTORY.md](HISTORY.md)). Carries no student PII: counts, method names, and a window length only.

**Response 200:**
```json
{
  "windowSeconds": 60,
  "totalCalls": 2,
  "byResult": { "ok": 1, "rate_limited": 1 },
  "byMethod": [{ "service": "sheets", "method": "values.batchGet", "total": 2 }]
}
```

The response also carries a `workingSet` block, the read-side cache's own counters (Step 6a, re-shaped in
6d). Counts and byte totals only; no keys, no user identifiers, nothing derived from student data.

```json
{
  "workingSet": {
    "residentEntries": 14,
    "residentUsers": 2,
    "residentBytes": 16384000,
    "maxBytes": 268435456,
    "hits": 91, "misses": 12, "coalesced": 3,
    "evicted": { "idle": 4, "stale": 1, "capacity": 0, "explicit": 2 },
    "hitRate": 0.883
  }
}
```

`residentBytes` against `maxBytes` is the memory headroom; `evicted.stale` against `hits` is the share of
reloads the working set is not absorbing, which is the size of the prize for Drive push invalidation.
**`maxBytes` replaced a `maxEntries` field in 6d**, when the ceiling was measured and turned out to be
counting the wrong thing — attendance is 98% of a teacher's footprint, so entries and memory were unrelated.

**Response 404:** when the session's `google_sub` is absent from `SUPPORT_ADMIN_GOOGLE_SUBS`. This is
service telemetry written for whoever runs the app, not for a teacher.

### `POST /internal/dev/plan`
Steps the authenticated account's **plan override** through
`none` → `free` → `trial` → `paid` → `none`, by writing `plan_override`. It never touches the
Stripe-managed subscription fields, so billing state and app state cannot drift apart. Used by the
account-menu toggle during manual testing.

The cycle steps on the **stored override**, not on the resolved plan, and the difference is load-bearing.
An account with an unexpired trial *and* an active subscription resolves to `trial` the moment the override
clears; stepping on the resolved plan therefore looped `trial` → `paid` → clear → `trial` forever, never
reaching `free`, with the cleared position indistinguishable from a forced `trial`. Stepping on the stored
value visits all four positions whatever the account's real plan is.

The fourth position clears the override, which is what makes the toggle reversible. Without it, the first
call pins the account permanently and silently masks a real subscription, `plan_override` outranking
subscription state by design.

**Request:** no body.

**Response 200** — `plan` is what now applies (after clearing, whatever the trial and subscription actually
say), and `override` is what was stored.
```json
{ "plan": "trial", "override": "trial" }
```

**Response 404:** when `NODE_ENV === 'production'`, or when the session's `google_sub` is absent from
`DEV_TOOLS_GOOGLE_SUBS`. Deliberately `NOT_FOUND` rather than `FORBIDDEN`: a 403 would confirm the
endpoint exists to anyone probing for it, and in production the honest answer is that it does not.

---

## Classes (Class archiving — Phase 2 Step 6e)

Classes become addressable for the first time here. Until this step a class was only a string on enrollment
rows; see `courses` in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md).

### `GET /classes`
Every class the teacher has, live and archived, for the Manage Classes tab of the Students page.

```json
{
  "live": [{ "id": "…", "name": "Period A Science", "createdAt": "…", "studentCount": 28 }],
  "archived": [
    { "id": "…", "name": "Period A Science", "createdAt": "…", "archivedAt": "…", "studentCount": 28 }
  ]
}
```

`studentCount` and the two dates are what let a teacher tell three classes called "Period A Science" apart in
the dialog; the name alone cannot. Archived counts come from the archive tabs, which is the one read of them
outside an unarchive.

**A live class with no students is not listed, and its course row is soft-deleted on the way past.** A class
comes into being in this app only by a student being put in it, so an emptied live class is the remains of a
deleted one rather than a class waiting to be filled. Every other tool already derives its class list from
enrollments and drops it immediately; without this rule the archive dialog, now the Manage Classes tab, was the one place it lingered.
Archived rows are exempt — having no live enrollments is what being archived means.

### `POST /classes/archive`
```json
{ "classIds": ["…", "…"] }
```

Moves each named class's enrollment rows, attendance rows, saved grouping, and any student left with no other
live class out of the live tabs and into the archive tabs, then stamps `archivedAt`. Multi-select, because
end-of-semester turnover archives nearly everything at once and that is the primary case.

**Synchronous, and it holds the teacher's other writes for the duration** (reads continue). The move is a
read-partition-rewrite of each affected tab, so a concurrent write to a tab mid-rewrite would be silently
overwritten — the one operation where losing data is least forgivable. It is a handful of API calls
regardless of row count, so the wait is seconds.

**Ordering is fixed: append to the archive, verify, then rewrite the source.** The reverse order turns a
crash into data loss; this order turns it into recoverable duplicates, which the operation de-duplicates by
row id on retry.

**Response 200:** the same shape as `GET /classes`, **including `studentCount`**, so the page re-renders
from the result. Returning a narrower shape here than `GET` gives the page no counts to render at the one
moment it is guaranteed to re-render.

**Response 409:** `CONFLICT` if an archive, restore or rename is already running for this account.

### `POST /classes/unarchive`
```json
{ "classIds": ["…"] }
```

The exact inverse: rows move back into the live tabs and `archivedAt` is cleared. A full inverse migration
rather than leaving the class readable in place, because a class read out of the archive would put the
archive back in the hot path for the rest of the term, and new attendance for it would have nowhere coherent
to go.

**Name collisions are resolved by renaming, not refused.** Unarchiving a class whose name matches a live one
returns the class renamed with its creation year appended — `Period A Science (2023)` — and reports it, so
the UI can warn rather than fail. If that name is also taken, a numeric suffix is added
(`Period A Science (2023) 2`) until it is unique; the rule must terminate rather than reject, because
refusing to restore a teacher's own records is the worse outcome.

```json
{ "renamed": [{ "from": "Period A Science", "to": "Period A Science (2023)" }], "live": [], "archived": [] }
```

### `PATCH /classes/:classId`
```json
{ "name": "Grade 9 Science" }
```

Renames one class, live or archived. `name` is trimmed, 1–60 characters, the same bound as a class name on a
student. Unexpected fields are rejected.

The name is the join key, so the rename rewrites it on every enrollment, attendance and grouping row carrying
it (soft-deleted rows included) as well as on the course row. **Only the tabs the class lives in are touched:**
the live tabs for a live class, the archive tabs for an archived one, because the other side may hold a
different class under the same name.

**All of it is one Sheets write.** This is load-bearing rather than an optimisation: `GET /classes` reconciles
live course rows against live enrollment names, so a live class whose rows were renamed but whose course row
was not would read back as an emptied class (soft-deleted) plus a new one under a fresh id, and the retry
would find nothing to rename. Nothing is cleared, so a failed write cannot lose a row.

Held under the account lock, like the moves, since a write landing part-way would be filed under the old name.

**Response 200:** the same shape as `GET /classes`.

**Response 404:** `NOT_FOUND` for an unknown class id.

**Response 409:** `CONFLICT` when another class on the same side already has the name (an archived class may
share a live class's name, as everywhere else), or when an archive, restore or rename is already running for
this account. Both messages are written for the teacher and shown as-is.

Renaming the current name, after trimming, is a no-op that writes nothing.

---

## Settings (Phase 2 Step 3)

Per-teacher settings that change what the server computes, as opposed to the display and styling
preferences, which are cosmetic and stay in `localStorage` with no endpoint. Stored on the account record,
not in the teacher's Sheet: the high-absence threshold is a scalar preference rather than student data, it
must be enforced and applied server-side, and keeping it out of the Sheet avoids a read on every risk
calculation.

### `GET /settings`
Returns the account's effective settings. Not gated — a `free` account reads the default threshold so the
roster tooltip can name it.

**Response 200**
```json
{
  "highAbsence": { "minAbsenceRate": 0.15, "minDaysRecorded": 5, "isDefault": true },
  "storedOverride": null
}
```

`minDaysRecorded` is returned but not settable (see `PUT` below).

`minAbsenceRate` is a fraction, not a percentage: `0.15` means "more than 15% of recorded days absent".
`isDefault` is `true` when the returned threshold is the product default, whether because the account never
set one or because it is `free` and its stored value is not being applied. `storedOverride` carries the
account's saved threshold when one exists and is not currently in effect (a lapsed account), and is `null`
otherwise.

### `PUT /settings`
Updates the account's settings. Requires `trial` or `paid`.

**Request**
```json
{ "highAbsence": { "minAbsenceRate": 0.2 } }
```

`minAbsenceRate` must be between `0.01` and `1` inclusive, and is the **only** settable field.
`minDaysRecorded` is **not accepted** — the request body is strict, so supplying it returns
`VALIDATION_ERROR`. The server writes that field from the product default on every update. It remains a
real part of the threshold and is still returned by `GET /settings`, because the flag is still computed
with it; it is simply not the teacher's to choose. The rationale: the sample floor exists to stop a class
with two recorded days from flagging everyone, which is a statistical guard rather than a policy decision,
and exposing it asked teachers to reason about sample size to set a threshold they think of purely as a
percentage. The column still stores it, so the lever could return without a migration.

**Response 200:** the same shape as `GET /settings`.

**Response 403:** `PREMIUM_REQUIRED` on a `free` account. The stored threshold is retained rather than
reset, so an account that lapses to `free` has its setting re-applied on upgrade — the same treatment
grouping constraints get.

A `free` account's flags are computed with the **default** threshold even when a custom one is stored,
which is the same "stored but not applied" rule as grouping constraints. This keeps the free tier a single
fixed definition: a free account's high-absence tooltip always reads 15%, so the number never depends on
what plan the account held some months ago, and support conversations have one answer rather than two.
`GET /settings` therefore returns the **effective** threshold — the default on `free`, the stored value on
`trial` and `paid` — with the stored value surfaced separately as `storedOverride` when the two differ, so
the client can show a lapsed teacher what upgrading would restore.

The threshold applies everywhere the high-absence flag is computed: the roster's warning icons, the
student-detail summary, the Statistics view flag, and the email tool's "High absences" recipient
selection. There is one threshold per account, not one per class.

---

## Billing (Phase 2 Step 3b)

Stripe integration. The teacher never enters card details in this app: checkout and every billing
self-service action happen on Stripe-hosted pages, and these endpoints only mint URLs to send the browser
to. See IMPLEMENTATION_PLAN.md (Phase 2 Step 3b) for the provider decision.

**The webhook is the sole writer of subscription state.** No endpoint here — and nothing else in the
codebase — writes `subscription_status`, the Stripe ids, or the billing period. Returning from a successful
checkout does not make an account `paid`; the webhook does, when Stripe says so. This matters because the
success URL is just a URL and a teacher can reach it by typing it.

### `POST /billing/checkout`

Session-gated. Creates a Stripe Checkout Session for one of the two intervals and returns its URL.

Request: `{ "interval": "monthly" | "annual" }` — any other value is a `VALIDATION_ERROR`; there is no
default, because guessing which plan someone meant to buy is not a recoverable mistake.

Response: `{ "url": "https://checkout.stripe.com/..." }`

Creates the account's Stripe customer on first use and records it. One customer per account, forever, which
is what keeps payment methods and invoice history together across resubscribes and what the webhook's
customer lookup depends on.

### `POST /billing/portal`

Session-gated. Returns a Stripe billing-portal URL for cancellation, card updates, invoices, and receipts.

Request: `{ "flow": "cancel" }` — optional. Omitted, the URL opens the portal's home page, which is what the
account page's "Manage billing" row wants. With it, the URL opens directly on the portal's **cancellation
flow** (Stripe's `flow_data`), which is what the in-app cancellation dialog's "Continue to cancel" wants.
Without the distinction both buttons land in the same place and a teacher who has already said they want to
cancel has to go and find the control again. Falls back to the portal home unless the account has a **live**
subscription to point the flow at, which is a stricter test than a non-null `stripe_subscription_id`: that id
is never cleared, so every account that has ever cancelled still carries one, and Stripe rejects a cancel
flow aimed at a terminated subscription — which reaches the teacher as a failure to open billing at all.

Response: `{ "url": "https://billing.stripe.com/..." }`

`404 NOT_FOUND` when the account has no Stripe customer, which is every account that has never checked out.

### `POST /billing/pause`

Session-gated. Pauses billing for one to three months (Phase 2 Step 6i), using Stripe's `pause_collection`
with `behavior: void` — the paused months are **not** owed and are never billed later.

Request: `{ "months": 1 | 2 | 3 }` — optional, defaulting to `2`. Anything outside the range is a
`VALIDATION_ERROR`. The bounds are enforced here rather than only offered in the dialog, because this
endpoint is reachable directly and an unbounded pause is a free subscription.

Response: `{ "resumesAt": "2026-09-01T00:00:00.000Z", "months": 2 }`

**No plan is returned, and none is written.** The webhook remains the sole writer of subscription state, so
the account is not paused until Stripe reports it; the client refreshes `GET /auth/me` rather than being
told. `pause_started_at` is the one field this endpoint writes, and it is not Stripe's — Stripe clears
`pause_collection` when collection resumes, so the once-per-twelve-months rule needs a record that outlives
the pause it describes.

Refusals, each `409 CONFLICT` because they describe an account in the wrong state rather than a malformed
request:

- already paused;
- paused within the last twelve months;
- **a founding-user promo is still running.** The refusal protects the teacher rather than tidying the
  dialog: the discount expires on calendar months rather than on invoices, so a pause does not defer it.
  They would spend free months and the once-a-year allowance to stop being charged an amount that is
  already zero. The message names the promo's end date so the answer is actionable;
- not on the monthly price. An annual renewal in September already falls outside the summer, which is that
  plan's entire advantage; an annual subscriber cancels to period end as before. The interval is read from
  Stripe's own line items rather than from anything mirrored on the account.

`404 NOT_FOUND` when the account has no subscription at all.

**Where this is offered is part of the specification.** The pause appears inside the in-app cancellation
flow and nowhere else — not on the pricing page, and not as a standing row on the account page. At list
prices a monthly subscriber who pauses for two months pays exactly the annual price, so advertising it tells
every visitor that annual has no advantage.

### `POST /billing/webhook`

**Not session-gated and not CSRF-gated.** Stripe is not a browser and carries no cookie; the request's
signature is its authentication. Two properties are load-bearing and are asserted in
`routes/billing.test.ts`:

- **Raw body.** The route is mounted ahead of `express.json()` and parses with `express.raw()`, because
  signature verification hashes the exact bytes Stripe sent. A parsed-and-reserialized body cannot verify,
  and the failure appears only against live Stripe.
- **Signature verified before anything else.** The endpoint is publicly reachable; without the check anyone
  could declare an account paid. An unsigned, wrongly-signed, or tampered request is `400` and changes
  nothing.

Consumed events: `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`. `customer.subscription.updated` also carries pause changes in **both**
directions: a pause arrives as `pause_collection` being set and a resume as the same field going null, so
the flag is written on every event rather than only when it is present. A subscription whose discounts
arrive as bare ids is re-fetched expanded, because the promo end date drives the Step 6h reminder and
reading an unexpanded list would silently report "no promo" instead. Every other event type is acknowledged with `200` and ignored — a webhook
that errors on unrecognised input earns an endless retry loop, and Stripe sends far more event types than
this integration consumes. An event for a customer with no matching account is likewise acknowledged.

`invoice.payment_failed` is deliberately **not** consumed: Stripe already moves the subscription to
`past_due` and sends `customer.subscription.updated`, so handling it too would be a second path to the same
state. `past_due` intentionally keeps access — a card expiring mid-semester should not lock a teacher out
of their class during a lesson.

Handler failures answer `500` on purpose, so Stripe retries rather than dropping the event.

**Cancellation is not immediate and not a lockout.** Stripe keeps the subscription `active` with
`cancel_at_period_end` set until the paid-for period actually ends, then sends
`customer.subscription.deleted`, at which point plan resolution returns `free`. No scheduled job is needed
on our side. Nothing is deleted and the spreadsheet mapping is untouched.

**Known, accepted limitation:** Stripe does not guarantee event ordering and the handler is last-write-wins.
A delayed event could briefly restore a superseded state; Stripe re-sends current state on every subsequent
change, and the realistic failure errs toward the teacher keeping access. The fix, if it ever matters, is to
re-fetch the subscription by id in the handler instead of trusting the event payload.

## Support (Phase 2 Step 4)

The contact / support system. Everything under `/support` sits behind the session gate, so submission there
is signed-in only: the account is the identity, and the submitter's email, name, and plan are read from the
account record rather than typed into the form. The signed-out route added in Step 5 is
`POST /public/support/contact`, documented below and mounted outside the gate.

**No student PII.** The free-text `message` is a teacher writing about their own account; the form states
plainly that student names must not be included, and neither `subject` nor `message` is ever logged.

### `POST /support/requests`
Body: `{ category, subject, message }`, strict (any extra field, including a `googleSub`, is a
`VALIDATION_ERROR`). `category` is one of `question` | `bug` | `billing` | `feature` | `other`; `subject` is
1–120 characters after trimming, `message` 1–4000.

Returns **201** with the stored request: `{ id, googleSub, category, subject, message, status, adminNote,
planAtSubmit, createdAt, updatedAt }`. `status` starts at `new`. `planAtSubmit` is the plan the account held
when the request was written, which is not necessarily the plan it holds when the request is read.
`googleSub` is `null` only on a request that arrived through the public route below.

Rate-limited to 10 submissions per hour per account (`RATE_LIMITED`). Not a security boundary — the route is
already behind a session — just a guard against a stuck client filling the table.

**Both list endpoints return `{ requests, truncated }`**, capped at 100 rows. `truncated` is exact rather
than inferred: the query fetches one row past the cap and drops it, so a full page and an overflowing one
are distinguishable. Silent truncation would be worst exactly when the queue is busiest.

### `GET /support/requests`
The caller's own requests, newest first: `{ requests, truncated }`. Never another account's.

### Admin endpoints — `/support/admin/*`
Gated on the `SUPPORT_ADMIN_GOOGLE_SUBS` allowlist. **Every one of them answers `NOT_FOUND` (404) rather
than `FORBIDDEN` for a caller who is not allowlisted**, for the same reason `POST /internal/dev/plan` does: a
403 confirms the endpoint exists to anyone probing. Unlike the dev toggle, the guard has no `NODE_ENV` half —
support triage is a production task — so the allowlist is the entire guard, and an empty allowlist grants
nobody anything.

- **`GET /support/admin/requests?status=`** — every request, newest first, each with the submitting account
  attached (`accountEmail`, `accountName`, `verifiedIdentity`, `currentPlanOverride`, `subscriptionStatus`,
  `trialEndsAt`). `status` is optional and must be one of `new` | `open` | `resolved` | `closed`. The join to
  `users` is a **LEFT** join, so a signed-out request appears in the queue rather than being filtered out of
  it; on such a row `googleSub` is `null`, `verifiedIdentity` is `false`, and `accountEmail` / `accountName`
  carry what the sender typed rather than an address anyone has confirmed.
- **`PATCH /support/admin/requests/:id`** — `{ status?, adminNote? }`, at least one required. Returns the
  updated request; `NOT_FOUND` for an unknown id.
- **`POST /support/admin/accounts/:googleSub/plan-override`** — the comp mechanism. `{ override }`, one of
  `free` | `trial` | `paid` | `null`. Writes `plan_override` **only**: the Stripe-managed subscription fields
  are untouched, so a comp never disagrees with billing state and is lifted by setting `override` to `null`.
  `NOT_FOUND` for an unknown account. Only ever called for an account-backed request: a signed-out one has no
  account to grant anything to, and the triage view does not render the control.
- **`GET /support/admin/metrics`** (Step 6j) — the operator metrics view. Returns `{ funnel, signups, usage,
  pickerCountsPageOpens, retentionMonths }`. `funnel` counts accounts per activation milestone
  (`signedUp`, `onboarded`, `firstStudent`, `firstAttendance`, `firstGrouping`, `firstPicker`, `firstEmail`,
  `premiumAttempt`); the stages are **independent counts against `signedUp`, not a descending cascade**,
  because an account can send an email having never generated a grouping. `signups` is new accounts per UTC
  month and `usage` is per-month per-tool totals with a distinct-account count beside each. The window is 12
  months, deliberately inside the 24-month retention so the view never renders a partly-pruned month as a
  decline. **This response carries no account identifiers at all** — no id, google_sub, email or domain — and
  a test asserts it, because the privacy policy's description of the view depends on it.
- **`GET /support/admin/accounts/:googleSub/activity`** (Step 6j) — one account's activation state, for the
  triage view. Returns `{ createdAt, milestones, usage }` and nothing else: never the refresh token, the
  spreadsheet id, the email, or anything from the teacher's Sheet. **Deliberately not a search.** It is keyed
  on a google_sub the operator already holds from an open request, the same key the comp grant above uses;
  there is no listing endpoint and no lookup by email, so an account that has not written in cannot be
  browsed. `NOT_FOUND` for an unknown account.

### The Name Picker's usage marker (Step 6j)

`GET /students` accepts one optional query parameter, **`?for=picker`**, and it exists for instrumentation
only. The Name Picker is entirely client-side by the Step 8 decision and has no endpoint of its own, so it
identifies the roster read its page already makes rather than being given a request whose only purpose is to
report usage. The parameter changes nothing about the response. It is compared against the literal string
and is the only counted read: every other caller omits it.

The consequence is that **the picker's counter counts opens of the tool, not rounds drawn**, which is not
what the other three counters mean. That asymmetry is carried in the response as `pickerCountsPageOpens` and
labelled everywhere the number is displayed, rather than left for a reader to infer.

## Public endpoints (Phase 2 Steps 5 and 5a)

Everything under `/public` is unauthenticated by design, and the prefix exists so that is visible in the
route rather than inferred from mount order. There are exactly two: the contact form below, which is the
application's only unauthenticated **write**, and `GET /public/app-info`, which is a read of configuration
and touches no account at all.

### `POST /public/support/contact`
**The only unauthenticated write endpoint in the application.** Mounted outside the session and CSRF gates,
under a `/public` path prefix so that fact is visible in the route rather than inferred from mount order.

It exists for a specific person rather than as a general courtesy: a teacher whose school board has not
allowlisted the OAuth app cannot sign in at all, so every route to us behind the sign-in wall is closed to
exactly the people with the most urgent reason to write. It also serves anyone deciding whether to sign up.

Body: `{ name, email, category, subject, message, website? }`, strict. `name` is 1–120 characters after
trimming, `email` must parse as an address and is at most 254, `category` is the same five values as the
signed-in form, `subject` 1–120, `message` 1–4000. `website` is a **honeypot**: it is rendered off-screen and
left empty by a person, so a request that carries it filled in is **discarded and answered 204** rather than
rejected — a 400 would tell an automated filler which field to leave alone next time.

Returns **204 with no body**. Deliberately nothing: an anonymous caller should not receive an identifier for
what they wrote, because an identifier is a handle that would then need guarding. There is no corresponding
read endpoint, and the route supports no method other than POST.

Rate-limited to **3 submissions per hour per IP subnet** (`RATE_LIMITED`). Unlike the signed-in form's limit,
this one *is* a security boundary rather than a guard against a stuck client, which is why it is far tighter.
The key is normalized to the subnet, so an IPv6 caller cannot sidestep it by moving within their allocation.
A captcha is deliberately not used: it would add a dependency, a third-party script, and an accessibility
cost, and the rate limit plus the honeypot are the proportionate response until abuse actually appears.

The submission is stored in the same `support_requests` table with `google_sub` null and the typed name and
address in `contact_name` / `contact_email`. A database CHECK constraint requires one of the two identities
to be present, so no path can create an unanswerable request.

**No student PII**, on the same terms as the signed-in form: the message field carries the same instruction
not to include student names, and neither `subject` nor `message` is ever logged.

### `GET /public/app-info` (Phase 2 Step 5a)
The configuration facts a Google Workspace administrator needs in order to allowlist the app, served to the
public `/for-admins` page. Unauthenticated and read-only.

**Response 200**
```json
{
  "appName": "Teachneat",
  "oauthClientId": "1234-abc.apps.googleusercontent.com",
  "scopes": ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file", "…"]
}
```

Served from configuration rather than hardcoded in the client for a reason particular to what the page is
for: an admin allowlists on the strength of these exact values, so a second copy that could go stale would
present as a teacher still locked out after their admin did everything right. `scopes` is the same array the
authorization URL is built from, so a scope added to sign-in cannot fail to appear here.

Nothing returned is secret — the client id appears in the query string of every consent redirect and the
scopes appear on the consent screen. There is no session, no account lookup, and no user data. When the
deployment is unconfigured `oauthClientId` is `""`, and the page renders a contact route rather than an
empty field to copy.

---

## Cross-cutting behavior

### Caching
`GET` endpoints that read from Sheets are served from a server-side **working set** (Phase 2 Step 6a), keyed
per user and per resource, to protect Google API quota. Mutations invalidate or merge into the relevant
entries. Clients should not rely on cache semantics — every `GET` returns a coherent snapshot, but two
consecutive `GET`s may serve different data if a mutation happened in between.

Two independent clocks bound an entry, and only the second is a staleness guarantee:

- **Idle (2 minutes), extended on every read.** A teacher working continuously keeps their data resident; one
  who stops has it evicted. Short deliberately — resident student data is the app's only transient PII
  surface, and the cost of evicting too eagerly is a single Sheets read.
- **Age (5 minutes), fixed at load and never extended.** The ceiling on how stale a value may be, including
  for an entry being read constantly. A merge from a mutation does not extend it.

**The age bound is conservative because Drive push invalidation does not exist yet** (Step 6d). Until it
does, nothing signals an edit made in Google Sheets directly, and this is the only bound on serving its stale
predecessor. Writes through the API are unaffected either way: they are write-through and invalidate or merge
their own keys, so in-app edits are visible immediately.

Both figures live in `server/src/config/cache.ts`. Raising the age bound is the last task of Step 6d, once
push invalidation is proven; the idle window is not what changes.

### Header validation
Every Sheets-backed endpoint runs the header validation invariant before reading or writing. A mismatch returns `SHEET_HEADER_MISMATCH` and the operation is aborted.

### PII in error messages
Error `message` fields never include student names, email addresses, IDs, or guardian contact info. Validation error `fieldErrors` reference field paths, not values.

### Logging
Server logs include request method, path, status, and timing. They never include request bodies, response bodies, recipient addresses, or student PII. The `emailLog` tab is the only audit trail of email sends; it does not store body content.

### Rate limits
Phase 1 enforces:
- Per-user 200-email daily cap on `POST /email/send` and queue approval (counted together).
- Burst limit on `POST /email/send`: no more than 60 sends within any rolling 10-second window per user. This is strictly below the "100 in 10 seconds should be blocked" threshold in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and leaves room for legitimate end-of-day updates to a full class. The exact threshold is tunable in config.
- Generic per-user rate limit on all endpoints: 600 requests per minute. Exceeding it returns `RATE_LIMITED`.

### CSRF
Every state-changing request — any method other than `GET`, `HEAD`, or `OPTIONS`, on any endpoint including `POST /auth/logout` — must carry the session's CSRF token in the `X-CSRF-Token` header. The token is per session, issued when the session is created and returned by `GET /auth/me`; it is not a cookie, so a cross-site page cannot read it. A missing or non-matching token returns **403 `CSRF_INVALID`**; the client's correct response is to re-read the token from `GET /auth/me` and retry the request once (a mismatch normally means the session was replaced, e.g. by a re-sign-in in another tab). Safe methods carry no token requirement.

The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production; the token requirement sits on top of `SameSite` rather than replacing it.

---

## What this contract does not cover

- **Phase 3 endpoints** (file uploads, resource browsing) are out of scope. So are the Phase 2 endpoints
  not yet built. The operator metrics view (6j) adds no route documented here; the founding-user promo and
  the summer pause (6i) are built, and the pause's one endpoint is documented above under Billing while the
  promo adds none at all — it is a Stripe coupon redeemed on the hosted Checkout page, so the only code
  change it needed was enabling the promotion-code field on the monthly interval.
  Lifecycle email (Step 6h) is built and likewise adds none: it is queued from paths that already
  exist and dispatched by a background sweep, so it has no client-facing endpoint at all. Its two
  development-only controls (`POST /internal/dev/trial`, `POST /internal/dev/lifecycle`) sit on the
  internal router, which this contract does not cover, and are unreachable in production. The Attendance Rules and Attendance Queue sections above are the one
  exception: they are specified but deferred, and are marked as such where they appear.
- **WebSocket or SSE channels.** All endpoints are request/response. Real-time updates are not part of Phase 1.
- **Pagination.** Roster, attendance, and template lists are bounded by a single teacher's data volume and returned in full. If any list grows beyond ~5,000 rows in practice, pagination is added; that threshold has not been reached.
