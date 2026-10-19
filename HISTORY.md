# Teachneat — History

Two sections. **Work Log** is the full chronological record: every implementation step, in the order
completed, with the technical detail of what shipped. It is append-only — entries are added, never
rewritten or removed. **Decisions Made** is the standing record of settled questions, with the conclusion,
the rationale, and the rejected alternatives; unlike the work log it is edited in place when a decision is
revised, and a reversal is corrected visibly rather than deleted.

For current status, the direct next step, and open questions, see [NEXT_STEPS.md](NEXT_STEPS.md).

**This is the only place completed work is described.** When a step ships, its entry is appended here and
its summary in NEXT_STEPS is *replaced* rather than added to. A second copy of a completed step's narrative
in NEXT_STEPS, IMPLEMENTATION_PLAN or CLAUDE.md is duplication that will drift, and on 2026-08-27 those
three documents were cut back for exactly that reason: NEXT_STEPS had grown to 969 lines of which roughly
780 restated entries already sitting below, IMPLEMENTATION_PLAN carried 620 lines of build specification for
completed sub-steps, and CLAUDE.md's Current State paragraph, which loads into every session, had become a
third copy. Nothing was lost in that pass; every detail removed was verified present here first. If a
standing *rule* comes out of a step, it goes to the document that governs the thing it constrains
(Security Practices in IMPLEMENTATION_PLAN, or the relevant spec), not to a status document.

---

## Work Log

### Step 1 — Google OAuth + Sheets Bootstrap

Branch: `claude/competent-shockley-48beb3` (worktree).

- Server scaffolding: config, logger (pino with PII redaction), env loader, helmet CSP, CORS limited to CLIENT_ORIGIN, 600/min generic rate limit, centralized error handler that sanitizes Google API errors and maps Zod/ApiError/invalid_grant.
- Schema constants ([server/src/config/schema.ts](server/src/config/schema.ts)) — all 9 tabs, opaque `cNN` codes mapped to camelCase field names per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md).
- Sheets service ([server/src/services/sheets.ts](server/src/services/sheets.ts)) — header validation invariant on every read/write, generic `appendRow`/`readTabRows` keyed on field names.
- Bootstrap service ([server/src/services/bootstrap.ts](server/src/services/bootstrap.ts)) — discovery via Drive `appProperties` first, then `TTK_APP_MARKER` row in `meta`; creates the spreadsheet with all tabs + seeded meta rows if neither found; reconciles missing tabs.
- OAuth service ([server/src/services/googleAuth.ts](server/src/services/googleAuth.ts)) — code exchange, profile fetch, `REAUTH_REQUIRED` detection.
- Token store (`server/src/services/tokenStore.ts`, since removed — see the Phase 2 Step 1 entry) — single-user encrypted-at-rest refresh token (AES-256-GCM); file lives at `server/.data/tokens.json` (gitignored).
- Session middleware ([server/src/middleware/session.ts](server/src/middleware/session.ts)) — signed HttpOnly cookie (HMAC-SHA256). Phase 2 swaps for a real session table.
- Routes: `/api/auth/google` (content-negotiates: redirects browsers, JSON for clients), `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/logout`, `/api/bootstrap/status`, `/api/health`.
- 31 Vitest tests covering schema, sheets header validation, bootstrap (create / discover via appProperties / discover via meta marker / missing-tab reconcile / tampered-header refusal), token store encryption, session cookie signing, error handler sanitization. `npm test` and `npm run typecheck` clean.
- Verified end-to-end against a real Google account: spreadsheet created on Drive with the opaque schema; encrypted token file persisted.

### Step 2 — App Shell + Theme System

- Tailwind v4 with CSS-first config ([client/src/index.css](client/src/index.css)). Full design-token palette for both modes (mode-invariant accent + semantic colors, mode-variant backgrounds/borders/text). Dark mode opt-in via `.dark` class on `<html>`. Global `prefers-reduced-motion` honored.
- Theme system ([client/src/hooks/useTheme.tsx](client/src/hooks/useTheme.tsx)) — `ThemeProvider` + `useTheme()` hook, localStorage persistence (`ttk.theme`), light default with top-bar toggle to switch into dark.
- API client ([client/src/api/client.ts](client/src/api/client.ts), [client/src/api/auth.ts](client/src/api/auth.ts)) — typed `fetch` wrapper that always sends credentials and throws a typed `ApiError`; `getMe`, `logout`, `SIGNIN_URL` exported.
- Auth gate ([client/src/hooks/useAuth.tsx](client/src/hooks/useAuth.tsx)) — `AuthProvider` calls `/api/auth/me` on mount; `AuthGate` auto-redirects to `/api/auth/google` on 401/`REAUTH_REQUIRED`. Injectable `fetchProfile` and `redirectTo` for tests.
- Layout ([client/src/layouts/AppShell.tsx](client/src/layouts/AppShell.tsx), [TopBar.tsx](client/src/layouts/TopBar.tsx), [Sidebar.tsx](client/src/layouts/Sidebar.tsx)) — three-zone layout: 64px fixed top bar (placeholder GraduationCap logo in accent gold + wordmark in `text-primary` + theme toggle + settings + account dropdown), sidebar (220px desktop / 64px tablet / mobile drawer), main content area capped at 1200px. Sidebar rendered as two separate trees (desktop and mobile) so breakpoint resizing is jank-free.
- Routing ([client/src/App.tsx](client/src/App.tsx)) — `react-router-dom` v7. `/auth/error` outside the auth gate; `/`, `/attendance`, `/grouping`, `/name-picker`, `/email` inside the gate with placeholder pages.
- Auth error page ([client/src/pages/AuthError.tsx](client/src/pages/AuthError.tsx)) — code-to-message lookup with fallback, "Try again" link to the OAuth URL.
- Vite proxy ([client/vite.config.ts](client/vite.config.ts)) — `/api/*` forwarded to `http://localhost:3001`. OAuth redirect URI moved to `http://localhost:5173/api/auth/google/callback` (must be added in Google Cloud Console) so the session cookie ends up on the client origin.
- 18 component tests across theme, auth gate, sidebar, top bar, auth error page. `npm test`, `npm run typecheck`, and `npm run build` all clean. Production bundle ~247 KB / 80 KB gzipped.

Local user state (gitignored, not committed): `server/.env` (OAuth credentials, secrets; `GOOGLE_REDIRECT_URI` switched to `:5173` for proxied callback handling) and `server/.data/tokens.json` (encrypted refresh token).

### Step 3 — Students Page (Roster + IEP)

Base build (commit `13e97b9`):
- Server: students + IEP CRUD routes with Zod validation, service layer with per-user 45s cache, soft-delete cascade.
- Client: `features/students/` with roster list (filter/sort, accommodation indicators), Gmail-style detail view, add/edit modal, accommodation toggles with notes.
- Service tests (students, iep) and component tests (StudentsPage, StudentDetail).

Follow-ups (3a–3f):
- **3a** — Required-field asterisks (rendered by `Input` when `required` is set), "* indicates a required field" footnote, submit disabled until first name / last name / course are non-empty (trimmed).
- **3b** — Pronouns dropdown ([PronounsSelect.tsx](client/src/features/students/PronounsSelect.tsx)): He/Him, She/Her, They/Them, Other, Not specified. Legacy free-text values display as "Other" and are overwritten with the literal `Other` on save (accepted tradeoff).
- **3c** — Course `<datalist>` combobox suggesting existing course names (from the roster cache) in the single-add, edit, and bulk-add forms; still free text.
- **3d** — Bulk add ([BulkAddStudents.tsx](client/src/features/students/BulkAddStudents.tsx)): full-width grid screen, auto-appending trailing empty row, client-side per-cell validation, N individual create calls with partial-failure handling (failed rows stay on the grid with their server error; summary reports the count).
- **3e** — IEP toggle responsiveness: optimistic toggles with rollback on error, server responses merged into local state (no refetch), and `updateRowByNumber` accepts `headerValidated` so an update validates the header once, not twice.
- **3f** — Roster load responsiveness: module-level stale-while-revalidate cache ([rosterCache.ts](client/src/features/students/rosterCache.ts)) eliminates the loading flash on revisit, and `GET /students/iep-summary` (service `listIepSummary`, routed before `/:id`) collapses the 1+N request pattern to two parallel requests.
- UI refinements after visual review: roster rows as a fixed-track CSS grid (course as its own column, accommodation tags in a fixed-width final column); detail view reports accommodation changes up through `patchEnabled` in [useRoster.ts](client/src/features/students/useRoster.ts) so roster indicators are correct on return without a refetch; course sort hidden while a specific course filter is active; bulk add keeps exactly one trailing blank row (emptied rows removed on blur, not mid-keystroke); student detail panel order is Contact, Notes, Attendance Summary, IEP Accommodations, with a read-only IEP panel whose Edit button opens the toggle/notes modal.
- Tests: server 48 passing, client 37 passing. Typecheck and production build clean.

### Step 4 — Attendance Tracker

- Shared request context: `resolveSheetsContext` extracted from the students router into [middleware/sheetsContext.ts](server/src/middleware/sheetsContext.ts) and reused by both routers.
- Sheets batch helpers ([services/sheets.ts](server/src/services/sheets.ts)): `appendRows` and `updateRowsByNumber` (single `values.batchUpdate` for many full-row overwrites), both honoring `headerValidated`. FakeGoogle gained a `values.batchUpdate` handler.
- Attendance service ([services/attendance.ts](server/src/services/attendance.ts)): per-user cached read of all active rows; `listByDate` / `listByRange` filter in memory; `submitAttendance` validates (unknown/duplicate studentIds) before any write, then overwrites existing rows in one batch and appends new ones in one call (no partial write on validation failure); `updateAttendance` for single corrections; pure `computeStats` (absences/tardies/excused, absence rate, current consecutive-absence streak) and `exceedsThreshold` for flag detection.
- Routes ([routes/attendance.ts](server/src/routes/attendance.ts), mounted at `/api/attendance`): `GET /` (by date), `GET /range`, `GET /stats` (range optional; both bounds together or neither), `POST /`, `PUT /:id`. Zod validation incl. real calendar-date check and ordered range.
- Client `features/attendance/`: `AttendancePage` (Daily Entry / Statistics tab toggle, reuses the roster stale-while-revalidate cache), `EntryView` (per-student P/A/T/E buttons defaulting to Present, per-row notes, date picker that loads past days, Mark All Present, Save), `StatsView` (per-student aggregate table with optional date range and a "High absences" flag at the default 5-absence / 10%-rate threshold), plus `types.ts`, `statuses.ts`, and the `attendance` API client.
- Student detail: the placeholder is replaced by [AttendanceSummary.tsx](client/src/features/students/AttendanceSummary.tsx), a compact summary reading the shared `/attendance/stats` endpoint and filtering client-side.
- Weekends ([features/attendance/dates.ts](client/src/features/attendance/dates.ts), [utils/time.ts](server/src/utils/time.ts) `isWeekend`): selecting a Saturday/Sunday in entry shows every student as a grayed-out read-only Excused row with Save disabled; `submitAttendance` rejects weekend dates server-side; `computeStats` excludes weekend-dated rows so they never count and never break a streak (Thu+Fri+Mon absences = streak 3).
- Cross-tool navigation: the student detail view is addressable at `/students/:studentId` ([StudentsPage.tsx](client/src/features/students/StudentsPage.tsx) is URL-driven via `useParams`/`useNavigate`); clicking a student's name in the entry list or stats table navigates there.
- Attendance heatmap ([AttendanceHeatmap.tsx](client/src/features/students/AttendanceHeatmap.tsx)): GitHub-style grid under the student-detail attendance summary. Weekday-only (Mon–Fri, five rows); present blue, tardy yellow, absent red, excused dark gray, no-record a faint fill. Horizontally centered, scrolls to the most recent week on overflow, trims leading all-empty weeks (min 12-week window), hover readout in place of a native tooltip; renders nothing when the student has no records. Pure `classifyDay` classifier plus render paths tested. Reads `GET /attendance/range` and filters client-side.
- Tests: server 65 passing, client 57 passing. Typecheck and production build clean. No new dependencies.

### Step 4a — Students in Multiple Courses (Option C)

Implemented multiple-courses-per-student as a schemaVersion 1→2 change.
- **Schema (v2):** new `enrollments` tab (`studentId → course`, unique `(studentId, course)`), `attendance.c09 course` (uniqueness now `(studentId, course, date)`), and `students.course` removed (students renumbered `c01–c11`). `SCHEMA_VERSION` bumped to `2` in [schema.ts](server/src/config/schema.ts). No automated migration — the tool is pre-launch with placeholder data, so v2 rolls out as a clean reset (delete the spreadsheet, let bootstrap recreate it).
- **Server:** new [enrollments.ts](server/src/services/enrollments.ts) service (`listEnrollments`, `coursesByStudent`, `setEnrollments` diff, `softDeleteEnrollmentsForStudent`). [students.ts](server/src/services/students.ts) now exposes `courses: string[]`, joins enrollments on list, drives them via `setEnrollments` on create/update, and cascades soft-delete. [attendance.ts](server/src/services/attendance.ts) re-keyed on `(studentId, course, date)`: `submitAttendance(date, course, entries)` validates course + enrollment, `computeStats` produces one row per `(student, course)`, `getStats`/`listByDate` take an optional `course`. Routes updated (courses array with dedupe refinement; `course` on submit + optional `course` query).
- **Client:** `Student.courses`/attendance `course` through types + API. Roster union course filter and joined display; multi-course chip editor in the add/edit modal; bulk-add course cell parses a comma/pipe list. Attendance is per class only — the class dropdown scopes entry + stats to one course with no "All classes" option (defaults to the first course alphabetically). Student detail shows course chips; the attendance summary + heatmap scope to a per-class dropdown for multi-course students (single-course students show no dropdown). Roster filter/sort selections persist across navigation within a session (module-scoped, reset on a fresh app session).
- **Docs:** SHEETS_SCHEMA, API_CONTRACT, IMPLEMENTATION_PLAN, TESTING_PLAN, DESIGN_SYSTEM, and CLAUDE.md all updated. No new dependencies.
- **Tests:** server 79 passing, client 62 passing. Typecheck and production build clean on both.

### Step 5 — Mass Email Tool

Gmail sending, teacher-authored templates, recipient selection, preview, and the capped send flow. No
schema change (the `emailTemplates` and `emailLog` tabs already existed from bootstrap). No change to
the OAuth scopes (`gmail.send` was already granted in Step 1).

- **Server — templates** ([services/emailTemplates.ts](server/src/services/emailTemplates.ts),
  routed in [routes/email.ts](server/src/routes/email.ts) at `/api/email`): CRUD with per-user cache,
  soft delete. `bodyHtml` is sanitized on write with a strict `sanitize-html` allowlist
  (`p, strong, em, ul, ol, li, br, a`; `a` keeps only `href` on safe schemes and always carries
  `rel="noopener noreferrer"`); the stored/sent body is always the sanitized output. A separate guard
  rejects bodies containing obviously hand-authored markup (`<script>`/`<style>`/event handlers/
  `javascript:`) with `VALIDATION_ERROR` (defense in depth over the strip).
- **Server — send** ([services/emailSend.ts](server/src/services/emailSend.ts)): pure
  `renderPlaceholders` (HTML-escapes values in the body; strips CR/LF in the subject; unknown tokens
  render empty), `buildRawMessage` (base64url RFC 2822 HTML), `dailySentCount` (caches the integer
  only, never the `emailLog` rows), and `sendEmails` — resolves each recipient to student/parent
  addresses from the record (client never supplies addresses), sends one Gmail message per address,
  writes one `emailLog` row per attempt (no body content), and returns `{ sent, failed, skipped }`.
  The daily cap 429s the request when no quota remains and marks mid-batch overflow as failed
  `daily_cap`. Sender From is the teacher's own address from the token store. `GET /email/send-status`
  exposes the quota. Burst limiter (60 requests / 10s per user) on `POST /email/send`.
- **Server — plumbing:** `resolveEmailContext` added to
  [middleware/sheetsContext.ts](server/src/middleware/sheetsContext.ts) (Gmail client + sender email);
  [services/gmailClient.ts](server/src/services/gmailClient.ts); [utils/htmlEscape.ts](server/src/utils/htmlEscape.ts)
  (inlined, no package); [config/email.ts](server/src/config/email.ts) (cap, burst, placeholder
  grammar). The test `FakeGoogleEnv` gained a Gmail mock that decodes and captures sent messages.
- **Client** (`features/email/`, lazy-loaded so TipTap stays out of the main bundle): `EmailPage`
  (Compose / Templates toggle + daily-quota chip), `ComposeView` (template picker, student-vs-parent
  target, class filter, per-student checkboxes with resolved addresses, Select all / High absences /
  Clear, live preview, confirmation modal with recipient count, result summary), `TemplatesView`
  (list + delete confirmation), `TemplateEditor` (name/subject + `RichTextEditor` + sample-data
  preview), `RichTextEditor` (TipTap StarterKit narrowed to bold/italic/lists/links plus a placeholder
  insert menu), and `EmailPreview` (renders body in a sandboxed `iframe srcDoc` — no
  `dangerouslySetInnerHTML`). `api/email.ts`, `placeholders.ts` (client render mirrors the server).
- **Tests:** server 97 passing (up from 79; template sanitize/CRUD + send render/escape/cap/logging/
  failure), client 77 passing (up from 62; placeholders, preview, compose send flow, templates
  delete). Typecheck and production build clean on both. One new dependency group: TipTap
  (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-link`), all on the
  DEPENDENCIES allowlist.

_Step 5 follow-ups (three rounds of post-review changes)._
- **Three attendance/course placeholders** added to the template editor: `courseName`, `lateCount`
  (tardies), and `unexcusedAbsences` (absences, excused excluded). They resolve **per (student,
  course)** — `courseName` is the send's course and the two counts are that course's totals — computed
  server-side in `sendEmails` from the `getStats` engine; the client preview mirrors this from
  `GET /attendance/stats`. (An earlier iteration aggregated the counts across all of a student's
  courses; superseded when recipients became per-course.)
- **Per-course recipient rows, 3-column layout.** The Compose parent/student radio was removed. The
  recipient table is three columns — student name (with course code beneath), student email, and
  guardian email(s) — each address column with its own checkbox (a single guardian checkbox includes
  all of a student's guardian emails). The student email is one truncated line; guardian emails are
  listed one per line, each truncated with the full address on hover (`title`). A student in multiple
  courses gets **one row per course**. The send payload is
  `{ studentId, course, includeStudent, includeParents }`; the client still selects address kinds,
  never raw addresses, so the server resolves them (invariant preserved).
- **Select toolbar.** The class filter sits on its own row above a compact "Select" row: `Students`
  and `Guardians` (check the student-email or guardian column across the visible rows), `High
  absences`, and `Clear` (pushed to the right). High absences now checks **both** the student and
  guardian columns for flagged `(student, course)` rows. This replaced a single "Select all" button
  and a one-line toolbar that was wrapping.
- **CC/BCC copy address.** A field above the recipient list takes one optional teacher-entered address
  copied on every message, with a CC/BCC toggle defaulting to BCC. It rides as a header (one Gmail
  message, so it does not multiply the daily-cap count). This is the single sanctioned place a
  client-supplied address is accepted; validated as an email server-side.
- **Preview target selector, always visible.** A "Preview for" dropdown lists the selected recipients
  (each a student–course) so the teacher can switch whose rendered email they see; it is always
  present, showing "Select a recipient to preview" when nothing is selected, and defaults to the first
  selected recipient otherwise. The secondary "Previewing for …" caption was removed.
- **Send count.** The footer and confirmation dialog report the number of email messages to send
  (`N email(s) to send`) rather than a "recipients" count, which had become an opaque tally of
  selected (student, course) rows.
- **Conditional template blocks (Option A).** A block (`p`/`li`) can carry a condition so those lines
  only send to recipients whose data matches. The condition is a bounded triple stored in a `data-if`
  attribute (`<metric> gte <n>` or `<metric> is <true|false>`), never a user expression: metric ∈
  {`lateCount`, `unexcusedAbsences`, `hasAccommodations`, `atRisk`}, evaluated per (student, course) by the
  server ([services/emailConditions.ts](server/src/services/emailConditions.ts)). Authoring is
  Option A: select the line(s), open the editor's Condition control, pick metric/operator/value; the
  block gets a left-border chip showing the human-readable condition. Save allows and validates
  `data-if` on block tags (invalid conditions rejected); send drops failing blocks
  ([filterConditionalHtml](server/src/services/emailTemplates.ts)) then strips the markers before
  placeholder substitution. The compose preview evaluates the same conditions for the selected
  recipient ([features/email/conditions.ts](client/src/features/email/conditions.ts)); the template
  editor's sample preview shows all blocks. No new dependency (TipTap global attribute + `sanitize-html`
  `exclusiveFilter`). Accommodation data comes from the existing IEP summary.
- Server 116 tests, client 93 tests; typecheck, lint (email files), and build clean on both.

### Sheets read-quota mitigations (post-Step 5)

Manual testing exhausted Google's per-user Sheets read quota (`RESOURCE_EXHAUSTED` / HTTP 429). Because
the googleapis client retries 429s with backoff and the error handler did not classify the result,
every Drive-backed page hung on "Loading…" and eventually 500'd. Root cause was read amplification:
each logical read cost two API calls (a header-validation read plus the data read), and the student
detail view read three tabs across two endpoints. Fixes (no new dependencies):

- **Halved per-read cost (double-read collapse).** [`readTabRowsIndexed`](server/src/services/sheets.ts)
  now fetches header + data in a single `values.get` (`A1:ZZ`) and validates row 1 from that same
  response via a shared `assertHeaderMatches`. Previously it did a separate `1:1` header read before the
  `A2:ZZ` data read. The header-validation invariant is unchanged — a mismatched row 1 still refuses the
  read (now covered on the read path, not just writes).
- **Batched multi-tab reads.** New `readTabsRowsIndexed` primitive reads N tabs in one `values.batchGet`;
  the test `FakeGoogle` gained a `values.batchGet` handler.
- **Combined student-detail endpoint.** `GET /students/:id/detail` → `{ student, iep }`, served by new
  [services/studentDetail.ts](server/src/services/studentDetail.ts) with **cache-aware batching**: it
  reads only the tabs not already cached (students + enrollments and/or iep), collapsed into one
  `values.batchGet`, and writes the derived values back into the same per-resource caches the
  list/summary endpoints use. A cold detail open costs one Sheets request (was three); a warm open costs
  zero. The client `StudentDetail` now issues one request instead of `getStudent` + `listIep` in
  parallel. Each service (students / enrollments / iep) exposes small derive + cache-key helpers so
  `studentDetail` composes them without duplicating derivation logic or creating circular imports.
- **429 → graceful degradation.** The error handler now classifies Google quota errors (`isQuotaError`:
  numeric 429, a `*RateLimitExceeded` / `quotaExceeded` reason, or the `RESOURCE_EXHAUSTED` message text)
  as a new `SHEET_RATE_LIMITED` (429) with a `Retry-After` header, logged at warn without PII — instead
  of the prior opaque 500 / "Unhandled error". The client fetch wrapper retries `SHEET_RATE_LIMITED` up
  to 3× with short jittered backoff (400 / 900 / 1800 ms) for any method (a 429 means the request never
  took effect), then surfaces the friendly message. No more infinite spinner.
- **Docs:** API_CONTRACT gained the `/students/:id/detail` endpoint and the `SHEET_RATE_LIMITED` code.
- **Tests:** server 125 (was 116), client 93; typecheck and production build clean on both.

### API call-volume instrumentation

The Phase 1 half of the scaling decision (see Decisions Made below): a gauge
for how close aggregate load is to the shared Sheets quota ceiling, and an early warning for runaway call
loops like the one that caused the read-quota incident. No user-facing surface; holds no PII (only call
counts keyed by API method).

- **Metrics recorder** ([services/apiMetrics.ts](server/src/services/apiMetrics.ts)): `recordApiCall`
  and a `trackGoogleCall(service, method, fn)` wrapper that tags each call `ok` / `rate_limited` / `error`
  (429 detection shared with the error handler via the extracted
  [utils/googleErrors.ts](server/src/utils/googleErrors.ts) `isQuotaError`) and re-throws unchanged.
  Counts live in a rolling 60-second ring of per-second buckets (O(60) memory even under a runaway loop);
  `snapshotMetrics` aggregates to a per-minute total plus a by-method / by-result breakdown.
- **Instrumented call sites:** every outbound Google call — all Sheets read/write helpers in
  [sheets.ts](server/src/services/sheets.ts), the Gmail send in
  [emailSend.ts](server/src/services/emailSend.ts), and the Drive / spreadsheet discovery + create calls
  in [bootstrap.ts](server/src/services/bootstrap.ts).
- **Endpoint:** `GET /api/internal/metrics` ([routes/internal.ts](server/src/routes/internal.ts), mounted
  at `/api/internal`), session-gated, returns the snapshot JSON. Deliberately **not** in API_CONTRACT —
  it is an internal operator endpoint, not part of the public/client API. Phase 2 pipes the same signal
  into real monitoring (dashboards + alerts, e.g. warn at 80% of the 300/min ceiling).
- **Tests:** server 132 (was 125; apiMetrics aggregation / rolling-window / 429 tagging, and the endpoint
  auth + payload). Typecheck clean. No new dependencies.

### Step 5a — Academic risk flag + warning indicators

Per-`(student, course)` academic-risk flag, plus roster and summary warning indicators. Schema bumped to
**v3** (`enrollments.c06 atRisk`); no migration runner, so the existing sheet must be deleted once. No new
dependencies.

- **Schema/server:** `enrollments.atRisk` boolean ([schema.ts](server/src/config/schema.ts)).
  [enrollments.ts](server/src/services/enrollments.ts) carries `atRisk` on `Enrollment`, defaults new
  rows to false, preserves it across course-set changes, and gains `setEnrollmentAtRisk`. `Student` now
  exposes read-only `atRiskCourses` ([students.ts](server/src/services/students.ts)); the enrollment
  join was reworked to `enrollmentsByStudent` (retiring `coursesByStudent`/`courseMapFromEnrollments`).
  `setStudentAtRisk` toggles the flag and invalidates the students cache.
- **One high-absence threshold, app-wide** ([attendance.ts](server/src/services/attendance.ts)
  `HIGH_ABSENCE_RISK` / `isHighAbsenceRisk`, mirrored in
  [features/attendance/thresholds.ts](client/src/features/attendance/thresholds.ts)): absence rate
  strictly over 15% with at least 5 recorded days. Normalized so the roster/summary indicators, the
  Statistics view flag ([StatsView.tsx](client/src/features/attendance/StatsView.tsx)), and the email
  "High absences" selection ([ComposeView.tsx](client/src/features/email/ComposeView.tsx)) all share it;
  the old per-site `FLAG_MIN_ABSENCES`/`FLAG_MIN_ABSENCE_RATE` (5 / 10%) constants were removed.
- **Risk summary** ([risk.ts](server/src/services/risk.ts), `GET /students/risk-summary`, routed before
  `/:id`): one entry per active student with `atRiskCourses` (stored) and `highAbsenceCourses` (computed),
  returning the specific courses so the roster tooltip can name them. Toggle endpoint
  `PUT /students/:studentId/at-risk { course, atRisk }`.
- **Client:** roster gains a warning column ([RosterView.tsx](client/src/features/students/RosterView.tsx))
  with an academic-risk icon (`AlertTriangle`, danger) and a high-absence icon (`CalendarX`, warning), each
  with a hover tooltip (`title`) naming the course(s); fed by a new `riskByStudent` in
  [useRoster.ts](client/src/features/students/useRoster.ts) (+ `patchAtRisk` and the `rosterCache`
  snapshot). Student detail gains an Academic Risk card — per-course **checkboxes** laid out inline
  horizontally to save vertical space (optimistic, reports the at-risk course list up to sync the roster).
  The attendance summary shows a "High Absences" warning inline next to the absence-rate value
  ([AttendanceSummary.tsx](client/src/features/students/AttendanceSummary.tsx)); added a `--color-warning-bg`
  token.
- **Docs:** SHEETS_SCHEMA (enrollments column + v3 versioning), API_CONTRACT (`Student.atRiskCourses`,
  `risk-summary`, `at-risk`), IMPLEMENTATION_PLAN Step 5a.
- **Tests:** server 136 (was 132; isHighAbsenceRisk boundaries, atRisk toggle/preserve, risk summary),
  client 96 (was 93; roster icons, detail toggle, summary warning). Typecheck and build clean on both.

### Step 5a — atRisk email condition metric (5a remainder)

The stored per-`(student, course)` academic-risk flag is now a boolean condition metric in the Mass
Email Tool's conditional templating, alongside `hasAccommodations`. Closes out Step 5a. No schema change,
no new dependency.

- **Condition grammar:** `atRisk` added to `BOOLEAN_METRICS` in
  [emailConditions.ts](server/src/services/emailConditions.ts) (server) and to `CONDITION_METRICS` in
  [features/email/conditions.ts](client/src/features/email/conditions.ts) (client), so it parses,
  validates, and evaluates as `atRisk is <true|false>`. The boolean branch of `evaluateCondition`
  selects the metric instead of hard-coding `hasAccommodations`. The client `formatCondition` now reads
  per-metric true/false phrasings off `MetricDef` (`boolTrue`/`boolFalse`) rather than a hard-coded
  accommodations string.
- **Resolution:** `atRisk` resolves per `(student, course)` — server `sendEmails` sets
  `ctx.atRisk = student.atRiskCourses.includes(recipient.course)`
  ([emailSend.ts](server/src/services/emailSend.ts)); the compose preview mirrors it from
  `previewRow.student.atRiskCourses` ([ComposeView.tsx](client/src/features/email/ComposeView.tsx)).
  The editor's Condition control offers it automatically (it enumerates `CONDITION_METRICS`).
- **Condition-control icon:** the toolbar button that opens the Condition control switched from
  `SlidersHorizontal` to `GitBranch` (Lucide) to read as conditional/branching logic
  ([RichTextEditor.tsx](client/src/features/email/RichTextEditor.tsx)).
- **Docs:** API_CONTRACT (boolean metric list + send-time evaluation note).
- **Tests:** server 137 (was 136; atRisk evaluated independently of accommodations), client 96 (added
  atRisk assertions to the existing conditions grammar/format/evaluate specs). Typecheck and tests clean
  on both.

### Step 5b — Cross-tool communication links

Two read-only client-side navigation additions connecting the Email tool, the Students page, and the
teacher's Gmail. No server endpoint, no schema change, no new dependency.

- **Recipient names link to student detail.** In the Email tool's recipient table
  ([ComposeView.tsx](client/src/features/email/ComposeView.tsx)) each student name is now a button that
  navigates to `/students/:studentId` via `useNavigate`, reusing the addressable-route pattern the
  Attendance entry/stats tables already use.
- **"View communication history" Gmail deep link.** The student detail Contact card
  ([StudentDetail.tsx](client/src/features/students/StudentDetail.tsx)) gains a link that opens Gmail
  search pre-filled with an OR query over the student's and guardians' addresses
  (`(from:<addr> OR to:<addr> OR cc:<addr>)` per address, OR-combined). Addresses come from the detail
  page's already-loaded data; the query sits in the URL fragment, which the browser never transmits.
  The link is hidden when the student has no email addresses.
  - **Gmail URL format (corrected after live testing).** The account is selected with the
    `?authuser=<teacherEmail>` query parameter — `https://mail.google.com/mail/?authuser=<email>#search/<q>`.
    The design doc's assumed `/mail/u/<email>/` path form 404s: Gmail's `/mail/u/<n>/` segment accepts
    only a numeric index, not an email. `authuser` still gives the "open the right account when several
    are signed in" behavior the doc wanted (verified against a real multi-account Gmail session). The
    teacher email is left literal in the query value; the search query is `encodeURIComponent`-escaped.
  - The teacher email comes from `useAuth().profile.email`; `StudentDetail` now consumes `useAuth`, so
    its tests (and `StudentsPage`'s, which mounts `StudentDetail`) wrap the tree in `AuthProvider`.
- **Step 5a follow-up — "At risk" email recipient quick-select.** The academic-risk flag shipped in
  Step 5a without an email recipient quick-select to match "High absences"; added one to
  [ComposeView.tsx](client/src/features/email/ComposeView.tsx). `selectAtRisk` selects both the student
  and guardian addresses for every `(student, course)` row where the student is flagged at risk in that
  course (mirrors `selectHighAbsences`; per-course, so a multi-course student is selected only in the
  flagged course). The four quick-selects (Students / Guardians / High absences / At risk) were regrouped
  into one connected segmented control under a single "Select" label so they stay on one line rather than
  wrapping as separate pills; "Clear" stays right-aligned.
- **Tests:** client 101 (was 96; recipient-name navigation, the Gmail link query/scoping/target, the
  no-address omission case, and the two at-risk quick-select cases). Typecheck and full suite clean.

### Dev-velocity pass — bulk-add batch endpoint + schema migration runner

Two developer-experience improvements decided in a planning discussion (Step 6 was tabled in the same
discussion; see Decisions Made below). No new dependencies.

- **`POST /students/batch`.** Bulk add previously issued one `POST /students` per row in a serial client
  loop, each doing ~4–5 sequential Sheets round-trips, so a 16-row add ran ~70–80 serial calls (15–30s).
  The new endpoint ([routes/students.ts](server/src/routes/students.ts),
  `createStudentsBatch` in [services/students.ts](server/src/services/students.ts)) appends all student
  rows in one `appendRows` call and all enrollment rows in one more — ~4 calls for the whole batch
  regardless of size (brand-new students need no enrollment reconcile, so rows are appended directly).
  Validated per-row by the same Zod schema as the single create, capped at 100 rows; any invalid row
  rejects the whole request. All-or-nothing, replacing the old per-row partial-success UX — the client
  ([BulkAddStudents.tsx](client/src/features/students/BulkAddStudents.tsx)) validates every row first,
  then on failure keeps all rows for retry. The now-dead per-row `serverError` plumbing was removed.
- **Schema migration runner.** Bootstrap now brings an existing sheet up to the current schema instead of
  requiring a manual delete/recreate. **Layer A — additive reconciliation**
  ([bootstrap.ts](server/src/services/bootstrap.ts) `reconcileSchema`, renamed from
  `reconcileMissingTabs`): a tab whose header is a *prefix* of the current schema is extended in place by
  rewriting row 1; nullable/defaulted new columns need no data backfill. **Layer B — version-gated
  registry** ([migrations.ts](server/src/services/migrations.ts) `runMigrations`): ordered
  `{from,to,migrate}` steps for non-additive changes, applied stored→target with a per-step version stamp
  and a best-effort Drive backup copy before the first step; registry is empty today. Version read/stamp
  helpers live in [schemaMeta.ts](server/src/services/schemaMeta.ts); `getBootstrapStatus` now reuses
  `readStoredSchemaVersion`. Bootstrap order: Layer B → Layer A → restamp to target. A non-prefix header
  divergence with no registered migration still fails closed with `SHEET_HEADER_MISMATCH`.
- **Tests:** server 147 (was 138; batch service call-count/dedupe/cache tests, additive-reconcile +
  restamp bootstrap tests, and the `runMigrations` walk/stop/backup unit tests). Client 101 (bulk-add
  tests rewritten for the batch call and all-or-nothing failure). `files.copy` added to the fake Drive.
  Typecheck and both suites clean.

### Step 7 — Grouping / Seating Creator

Classroom grouping tool over the existing roster, dual-purpose as a teacher config surface and a
class-facing projected display. Scope confirmed with the user: **groups shown as arranged "table" cards**
(not a positional seating chart), on an **arranged canvas**.
No new dependencies.

- **Schema** ([config/schema.ts](server/src/config/schema.ts)) — added the `groupings` tab (c01 id,
  c02 groupingId, c03 groupIndex, c04 studentIds, c05 groupSize, c06 groupCount, c07 savedAt,
  c08 deletedAt) to `TABS`/`TabName`/`TAB_ORDER`, and `GROUPING_CONSTRAINT_TYPE_KEYS = ['together','apart']`.
  `groupingConstraints` already existed. The addition is purely additive: existing sheets gain the tab via
  the bootstrap missing-tab reconciliation, so **schemaVersion stays 3** (no bump, no migration entry).
  `schema.test.ts` updated to 11 tabs.
- **Algorithm** ([groupingAlgorithm.ts](server/src/services/groupingAlgorithm.ts)) — pure, no IO. A
  union-find fuses `together` constraint members into atomic units; `apart` constraints build a
  student-level adjacency. Conflict detection throws `CONFLICT` when a pair is required both together and
  apart (directly/transitively). Bin count = `ceil(N/groupSize)` or `min(groupCount, N)`, with evenly
  distributed target sizes. Placement shuffles units (Fisher-Yates, injectable RNG) and greedily fills the
  most-under-target apart-safe bin with a random tie-break, up to 200 restarts; exhausting them (an
  infeasible `apart` set) throws `CONFLICT`. Empty population returns no groups.
- **Constraints service** ([groupingConstraints.ts](server/src/services/groupingConstraints.ts)) — CRUD
  over `groupingConstraints`, `studentIds` pipe-joined, cached per user, mirroring `enrollments.ts`.
- **Groupings service** ([groupings.ts](server/src/services/groupings.ts)) — `generateGrouping(course,…)`
  resolves the population from `listEnrollments` filtered to the course, merges stored + ad-hoc
  constraints, and calls `buildGroups` (read-only, nothing persisted). `saveGrouping` writes one row per
  group (shared `groupingId`/`savedAt`, denormalized size/count) in a single `appendRows`.
  `listGroupingHistory` regroups rows by `groupingId`, newest-first by `savedAt` with a ULID tiebreaker
  (since `nowIso()` is second-resolution and two saves can tie).
- **Route** ([routes/grouping.ts](server/src/routes/grouping.ts), mounted `/api/grouping` in
  [index.ts](server/src/index.ts)) — `POST /generate` (Zod `.strict()`, `course` required, size 2..10 /
  count 2..20 with an exactly-one `.refine`), `POST /save`, `GET /history`, and `GET/POST/PUT/DELETE
  /constraints`. The `course` field on generate is a documented one-field addition to API_CONTRACT: Step 7
  is class-scoped, so the server resolves the population rather than the client sending a student list.
- **Client** (`client/src/features/grouping/`) — `types.ts`, [api/grouping.ts](client/src/api/grouping.ts),
  and: `GroupingPage` (orchestrates; reuses `useRoster` for names/courses and the Attendance
  course-dropdown pattern; maps studentId→`goesBy||firstName`+last initial), `ConfigPanel` (hideable
  size/count levers + Generate/Regenerate + Constraints/History buttons), `ConstraintsEditor` (modal:
  add a together/apart rule over 2–10 scoped students, list + per-row remove), `HistoryView` (modal:
  saved groupings newest-first, load onto canvas), and `GroupsCanvas` (accent-headed "Table N" cards in a
  centered flex-wrap; **scale** −/＋ driving one em-based font-size; **fullscreen** via the Fullscreen API
  on the canvas container; **Save** button reflecting saved state). Route wired in
  [App.tsx](client/src/App.tsx), replacing the Grouping placeholder. All styling via existing design
  tokens; accent used only as large card-header fill.
- **Docs** — API_CONTRACT (`course` on `POST /grouping/generate` + class-scoping note), DESIGN_SYSTEM
  (new "Grouping Tool" section: layout, table cards, projection controls, constraints/history modals).
- **Tests** — server 170 (was 147; +23: `groupingAlgorithm` sizes/counts/remainders, together/apart
  respected, both `CONFLICT` cases, randomization, empty population, deterministic RNG; `groupingConstraints`
  CRUD; `groupings` generate/scope/constraints/save/history round-trip). Client 110 (was 101; +9:
  `GroupingPage` empty state, generate-by-size renders labeled cards + names, generate-by-count, save +
  saved state, CONFLICT surfaced, hide-controls projection toggle; `ConstraintsEditor` add/validate/remove).
  Both typecheck and both `npm run build` clean.
- **Not run:** the authenticated end-to-end browser drive (generating/saving/fullscreen in the live app).
  The app auto-redirects to real Google OAuth and needs a teacher Google account + Sheets spreadsheet,
  which the dev environment lacks; verification rests on the algorithm/service unit tests and the full
  component-tree component tests above.

### Step 7 refinement pass — per-class persistence, drag-to-move, display options

A round of changes on the initial Step 7 build, driven by user feedback. No new dependencies.

- **Per-class persistence replaces multi-save + history.** The `groupings` tab gained a `course` column
  (c09, additive — reconciles into existing sheets, schemaVersion still 3). Each class keeps exactly one
  active grouping: [groupings.ts](server/src/services/groupings.ts) `saveCurrentGrouping` soft-deletes the
  course's prior active rows and appends the new arrangement; `getCurrentGrouping` restores it (cached as
  a course→Grouping map). `POST /grouping/save` + `GET /grouping/history` were replaced by
  `PUT /grouping/current` (body `{ course, groupSize?/groupCount?, groups }`) and
  `GET /grouping/current?course=` (returns `Grouping | null`). `HistoryView.tsx` deleted.
- **Auto-save.** The client persists on every change — generate, drag-move, renumber — so there is no
  Save button. [GroupingPage](client/src/features/grouping/GroupingPage.tsx) loads the class's saved
  grouping in an effect keyed on the active course (with a cancelled-flag guard against races), and
  `persist()`/`applyGroups()` upsert after each mutation.
- **Drag-to-move + renumber** ([GroupsCanvas.tsx](client/src/features/grouping/GroupsCanvas.tsx)). Student
  `<li>`s are `draggable`; dropping onto another group's card moves the student (native HTML5 DnD) and
  drops any now-empty group. Each card header has ◀/▶ controls that swap the group with its neighbour
  (keyboard-accessible renumbering; the drop target highlights with `border-accent`).
- **Display options** ([AppearanceSettings.tsx](client/src/features/grouping/AppearanceSettings.tsx),
  [appearance.ts](client/src/features/grouping/appearance.ts)). A modal, opened from the config panel
  (replacing the History button), controls a global localStorage-backed preference: **font** (System /
  Serif / Rounded — system fonts only), **group header colour** (5 swatches), and a **Mark group leader**
  toggle that stars the first member of each group. Applied to the canvas via inline `fontFamily` and
  per-header `backgroundColor`/`color`.
- **Other tweaks.** Label changed **Table N → Group N**; member count removed from the header; **hide
  controls** toggle removed (fullscreen covers the clean-projection need); constraint **note** field
  removed (UI + client payload; the nullable column stays). Scale max raised (0.75–3.5) and member
  line-height made unitless so names don't overlap at large sizes; in fullscreen the groups now centre
  vertically (`content-center`) instead of top-aligning.
- **Tests:** server 173 (was 170; groupings save/history tests rewritten as current-per-course upsert/
  restore/overwrite/independence; schema.test.ts groupings now 9 columns). Client 111 (was 110;
  GroupingPage tests updated for restore-on-load, auto-save on generate, renumber-persists, display-options
  modal). Both typecheck and both `npm run build` clean. Live authenticated browser drive still not run
  (the dev environment is gated behind real Google OAuth + a teacher spreadsheet).

### Step 7 refinement 2 — client-side generation, debounced save, rainbow headers

Two user-requested improvements on the grouping tool. No new dependencies.

- **Rainbow header colours.** Added a "Rainbow" option to the Display-options header-colour swatches
  ([appearance.ts](client/src/features/grouping/appearance.ts) `RAINBOW_PALETTE` /
  `groupHeaderColor(key, index)`): each group header takes the next colour from an 8-colour cycling
  palette instead of one shared colour. The settings swatch is a compact four-colour band preview
  (`RAINBOW_SWATCH_BANDS` — yellow/blue/green/red, hard stops)
  ([AppearanceSettings.tsx](client/src/features/grouping/AppearanceSettings.tsx)); the canvas resolves the
  per-group colour by index ([GroupsCanvas.tsx](client/src/features/grouping/GroupsCanvas.tsx)).
- **Instant, mashable Regenerate via client-side generation.** Previously Regenerate did a server round
  trip (`POST /grouping/generate`, which reads enrollments + constraints from Sheets and runs the solver)
  and then a second write, so there was visible latency and no way to mash the button. The pure solver is
  now mirrored on the client ([groupingAlgorithm.ts](client/src/features/grouping/groupingAlgorithm.ts), a
  faithful copy of [server/src/services/groupingAlgorithm.ts](server/src/services/groupingAlgorithm.ts);
  both carry a "keep in sync" note). Generation is a synchronous local call over the roster
  (`scopedStudents`) plus the constraints (fetched once on mount, refreshed when the constraints modal
  closes), so the arrangement appears immediately with no network wait. `CONFLICT` cases throw a
  `GroupingConflictError` surfaced inline. The server endpoint remains for the documented API but the web
  client no longer calls it (`generateGrouping` removed from [api/grouping.ts](client/src/api/grouping.ts)).
- **Debounced auto-save.** [GroupingPage](client/src/features/grouping/GroupingPage.tsx) now schedules a
  single `PUT /grouping/current` ~900ms after the last change (generate, drag, or renumber), so mashing
  Regenerate writes once. A pending save is flushed before a class switch (in the load effect) and on
  unmount, so switching away or leaving never loses the latest arrangement. The generate button is
  disabled until constraints have loaded so the first generation never silently ignores them.
- **Tests:** client 117 (was 111; added a client solver unit test mirroring the server cases, and updated
  GroupingPage tests for local generation, debounced/auto-save, mash-coalescing into one save, and the
  rainbow swatch). Server unchanged at 173. Both typecheck and both `npm run build` clean. Live
  authenticated browser drive still not run (OAuth-gated dev environment).

### Step 7 fix — balanced group sizes with constraints, largest-first ordering

Bug: with a "keep together" constraint, generating by a fixed number of groups produced uneven sizes —
a group containing a kept-together pair could end up larger than necessary. Root cause: the solver placed
units (a "together" cluster is one atomic unit) in fully random order, so a cluster placed late got
crammed into an already-full bin, overflowing it and forcing another group under size.

Fix (mirrored in both [server](server/src/services/groupingAlgorithm.ts) and
[client](client/src/features/grouping/groupingAlgorithm.ts) solvers, kept in sync):
- **Largest-first placement.** Each restart shuffles the units (for randomness) then stable-sorts them by
  size descending, so big clusters land in roomy bins and singletons fill the gaps evenly. Order among
  equal-size units stays random, so regenerate still varies. (Standard first-fit-decreasing balancing.)
- **Groups listed largest-to-smallest.** `buildGroups` now sorts its returned groups by size descending.
- **Most-balanced-across-restarts selection.** Largest-first fixed the common case, but a second edge
  case remained: with `apart` constraints a single greedy pass could land on a *valid but lopsided* split
  (e.g. 13 into 6 came out `[3,3,2,2,2,1]` or `[4,2,2,2,2,1]` instead of the ideal `[3,2,2,2,2,2]`), and
  the solver returned the first valid arrangement it found. It now scores each restart's arrangement by
  the sum of squared group sizes (minimized by the even split) and keeps the best, stopping early once an
  attempt reaches the even-split optimum. A 5000-run check of the reported case (13 students, 6 groups,
  one together pair + two apart rules) now yields `[2,2,2,2,2,3]` on every run.
- Tests: added even-sizes-with-a-cluster, largest-first-ordering, and even-split-with-together+apart cases
  to both solver test files (server 176, client 119). Both typecheck and both builds clean.

### Step 8 — Random Name Picker

Client-side name picker over the roster (Phase 1 Step 8): pick a class, choose a style, draw one student
at random with a projected reveal. No new server endpoints and no schema change — the picker draws from
`GET /students` (already cached by `useRoster`) and runs selection in the browser. Card deck and wheel
modes shipped; marble race deferred as a stretch goal. No new dependencies.

- **Pure selection + geometry.** [picker.ts](client/src/features/name-picker/picker.ts): `pickRandom`
  (uniform, injectable RNG, guards the theoretical `rng()===1`) and `selectablePool` (roster minus picked
  ids when exclusion is on). [wheelGeometry.ts](client/src/features/name-picker/wheelGeometry.ts): pie
  `segmentPath`, `segmentCenterAngle`, and `nextRotation` — an accumulating clockwise rotation that always
  spins forward ≥ the requested whole turns and lands the chosen segment's center under the top pointer
  from any prior rotation. Both are unit-tested (a 4,000-draw distribution check; landing-from-any-start).
- **Page + round state.** [NamePickerPage](client/src/features/name-picker/NamePickerPage.tsx) reuses
  `useRoster` and the shared course dropdown, scopes the pool to the active course, and decides the winner
  up front before handing it to the animation (fairness independent of visuals). Exclude-already-picked is
  a localStorage-persisted toggle; a drawn student leaves the pool until **Reset**, an emptied pool shows
  an "Everyone has been picked" state, and a class change resets the round via the adjust-state-during-
  render pattern (not an effect, to satisfy `react-hooks/set-state-in-effect`). Every unique winner is
  recorded regardless of the toggle so enabling exclusion later stays consistent. A "Selected" caption
  names the result once the animation settles; controls are disabled mid-animation.
- **Animation modes.** [CardDeck.tsx](client/src/features/name-picker/CardDeck.tsx): a large card over a
  decorative deck whose face flickers through random pool names on a growing-delay (ease-out) timer chain
  and settles on the winner. [Wheel.tsx](client/src/features/name-picker/Wheel.tsx): an SVG wheel, one
  colour segment per eligible student ([palette.ts](client/src/features/name-picker/palette.ts)), spun by
  a `transform` CSS transition; the settle callback fires on a duration-matched timer (more reliable than
  `transitionend`). Both read their latest props from a ref updated in a passive effect so the animation
  effect depends only on a `spinToken` (one animation per draw). Labels shrink and truncate with segment
  count; a single-name pool draws a full circle.
- **Preferences + reduced motion.**
  [preferences.ts](client/src/features/name-picker/preferences.ts) persists style + exclusion in
  localStorage; [usePrefersReducedMotion.ts](client/src/features/name-picker/usePrefersReducedMotion.ts)
  makes both modes skip straight to the result (bypassing the JS timers) on top of the global
  reduced-motion CSS.
- **Routing cleanup.** The `/name-picker` route now renders `NamePickerPage` instead of the placeholder;
  the now-unused `pages/Placeholder.tsx` was deleted since every sidebar route is implemented.
- **Docs.** DESIGN_SYSTEM gained a "Name Picker Tool" section; NEXT_STEPS "Most Recently Completed" and
  "Next Step" (now Step 9 — Design iteration) and the decision record updated. API_CONTRACT already noted
  no new endpoints.
- **Tests:** client 134 (was 119; +7 `picker`, +3 `wheelGeometry`, +5 `NamePickerPage`). Server unchanged
  at 176. Typecheck, feature-scoped lint, and both `npm run build` clean. The component tests force the
  reduced-motion path so the pick outcome is deterministic to assert; the animation quality is a
  manual-verification item per TESTING_PLAN, and per the standing OAuth-gated-verification constraint the
  live authenticated browser drive was not run.

### Step 8 refinement — projection controls + reworked animations

Post-build refinement pass on the Name Picker, driven by review feedback, making it projection-grade and
reworking both animation modes. No new dependencies; still client-only.

- **Wheel — radial spoke labels.** Names now run along the radius like bike spokes instead of horizontally.
  `Wheel.tsx` computes a per-label `translate(...) rotate(...)`: rotation is the segment's outward radial
  angle (`centerAngle − 90°`), with the lower-left half flipped 180° so no label is upside down. Label font
  is smaller relative to the wheel.
- **Wheel — pointer moved to the right, black.** New `POINTER_ANGLE = 90` in
  [wheelGeometry.ts](client/src/features/name-picker/wheelGeometry.ts); `nextRotation` gained a
  `pointerAngle` param and now lands the winner's segment center at the pointer angle (was the top). The
  pointer is a fixed black triangle on the right edge, sized with the same `min(rem, vmin)` basis as the
  wheel so it scales in both normal and fullscreen layouts. Geometry test updated to assert landing at 90°.
- **Wheel — lower friction.** Spin lengthened to ~6s with a gentler ease (`cubic-bezier(0.25,0.3,0.15,1)`,
  6 turns) so it starts at a moderate pace and coasts to a soft stop rather than whipping and braking.
- **Card deck — real 5:7 card + shuffle-then-flip.** [CardDeck.tsx](client/src/features/name-picker/CardDeck.tsx)
  is now a proper playing-card stack (`aspect-ratio: 5/7`). A draw runs a **shuffle** (two depth cards
  riffle apart and back, twice — CSS keyframes `ttk-riffle-l/r`) then **flips** the top card (CSS 3D
  `rotateY` + `backface-visibility`) from a gold-bordered woven back to the name. New picker CSS lives in
  [index.css](client/src/index.css); front-face text is container-query sized so it scales with the card.
- **Projection stage (both modes).** New [PickerStage.tsx](client/src/features/name-picker/PickerStage.tsx)
  wraps the mode in the Grouping-style `bg-surface` surface with a **Size** −/＋ control (larger default,
  `DEFAULT_SCALE` 1.4; the animation scales with it) and a **fullscreen** toggle (Fullscreen API). It also
  hosts the exhausted-round message and the Selected caption. `CardDeck`/`Wheel` take a `scale` prop.
- **Deferred removal.** "Remove selected students" (renamed toggle) now removes a drawn student **on the
  next draw** rather than on settle, so the current pick stays visible on the wheel until the next spin.
  The page commits the previous winner into `pickedIds` at the start of `handlePick`; exhaustion is derived
  (`excludePicked && lastPick === null && pool.length === 0`).
- **No draw on arrival.** Each mode tracks a `prevToken` ref and animates only when `spinToken` actually
  changes (not on mount / mode switch / navigation), so opening the picker never auto-spins.
- **Browser-verified via a throwaway harness.** Because the app is OAuth-gated, a temporary
  `picker-preview.html` + `picker-preview.tsx` rendered the modes with mock data outside the gate. Confirmed
  live: the wheel lands the winner exactly under the right pointer (e.g. rotation 2497.5° → segment center
  112.5° resting at 90°, caption "Jonathan Park"), all 8 radial labels upright, pool unchanged after a pick
  (deferred removal), the card a 240×336 (5:7) shuffle-then-flip with a gold back and container-query text.
  Harness then deleted.
- **Tests:** client 135 (`NamePickerPage` suite reworked for deferred removal / no-draw-on-arrival / wheel
  retains selection; `wheelGeometry` updated for the right pointer). Server unchanged at 176. Typecheck,
  feature-scoped lint, and both builds clean.

### Step 8 refinement round 2 — wheel labels, pointer, click-to-spin, card flip

Second review-driven tuning pass on the Name Picker. No new dependencies.

- **Wheel labels read the same way, upright at the pointer.** Dropped the lower-half 180° flip; every label
  now uses the same `centerAngle − 90°` rotation, so a name is right-side-up exactly as its segment passes
  the right pointer (browser-verified: rotations `-67.5…` with no flips). Labels are `text-anchor: start`
  anchored near the hub (`LABEL_START = 0.15R`) and run outward, using the full radius before truncating
  (truncation raised to 18 chars for ≤18 students; the 8 harness names all fit un-truncated). Font bumped
  from ≤12 to ≤13.
- **Pointer halved + outlined.** Re-rendered as an SVG triangle (was a CSS border triangle) so it can carry
  a **thin white outline**; sized to ~half (≈17px wide at the default scale, was ≈33px).
- **Click-to-spin.** The wheel is now a `<button aria-label="Spin the wheel">`; clicking anywhere on it
  triggers a draw via a new `onSpin` prop threaded page → `PickerStage` → `Wheel`. Locked out mid-spin
  (`disabled={animating}` plus the page's existing `if (animating) return`) — verified the mid-spin click
  is ignored.
- **Card deck flip-down reworked.** A new draw now: (1) flips the current face-up card **face-down while
  keeping its name** (no longer blanked at flip start), (2) waits for that flip to finish, (3) **then**
  runs the riffle shuffle, (4) flips up the new name. The pre-spin `flipped` is carried on the ref so the
  effect knows whether a flip-down is needed (skipped on the first draw). Browser-verified timeline: at
  +200ms name still shown & not shuffling; shuffle starts only after the ~650ms flip-down.
- **Reset keeps the result caption.** Split the caption (`selected`, survives Reset) from the
  removal-logic pointer (`lastPick`, cleared by Reset), so Reset restarts the round (counter back to 0,
  pool refilled) without wiping the on-screen "Selected" name. A `resetKey` (the active course) remounts
  the mode on class change so a stale card/wheel doesn't linger across classes.
- **Tests:** client 137 (+2: Reset keeps the caption; clicking the wheel spins). Server unchanged at 176.
  Typecheck, feature-scoped lint, and both builds clean. Re-verified live via the throwaway harness (radial
  upright labels fitting the rim, half-size outlined pointer, click-to-spin landing under the right pointer
  with mid-spin lockout, and the flip-down→shuffle→flip-up card timeline), then removed it.

### Step 8 refinement round 3 — display options, colour/back schemes, sound

Third refinement pass adding projection customization and audio. No new dependencies (sounds are
synthesized with the Web Audio API; no assets).

- **Display options modal** ([PickerDisplayOptions.tsx](client/src/features/name-picker/PickerDisplayOptions.tsx)),
  opened from a new **Display options** button in the config panel (mirrors Grouping). Sections: **Font**
  (system/serif/rounded, applies to both modes and the caption — [fonts.ts](client/src/features/name-picker/fonts.ts));
  and, per current mode, **Wheel colours** or **Card back**. Prefs extended in
  [preferences.ts](client/src/features/name-picker/preferences.ts) (font, wheelScheme, cardBack, sound),
  all persisted.
- **Wheel colour schemes** ([palette.ts](client/src/features/name-picker/palette.ts)): Rainbow default
  (swatch is the same four-band gradient Grouping uses) plus two-tone alternating schemes — Black & white,
  Blue & orange, Purple & gold, Teal & magenta — where adjacent segments alternate the pair. `schemeColor`
  cycles the scheme by index; verified live (rainbow gold/blue/green/red; `bw` alternates #111/#f5f5f5).
- **Card-back designs** ([cardBacks.ts](client/src/features/name-picker/cardBacks.ts) + `ttk-deck-back--*`
  classes in [index.css](client/src/index.css)): Classic (default), Crimson, Forest, Royal (gold
  crosshatch), Dots. The card-back border width became a `--ttk-deck-border` variable so the modal's mini
  previews can shrink it; each design supplies its pattern + border colour.
- **Wheel label tweaks:** font up 13→14; labels start further out (`LABEL_START` 0.15R→0.21R). Verified the
  8 sample names still fit un-truncated (max reach radius 139 of 150). Wheel `<text>` and card front now use
  the chosen font.
- **Card deck click-to-draw.** The deck is now a `<button aria-label="Draw a card">` with the same
  onSpin/disabled lockout the wheel got, so clicking the deck draws (ignored mid-animation).
- **Sound effects** ([sound.ts](client/src/features/name-picker/sound.ts)), on by default, toggled by a
  sound icon beside the stage's Size control. Web Audio synthesis, lazily created and resumed inside the
  Pick click (`primeAudio`), and a no-op when Web Audio is unavailable (so jsdom tests need no guards):
  decelerating wheel ticks + a two-tone landing chime; card riffle clicks + flip whooshes. Gated on the
  `sound` pref and skipped under reduced motion. Verified live: a pick throws no errors with audio present.
- **Tests:** client 140 (+3: card-deck click draws; Display options shows font + mode-specific colour/back
  groups; sound toggle flips mute/unmute). Server unchanged at 176. Typecheck, feature-scoped lint, and
  both builds clean. Verified live via the throwaway harness (font 14 labels fitting the rim, two-tone
  alternation, all card backs applying, sound erroring-free), then removed it.

### Step 8 refinement round 4 — per-mode font, wheel font sizing, layout, shadow

Small review-driven tuning pass. No new dependencies.

- **Font stored per mode.** Split the single `font` pref into `wheelFont` + `cardFont`
  ([preferences.ts](client/src/features/name-picker/preferences.ts); older saved `font` migrates into
  both). The Display options Font section edits whichever mode is showing; `PickerStage` passes each mode
  its own font, and the caption uses the active mode's. Verified live: wheel renders system, card front
  serif, independently.
- **Wheel label sizing reworked.** Lowered the max font (few names) from 14 to **11** and flattened the
  shrink so it only eases to ~9–10 as the wheel fills (`labelFontSize` = clamp 9…11 of `9 + 30/count`,
  was clamp 7…14 of `6 + 80/count`) — the previous max was overrunning the rim with long names on a
  near-empty wheel. Truncation is now **length-aware**: `maxChars` derives from the radial room left at the
  current font (`LABEL_END − LABEL_START`), so a name can no longer run past the rim. Verified: a 29-char
  name on a 3-name wheel truncates to end at radius 138/150; a 24-name wheel renders at font 10, no overflow.
- **Labels start further out.** `LABEL_START` 0.21R → **0.28R**.
- **Wheel drop shadow.** Added the cards' soft shadow to the wheel via `filter: drop-shadow(...)` on the
  non-rotating container (so it follows the circular silhouette and stays put while spinning).
- **Config layout swap.** The **Picked _n_ of _m_** count moved up into the right-hand action cluster
  (beside Reset/Pick) and the **Display options** button moved down to its own row — swapping their prior
  positions.
- **Tests:** client 141 (+1: wheel and card fonts stay independent). Server unchanged at 176. Typecheck,
  feature-scoped lint, and both builds clean. Verified live via the throwaway harness (font ceiling 11 /
  gentle shrink, long-name truncation within the rim, per-mode fonts, drop shadow present), then removed it.

### Step 8 refinement round 5 — off-center wheel landings ("close call")

The wheel previously always landed the pointer on a segment's exact center. Now it lands **anywhere across
the winning segment**, so it can stop near a border for an entertaining near-miss without ever being
ambiguous. Purely cosmetic — the winner is still decided upstream, so fairness is untouched.

- `nextRotation` ([wheelGeometry.ts](client/src/features/name-picker/wheelGeometry.ts)) gained an
  `offsetDeg` param (default 0) that shifts the landing point within the segment.
- `Wheel` picks a uniform random offset in ±(half-segment · `LANDING_SPREAD` = 0.86) per spin (0 when it
  snaps under reduced motion / a one-name pool), so the pointer can approach a border but a ~14% buffer
  keeps it clearly inside the winner.
- Tests: +1 geometry test (off-center offset lands at the pointer and stays within the wedge); client 142.
  Verified live via the throwaway harness — three spins landed at 0.3° / −5.7° / −2.7° off-center, all
  inside the segment — then removed it. Typecheck, feature-scoped lint, and both builds clean.

### Step 9 — Design iteration (cross-tool polish pass)

The last Phase 1 item: not a feature but a consistency/polish pass over the five finished tools, against
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Focus: shared loading/error/empty states, cross-page layout
consistency, user-facing terminology, and a codebase-wide lint cleanup. No behavior or schema change.
Client tests stay at **142** throughout (assertions updated for renamed labels and moved imports);
typecheck and both builds clean.

- **Shared state components** (`client/src/components/ui/`): `Spinner`, `LoadingState` (centered spinner +
  caption, `role="status"`), `ErrorState` (muted icon + message + optional action, `role="alert"`),
  `EmptyState` (icon + heading + description + optional action), and `Skeleton` (pulsing `bg-hover`
  placeholder). Every tool's duplicated inline load/error/empty blocks route through these. Full-page loads
  now show a **centered spinner** (were plain "Loading…" text); inline fetches (attendance summary,
  heatmap, grouping constraints) show **shape-matched skeletons**; errors use a consistent icon + `Button`
  retry. The code-split `EmailPage` `Suspense` fallback now uses `LoadingState`, so opening Email no longer
  flashes plain "Loading…" before the spinner. Grouping's `ConfigPanel` is gated behind a load flag
  (`ConfigPanelSkeleton`) so the mode/target controls no longer flash their defaults before a class's saved
  grouping resolves.
- **Shared layout primitives** (`client/src/components/ui/`): `PageHeader` (title + right-aligned control
  cluster), `SegmentedControl` (replaced four copy-pasted `ViewTab`/`ModeTab` components across Attendance,
  Email, Name Picker, Grouping), and `Select` (replaced six copies of the `SELECT_CLASS` dropdown-styling
  string, including four in `ComposeView` and one inline in `StudentDetail`). Adopted across all five tool
  pages; the Students roster no longer breaks the shared header shell (now uses the same `items-center` +
  `gap-4` rhythm). Net **−103 lines** despite adding the components.
- **Visual consistency:** Grouping's primary **Generate** button is now right-aligned (`ml-auto`), matching
  Name Picker and the site-wide "primary action on the right" convention (Students, Attendance entry,
  Student detail, and modals all right-align their primary action).
- **Terminology → "Class":** every user-facing label now reads "Class"/"Classes" (the scoped-tool
  dropdowns, the roster filter + sort option, the stats table column, the add/bulk-add enrollment fields).
  The Sheets schema, API, and all code identifiers keep `course`/`courses` — copy only, no data change.
- **Lint cleanup** (codebase-wide, low-risk scope): **~12 problems → 2.** Fixed every
  `set-state-in-effect` finding — `StatsView` clears its error on success rather than synchronously in the
  effect; `AttendanceHeatmap` and `AttendanceSummary` reset to the loading state via the render-time
  "adjust state when the target changes" pattern (an object key over `studentId`/`course`). Fixed most
  `react-refresh/only-export-components` mixed-export findings — extracted `rosterControls.ts` (module state
  + `resetRosterControls` test hook) and `heatmapDays.ts` (`classifyDay` + `DayCategory`), un-exported the
  internal `isFlagged`, and dropped the dead `PRONOUN_OPTIONS` and `todayIso` re-exports — plus an unused
  `eslint-disable`. The two remaining (`useAuth`/`useTheme` provider+hook splits) were deliberately deferred
  as the invasive option, standard React pattern.
- **Docs/decisions** (in [NEXT_STEPS.md](NEXT_STEPS.md)): marble race recorded as **sim-decided /
  non-deterministic** (fairness from symmetric randomized initial conditions, not `pickRandom`) and demoted
  to a stretch goal; **toasts** kept inline-only for Phase 1 with an inline/toast hybrid as a Phase 3
  consideration (DESIGN_SYSTEM Toasts section updated to match); and the **"Class"** user-facing
  terminology decision.
- **Committed in two parts:** an earlier checkpoint (`d9096d6`) shipped the shared state components,
  skeletons, the EmailPage/`ConfigPanel` load-flash fixes, and the marble-race/toast doc decisions; then
  the consistency pass (layout primitives + terminology + Generate realign) and the lint cleanup landed as
  their own commits. Design iteration stays an ongoing process; this pass covered shared states, cross-page
  consistency, terminology, and lint.

### Step 4b — Attendance History view

A third view on the Attendance page (segmented toggle: **Daily Entry · History · Statistics**), showing the
whole class's recorded attendance at once — one row per student, one column per school day, scrolling into
the past. It is the read-only, class-wide complement to the per-student detail heatmap: Daily Entry shows one
day for every student, the heatmap shows every day for one student, Statistics collapses the days into totals,
and History is the remaining axis (every student against every day) where a class-wide pattern is visible.

- **Server:** `GET /attendance/range` gained an optional `course` query param (route + `listByRange`
  service), mirroring `GET /attendance`. Additive; existing heatmap callers omit it and are unaffected. One
  new service test covers course-scoped vs. all-courses range reads. No schema change.
- **Shared classifier moved:** `classifyDay` + `DayCategory` (formerly `features/students/heatmapDays.ts`,
  extracted there in Step 9) moved to `features/attendance/heatmapDays.ts`, now also holding the
  `CELL_CLASS`/`CATEGORY_LABEL` color+label maps and `mergeStatus` (all previously inline in
  `AttendanceHeatmap.tsx`). Both the detail heatmap and the History grid import them, so the two views cannot
  drift on what color a status is. Pure-function tests moved alongside into
  `features/attendance/heatmapDays.test.ts`; the heatmap component test lost its duplicated `classifyDay`
  block.
- **`HistoryView.tsx`:** a real `<table>` in a bounded, vertically-scrollable container — sticky student-name
  column (`<th scope="row">`, links to detail) and a sticky two-row header (`<th scope="col">`: a month
  `colgroup` band + a day-number row), weekday-only date columns with a fixed 8px gap between weeks (a
  transparent left border that takes the row background and keeps columns aligned, rather than a rule) and a
  very faint zebra stripe (alternate rows one background step lighter), cells colored by the shared classifier
  with a corner dot for a note, a note in each cell's visually hidden status text (color is never the only
  channel), a shaped skeleton while loading (a blank header bar + a single name-column row, no day cells), and
  the shared `EmptyState` when the class has no records in the window. Trailing 26-week window (the heatmap
  constant), leading empty weeks trimmed to a floor, opened scrolled to today. Read-only: the only
  interactive controls are the name links; corrections stay in Daily Entry. Five component tests.
- **Cross-highlight (perf):** the row/column highlight is drawn as two absolutely-positioned translucent
  overlay bars (`bg-primary/9`) placed from the hovered cell's offset geometry, with the grid `memo`-ized, so
  pointer movement re-renders only the two bars and the readout line — not the (students × school-days) cells.
  The column bar subtracts the week gap so a Monday's highlight is the same width as any other day. The
  readout below the grid names the hovered student, date, status, and note.
- **Verification:** server + client typecheck clean; server 177 tests, client 148 tests pass; client build
  succeeds. Lint holds at the two pre-existing deferred `useAuth`/`useTheme` splits (new files add none).

### Step 9 (design iteration) — Responsive edge-case audit

Swept all five tools at mobile (375px) and tablet (768px) against the DESIGN_SYSTEM responsive breakpoints,
with the Step 4b History view included. Because the app is OAuth-gated and reads everything from Sheets, it
can't be driven in a browser without a live Google login, so verification used a throwaway dev harness
(`client/harness.html` + `src/harness.tsx`, since removed) that stubbed `window.fetch` for every `/api/*`
route with fixture data and mounted the real `<App/>`, then measured layout via DOM geometry
(`getBoundingClientRect`, computed `grid-template-columns`, `documentElement.scrollWidth` vs. the viewport)
at each width. Fixtures deliberately included long names, "goes by" aliases, multi-course enrollments, long
email addresses, at-risk/high-absence flags, and multiple accommodations, to stress truncation and wrapping.

- **Found and fixed one genuine breakage — the roster row on mobile.** [RosterView.tsx](client/src/features/students/RosterView.tsx)
  laid each row out as a single fixed grid (`grid-cols-[32px_…_56px_160px]`) at every width. Below the `sm`
  breakpoint the fixed 160px accommodations column and 56px risk column (plus the 32px avatar and gaps)
  consumed the whole row, computing the two fluid columns to **0px** — so on a phone the student's name and
  classes were invisible. The roster is the landing page, and DESIGN_SYSTEM calls for card layouts below
  768px, so the row now reflows to a stacked card on mobile: a `grid-cols-[auto_1fr]` (avatar + content)
  whose content wrapper is `flex flex-col` on mobile and `sm:contents` at ≥640px — `display: contents`
  dissolves the wrapper so each field becomes a direct grid cell of the original columnar row at `sm`+, with
  no duplicated markup. Below `sm`: name, classes, then risk icons and accommodation badges each wrap onto
  their own left-aligned line (`empty:hidden` collapses the icon/badge lines when a student has none); the
  email line stays hidden as before. Verified: at 375px the name column measures 249px (was 0); at 1280px the
  full six-column row (`32px 218px 179px 238px 56px 160px`) is unchanged.
- **Everything else passed with mobile breakpoints active** (confirmed via `matchMedia` that `sm`/`md` were
  false at the narrow width). No horizontal page overflow on: Attendance Daily Entry (rows stack to one column
  below `sm`), Grouping (config toolbar wraps; group cards are em-scaled and flex-wrap), Name Picker (control
  panel wraps), Email Compose (the two-column `lg:grid-cols-2` collapses to one; quick-select segments and
  recipient rows fit), Student Detail (attendance summary is 2-col on mobile, 3-col at `sm`), and the shared
  PageHeader toolbars. The three dense data grids — Statistics, the History grid, and Bulk Add — keep their
  content inside an intentional inner horizontal scroll container (`overflow-x-auto` with a `min-w`), which is
  the accepted fallback for a wide table on a phone rather than a break. The mobile sidebar drawer's open
  state (class + `--tw-translate-x` variable) applies correctly.
- **Verification:** client 148 tests pass, typecheck and production build clean. The one code change is
  `RosterView.tsx` (+47/−42); the harness files were removed after the sweep. No feature or schema change.

Follow-up fixes from on-device (iPhone SE, 375×667) testing, verified the same way:

- **History student column** trimmed 180px → 160px ([HistoryView.tsx](client/src/features/attendance/HistoryView.tsx)).
  Because the grid is an auto-layout table, a `width` on the cell is only a hint — a long name (`nowrap`
  truncation) grew the column to its content. Fixed by giving the name button a fixed pixel width (column
  minus the cell padding), so the column resolves to exactly 160 regardless of name length.
- **Statistics table** ([StatsView.tsx](client/src/features/attendance/StatsView.tsx)) now scrolls inside a
  bounded `max-h-[70vh] overflow-auto` container with the **student column and header row both pinned**
  (`position: sticky`, `border-separate` so the sticky cells keep their borders). Switched to `table-fixed`
  so the pinned column has an authoritative width that stays header/body-aligned: the Student column is
  `w-[150px]` on mobile, `w-[210px]` at `sm`+. The high-absences flag changed from a red pill to the yellow
  `text-warning` calendar icon (matching the student-detail summary), with its **"High absences" label hidden
  below `sm`** so only the icon shows in the narrow pinned column on a phone.
- **Student-detail attendance heatmap** ([AttendanceHeatmap.tsx](client/src/features/students/AttendanceHeatmap.tsx))
  now fits the visible-week count to the measured container width (a `ResizeObserver` on the root, read in a
  layout effect so no too-wide frame flashes), showing the fewer of "weeks since first record" and "weeks
  that fit." On iPhone SE it renders ~10 weeks with no horizontal scroll (the day labels are visible without
  scrolling); on desktop the window is unchanged. A no-op `ResizeObserver` stub was added to the test setup
  (jsdom has none).
- **Modal** ([Modal.tsx](client/src/components/ui/Modal.tsx)) is now a flex column capped at
  `max-h-[calc(100dvh-2rem)]` with a scrollable body and pinned header/footer, so a tall form (add-student,
  grouping constraints) fits a short screen — on iPhone SE the panel is 635px tall inside the 667px viewport,
  the body scrolls, and the footer buttons stay visible. Covers every modal (all use this shared component).
- **Button labels no longer wrap.** Added `whitespace-nowrap` to the shared [Button.tsx](client/src/components/ui/Button.tsx)
  base, so "Pick a name", "Add Students", etc. stay on one line in tight toolbars.
- **Verification:** client 148 tests pass, typecheck and production build clean.

Second on-device round — three stacking/overflow bugs from continued manual mobile testing:

- **History cross-highlight painted over the pinned name column on horizontal scroll.**
  [HistoryView.tsx](client/src/features/attendance/HistoryView.tsx) drew the row/column highlight overlay
  bars at `z-30`, above the sticky name column's `z-20` — so scrolling right while a cell was hovered slid
  the column bar on top of the pinned names. All of the grid's internal sticky layers were rebased into a
  single low range (highlight bars `z-5`, body name column `z-10`, header rows `z-20`, sticky top-left
  corners `z-25`), all kept under 30 for the next fix.
- **Sticky table headers fought the mobile drawer overlay.** On both Statistics and History, opening the
  sidebar drawer (overlay `z-30`, drawer `z-40`) left the sticky header row mis-layered: Statistics' student
  header sat at `z-30`, tying the overlay so it never visibly faded; History's corner cells sat at `z-40`,
  literally above the drawer. Both grids' sticky z-indices now stay below the drawer overlay (History's
  highest layer is `z-25`; [StatsView.tsx](client/src/features/attendance/StatsView.tsx)'s pinned header
  corner dropped from `z-30` to `z-[25]`), so the whole grid — including headers — fades under the overlay
  like the rest of the page, and never renders above the open drawer.
- **The wheel/card-deck animation could transiently widen the page, shifting the top bar.**
  [PickerStage.tsx](client/src/features/name-picker/PickerStage.tsx)'s stage card had no overflow clipping;
  the wheel's rotating square SVG (a circle inscribed in a square, so the corners sweep past the visible
  circle mid-spin) and the card deck's riffle animation could extend the scrollable content area past the
  viewport during the animation, growing `document.documentElement.scrollWidth` and shifting the fixed,
  right-aligned top-bar controls (theme toggle, settings, avatar) for the duration. Fixed with
  `overflow-hidden` on the stage container — the wheel and deck are already visually self-contained within
  it, so nothing intended to show outside its bounds is clipped.
- **Verification:** client 148 tests pass, typecheck and production build clean.

### Step 9 (design iteration) — Sheets read-quota backlog (single-flight, shared read, merge-not-drop)

Closed the three Phase-1-friendly items on the Sheets read-quota mitigation backlog, all behind the existing
per-user server cache seam (`server/src/services/cache.ts`). No feature, API, or schema change: API responses
are byte-identical and only the server's internal read/cache behavior changed. This is a single-teacher
read-reduction pass; the larger read-scaling architecture (in-memory working set, Drive `files.watch`
invalidation, Drive-export hydration) stays deliberately in Phase 2.

- **(a) Single-flight coalescing.** Added `getOrLoad(key, loader, ttl?)` to `cache.ts`. It returns the
  cached value if warm, otherwise loads once while coalescing concurrent misses of the same key onto that
  single loader promise, caching the value before the promise resolves. The in-flight entry is removed on
  settle via `.finally`, so a **rejected** load clears cleanly (nothing cached, nothing pending) and the
  next caller retries — a failed read can never poison the key into a permanent hang. Every cached read now
  flows through it: `listStudents`, `listEnrollments`, `listAllIep`, `listAllRecords` (attendance),
  `listCurrentGroupings`, `listConstraints`, `listTemplates`, and `dailySentCount` (kept at its 30s TTL).
- **(b) One shared cached tab read across list / detail / summary.** The `iep` tab was previously read three
  ways — a per-student `iep:<studentId>` cache (`listIep`), a lossy `iep-summary` cache (`listIepSummary`),
  and a fresh read inside `getStudentDetail` — so opening a student right after the roster re-read the iep
  tab. Replaced all of it with a single **`iep-all`** cache (`listAllIep`, every active IEP record), which
  `listIep` (filter by student), `listIepSummary`, and `getStudentDetail` all derive from in memory.
  `listIepSummary` no longer keeps its own cached copy; it derives live from the shared students + `iep-all`
  caches, which let the cross-file `iep-summary` invalidation that `students.ts` carried on student
  create/delete be deleted. `getStudentDetail` still batches only the cold tabs into one `values.batchGet`
  and now populates `iep-all`, so a detail open from an already-loaded roster reads nothing. Removed the now
  unused `iepResourceKey` and `deriveIepForStudent`; added `deriveAllIep` and exported `IEP_ALL_RESOURCE`.
- **(c) Merge-not-drop invalidation during editing.** Added `updateCached(key, updater)`: when a mutation's
  result is known, merge it into the warm cache (keyed by the domain object's `id`) rather than dropping the
  entry, so a tight editing loop keeps serving from cache instead of running cache-cold after every write.
  It is a deliberate no-op on a cold key (the next read derives fresh), and it is safe because every write
  still goes through to the Sheet first and re-reads there for row numbers — this only updates the read-side
  derived view, so appends to a derived list never need a sheet row number. Applied to the hot loops: IEP
  create/update/delete (`iep-all`), attendance `submitAttendance` (updates replaced by id, new rows
  appended) and `updateAttendance` (`attendance`), the at-risk toggle (`setEnrollmentAtRisk` merges
  `enrollments`; `setStudentAtRisk` recomputes just that student's `atRiskCourses` in `students`),
  `updateStudent` profile/notes edits (`students`), grouping auto-save (`saveCurrentGrouping` sets the
  course's entry in the `groupings` map), and email-template + grouping-constraint create/update/delete.
  Operations that cascade across tabs (`softDeleteStudent`) still invalidate the affected caches — the delete
  cascade already reads each child tab fresh, so there is nothing to merge.

**Architecture note.** The design keeps the existing "cache derived domain objects, not raw tab rows" model:
reads derive typed objects (`Student[]`, `Enrollment[]`, `IepRecord[]`, …) from a Sheets read and cache
those, and merges operate on those derived caches by `id`. Row numbers live only in the write path, which
always reads the tab fresh, so the read cache never has to track them. `getOrLoad` and `updateCached` are the
two new seams; the per-service `getCached`/`setCached`/`invalidate` calls were replaced by them everywhere a
read or a hot-path write occurs.

- **Verification:** server suite 188 pass (11 new), `tsc` typecheck and build clean. New `cache.test.ts`
  unit-tests single-flight (coalescing to one call, rejection cleanup + recovery, caching before resolve,
  cached-hit skips the loader) and merge (warm apply, cold no-op). `iep.test.ts` adds an integration test
  that the roster summary + `listIep` + `getStudentDetail` together read the iep tab once, and that IEP
  create/update/delete merge the shared `iep-all` cache. `attendance.test.ts` adds tests that a submit and a
  correction re-submit are then served from the warm cache with zero further reads. No client change.

### Phase 2 Step 1 — Database & account model (Postgres account store; code-complete, live verification pending)

First Phase 2 step: replaced the single-user encrypted token file with a multi-user, Postgres-backed account
model. Stack decided with the user: Postgres + raw `pg` (no ORM), run natively in local Windows dev. The
database holds no student PII — the `users` table holds only Google identity, the teacher's own contact
fields, the Sheet ID mapping, subscription status, and the encrypted refresh token; all student data stays in
the teacher's Sheet.

- **New DB layer.** `db/pool.ts` (lazy shared `pg.Pool`), `db/migrations.ts` (ordered in-code migration list;
  `0001_create_users`), `db/runMigrations.ts` (applies unrecorded migrations at boot, each in a transaction,
  tracked in `_migrations`, idempotent). Migrations are in-code TS rather than `.sql` files so the `tsc` build
  needs no copy step (they emit to `dist/db/`).
- **AccountStore** (`services/accountStore.ts`): `getByGoogleSub` / `upsert` / `updateSpreadsheetId` / `delete`,
  with a Postgres impl (encrypt-on-write / decrypt-on-read) and an in-memory impl for tests. `upsert` is
  insert-or-update-identity on the `google_sub` unique key, preserving `id` and `spreadsheet_id`. Replaced the
  deleted single-user `TokenStore` (file + memory impls, `tokenStore.ts` + its test removed).
- **TokenCipher** (`services/tokenCipher.ts`): AES-256-GCM extracted from the old token store behind an
  interface; env-var key now, KMS-swappable at the hosting step.
- **Seam + routes.** `resolveSheetsContext` / `resolveEmailContext` (`middleware/sheetsContext.ts`) and the
  `auth` / `bootstrap` routes resolve the account by the session's `google_sub` and became async; all data
  routes (`students`, `attendance`, `email`, `grouping`) `await` them. `googleAuth` lost `authorizedClientFromStore`
  in favor of `authorizedClientForRefreshToken`; the OAuth callback now `upsert`s the account then sets the
  Sheet ID. `buildApp` builds one shared store and injects it into every router; `index.ts` runs migrations
  before `listen`. Logout clears the cookie only. `config/env.ts` gains `database.url` + `tokenCipher.key`
  (both required in prod), drops `TTK_DATA_DIR`/`dataDir`. Added `pg` + `@types/pg`; `DEPENDENCIES.md` updated.
- **Verification.** Typecheck + build clean; server suite 195 pass (added `tokenCipher.test.ts` and
  `accountStore.test.ts`; removed the file-token-store test). Verified against a live Postgres: the migration
  runner creates the `users` table at boot with the intended schema, and the pg `AccountStore` passed an
  end-to-end check (insert + defaults, encryption at rest with plaintext absent from the stored column, decrypt
  on read, `updateSpreadsheetId`, re-sign-in upsert preserving id + spreadsheet, delete). The interactive Google
  sign-in was then run live: a real sign-in wrote the expected `users` row (identity, an encrypted refresh token,
  and the discovered spreadsheet id), confirming the full OAuth → account-row → Sheet-bootstrap path.

### Phase 2 Step 2 — Session management (server-side sessions, CSRF, route gating)

Replaced the stateless HMAC session cookie with server-side session records, added per-session CSRF tokens on
every state-changing endpoint, and moved authentication from a per-handler check to middleware at each router
mount. The sessions table holds no student PII — the account it belongs to, its CSRF token, and its timestamps.

- **Session records.** New `0002_create_sessions` migration: `sessions(id_hash, google_sub → users ON DELETE
  CASCADE, csrf_token, created_at, last_seen_at, expires_at)`, indexed on `google_sub` and `expires_at`. Only
  the SHA-256 of the cookie's session id is stored, so a database dump yields nothing replayable as a cookie.
- **SessionStore seam** (`services/sessionStore.ts`): `create` / `get` / `destroy` / `destroyAllForUser` /
  `deleteExpired`, with a Postgres impl and an in-memory impl for tests. Lifetime is 30 days absolute or 14
  days idle, whichever comes first; `last_seen_at` is rewritten at most once an hour, so an active session
  costs one write per hour rather than one per request. `index.ts` sweeps expired rows hourly (housekeeping
  only — expiry is already enforced on read).
- **Cookie.** Now carries an opaque signed session id (`s2.<id>.<sig>`, the signature rejecting forged values
  without a database hit) instead of the self-describing `s1.` payload; still HttpOnly / SameSite=Lax / Secure
  in production. Signing in mints a fresh id, so a planted cookie can never be promoted to an authenticated
  one; logout deletes the session row, which is what makes sign-out a real revocation.
- **CSRF** (`middleware/csrf.ts`): unsafe methods must echo the session's token in `X-CSRF-Token`, compared
  with `timingSafeEqual`; failures return the new `CSRF_INVALID` (403). The token is issued with the session
  and handed to the client by `GET /auth/me`, which now returns `csrfToken`.
- **Route gating.** `requireSession(sessions)` + `requireCsrf` mount in front of every non-auth router in
  `buildApp`, so bootstrap / students / attendance / email / grouping / internal are gated in one place.
  Handlers read `sessionOf(req)`; `resolveSheetsContext` / `resolveEmailContext`, `bootstrap`, and the email
  burst limiter's key now use the loaded session rather than re-parsing the cookie. `internal.ts` dropped its
  own `requireSession`.
- **Client.** `api/client.ts` attaches `X-CSRF-Token` to non-safe requests, and on a `CSRF_INVALID` refreshes
  the token from `/auth/me` and replays the request exactly once (covering a session replaced in another tab);
  `useAuth` arms and clears the token on sign-in and sign-out.
- **Verification.** Server 216 pass (new `sessionStore.test.ts`, `csrf.test.ts`, `auth.test.ts`; `session.test.ts`
  rewritten for the new cookie and gate), client 152 pass (new `client.test.ts`), typecheck, build, and lint
  clean on both. Live-verified against the provisioned Postgres: the migration creates `sessions` with the
  intended columns, only the id hash is stored (the raw id is absent from the row), `get` resolves a live
  session and round-trips its CSRF token, `destroy` and `destroyAllForUser` revoke, and deleting an account
  cascades its sessions away.

### Phase 2 Step 3 — Plan entitlements (three plan states, server-side gating, the free email cap)

Made plan state a property of the account record, resolved on every request and enforced on the endpoint.
Billing is deliberately absent: nothing in this step writes the Stripe-managed subscription fields, which is
what lets Step 3b's webhook become their sole writer and keeps app state and billing state from disagreeing.

- **Account model.** Migration `0003_add_plan_and_settings` adds `plan_override`, `trial_ends_at`, the
  `high_absence_min_rate` / `high_absence_min_days` setting, and `monthly_email_period` /
  `monthly_email_count`. Existing rows are backfilled with a trial measured from `created_at` rather than
  from the deploy, so nobody loses one; `upsert` writes `trial_ends_at` on insert only, so signing in again
  never restarts a spent trial. `addMonthlyEmailCount` resets and increments in a single statement, so two
  sends racing across a month boundary cannot both reset and lose a count.
- **Resolution order** (`services/plan.ts`): `plan_override`, then an unexpired `trial_ends_at`, then
  subscription state, then `free`. `effectiveHighAbsence` applies the "stored but not applied" rule for
  `free`. `trial` and `paid` are entitlement-identical throughout.
- **Gating** (`middleware/entitlements.ts`): `requirePremium(store, feature)` answers 403 `PREMIUM_REQUIRED`
  with a plain-language feature name and no upsell copy. Mounted on `GET /attendance/stats`, all four
  `/grouping/constraints` routes, and `PUT /settings`. `loadAccount`
  memoizes the account load on the request, so a gated endpoint that also needs the Sheets context reads the
  row once instead of twice; `resolveSheetsContext` / `resolveEmailContext` now go through it.
  `generateGrouping` gained an `applyConstraints` flag so a `free` account's request succeeds with its
  stored rules ignored rather than erroring.
- **Free monthly email cap.** 30 sends per calendar month (UTC), held as a per-user integer in Postgres —
  a paywall cannot be enforced from a spreadsheet the teacher can edit, and a count carries no PII;
  `emailLog` stays the audit record. A request whose recipient count would cross the allowance is rejected
  whole with `MONTHLY_EMAIL_CAP`, sending nothing and writing no log row. Only successful sends are
  recorded, so a Gmail failure does not come out of the teacher's month. The daily cap's existing mid-batch
  behaviour is unchanged for `trial` and `paid`.
- **Configurable high-absence threshold.** `routes/settings.ts` serves `GET /settings` (ungated — the
  tooltip must name the threshold on every plan) and `PUT /settings` (gated, validated to a rate in
  `[0.01, 1]` and an integer day count in `[1, 200]`). `isHighAbsenceRisk` and `listRiskSummary` now take
  the threshold rather than reading a module constant, and `GET /students/risk-summary` passes the account's
  effective one.
- **Development-only plan toggle.** `POST /internal/dev/plan` cycles `free` → `trial` → `paid` → `free`,
  writing `plan_override` alone. Guarded by both a `DEV_TOOLS_GOOGLE_SUBS` allowlist and a non-production
  `NODE_ENV` (`devToolsEnabledFor` in `config/env.ts`), answering 404 rather than 403 on refusal.
  `GET /auth/me` gained `plan`, `trialEndsAt` (only while on trial), and the `devTools` rendering hint.
- **Client.** `hooks/useEntitlements.tsx` holds the plan and the effective threshold; `AccountEntitlements-
  Provider` wires it to the signed-in profile, and the plain `EntitlementsProvider` takes the plan as a prop
  so it is directly usable in tests. `components/ui/Premium.tsx` implements the affordance: `PremiumBadge`
  (nothing on `paid`), `PremiumControl` (tooltip plus a visually hidden `aria-describedby` description on
  `free`), and `PremiumNotice` for whole gated panels. Gated in the UI: the History and Statistics segments,
  the student-detail attendance summary, Grouping's Constraints and Display options, and the Name Picker's
  Display options. `SegmentedControl` gained `suffix` and `describedBy` to carry a badge on a segment.
  `features/attendance/thresholds.ts` now takes a threshold and states it in words
  (`describeHighAbsence` / `highAbsenceLabel`), used by the roster icons, the detail summary, and the
  Statistics badge. `HighAbsenceSetting.tsx` is the premium editor in the Statistics toolbar. The email quota
  indicator shows the monthly allowance on `free`, and the over-cap warning names the binding limit and its
  reset date. `useAuth` gained `refresh()` so the dev toggle takes effect without a reload.
- **Spec conflict resolved.** The Compose view's placeholder previews and "High absences" quick select are
  free-tier features that were reading the now-premium `GET /attendance/stats`. Added an ungated
  `GET /email/recipient-metrics` returning only the per-(student, course) figures the email tool needs, with
  `highAbsence` computed server-side from the effective threshold — which also removed the client's last
  place for re-deriving the flag from a hardcoded constant. Recorded in API_CONTRACT.md.
- **Verification.** Server 270 pass (new `plan.test.ts`, `entitlements.test.ts`, `gating.test.ts`,
  `settings.test.ts`; `internal.test.ts`, `auth.test.ts`, `emailSend.test.ts` extended), client 171 pass (new
  `Premium.test.tsx`, `thresholds.test.ts`, `EmailPage.test.tsx`; attendance, roster, and TopBar suites
  extended). Typecheck and build clean on both. Lint sits at 3 problems, all the same pre-existing
  `react-refresh/only-export-components` on provider-plus-hook files. **Not yet exercised against the live
  Postgres** — migration `0003` and the counter have only run against the in-memory store.

### Phase 2 Step 3 — revisions from manual testing (free History, marked quota, star marker)

Three changes after driving the built step by hand.

- **History moved back to the free tier.** `GET /attendance/range` is ungated; the History segment and the
  student-detail heatmap are free, and the premium line now falls at the computation rather than at looking
  back. `GET /attendance/stats` stays gated, which is what gates both the Statistics view and the
  student-detail attendance summary — the summary is now the only part of that card withheld, with the
  heatmap rendering beneath it on every plan. The card's title changed from "Attendance Summary" to
  "Attendance", since it no longer holds only a summary, and `PremiumNotice` gained a `compact` variant for
  standing in for a panel that shares a card with free content.
- **The email quota chip carries the marker.** Sending past the monthly allowance is the paid feature, so
  the chip is where it is named, with a tooltip explaining the cap and its reset.
- **The `Premium` text badge became a star.** `PremiumBadge` now renders a filled accent `Star` (14px)
  keeping an explicit `Premium feature` accessible name, since a screen-reader user has no legend beside
  them. The legend lives in `SidebarFooter`, which also stopped hardcoding "Free Trial" and now shows the
  resolved plan: "Free plan" with "Paid plan feature", "Free trial — full access" with "Included until your
  trial ends", or "Paid plan" with no legend at all.
- **Verification.** Server 270 pass (`gating.test.ts` now asserts the range read is *not* refused), client
  174 pass (new sidebar-legend tests; the badge and attendance-gating assertions rewritten around the star's
  accessible name). Typecheck, lint, and build unchanged on both. Specs updated: IMPLEMENTATION_PLAN
  (free/paid split), API_CONTRACT (gated endpoint list), TESTING_PLAN (History moved to the free-tier
  positive cases), DESIGN_SYSTEM (the marker, the legend, the sidebar footer, and the Attendance view line).

### Phase 2 Step 3 — attendance panel rework and threshold placement

Two presentation changes from a second round of manual testing, plus the dev-toggle configuration that had
been missing.

- **The Statistics toolbar's threshold moved into its own right-aligned column**, opposite the date-range
  controls rather than on a second line beneath them, with the warning `CalendarX` in `status-warning` beside
  the text. The range is what the teacher scopes and the threshold is what the flag means; stacking them read
  as one sentence and conflated the two.
- **The student-detail attendance card was reworked into two labelled sections**, History then Statistics,
  side by side from `xl` up and stacked below it (the heatmap takes 3fr to the summary's 2fr and already
  adapts its week count to the width it is given). Statistics carries the premium star. On `free` it renders
  the same six tiles blurred and valueless — labels intact, every figure an em dash — with the explanation
  over them, replacing the earlier `PremiumNotice` that removed the section outright: a teacher can see the
  shape of what the paid plan adds without being shown invented numbers, and `AttendanceSummary` skips the
  gated fetch entirely when locked. The heatmap lost its `border-t` separator (each section now has a
  subheading) and gained its own empty state, worded differently from the summary's so the two do not print
  the same sentence side by side.
- **`DEV_TOOLS_GOOGLE_SUBS` was unset**, which is why the account-menu plan toggle never appeared — the
  allowlist half of the guard was empty, so `devTools` was always false. Set in `server/.env` to the
  developer's own Google sub.
- **Live Postgres confirmed.** `_migrations` holds `0003_add_plan_and_settings`, and the account row carries
  a `trial_ends_at` backfilled from `created_at` (2026-08-19) with the email counter at zero — so the
  migration and the backfill are verified against the real database, closing the gap flagged when the step
  was first completed.
- **Verification.** Client 176 pass (new locked-statistics tests on `StudentDetail`; the heatmap's two
  "renders nothing" tests rewritten around its new empty state), server 270 pass, typecheck, lint, and build
  unchanged.

### Phase 2 Step 3 — threshold simplified to one lever, standard gated wording, tooltip fixes

Four changes from a third manual pass.

- **The minimum-recorded-days lever is gone from the teacher's control.** `PUT /settings` now accepts
  `{ highAbsence: { minAbsenceRate } }` only, and the strict body rejects `minDaysRecorded`; the server
  writes that field from `DEFAULT_HIGH_ABSENCE` on every update. It is still stored, still returned by
  `GET /settings`, and still applied when computing the flag — it is a statistical guard against flagging a
  class with almost no recorded data, not a policy choice, and asking teachers to reason about sample size
  made a rule they think of as one percentage read as two numbers. The column is untouched, so the lever
  could return without a migration. `describeHighAbsence` names the rate alone; the settings modal states
  the fixed floor in prose so the full rule is still visible somewhere.
- **One sentence for every gated surface.** `paidPlanSentence(feature, plural)` (its own module, since
  `Premium.tsx` holds only components) produces "Attendance statistics are a paid plan feature."
  `PremiumNotice` now takes a feature name rather than a heading and description, so the Statistics tab, the
  student-detail statistics panel, and the disabled segment's screen-reader description all read the same.
  The boundary should look like a property of the product, not a different pitch each time it is met.
- **The email quota tooltip opens downward.** The chip sits in the page header directly beneath the fixed
  top bar, which covered an upward tooltip entirely.
- **The collapsed sidebar footer keeps a star.** At the icons-only width there is no room for the legend
  sentence, which left the one viewport where the star marking controls elsewhere had nothing explaining it.
  The star now renders alone there with the legend as its tooltip and as its accessible name.
- **Verification.** Server 270 pass (settings tests rewritten around the single lever, including that a
  client-supplied sample minimum is rejected rather than stored), client 177 pass. Typecheck, lint (back to
  the 3 pre-existing problems), and build clean. Specs updated: API_CONTRACT (`PUT /settings` body),
  DESIGN_SYSTEM (single input, the standard gated sentence, the label's wording), TESTING_PLAN (validation
  cases and the client-presentation criteria).

### Phase 2 Step 3 — tooltip fixes (gated segment, doubled bubble, touch legend)

Three defects found by hand, all in the premium affordance's explanations.

- **The disabled Statistics segment had no tooltip.** Every other gated control gets one from
  `PremiumControl`, which wraps its child — but `SegmentedControl` renders its own buttons, so there was
  nothing to wrap and the segment silently shipped without the explanation. Added a per-option `tooltip`,
  which the group applies itself. Its rounding moved from `first:` / `last:` to an index-derived class,
  because a tooltipped segment now sits inside a wrapper and would otherwise be both the first and last
  child of it, rounding every corner of a middle segment; untooltipped segments wrap in `display: contents`
  so their layout is unchanged.
- **The email quota chip showed two tooltips at once.** It carried both a `title` attribute and a `Tooltip`
  wrapper, so the browser's native bubble rendered over ours. Removed the `title` there and on the
  student-detail high-absence badge, which had the same pairing. Elements that use `title` alone (the roster
  indicators, the statistics table) are unaffected — the rule is one mechanism per element, not one
  mechanism app-wide.
- **The collapsed sidebar legend was hover-only.** Nearly every device narrow enough to collapse the sidebar
  is a touch device with no hover, so the legend was unreachable at exactly the width where it is the only
  explanation of the star. The star is now a button that toggles the tooltip on tap (`aria-expanded`,
  closing on blur), with hover and keyboard focus unchanged. `Tooltip` gained an optional `open` prop for
  this, so the controlled case reuses the component instead of forking it.
- **Verification.** Client 179 pass (new tests: the segment's tooltip and sr-only description, the absence
  of both on `paid`, and tapping the collapsed star), server 270 pass, typecheck, lint, and build clean.
  DESIGN_SYSTEM's Tooltips section now records the placement rule, the no-`title`-pairing rule, and the
  touch case.

### Phase 2 Step 3 — tooltip placement (downward from toolbars, left-anchored near the edge)

Two more placement defects, both from `Tooltip` having a single fixed position.

- **The Statistics segment's tooltip was clipped by the top bar**, the same defect the email quota chip had:
  it opened upward from a control sitting directly beneath the fixed header. `SegmentedControl` now defaults
  its tooltips to `side="bottom"` (with a `tooltipSide` escape hatch), since a segmented control is a toolbar
  control and every toolbar in this app is under that header.
- **The collapsed star's tooltip ran off the left edge.** It was centred on a trigger 32px from the edge of
  the viewport, so a bubble wider than the star overflowed. `Tooltip` gained an `align` prop
  (`center` / `start` / `end`); the star uses `start`, which flushes the bubble's left edge with the
  trigger's and keeps the caret over the trigger rather than centred in the bubble.
- Placement stays **declared rather than measured**. Every tooltip in the app sits somewhere known, so `side`
  plus `align` covers them; auto-flipping needs measurement on every open and is not worth it until a
  tooltip lands somewhere genuinely unpredictable. Recorded in DESIGN_SYSTEM's Tooltips section.
- **Verification.** Client 179 pass, server 270 pass, typecheck, lint, and build clean.

### Phase 2 Step 3 — committed; two presentation bugs logged for next session

Step 3 committed to `main` in full (implementation, tests, and specs). Manual testing then turned up two
presentation defects, recorded under Known Bugs in NEXT_STEPS.md to be fixed before Step 3b rather than
patched in a hurry at the end of this one:

1. The collapsed sidebar's star legend does not appear on `free`, though it does on `trial`. Reading
   `SidebarFooter`, both live in one `plan !== 'paid'` branch and look like they should render identically,
   so the note records that as a starting point rather than a diagnosis — the first thing to check is
   whether the plan reaching `useEntitlements` is actually `free` at that moment, since the dev toggle
   changes plan through a `GET /auth/me` refresh.
2. The account avatar is clipped at tablet widths. Not plan-related — it affects every account — but it sits
   on the path to the account menu, which holds the plan toggle now and the upgrade entry point from Step 3b.
   The Step 9 responsive audit checked the five tools at 375px and 768px but never the top bar's own right
   region, so this is a gap in coverage rather than a Step 3 regression.

TESTING_PLAN gained criteria for both, so the fixes have something to be verified against: the footer legend
asserted across all three plans *and* all three sidebar widths, the star's tooltip reachable by tap, and the
top bar's right region staying within the viewport at every width.

### Phase 2 Step 3 — the two logged bugs diagnosed and scheduled as Step 3a

Further manual testing narrowed both symptoms to **the Attendance page on a `free` account**, which
identified the cause and made the earlier framing of them wrong in two ways worth recording.

The first report read as two unrelated bugs — a missing sidebar legend and a clipped avatar at tablet
widths. Neither was accurate. The legend does render; the page has grown and pushed it out of view. The
avatar is not a tablet-breakpoint bug; the width only made the real problem visible. Both are the top bar
and the fixed sidebar appearing displaced, which is what a document overflowing its viewport looks like.

The cause is almost certainly the Statistics segment's tooltip added earlier this session.
`AttendancePage` passes `tooltip: isPremium ? undefined : STATS_EXPLANATION`, so the element exists only on
`free`, and the Attendance page is the only place a `SegmentedControl` carries a tooltip — which accounts
precisely for "free only" and "Attendance page only". The bubble is absolutely positioned, `w-max
max-w-56`, centred with `left-1/2 -translate-x-1/2` on a trigger at the right end of the page header;
absolutely positioned elements contribute to scrollable overflow even at `opacity-0`, and neither `main`
nor `PageHeader` clips it.

Scheduled as **Step 3a** in IMPLEMENTATION_PLAN, before Step 3b, since the account menu is where the plan
toggle lives now and where the upgrade entry point lands in 3b. Recorded but not yet fixed — the hypothesis
is confirmed against the running app first. Fix directions under consideration: anchoring that tooltip with
`align="end"` so it grows inward, and/or `overflow-x: clip` on `main` so no absolutely positioned
decoration can widen the document again (`clip`, not `hidden`, which would create a scroll container and
break the sticky headers in the History grid and Statistics table). TESTING_PLAN gained a Step 3a section,
including a `scrollWidth` vs `clientWidth` assertion — a layout defect a unit test can actually catch — and
extending the Step 9 responsive audit to the app frame, which it never covered.

---

### Phase 2 Step 3 (Plan entitlements) — three plan states, server-side gating, the free email cap

Plan state became a property of the account record, resolved on every request and enforced on the endpoint.
Billing is not part of this step: nothing yet writes the Stripe-managed fields, which is what makes Step 3b's
webhook their sole writer.

- **Account model.** Migration `0003_add_plan_and_settings` adds `plan_override`, `trial_ends_at`, the
  `high_absence_min_rate` / `high_absence_min_days` setting, and `monthly_email_period` /
  `monthly_email_count`. Existing rows are backfilled with a trial measured from `created_at`, so nobody
  loses one; `upsert` sets `trial_ends_at` on insert only, so signing in again never restarts a spent trial.
- **Resolution order** ([services/plan.ts](server/src/services/plan.ts)): `plan_override`, then an unexpired
  trial, then subscription state, then `free`. `trial` and `paid` are entitlement-identical.
- **Gating** ([middleware/entitlements.ts](server/src/middleware/entitlements.ts)): `requirePremium` answers
  403 `PREMIUM_REQUIRED` with a plain-language feature name and no upsell copy. Applied to
  `GET /attendance/stats`, `GET /attendance/range`, and all four `/grouping/constraints` routes, plus
  `PUT /settings`. `loadAccount` memoizes the account on the request, so a gated endpoint reads the row once
  rather than twice. A `free` account still generates groupings — its stored constraints are ignored, not
  applied, and re-apply on upgrade.
- **Free monthly email cap.** 30 sends per calendar month (UTC), counted as a per-user integer in Postgres
  rather than from the teacher's `emailLog`, which they can edit; `emailLog` stays the audit record. A
  request that would cross the allowance is rejected **whole** with `MONTHLY_EMAIL_CAP` — nothing sent, no
  log row written — so the teacher retries the same send after upgrading rather than reconstructing who
  already heard from them. Only successful sends are counted. `GET /email/send-status` reports the monthly
  figures and a reset date on `free` only, with `remaining` always the lower of the two allowances.
- **Configurable high-absence threshold.** `GET /settings` (ungated, because the tooltip must name the
  threshold on every plan) and `PUT /settings` (gated). A `free` account is computed with the **default**
  even when it has a stored value — "stored but not applied" — and `GET` surfaces that value as
  `storedOverride` so a lapsed teacher can be shown what upgrading restores. The threshold is threaded
  through `isHighAbsenceRisk`, `listRiskSummary`, and the client's flags, so the roster icons, the
  student-detail summary, the Statistics badge, and the email tool's high-absence selection cannot disagree.
- **Development-only plan toggle.** `POST /internal/dev/plan` cycles `free` → `trial` → `paid` → `free`,
  writing `plan_override` alone. Guarded by both a `DEV_TOOLS_GOOGLE_SUBS` allowlist **and** a non-production
  `NODE_ENV`, answering **404** on refusal so probing cannot confirm it exists. `GET /auth/me` gained `plan`,
  `trialEndsAt`, and a `devTools` rendering hint the endpoint re-checks rather than trusts.
- **Client presentation.** An `EntitlementsProvider` supplies the plan and the effective threshold to every
  tool. Premium controls follow the affordance rules — unmarked on `paid`, badged and usable on `trial`,
  badged and disabled with `aria-disabled` plus an `aria-describedby` explanation on `free`. Gated in the UI:
  the Statistics tab, the student-detail attendance summary, Grouping's Constraints and Display
  options, and the Name Picker's Display options. Legibility controls (Scale, Size, fullscreen, sound, theme)
  stay free and unbadged. The email quota indicator reads the monthly allowance on `free`, and the over-cap
  warning names the limit that binds and when it resets.
- **One spec conflict resolved.** The Compose view's placeholder previews and "High absences" quick select
  are free-tier, but were reading the now-premium `GET /attendance/stats`. Added an ungated
  `GET /email/recipient-metrics` carrying just the per-(student, course) figures the email tool needs, with
  `highAbsence` computed server-side against the effective threshold. Recorded in
  [API_CONTRACT.md](API_CONTRACT.md).

**Revised after manual testing** (three changes from the first cut):

- **The History view is free, not premium.** `GET /attendance/range` is ungated again — the History grid and
  the student-detail heatmap are the only readers of a range, and both show the record of what was taken
  rather than anything computed from it. The premium line now falls at the computation: Statistics and the
  student-detail attendance *summary* are gated, the heatmap beneath that summary is not. This makes the
  free tier's story simpler as well: a teacher can always see what they recorded, and pays for what the app
  works out from it.
- **The email quota chip is marked premium.** Sending beyond the monthly allowance is the paid feature, so
  the number a teacher watches and the reason it is limited now sit together, rather than the cap being
  discovered when a send is refused.
- **The `Premium` text badge became a star.** With markers on the attendance tabs, two Display options
  buttons, Constraints, the threshold control, and the quota chip, a repeated word crowded every row and
  read as advertising. A filled accent `Star` replaces it, explained once by a legend in the sidebar footer
  beside the account's plan (which also now shows the real plan rather than the hardcoded "Free Trial" it
  had displayed since Phase 1). Every star keeps an explicit `Premium feature` accessible name — a
  screen-reader user meets the marker without the legend beside it, so the marker stays self-describing to
  assistive technology even though it is silent to the eye.

- **The high-absence threshold is a single lever.** Only the rate is the teacher's to set; the
  minimum-recorded-days floor stays fixed at 5, written server-side from the default and rejected if a
  client sends it. It is a guard against flagging a class with almost no data rather than a policy choice,
  and a second input made a one-number rule read as a two-number one. Every gated surface now shows one
  fixed sentence, "<Feature> is a paid plan feature.", so the boundary reads as a property of the product.

- **Tests:** server **270 pass** (new `plan.test.ts`, `entitlements.test.ts`, `gating.test.ts`,
  `settings.test.ts`; `internal.test.ts`, `auth.test.ts`, and `emailSend.test.ts` extended), client
  **171 pass** (new `Premium.test.tsx`, `thresholds.test.ts`, `EmailPage.test.tsx`; attendance, roster, and
  TopBar suites extended). Typecheck and build clean on both; lint is at 3 problems, all the same
  pre-existing `react-refresh/only-export-components` on a provider-plus-hook file (`useAuth`, `useTheme`,
  and now `useEntitlements`, which follows their pattern).

**Verified against the live Postgres.** Starting the server applied `0003_add_plan_and_settings` to the
provisioned database (it is recorded in `_migrations`), and the existing account row carries a
`trial_ends_at` backfilled from its `created_at` with the email counter at zero — the migration, the
backfill, and the new columns are confirmed against the real database, as Steps 1 and 2 were.

**Note for local setup:** the account-menu plan toggle needs `DEV_TOOLS_GOOGLE_SUBS` set to the developer's
Google `sub` in `server/.env`. Unset, the allowlist half of the guard is empty and `devTools` is always
false, so the item never renders — which is the intended production behaviour, and the first thing to check
if the toggle is missing.

---

---

### Phase 2 Step 3a (Entitlement presentation fixes) — one cause behind both symptoms

The two symptoms logged after Step 3 — the top bar's account avatar displaced, and the sidebar's star
legend pushed below the viewport — were confirmed to share one cause, and the fix is at that cause rather
than at either symptom.

- **The cause, confirmed by reading the layout.** The Statistics segment's tooltip is the only
  `SegmentedControl` tooltip in the app and `AttendancePage` renders it only on `free`, which is exactly the
  "free only, Attendance only" shape of the reports. The bubble is absolutely positioned, `w-max max-w-56`
  (224px), centred on its trigger with `left-1/2 -translate-x-1/2`; Statistics is the last control in a
  right-aligned `PageHeader`, so the bubble extended past the right edge of the content area. An absolutely
  positioned element contributes to the document's scrollable width even at `opacity-0`, and neither `main`
  in [AppShell](client/src/layouts/AppShell.tsx) nor [PageHeader](client/src/components/ui/PageHeader.tsx)
  clipped it. Both the top bar and the sidebar are `position: fixed`, which is why a document wider than the
  viewport displaces them together rather than breaking either component on its own.
- **Fixed at the tooltip.** `SegmentedControl` gained a `tooltipAlign` option passed through to `Tooltip`
  (which already had `end` from the sidebar star's `align` work), and the Statistics segment uses
  `align="end"` so the bubble grows leftward from the trigger's right edge and cannot exceed it.
- **Backstopped at the layout boundary.** `main` gained `overflow-x-clip`, so no absolutely positioned
  decoration can widen the document again. `clip` rather than `hidden` deliberately: `hidden` would make
  `main` a scroll container and break `position: sticky` in the History grid and the Statistics table.
  Fixed-position descendants (the modals) are unaffected, since `main` is not their containing block.
- **The regression test is structural, not geometric.** The check named in TESTING_PLAN —
  `document.documentElement.scrollWidth` not exceeding `clientWidth` — cannot be written as a unit test:
  the client suite runs in jsdom, which has no layout engine, so `scrollWidth` is always 0 and the
  assertion would pass whether or not the bug were present. What is asserted instead is the two structural
  guarantees that produce the geometry: the Statistics tooltip is anchored `right-0` and not `left-1/2`
  (`AttendancePage.test.tsx`), and `main` carries `overflow-x-clip` and not `overflow-x-hidden`
  (`AppShell.test.tsx`, new). TESTING_PLAN's Step 3a section was corrected to say the `scrollWidth` check is
  a manual/browser one.
- **Tests:** client **181 pass** (2 new); typecheck and build clean; lint unchanged at the same 3
  pre-existing `react-refresh/only-export-components` errors on the three provider-plus-hook files. Server
  untouched.

**Not closed:** the visual confirmation. The overflow is only observable in a real browser, and extending
the Step 9 responsive audit to the top bar and sidebar chrome at 375px/768px — which the original audit
covered for the five tool pages but never for the app frame, which is why this reached manual testing — is
a visual pass on a `free` account.

---

### Phase 2 Step 3b (Stripe integration) — checkout, the webhook, and the upgrade path

Billing state became something only Stripe writes. Step 3 left `subscription_status` and the billing
period unwritten by anything precisely so this step's webhook could become their sole writer.

- **Migration `0004_add_stripe_fields`** adds `stripe_customer_id` (UNIQUE, indexed),
  `stripe_subscription_id`, `current_period_end`, and `cancel_at_period_end`. The customer id is the
  indexed lookup path because a webhook identifies a *customer*, never a `google_sub`.
- **One writer, enforced by shape.** `applySubscriptionState` is keyed on the Stripe customer id rather
  than the account, so it is awkward to call from anywhere not reacting to a Stripe event. `plan_override`
  remains the separate path for the dev toggle and support comps; a test asserts a billing event leaves it
  untouched and that a comp still wins afterwards.
- **A breaking SDK change caught by reading the types rather than trusting memory.** In API version
  `2026-06-24.dahlia`, `current_period_end` lives on the subscription's **items**, not on the
  subscription. Reading the old location yields `undefined` rather than throwing, so the bug would have
  been a silently-null period end surfacing much later as a cancellation that never expired. Pinned by a
  test.
- **The webhook** ([routes/billing.ts](server/src/routes/billing.ts)) is mounted ahead of
  `express.json()` with `express.raw()`, because signature verification hashes the exact bytes sent. A
  test asserts the *same request fails* when mounted after the JSON parser, so the ordering constraint
  cannot be quietly undone by a later refactor. Unknown event types and unknown customers are acknowledged
  with 200 (a webhook that errors on unrecognised input earns an endless retry loop); handler failures
  answer 500 so Stripe does retry.
- **Cancellation needs no scheduled job.** Stripe keeps the subscription `active` with
  `cancel_at_period_end` set until the paid period genuinely ends, then sends
  `customer.subscription.deleted`, at which point plan resolution returns `free`. `past_due` deliberately
  keeps access — a card expiring mid-semester should not lock a teacher out during a lesson.
- **A startup price check.** Each configured Price is fetched and compared against the advertised amount,
  because a Price's amount can be edited in the dashboard without its id changing and nothing else would
  notice the app advertising one number while Stripe charged another. It logs loudly rather than refusing
  to boot, so a pricing discrepancy cannot take the app down for teachers who are not buying anything.
- **The upgrade path.** An `UpgradeModal` with annual preselected, reached from the account menu and the
  sidebar footer, both of which offer it on `trial` as well as `free`. Gated-control entry points are
  deliberately deferred to the pricing page (Step 5), and when they arrive they will prompt on `free`
  **only** — on `trial` the control is live, so a prompt there would interrupt someone who already has
  access. The rule is encoded once as `promptFromGatedControls`. "Manage billing" (Stripe's hosted portal)
  is shown by whether a Stripe customer exists rather than by plan, because a lapsed `free` account still
  has invoices and a card worth managing.
- **Two of my own tests were passing for the wrong reason** and were fixed: the checkout handler checked
  configuration before validating the body, so those cases only returned the expected status because a
  configured `.env` happened to be loaded during the run. Validation now precedes the configuration guard,
  and the tests blank the key explicitly.

**Verified against the live Postgres**, through the real `buildApp` mount order, with genuinely signed
requests: an unsigned request and one signed with the wrong secret are both refused with 400 and change
nothing; a signed activation moves the account to `paid` with the period end read correctly from the
subscription item; `cancel_at_period_end` keeps the plan `paid`; and the delete event drops it to `free`
with the spreadsheet mapping untouched. Run against a throwaway account row, removed afterwards.

**Not yet done:** a real Stripe-delivered event. That needs `stripe login` (a browser confirmation only the
account owner can give) followed by `stripe listen --forward-to localhost:3001/api/billing/webhook` and a
real test-mode checkout. The CLI is installed; the signature path is proven; what remains unproven is
Stripe's own delivery and the checkout redirect.

**Follow-up pass after manual testing** (four changes):

- **The tier is called Premium.** "The paid plan" became **Premium** and "free plan" became **free
  account** in every string a teacher reads; `paidPlanSentence` was renamed `premiumSentence` so the code
  matches the copy. The plan *values* (`free` / `trial` / `paid`) are API and database vocabulary and are
  unchanged.
- **The sidebar footer was rebuilt with three treatments.** Premium gets an accent-gradient mark and
  nothing else — no legend, because nothing visible is gated, and no offer, because there is nothing left
  to sell. Trial gets a card with days remaining and a progress bar; free gets that card without the
  countdown. Keyed off which sidebar renders it rather than drawn twice and hidden with CSS. The mark's
  label is white on accent by request, recorded in DESIGN_SYSTEM as a knowing contrast exception (~1.9:1
  against AA's 4.5:1).
- **"Manage billing" opens in a new tab**, and the upgrade modal no longer claims "unlimited email" — a
  limit does still apply, so it names both figures.
- **The IPv6 rate-limit key.** The email burst limiter's custom `keyGenerator` fell back to a raw
  `req.ip`, which `express-rate-limit` had been warning about at startup (`ERR_ERL_KEY_GEN_IPV6`). A bare
  IPv6 address is one address out of the /64 a client is typically handed, so an IPv6 caller could
  sidestep the limit by picking a new address per request. It now goes through `ipKeyGenerator`.

**One real bug found and fixed in the dev plan toggle.** It stepped on the *resolved plan*, which looks
equivalent to stepping on the override and is not: an account with an unexpired trial **and** an active
subscription — the state this developer account is actually in — resolves to `trial` the moment the
override clears, whose successor is `paid`, whose successor is clear again. An inescapable two-state loop
that never reaches `free`, with the cleared position indistinguishable from a forced `trial`. It now steps
on the stored override (`none → free → trial → paid → none`), which visits all four positions whatever the
real plan is, and `GET /auth/me` returns `planOverride` (dev-only) so the menu label can say `(real)` or
`(forced)` rather than guessing from the plan.

- **Tests:** server **293 pass** (new `billing.test.ts` in services and routes; `internal.test.ts`
  extended with the trial-and-subscribed regression), client **197 pass** (new `UpgradeModal.test.tsx`,
  plus entry-point, footer-countdown, and toggle-label cases). Typecheck and build clean on both. Client
  lint is at 4 problems, all the same pre-existing `react-refresh/only-export-components` on
  provider-plus-hook files (`useAuth`, `useTheme`, `useEntitlements`, and now `useUpgrade`, which follows
  their pattern).

---

### Phase 2 Step 4 (Contact / support system) — the form, the table, and the triage view

Three scoping choices were settled before building. **Submission is signed-in only:** the account is the
identity, so the form asks for no name, no email, and no plan, and the router carries no anonymous write
path, no captcha, and no address to validate. A public contact route is Step 5's, where the signed-out
people actually are. **The triage view is an in-app route behind the same doubled-guard pattern as the dev
plan toggle**, rather than a server-rendered page or a psql script, so it reuses the session wiring and the
existing components. **No email notification**, because sending one today would have to use the submitting
teacher's own Gmail token; an app-owned sending identity does not exist until hosting (Step 6), and the
triage view is the read path until it does.

- **Migration `0005_create_support_requests`.** `google_sub` with `ON DELETE CASCADE` rather than a copied
  email, so deleting an account takes its requests with it (verified live). The plan is copied at submit
  time as `plan_at_submit` because it is the plan the teacher was describing, which is not necessarily the
  plan they hold when the request is finally read.
- **The one place a teacher could put student PII in our database.** Everything else in the schema is
  identifiers, counts, and timestamps; a free-text message is not. The form says plainly not to include
  student names, neither the subject nor the message is ever logged, and the migration comment records this
  as the field to remember when a retention policy is written. This is a knowing narrowing of the
  no-student-PII posture to "the app never puts it there," not a claim that the column cannot hold it.
- **The admin guard has no environment half, deliberately.** `DEV_TOOLS_GOOGLE_SUBS` is paired with a
  non-production `NODE_ENV` check because a live entitlement endpoint has no business existing in
  production. Support triage is the opposite: it is a production task, so `SUPPORT_ADMIN_GOOGLE_SUBS` is the
  entire guard. What carries over is the 404: an operator-only endpoint that answers 403 has confirmed it
  exists to whoever asked. An empty allowlist grants nobody anything, which is also the default.
- **The comp path is the one that already existed.** Step 3 wrote `plan_override` specifically so support
  would not later invent a second way into plan state, and this step spends it: the triage view's plan
  dropdown writes `plan_override` and nothing else, so a comped account's Stripe fields stay exactly as
  Stripe left them and the comp is lifted by setting it back to "no override". A test asserts a comp on a
  cancelled subscriber leaves `subscription_status` and the subscription id untouched.
- **Past requests are shown to the submitter**, with status. A form that swallows a message and says
  "thanks" is indistinguishable from one that dropped it, and the read is one indexed query.
- **Two client fixes fell out of the build.** `apiClient` gained `patch` (triage is the first partial
  update in the app), and the initial load-in-effect pattern tripped React's `set-state-in-effect` rule —
  fixed properly by writing state only once the request settles rather than by suppressing the rule, with
  the filter change clearing the list from its own change handler, where the intent is.

**Verified against the live Postgres**, through the real `buildApp` mount order with session and CSRF gates
in place: a submission stores and reads back, a non-allowlisted operator gets 404 while an allowlisted one
gets the list, the pg triage write returns the joined account, an unknown id returns null rather than a
silent success, the status filter finds the row, and deleting the account removes its support rows.
Throwaway rows, removed afterwards.

- **Tests:** server **304 pass** (new `support.test.ts`: 11 cases covering the strict body, the recorded
  plan, both allowlist refusals, triage, and the comp), client **206 pass** (new `SupportPage.test.tsx` plus
  three account-menu cases). Typecheck and build clean on both. Client lint is back at the same 4
  pre-existing `react-refresh/only-export-components` errors.

**Follow-up pass after review** (two chrome cleanups):

- **The top bar's settings gear is gone.** It was drawn in the original layout and never had a destination:
  the one server-applied setting (the high-absence threshold) belongs contextually on the Attendance page
  beside the flag it governs, display and styling options live in their tools' own modals, the theme has its
  own control, and everything account-shaped — plan, billing, support, sign-out — is in the avatar menu. A
  control that does nothing is worse than no control; a test now asserts its absence so it cannot drift
  back, and DESIGN_SYSTEM records what would justify reintroducing it.
- **Every account-menu item carries a leading icon.** Upgrade and Help and support already had one, which
  made the rest read as a second class of item. Manage billing, Support triage, and Sign out gained theirs,
  and the development plan toggle takes a flask: with everything else iconed, having none is what would draw
  the eye to it, which is the opposite of what that item wants. Client **207 pass**.

**Visually reviewed and accepted**, including the rebuilt account menu and the two new pages. Nothing in
Step 4 is now outstanding.

**Project-wide consistency sweep (documentation + code).** Run after Step 4, across all seven documents and
both source trees. Mechanical checks first: every documented endpoint against the route files, every sheet
column against `config/schema.ts` (all 11 tabs matched exactly), every error code against `utils/errors.ts`,
every doc file link, and the installed dependencies against DEPENDENCIES.md. What it found:

- **`GET /internal/metrics` was reachable by any signed-in teacher in production**, while the section of
  API_CONTRACT documenting it claimed internal endpoints are "never reachable in production" — and it was
  not documented at all. It now sits behind the operator allowlist, with the endpoint written up. The two
  internal guards are deliberately different and the difference is now stated in one place: metrics takes
  the operator allowlist alone because reading counters is a production task; the plan toggle takes the
  allowlist **and** a non-production check because a live entitlement endpoint should not exist in
  production. Both still answer 404.
- **One operator gate, not two.** Step 4's support-admin guard was a local function in its route file; it is
  now `middleware/operator.ts`, used by both the support admin router and the metrics endpoint. The
  rate-limit key generator was likewise duplicated between the email and support routers — now
  `utils/rateLimitKey.ts`, which also means the IPv6 subtlety it encodes (a bug fixed once already) can only
  ever be fixed in one place.
- **Silent truncation in the support lists.** Both capped at 100 with nothing said about it, so a queue that
  stopped at the cap looked exactly like a queue with 100 items — worst precisely when the queue is busiest.
  Both endpoints now return `{ requests, truncated }`, with `truncated` answered exactly (one row is
  over-fetched and dropped) rather than inferred from a full page, and both views say so.
- **A failed comp left the dropdown showing a comp that was never granted.** It now reverts.
- **`text-[#1a1a1a]` appeared literally in six files and `bg-[#484848]` in two**, against the project rule
  that colours come from tokens. Added `--color-on-accent` and `--color-tooltip`; verified the emitted CSS
  actually carries the new utilities rather than trusting a clean build.
- **README was badly stale** — it said Phase 1 was in progress with Step 7 next, listed the marble race as a
  shipped Name Picker mode, put an uninstalled physics engine in the tech stack, omitted the free/Premium
  split entirely, and named `ts-node` as the dev runtime. Rewritten. CLAUDE.md named `ts-node` too;
  `ts-node` itself was still installed and has been uninstalled.
- **The one deliberate non-`strict()` Zod schema** (the OAuth callback query, which Google appends its own
  parameters to) now says why, so it does not read as an oversight against the project rule.
- Also fixed: a HISTORY link to a file deleted two steps later, and DEPENDENCIES missing the lint and
  PostCSS tooling that is installed.

No contradictions were found between the six planning documents. **Tests: server 306 pass, client 208 pass**
(4 new), typecheck, build, and lint clean; the support store's changed SQL was re-verified against the live
Postgres.

---

### Phase 2 Step 5 (Public surface) — landing, pricing, the signed-out contact route, and the routing change

The step was **split before building**. The original Step 5 covered a marketing surface, a legal surface, an
onboarding flow, and the board-allowlisting path, which is more than one reviewable unit of work; it is now
Step 5 (this) and Step 5a (onboarding & allowlisting), sub-numbered so nothing after it renumbers.

**The routing change is the structural part, and it inverts a Phase 1 assumption.** `AuthGate` redirected
every unauthenticated visitor straight to Google, which was correct when the app had no page of its own to
show. It is wrong now for two different people: a first-time visitor gets a consent screen before they have
seen anything to consent to, and a teacher whose board has blocked the OAuth app gets a Google error page
and no route forward. `AuthGate` now takes an optional `signedOut` element and renders it instead of
redirecting; `App` passes the landing page. The redirect path is kept for the case where nothing is
supplied, so the existing behaviour is still reachable and still tested.

- **The two signed-out states stay distinct**, which is the part worth guarding with a test. `unauthenticated`
  (never got in) is now the landing page. `sessionEnded` (was in, lost it) keeps its explicit screen with a
  way back in — someone who was mid-task wants to resume, not to read marketing copy.
- **The public routes sit outside `AuthProvider` entirely**, so `/pricing`, `/contact`, `/privacy`, and
  `/terms` render with no `/auth/me` round trip. A visitor deciding whether to sign up should not wait on a
  session lookup that is going to fail.
- **A separate `MarketingLayout`, not the app shell.** No sidebar (there is no roster to navigate), no fixed
  top bar, an ordinary scrolling document. It carries the theme toggle, because the theme is app-wide and
  persisted and a visitor who picks dark should not watch the product change appearance the moment they
  sign in.

**The signed-out contact route is the app's only unauthenticated write, and is built as one.** Step 4
deliberately shipped support as signed-in only and named this as Step 5's; the reason it matters is specific
rather than general politeness, since a teacher whose board has blocked the app cannot sign in at all and is
therefore exactly the person a sign-in-walled contact form excludes.

- **`POST /public/support/contact`**, mounted outside the session and CSRF gates under a `/public` prefix so
  that "unauthenticated" is visible in the path rather than inferred from mount order in `index.ts`.
- **204 with no body, and no read path.** An anonymous caller receives no identifier for what they wrote,
  because an identifier is a handle that would then need guarding. There is no `GET`.
- **A honeypot that is discarded, not rejected.** An off-screen `website` field arrives empty from a person;
  a submission carrying it is dropped and answered with the same 204 a real one gets. A 400 would tell an
  automated filler which field to leave alone next time. It is `aria-hidden` and `tabIndex={-1}` together,
  which is the a11y trap this pattern usually walks into.
- **3 per hour per IP subnet**, against the signed-in form's 10 per hour per account. Here the limit is the
  security boundary rather than a guard against a stuck client. A captcha was rejected: a dependency, a
  third-party script, and an accessibility cost, against a rate limit and a honeypot that are proportionate
  until abuse actually appears.
- **Migration `0006` makes `google_sub` nullable rather than adding a second table.** A request is a request
  and triage should show one queue; an anonymous row differs only in where the identity comes from. A CHECK
  constraint requires one of `google_sub` or `contact_email`, so no path can create an unanswerable request.
- **The triage join became a LEFT join**, which is the one genuine bug this could have shipped: an inner
  join would have silently hidden exactly the messages from people who could not sign in. A test asserts a
  signed-out request appears in the queue. `verifiedIdentity` distinguishes the two, because an operator is
  about to reply to an address nobody has confirmed, and the comp control is absent on a request with no
  account rather than disabled.

**The pricing page states the split as shipped, which turned up a documentation conflict.** NEXT_STEPS said
the History view and `GET /attendance/range` are premium; IMPLEMENTATION_PLAN and the shipped code have both
free. The code and IMPLEMENTATION_PLAN agree, so the NEXT_STEPS entry was the stale one — it had recorded an
intermediate Step 3 decision that was reversed before Step 3 shipped. Both bullets are corrected in place
rather than deleted, so the reversal is legible. The line that shipped is that **looking back at the record
is free and computing over it is not**: History and the heatmap free, statistics and the student-detail
summary premium. A test asserts the pricing page says it that way round, since it is easy to invert and this
page is what a teacher checks the claim against.

**The gated-control upgrade entry point, which DESIGN_SYSTEM had been promising since Step 3.** It lives on
`PremiumNotice` — the stand-in for a premium view on `free` — and nowhere else: a disabled control already
carries its explanation by tooltip, and a button on each one would repeat the offer down a page. It reads
`promptFromGatedControls`, so it is absent on `trial`, where the feature is live and prompting would
interrupt someone to sell them what they have. It opens the existing upgrade modal rather than linking to
`/pricing`, because that page is framed for a signed-out visitor and offers "Sign in with Google" to someone
who has already done so. `useUpgradeIfAvailable` was added so a presentational primitive does not require
billing to be mounted in order to render.

**Legal pages are routes with placeholder content, on the user's explicit instruction.** The footer links
them, a board privacy review asks for them by URL, and OAuth verification (Step 9) requires them on the
production domain, so a dead link is worse than a page that says what it is. The content is not written:
it turns on the operating entity, its jurisdiction, retention commitments, and DPA wording, and getting
that wrong is legal exposure rather than a bug. The pages state only what the shipped architecture already
makes true and say plainly that they must not be relied on as policy. **This is a deliberate hold, recorded
in Next Step, not an oversight.**

- **Tests:** server **316 pass** (new `publicSupport.test.ts`: 10 cases covering the anonymous write, the
  honeypot, the strict schema, the rate limit, the absent read path, and the LEFT-join regression), client
  **230 pass** (new `ContactPage.test.tsx` and `PublicPages.test.tsx`, plus the two `AuthGate` cases and
  three `PremiumNotice` cases). Typecheck and build clean on both. Client lint went 4 → 5 problems, all the
  same pre-existing `react-refresh/only-export-components`: the new one is `useUpgradeIfAvailable` sitting
  beside `useUpgrade`, which already trips it in that file.

**Not yet verified in a browser.** Per the project's verification rule the visual review is the user's, and
nothing here was driven live. The migration has not been run against the live Postgres either, so
`0006_public_support_requests` and the LEFT-join queries are proven against the memory store and the type
checker but not yet against real SQL.

---

### Phase 2 Step 5 (Public surface) — the design pass, and the landing page built from it

The skeleton from the previous entry was reworked into an approved design and then built. The design itself
is committed at [design/landing-page-mockup.html](design/landing-page-mockup.html): a single self-contained
interactive file, reviewed over several rounds, and now the reference the implementation matches rather
than a sketch that was thrown away.

**The design work happened before the code, and changed what got built.** Three things came out of it that
would not have come out of writing components first.

- **There are no screenshots of this app, and there cannot easily be.** A real capture of a roster contains
  real student names, which is indefensible for a product whose central claim is that it never holds
  student data. Since any product shot must use invented data regardless, the shots are rendered in the DOM
  from the same design tokens. That buys two things a PNG cannot have: they follow the light and dark
  theme, and they cannot drift when a colour token moves. The cost, recorded in
  [shotChrome.tsx](client/src/pages/landing/ProductShots.tsx) and DESIGN_SYSTEM, is that they are a
  *representation* maintained separately from the real component, so they need a look whenever a tool's
  layout changes materially.
- **The first draft of the shots was wrong, and reading the components fixed it.** Attendance had been
  drawn as a coloured heatmap grid; daily entry is actually a row per student with four square P/A/T/E
  buttons where the chosen one takes the accent fill, plus an optional note. Group members were chips
  rather than a plain list under a coloured header. The roster used invented labels rather than the real
  accommodation set. Every shot is now built from `RosterView`, `EntryView`, `GroupsCanvas`, `Wheel` and
  `ComposeView`, so nothing on the page shows a control the product does not have.
- **A documentation conflict surfaced and was fixed** in the previous entry's sweep: NEXT_STEPS had the
  History view and `GET /attendance/range` as premium while IMPLEMENTATION_PLAN and the code have both
  free. The pricing page now states the shipped line, and a test asserts the direction, because it is easy
  to write backwards and this page is what a teacher checks the claim against.

**The logo replaces the Phase 1 placeholder.** A pencil and a ruler fanning out of a protractor, the
protractor standing in for the handle of a pocket knife. Four directions were drawn and compared at 64px,
32px and 16px, since small sizes are where marks fail. Two geometry problems in the chosen mark were found
and fixed by measurement rather than by eye: the body had been an ellipse, on which equal angles are not
equal arcs, so its tick marks bunched toward the ends (it is now a true semicircle, ticks verified at
30.0° ± 0.02), and the ticks now run inward from the rim so none can cross the outer edge.
[Logo.tsx](client/src/components/ui/Logo.tsx) is one component used by the app top bar, the marketing
header and the hero, so the three cannot drift.

**Three additions to DESIGN_SYSTEM, raised as flags during the design pass and approved.** Each fills a gap
rather than contradicting a rule, and none is used inside the app: two display type steps above the app's
24px ceiling, a fourth ground `--color-canvas` for full-width bands (a neutral pulled toward the accent
hue, so a band separates without spending the accent's signal value), and a 48px call-to-action size. A
fourth flag was withdrawn during review: the premium star had been marking whole tools, which is a second
meaning for an existing symbol, and removing the stars from tool names dissolved it. Every tool has premium
parts, so marking three of five drew a distinction that does not exist.

**Pricing split into Pricing and FAQ.** The pricing page keeps the two plan cards and gains a row-by-row
comparison table, which is what someone arriving from "Compare the plans" is actually checking. The eight
questions on [FaqPage.tsx](client/src/pages/FaqPage.tsx) are what support will predictably receive; two of
them exist because of how this product reaches teachers rather than what it does, and both point at the
public contact form, since a teacher whose board has blocked the app cannot ask from inside the product.

**The roster row's collapse is a container query, not a media query.** Its three flexible columns were
`minmax(0, …)`, whose zero lower bound let name, class and email shrink to nothing before any breakpoint
fired. Below 620px of *row* width it is now four columns: name over class, the indicator icons in a
reserved fixed track, then the accommodation, with only the email dropping. A viewport query could not do
this correctly — the same row appears in the hero at nearly full width and in the showcase panel at roughly
two thirds of it, at the same viewport. The flag track is fixed and the tag track fractional, never `auto`,
because an `auto` track is sized per row and a student with no accommodation would otherwise let the icons
slide right and break the column. Worth borrowing for the real roster, which sits in a content area whose
width depends on the sidebar state.

**Copy was rewritten for a marketing reader.** All em dashes removed; "our servers", "capabilities" and
"narrow permissions" removed with them, since a teacher does not care where our servers are, they care that
nobody can take their class list and that a principal will not block them. The headline leads with the
benefit ("Less admin. More teaching.") rather than with where files are stored, which is a reason to
believe rather than a reason to care. Nothing on the page names a fixed number of tools, so a sixth tool
cannot silently make the copy wrong — a test asserts it.

- **Tests:** client **246 pass** (16 new, covering the showcase's tab and keyboard behaviour, the
  pricing/FAQ split, the comparison table, and a guard that every address in a product shot uses a reserved
  example domain). Server unchanged at **316 pass**. Typecheck, build and lint clean; lint holds at the
  same 5 pre-existing `react-refresh/only-export-components` problems. The emitted CSS was checked rather
  than trusted: both display steps, `bg-canvas` in light and dark, and both container queries
  (`not (width>=620px)` and `not (width>=560px)`) are present in the build output.

**Review pass on the copy and the pricing table.** After the build, a round of content corrections:

- **The FAQ was consolidated and reordered.** "What happens to my data if I stop paying" and "Can I get my
  data out" were answering the same question from two directions and are now one. A new question leads the
  page: *why do I need to sign up with Google*, which is the first objection a privacy-minded teacher
  forms, and the answer is the product's central claim stated plainly. "Why is IEP tracking free" was cut;
  it explained our reasoning to someone who had not asked for it.
- **Mass email appears on both plan cards**, phrased as the landing page phrases it. It had read as a
  premium feature with a free allowance rather than as a free feature with a premium ceiling, which
  undersells the free tier's most useful tool.
- **The comparison table shows inclusion as a tick rather than the word "Included"**, with the word kept
  as screen-reader text so the meaning is not carried by colour and shape alone. Rows are ordered shared
  first, differing after, so a teacher reads what they get for nothing before what they would pay for.
- **Per-student attendance summary was removed as its own row** (it is part of statistics), grouping now
  reads as present on both plans with "Advanced grouping options" as the premium line, and the Name Picker
  row names its modes.
- The annual caption changed in `api/billing.ts` rather than on the page, so the upgrade modal and the
  pricing page keep saying the same thing.
- **The fullscreen-and-theme row was dropped from the comparison table.** It sat in the shared block
  saying the same thing on both sides. Legibility controls staying free is a design principle rather than
  a plan feature, so it does not earn a row a teacher has to read.

**The review so far has been of the copy, not of the rendering.** Per the project's verification rule the
visual pass in a browser is the user's, and it has not been reported back. Also still open from the
previous entry: migration `0006` and the LEFT-join support queries have not been run against
the live Postgres. **And one thing this step introduced deliberately:** the pricing table advertises the
Marble Race, which is not built (see the Phase 3 section above for the obligation that creates).

---

### Phase 2 Step 5a (Onboarding & managed-domain allowlisting)

Three pieces that look unrelated and are not: what a new account sees, what a blocked account sees, and what
the person who can unblock it sees. All three are the same question — the app is useless until a teacher can
get in and get a class list in — approached from the three points where that goes wrong.

**The OAuth callback was answering the wrong question.** It parsed `code` and `state` and nothing else, so
every failed consent fell through the schema into `VALIDATION_ERROR` and a screen reading "the request was
missing or invalid information. This usually clears up on a retry." For the case this product hits most that
is not merely unhelpful, it is false in both halves: nothing was invalid, and retrying cannot work, because
the block is a setting in a school board's Admin console. The callback now evaluates Google's error branch
*before* the schema (an error response carries no `code` at all, so parsing first is what caused the
misreport) and classifies it into `ADMIN_POLICY_BLOCKED`, `CONSENT_DECLINED` or `OAUTH_ERROR`.
`admin_policy_enforced` is checked in **both** `error_subtype` and `error_description`, because Google puts
it in either depending on the flow, and trusting one field would have made the detection work in testing and
fail for half of real users.

**The blocked screen has no retry button.** That is the substantive design decision on it. Every other
failure keeps "Try again"; this one offers instead the two things that can actually change the outcome — a
page written for the administrator, and the contact form — because a button that cannot work is worse than
no button, and a teacher pressing it all afternoon is the failure mode being designed out.

**`/for-admins` is public, and pitched at an IT decision rather than a privacy review.** Its reader is not
the blocked teacher: it is their administrator, who has no account here, may arrive from a pasted link, and
must not have to reproduce a failed sign-in to read a page about failed sign-ins. It leads with the console
path and the client ID, because an admin who has already decided still needs those, and puts the
data-handling summary second for the one who has not.

**The client ID and scope list are served, not hardcoded.** `GET /public/app-info` returns them from the same
config and the same `GOOGLE_SCOPES` array the authorization URL is built from. A client-side copy would be a
second place for them to go stale, and the failure mode is specific and bad: an admin pastes an ID that
allowlists nothing, and the teacher is still locked out after everyone did their part — a bug that surfaces
as a support ticket from someone who cannot sign in to file one. Nothing in the payload is secret; both
values already appear in the consent flow.

**The DPA was deliberately not written, and this is the reasoning.** The step's brief named a signable DPA
template as admin collateral. A DPA is a procurement artifact, produced when an institution buys something
and its privacy office reviews the vendor. That is not this transaction: the teacher pays, the board
approves nothing, and the only thing needed from the board is a checkbox. Asking an admin to route a
one-teacher allowlist through legal is the surest way to get no answer. The page states the factual position
(a description of shipped architecture, not a commitment) and offers a DPA on request. The residual risk —
a board that signs before it allowlists anything touching student data — arrives one board at a time, and
the first real request will define the wording better than a guess written against an operating entity that
has not been chosen.

**Onboarding completion is a database column, not localStorage.** `users.onboarded_at`, null until the guide
is finished. Per-browser would have been wrong twice over: a teacher signing in on the classroom desktop and
again on their laptop would be walked through it a second time, and clearing site data would resurrect it
years later. Existing accounts are backfilled to `created_at` in the migration, because they have been using
the app and a welcome screen would read as an insult.

**The guide is a page, not a stepped tour.** A tour has to be dismissed before the app can be used, arrives
before the teacher has any question it could answer, and is the thing people click past. A page can be read,
skipped, or returned to — and it is returnable, from **Getting started** in the account menu, because the
teacher who clicked past it on day one is the one who wants it in week two. Its primary action is not "Next"
but "Add my first class", which is the task they had anyway; and its opening list is what has *already*
happened (account made, spreadsheet created, trial started) rather than homework, because all three are true
by the time it renders.

**One real bug found and designed out, in the redirect.** The first draft trusted `needsOnboarding` from the
profile, which meant that if the completion write failed — offline, a 500 — the teacher would be dragged
back to the page they had just finished, every time, with no way forward. Two attempts to fix it inside
`RequireOnboarding` (a ref read during render, then state set in an effect) were both correctly rejected by
the linter as render-time side effects. The right fix was to move the state rather than guard it:
`useAuth` gained `markOnboarded`, which clears the flag on the profile locally, and the guide calls it in a
`finally` regardless of whether the write landed. Whether the teacher has read the page is not a fact about
our database being reachable. `RequireOnboarding` is now stateless, and a failed write costs one extra
showing of the guide instead of a trap. A test asserts exactly that: with a profile that permanently reports
`needsOnboarding: true`, finishing the guide still lands on the roster.

**`users.workspace_domain` records Google's `hd` claim.** The allowlisting problem is per-domain, not
per-teacher: four blocked sign-ins from one board are one conversation with one admin, not four tickets. It
is the teacher's own employer's domain, it is refreshed on every sign-in like the other identity fields, and
it is deliberately the whole of what the app learns about their institution.

**A latent test-harness bug was found and fixed while diagnosing a phantom double call.**
`beforeEach(() => vi.mocked(fn).mockResolvedValue(x))` returns the mock function, and vitest reads a function
returned from a hook as its teardown callback and calls it — invoking the mock an extra time per test and
leaving its rejection unhandled. It was silently present in `TopBar.test.tsx` (harmless there only because
nothing asserted a call count) and is now a block body in both places, with the reason recorded at the site.

- **Tests:** server **330 pass** (14 new: the four callback classifications plus the assertion that a
  malformed callback with no error is still `VALIDATION_ERROR`, the onboarding endpoint's session, CSRF and
  idempotence cases, and `publicInfo.test.ts` including a guard that the served scopes are the same array
  sign-in uses). Client **272 pass** (26 new, covering the redirect, the rewritten guide including that it
  never offers to add a class and leads with the action, the two add deep links on the Students page, and
  the admin page including its behaviour when the info call fails). Typecheck and build clean on both;
  client lint back to the same 5 pre-existing `react-refresh/only-export-components` problems after the
  `RequireOnboarding` rewrite and the deep-link initializers.

**Live-verified against the provisioned Postgres.** Migration `0007` applied and was inspected in
`information_schema` (`onboarded_at` nullable timestamptz, `workspace_domain` not-null defaulting to `''`),
the backfill left no existing account facing the welcome screen, and the store's new behaviour was exercised
end to end: a new account starts with `onboardedAt` null, `markOnboarded` sets it, a second call leaves the
timestamp unchanged, and a repeat sign-in refreshes `workspace_domain` without resurrecting onboarding. This
run also applied `0006_public_support_requests`, which had been outstanding from Step 5.

**Not visually reviewed.** Per the project's verification rule the browser pass is the user's, and the three
new surfaces (`/welcome`, `/for-admins`, and the blocked variant of `/auth/error`) have not been driven live.

**One pre-existing failure found, not introduced here and not fixed here.** Four `AttendancePage` tests fail
on Saturdays and Sundays: they build their fixtures around `todayIso()`, and `EntryView` correctly disables
entry on a weekend, so the suite is green Monday to Friday and red at the weekend. It reproduces on a clean
checkout of `main`. Left alone because it is outside this step and the fix is a judgement call (pin the tests
to a fixed weekday, or make the date injectable) rather than an obvious one-liner.

**Review pass: the first-run guide was rewritten.** On review it read as a worse version of the marketing
site, which is the wrong thing to show someone who has already read the marketing site and signed in. Four
faults, and the layout that replaced them:

- **It buried the action.** "Start here" sat in the middle, between a restatement of the value proposition
  and a tool-by-tool feature list. The action is now the page: a single bordered block directly under the
  title, and it is the largest thing on the screen.
- **Its primary action named something that does not exist.** "Add my first class" implied a class-creation
  flow. There is none — a class comes into being when a student names one, which is genuinely non-obvious
  and is now the one mechanic the page teaches. The two buttons are **Paste a class list** and **Add one
  student**, which are the two real entry points.
- **Both buttons now land inside the form.** `?add=bulk` and `?add=one` on the Students page open the bulk
  grid or the single-student modal on arrival, read in the state initializers rather than synchronised by an
  effect (so the form is open on the first render instead of flashing an empty roster) and dropped from the
  URL immediately, since a parameter left there would reopen the form on every reload and back navigation. A
  test asserts the clearing, and was mutation-checked to confirm it fails without it.
- **The per-tool descriptions were cut.** They duplicated the landing page's showcase, taught nothing a
  click would not, and were the same maintenance liability as a static screenshot: prose describing a tool
  goes stale silently when the tool changes. The sidebar strip survives as icons and names only, in
  `navConfig` order, because it does the one thing prose cannot — map the page onto the chrome the teacher
  is looking at — and carries nothing that can drift.

What is left is short and scannable: the action, then the two questions a teacher actually arrives with
(where the data lives, what happens when the trial ends) as two compact cards rather than paragraphs, then
the sidebar strip, then a visible **Skip for now**. The `/for-admins` link was dropped from it as well — a
teacher reading this page has already signed in, so they are by definition not the person who is blocked.

### Phase 2 Step 5c (Registration consent) — two agreements, gated server-side

Added out of sequence, from a review of Step 5a rather than from the roadmap. The observation was simple and
correct: a teacher could reach every tool in the app having agreed to nothing. Google's consent screen covers
Google's scopes; it says nothing about our terms, and nothing at all about the obligation that actually
matters here.

**Two checkboxes, not one, and the second is the substantive one.** The first is the ordinary terms and
privacy policy acceptance. The second is an acknowledgement that student information stored in the teacher's
own Google account remains their responsibility — including compliance with the privacy laws, records
regulations, and board or district policies that apply to them. Bundling the second into the first would have
been easier and would have made the record of it materially weaker: a teacher should have to tick that one
specifically, and the record should show that they did.

**The gate is server-side, and that is the design.** `requireConsent` mounts alongside `requireSession` and
`requireCsrf` on every non-auth router and re-reads the account on every request. A client-side prompt would
have been defeated by calling the API directly, which would leave the app reading and writing a teacher's
student data on the strength of a checkbox nobody ticked. The order matters too — consent runs last, so a
cross-site forgery is still reported as CSRF rather than as a consent prompt.

**The exceptions are exactly the routes that let a teacher resolve it or leave:** `/auth/me`, `/auth/consent`,
and `/auth/logout`. Support is deliberately not among them, despite being the natural place to ask a question
about the terms, because the public contact form needs no account at all — so nobody is left unable to reach
us. Declining is a real option on the screen: "Sign out instead", which leaves the account and the
spreadsheet untouched.

**Consent is versioned, not merely timestamped.** `terms_version` alongside the two timestamps, checked
against `CURRENT_TERMS_VERSION`. Without it there is no way to tell who agreed to which text and no way to
re-prompt, and it cannot be retrofitted cleanly — an unversioned population is unversioned forever. With it,
revising the terms is a one-line change that re-prompts everyone on their next request. `recordConsent` is
therefore deliberately **not** idempotent, the opposite of `markOnboarded`: on a version bump the teacher is
accepting genuinely new text, and preserving the old timestamp would record them as having agreed to it
before it was written.

**Existing accounts were not backfilled**, which is also the opposite of what migration `0007` did for
onboarding. They have not agreed to anything, and writing a timestamp saying they had would fabricate exactly
the record this step exists to create. They are prompted on their next request.

**The client screen is a gate, not a redirect** — the other place it diverges from the first-run guide. The
guide may be skipped because nothing turns on having read it; this may not, because the server refuses every
tool router until consent is on file, so rendering the shell would produce an app where every panel loads
into an error. It sits above the entitlements provider for the same reason: that provider's own fetch is one
of the refused calls. And a **failed write keeps the teacher on the screen**, again inverting the guide's
behaviour: there the local answer was the true one, here only the server can decide and it will keep
refusing, so letting them through on a failure would strand them in a dead app.

**The version is echoed back on acceptance** rather than assumed server-side, and a mismatch is rejected. The
failure it prevents is a client holding stale text recording agreement to terms the teacher was never shown.

**The known weakness, stated rather than papered over.** `/terms` and `/privacy` still serve placeholder text
that says outright it is not a policy, so the first checkbox is close to meaningless until the legal hold
clears. The second does not share the weakness — its full wording is on the screen and is agreed by reading
rather than by reference — so the substantive protection is in place today, and the version field makes the
real documents landing a clean re-prompt rather than a migration. Recorded in NEXT_STEPS as a reason to
schedule the legal work sooner.

- **Tests:** server **356 pass** (26 new: the gate's six cases in `consent.test.ts` including the stale
  version, the half-consented account, and a deleted account reported as `UNAUTHORIZED` rather than as
  consent; the endpoint's validation matrix in `auth.test.ts` asserting that every way of not agreeing records
  nothing; and the mounting assertions in `gating.test.ts`). Client **284 pass** (8 new, covering the shell
  being replaced rather than covered, the submit button tracking both boxes in both directions, the version
  echo, the failed write staying put, and the acknowledgement text). Typecheck and build clean on both; client
  lint back to the same 5 pre-existing `react-refresh/only-export-components` problems.

- **Mutation-checked.** Removing `requireConsent` from the mount in `index.ts` fails 7 of the `gating.test.ts`
  cases, so the mounting assertions are load-bearing rather than passing on the gate's absence.

- **Live-verified against the provisioned Postgres.** Migration `0008` applied and was inspected in
  `information_schema` (both timestamps nullable timestamptz, `terms_version` not-null defaulting to `''`);
  the existing account was left un-consented as intended; a fresh account starts with the gate closed; and
  `recordConsent` opens it, a stale version re-closes it, and re-accepting moves the timestamp forward.

- **Not visually reviewed.** Per the project's verification rule the browser pass is the user's; the consent
  screen has not been driven live.


### Phase 2 Step 6e (Class archiving)

Built after being designed earlier in the same session. A `courses` tab makes a class a record for the first
time (schemaVersion 4, additive — a test reshapes a sheet as a v3 account and proves the five new tabs appear
with correct headers and no data touched), four archive tabs mirror their live counterparts, and rows **move**
rather than being flagged, because `listAttendance` reads the whole tab and a flag would leave the read cost
exactly where it was.

**The ordering is the safety argument.** Read, append to the archive, verify by row count, then rewrite the
source. A crash before the verify leaves the source untouched; a crash after it leaves duplicates, which the
next run removes by id. The reverse order would turn the same crash into permanent loss of attendance
records. Each tab is one read-partition-rewrite, so the cost is a handful of API calls whatever the row
count, rather than the thousands of delete ranges that removing scattered rows would need.

**Synchronous, holding the account's other writes.** A rewrite reads a tab and writes back its survivors, so
an attendance row entered in between is read by nobody and then overwritten. Reads continue. The lock is
in-process, which matches the single-instance decision, and moving it to Postgres is a prerequisite for
scaling out rather than an afterthought.

**Four bugs, all found by tests or by manual use rather than by design.** Two before shipping: the orphan rule
would have swept up a student created moments earlier and not yet placed in a class, and reconciliation
compared course names against archived rows too, so a teacher reusing a name in September got no live class
at all — the exact workflow the feature exists for.

Two more from the user's manual testing, and the second was data loss:

- **The archive dialog missed newly created classes for up to five minutes.** `listCourses` cached its own
  copy of the enrollment rows under the courses key; adding a student invalidates the enrollments cache, but
  nothing invalidated that one. Enrollments now come from their own service, so every existing invalidation
  applies and there is no second set of rules to keep in step.
- **Restoring a class into a live class of the same name merged the two and stranded the archived students.**
  The rename ran *after* the restored rows landed, rewriting every row in the destination whose course matched
  the old name — which, on a restore that needs a rename, is both the restored rows and the live ones by
  definition. The orphan check then looked for live enrollments under the old name to decide who to bring back
  from `studentsArchive`, found none because it had just renamed them all, and restored nobody. The rename now
  happens on rows as they move, before the append, and the orphan check matches the names the rows actually
  carry. Both are covered by tests reproducing the reported sequence, and both fail against the previous code.

That second bug also exposed a missing invariant, now enforced in both directions: **a class name is unique
among live classes and unique among archived classes, though it may exist once in each.** Archive rows carry
only the course name, so two archived classes sharing one would have indistinguishable rows — and archiving
the same name in successive years is entirely ordinary.

**The user's real spreadsheet was repaired**, with a snapshot of every affected tab taken first. 15 enrollments
were renamed back, a duplicate emptied course record merged away, and 12 students moved out of
`studentsArchive` back onto the roster. The repair script was idempotent and was deleted after use; nothing had
been deleted by the bug, only misnamed and misplaced.

- **Tests:** server **411 pass**, client **293 pass**. Typecheck and build clean on both; client lint back to
  the same 5 pre-existing `react-refresh/only-export-components` problems.

- **Not visually reviewed beyond the user's own pass**, which is what found the two shipped bugs.

### Phase 2 Step 6e follow-up (archive dialog review)

The user confirmed archiving and unarchiving as manually tested and working, and the review pass that
followed produced four fixes. None changed the move itself; three were the dialog and one was the shape of
the response it re-renders from.

- **The move endpoints returned a narrower body than `GET /classes`.** They omitted `studentCount`, so every
  class in the dialog read "undefined students" the moment an archive or restore finished — the one moment
  the dialog is guaranteed to re-render. Both endpoints now build their response through the same helper as
  `GET`, which is why the shape can no longer drift.
- **An emptied live class stayed in the dialog.** `listCourses` reconciled in one direction only: a name on
  an enrollment with no course row became a class, but a course row with no enrollments was kept. That was
  written to protect a class briefly emptied of students, except there is no way in the app to make a class
  except by putting a student in one, so an empty live class is the remains of a deleted one. Every other
  tool derives its class list from enrollments and had already dropped it, which made the archive dialog the
  single place a deleted class survived. Live rows with no live enrollments are now soft-deleted in the same
  pass that backfills; archived rows are exempt, since having no live enrollments is what archived means.
- **The dialog could offer two opposite actions at once.** Selecting from both lists produced both an
  Archive and a Restore button, leaving the teacher to work out which of their checkboxes each applied to,
  and the two would have run as opposite writes against the same tabs. Choosing a direction now disables the
  other list, so there is at most one action button. The "Done" button went with it: the dialog already has
  a close control, and a second one that also merely closed read as a confirmation.
- **The two notices were muted body text.** The in-progress notice asks the teacher not to close the window
  and the rename notice tells them a class came back under a different name; both now use the warning
  treatment (`border-warning` / `bg-warning-bg` with an icon) already used for the legal placeholders,
  rather than competing with a list of checkboxes as grey paragraphs.

Two more from the same review, neither specific to archiving:

- **The archived class list is bounded and scrolls within itself** (roughly five rows). The modal panel
  already scrolls against the viewport, but the archived list gains a class every semester and has no
  ceiling, so letting it size the panel would push the live classes, both notices and the action button out
  of reach.
- **A tool's class selection now survives navigation** ([useSelectedClass.ts](client/src/hooks/useSelectedClass.ts)).
  Attendance, Grouping and the Name Picker each reset to the first class alphabetically on every remount, so
  any trip through another tool put the teacher back in a class they were not teaching — in Attendance, that
  is recording against the wrong class. The roster had already solved this for its filters; this is the same
  module-scope treatment, kept **per tool** rather than shared, so changing the class in the Name Picker
  cannot change which class attendance is about to be taken for. A remembered class that has since been
  archived falls back to the first rather than showing an empty view, and the fallback is deliberately not
  written back, since `courses` is empty while the roster loads and treating that as "your class is gone"
  would discard the selection on every remount. In memory rather than localStorage, matching the roster: a
  stored class that no longer exists a term later is a question the within-session fix does not have to
  answer. The Email tool is excluded — it selects recipients across classes rather than scoping to one.

- **Tests:** server **413 pass** (two added: student counts survive a move, and an emptied class leaves the
  listing), client **297 pass** (four added: the direction lock, the absence of the Done button, and the
  remembered class surviving a remount and falling back when it is gone). Typecheck and build clean on both.

- A **class management page** — archive, unarchive, rename, delete, move students between classes — was
  adopted as a post-launch Phase 3 candidate rather than folded in here. The reasoning, and the question each
  addition raises that 6e did not have to answer, is in IMPLEMENTATION_PLAN under Phase 3 Additions.

### Phase 2 Step 6b (Hosting provider and plan)

A discussion step with no code. The provider, plan tier, region and managed-Postgres arrangement were
decided together and before anything was bought, which is what the step asked for. Prices below are USD per
month and were verified against the providers' own pages on 2026-08-04; confirm at purchase.

**Decision: DigitalOcean App Platform + DigitalOcean Managed Postgres, Toronto (`tor1`), about $25/month,
with Google Cloud KMS holding the refresh-token encryption key.** Full rationale and the rejected
alternatives are under Decisions Made below.

**Region was decided first, because it eliminated most of the field.** The question the user raised is that
the app targets Canadian and US teachers at once, and it is not obvious whether hosting in one country
complicates serving the other. Researched rather than assumed, and the answer turns on a fact about this
app's architecture: **our database holds no student data.** Names, IEP notes, attendance and contacts live in
the teacher's own Google Drive inside their board's own Workspace tenancy. What our server holds is the
teacher's own identity, their sheet id, subscription state and an encrypted token, so rules written about
*student records* largely do not reach it. Student data touches our side only transiently, in the working
set and while sending email.

- **United States: no residency requirement anywhere that matters.** FERPA contains none, and neither do the
  strict state statutes (NY Education Law § 2-d, Illinois SOPPA, California SOPIPA), which govern access,
  use limitation, encryption in transit and at rest, and deletion on termination. NY § 2-d is the strictest
  and is an encryption-and-contract obligation, not a location one. US storage appears as a clause districts
  write into their own vendor contracts by convention.
- **Canada: no federal requirement, but a live provincial one.** PIPEDA permits transfer out of the country
  for processing given comparable protection and disclosure that foreign authorities may access it, which is
  a privacy-policy obligation and easily met. Provincial public-sector law binds boards and, through them,
  their service providers: BC repealed its in-Canada rule in 2021, but **Nova Scotia's PIIDPA still requires
  in-Canada storage and access until its replacement takes effect on 2027-04-01**, and Quebec's Law 25
  requires a privacy impact assessment before an out-of-province transfer.
- **The asymmetry is the whole argument.** Canadian hosting is lawful for every user in both countries. US
  hosting creates an obstacle in part of the home market. The cost of choosing Canada is 20 to 40 ms of
  latency for a US teacher, invisible in this app, plus the occasional US district checklist asking whether
  data is stored in the US, which mostly never reaches us because the product is not sold through
  procurement.

**Verified numbers, all in the smallest sensible tier.** DigitalOcean Toronto: App Platform 1 vCPU / 1 GiB
at $10 plus Managed Postgres Basic 1 GiB / 1 vCPU / 10 GiB at $15.15, both confirmed available in `tor1`.
Google Cloud Montreal (`northamerica-northeast1`): Cloud Run with one warm instance at roughly $10 to 13
plus `db-f1-micro` Cloud SQL at roughly $8 to 10 plus about $2 storage. Fly.io Toronto: a small machine at
$5 to 15 plus Managed Postgres Basic at **$38**, which is $23 more than DigitalOcean's for no benefit at this
size. **Render and Railway were eliminated on region alone** (Render offers Oregon, Ohio, Virginia,
Frankfurt and Singapore, with no Canadian region); for reference its equivalent US stack is about $26.

**Two things raised in the earlier framing turned out to be weaker than stated, and both were corrected in
the discussion.**

- **The SLA caveat on Cloud SQL's shared-core tier is close to irrelevant.** An SLA is a contractual uptime
  promise whose remedy is service credits, so on a $10 database a bad month refunds a few dollars. It is not
  a reliability rating. What actually matters is that **neither cheap option is redundant**: both are single
  nodes taking short maintenance restarts, and because sessions live in Postgres a restart means a brief
  window of errors rather than data loss. Redundancy roughly doubles the cost on either platform and is not
  worth buying before there are users.
- **"We are already integrated with Google" does not favour hosting on Google Cloud.** The integration is
  with Google *APIs* (OAuth, Sheets, Gmail), which are ordinary HTTPS services called with a client id and
  secret from any server anywhere. They share the same web console as Cloud Run and Cloud SQL, which makes
  them feel like one system, but nothing operationally: hosting on GCP would give the Sheets integration no
  shared credentials, no private network path, no useful latency gain and not one line less code. OAuth
  verification and the Marketplace listing attach to the Cloud project and the verified domain, not to where
  the app runs.

**The KMS commitment is kept without hosting on Google.** Cloud KMS is an API callable from DigitalOcean
using the Cloud project that already exists for OAuth. The honest cost is that authenticating to it from
outside GCP needs a service-account credential on the server, so what sits beside the ciphertext becomes a
revocable, logged credential to the key service rather than the key itself. That is the point of the
exercise: whoever obtains the database no longer has the key. Refresh tokens are decrypted rarely, so the
extra round trip is not on any hot path.

**Configuration cost was the deciding practical factor.** DigitalOcean App Platform builds from the GitHub
repository with no Dockerfile, attaches the managed database and injects its connection string, provisions
and renews TLS for a custom domain, and redeploys on push, which is most of 6d in an afternoon. The Cloud
Run equivalent needs a Dockerfile, an Artifact Registry repository, a build pipeline, a Cloud SQL connection
path (Auth Proxy socket or a Serverless VPC connector at extra cost), Secret Manager for env secrets, and
least-privilege IAM across all five, which is the largest time cost and the easiest thing to over-grant.
**The custom domain is the gotcha to check before ever revisiting this:** Cloud Run's free domain mapping has
not been available in every region, and if Montreal lacks it the fallback is a Global External Application
Load Balancer at roughly $20/month more, which would make Google the more expensive option as well as the
slower one.

**Confirmed against 6a as that step required.** A single App Platform instance matches the single-instance
decision; App Platform can pin to one instance now and offers affinity later, so the sticky-sessions path
stays open and no shared cache holding student data is introduced. **The built client will be served by the
same Node process**, keeping one origin so the session cookie needs no cross-site handling and CORS drops
out of production entirely.

**Entity and jurisdiction settled in the same session, which unblocks the half of 6c that was never waiting
on hosting: sole proprietorship in Ontario, Canada**, with the intent to incorporate later. See the
Decisions Made entry for the liability trigger that was corrected and the items 6c now has everything it
needs to state.

- **No code, no tests.** The only artefacts are this entry, the Decisions Made record, and the NEXT_STEPS
  update moving the work to 6c.

### Phase 2 Step 6c (Privacy policy and terms of service)

The hold was lifted deliberately, and both documents are written and live at `/privacy` and `/terms`,
replacing the placeholders that said they were not policies. **Neither has been reviewed by a lawyer**, and
the version constant exists partly so that a reviewed revision is a one-line bump.

**Written from a data inventory, not from a template.** Every table and column in
[migrations.ts](server/src/db/migrations.ts), the three OAuth scopes, the pino redaction list, the session
cookie's attributes, the working-set TTLs and the Sheets tab schema were read first, so the policy
enumerates what is actually stored rather than a plausible superset. That is what lets it make specific
claims — the complete list of stored fields, the exact scopes, one strictly necessary cookie, no analytics —
instead of the hedged generalities a template produces.

**The spine of both documents is the split the product is built on.** Account information is ours and we
answer for it; student information is in the teacher's own Google account and they do. The privacy policy
states it in its second section and refers back to it throughout; the terms turn it into an allocation of
responsibility. That framing is what makes the risk allocation defensible rather than merely aggressive: it
matches the architecture, so a reviewer checking it against the code finds it true.

**Where the aggressive drafting stops, and why.** The instruction was to minimise liability and maximise the
account holder's assumed responsibility, and three limits were treated as real rather than drafted through:

- **Ontario's Consumer Protection Act, 2002 binds, because the customer is a consumer.** A teacher paying
  personally is one, the Act voids contracting out of it, and it preserves the right to sue in court and to
  join a class proceeding. So the arbitration and class-action waiver is **scoped to US residents only**,
  carries a 30-day opt-out, and expressly does not apply to an Ontario consumer. Applying it to everyone
  would invite a court to read down the surrounding clauses too.
- **Some liability cannot be excluded at all.** Fraud, wilful misconduct, gross negligence, and death or
  personal injury are carved out of the cap, in their own section immediately after it.
- **The cap itself is the greater of twelve months' fees or CAD $100**, with consequential, indirect and
  data-loss damages excluded, and a paragraph saying plainly why that allocation is reasonable for a
  product at this price that holds none of the records in question.

**What the terms put on the teacher**, all of it factually true rather than reallocated: they are the party
responsible for student information; they warrant authority to use a tool of their own choosing for it and
compliance with the statutes and board policies that apply to them, named specifically for both countries;
they are the sender of every email for anti-spam purposes under CASL and CAN-SPAM; they keep their own
copies, because we hold none; and buying a subscription creates no relationship with their school and does
not make us a "school official" of a district.

**The privacy policy carries two things that exist for a reader other than the teacher.** The Google API
Services User Data Policy Limited Use statement is written out in full, because OAuth verification in Step 9
checks for it and a rejection there costs months. And a numbered section addressed to school and board
administrators states the review checklist answers in one place: no student records held, data in Canada,
three narrow scopes, no procurement needed.

**Two honest disclosures rather than convenient absolutes.** The support form's free-text field is named as
the one place a teacher can put student information into our database despite the design, with an offer to
delete it. And the in-memory working set is described as what it is, including that it is discarded within
minutes, rather than being papered over with "we do not store student data".

**Implementation.** The text lives in `privacyPolicy.tsx` and `termsOfService.tsx` as arrays of sections
rendered by a shared `LegalDocument` shell, with the operator identity, effective date, version and
subprocessor list as constants in `legalMeta.ts`. **Section numbers are never written into the prose**: a
cross-reference names an anchor and `sectionNumber` resolves it at render, throwing on an unknown one, so
inserting a clause cannot silently leave a document citing the wrong section. The sections are passed as a
thunk because the elements holding those references are built while the array they point at is still being
constructed. Anchors are stable ids so a board or a reviewer can cite a clause by URL.

**`CURRENT_TERMS_VERSION` moved from `1970-01-01-placeholder` to `2026-08-04`**, which is the mechanism built
in Step 5c doing exactly what it was built for: every existing account is re-prompted on its next request,
this time against text that exists. The client's `DOCUMENT_VERSION` must equal it, and both files say so.

- **Tests:** server **413 pass**, client **301 pass** (four added, replacing the three that asserted the
  placeholders said they were placeholders). Typecheck and build clean on both; client lint back to the same
  5 pre-existing problems after the section-reference helpers were moved out of the content modules to keep
  the fast-refresh boundary.
- **Still to do, and it is a real gap:** there is **no self-serve account deletion**. `AccountStore.delete`
  exists and is wired to no route, so the policy commits to deletion **on request within 30 days**, which is
  honest and is a path an operator can actually execute. Google's OAuth verification is likely to want a
  self-serve route, so this belongs in 6d or Step 9.
  *(Two corrections, made later. The method is `delete(googleSub)`, not `deleteAccount` — the name written
  here and in IMPLEMENTATION_PLAN existed nowhere in the code, so a future session would have grepped for it
  and found nothing. And the claim about OAuth verification was checked against the published policies and
  is wrong: the account-deletion mandate is Google Play's. Deletion shipped in Step 6f on product grounds.)*
- **Also outstanding:** `PRIVACY_CONTACT_EMAIL` is empty until the domain exists, and both documents route
  the reader to the contact form meanwhile. Set it in 6d.

---

### Phase 2 Step 6c revision (Legal document consistency pass) — version `2026-08-04.2`

A read of both documents against the shipped code, looking for claims the implementation does not support and
for places the two contradict each other. Eight changes, four of them corrections rather than improvements.

**The correction that mattered most: the OAuth scope list was wrong.** The privacy policy said "We request
three permissions, and no others" and listed `spreadsheets`, `drive.file` and `gmail.send`. `GOOGLE_SCOPES`
in [googleAuth.ts](server/src/services/googleAuth.ts) requests **six** — those three plus `openid`, `email`
and `profile`, which are what the identity fields in the account row come from, and which `/for-admins`
already disclosed. A discrepancy between the requested scopes and the published policy is precisely what
Google's OAuth verification (Step 9) compares, so this was a months-long rejection waiting to happen. The
section now lists the identity scopes in their own paragraph, says none of the six is a restricted scope, and
points at the administrator page, which serves the same list from the same config sign-in uses. A test now
asserts every scope string appears on the page.

**Two claims about controls that do not exist.** The privacy policy said we "let you sign out everywhere" and
the terms said "You can sign out of all sessions from within the app at any time". `destroyAllForUser` exists
on the session store and is wired to no route; logout destroys the current session only. Both now describe
what actually happens — signing out ends that device's session, we will end every session on request, and
revoking access in Google works without us — and the privacy policy's rights list gains the same as a request
we honour.

**Technical logs were not disclosed at all.** The policy enumerated the database exhaustively and then said
we run no analytics, which left server logs — including the network address a request came from, and the
in-memory per-subnet counters behind the public contact form's rate limit — undescribed. Now a paragraph of
its own, deliberately outside the "complete list of what is stored in our database", because logs are not in
the database and that list's precision is what makes it worth having. **Retention is stated at no longer than
30 days, which 6d's log aggregation has to be configured to honour.**

**Smaller inconsistencies fixed.** The forum clause said the Ontario courts have jurisdiction over any
dispute while the next section sent US residents to arbitration; it is now expressly subject to it. The
entire-agreement clause listed the Terms and the Privacy Policy but not the data-responsibility
acknowledgement, which is a separate agreement recorded in its own column and would have been arguably
merged. "We do not keep a copy" in the two-kinds section sat against the working-set section three clauses
later; it now says we store no copy and points there. The administrators section claimed the vendor's systems
and data are in Canada without the Stripe exception the disclosure section states. The support-request
retention line now says "up to 24 months", with account deletion taking a request with it sooner, which is
what `ON DELETE CASCADE` on `support_requests.google_sub` actually does.

**One thing added because consent is recorded as a version string.** Both documents now promise the text of
the version you accepted on request, and the consent screen displays the version and effective date being
agreed to. A recorded version whose text cannot be produced proves nothing; git history is that archive
today, and `legalMeta.ts` says so, along with what has to replace it if the documents ever leave this repo.

- **Version bumped to `2026-08-04.2`** in `legalMeta.ts` and `config/legal.ts` together. The changes are
  substantive, so the re-prompt is correct; the date-plus-revision form keeps the "when as well as which"
  property of the original scheme.
- **Tests:** server **413 pass**, client **303 pass** (two added: every requested scope appears in the
  policy, and the technical-logs disclosure with its retention). Typecheck and build clean on both; client
  lint at the same 5 pre-existing problems.
- **Three items this pass hands to 6d**, each a commitment the text now makes that nothing yet enforces: a
  **retention sweep for `support_requests`** (24 months after resolution — nothing deletes them today), **log
  retention configured to 30 days** on whatever aggregation is chosen, and a **session-revocation path** an
  operator can run for "someone else has used my account". The first two are jobs, not features.
- **Unchanged, deliberately:** the Toronto database and the KMS-held token key are still described in the
  present tense while the deployment is a local Postgres with the key in an environment variable. That was
  already recorded as 6d's hard ordering constraint — the domain must not become publicly reachable until
  both sentences are true — and `legalMeta.ts` now carries the same warning next to the subprocessor list.
  **Neither document has been reviewed by a lawyer**; that remains the outstanding item.


### Phase 2 Step 6f (Account menu rework, deletion, and the help documentation)

Pulled out of 6d and built first. Three pieces: a menu that had never been designed as a whole, the two
account actions it had no room for, and the one piece of documentation Google actually requires.

**It started as a correction to my own advice.** The 6d rationale had claimed a self-serve deletion path was
likely required by OAuth verification and the Marketplace listing. Checked against the published policies,
that was wrong: the account-deletion mandate is Google **Play's** and does not reach a Workspace Marketplace
app, and the Marketplace review criteria, the Marketplace program policies and sensitive-scope verification
contain no deletion or session-revocation requirement between them. Sign-out-everywhere had a worse
provenance still — it was a claim written into the first draft of the legal documents with no feature behind
it, found by the consistency pass that preceded this step. Both were built anyway, on product grounds, with
the user deciding that explicitly rather than under the impression they were forced.

**The check did find one real gap**, and it is the third piece here. The Workspace API user data and
developer policy requires that developers "provide user help documentation that explains how users can
manage and delete their data from your app or service." Nothing satisfied that. The privacy policy describes
what we hold and says you may ask us to delete it, which is a disclosure rather than an instruction sheet.

**The menu keeps navigation and nothing else.** Upgrade (unless paid), Account settings, Getting started,
Help and support, plus the operator triage item, the development plan toggle, and Sign out. Billing moved
out. The reasoning is not tidiness alone: a dropdown is the wrong container for an irreversible action,
because it is small, it is dismissed by a stray click, and it has no room to say what a control does before
it is clicked — and two of the things this step adds end an account or a session.

**Two hub pages from one primitive.** `ActionList` renders a row as a link or a button, never both, so a
destination is an anchor that middle-clicks and an action is not. It exists as one component because the
menu got out of hand exactly by growing an item at a time, and the fix only holds if the places those items
moved to keep looking like each other.

**`/help/your-data` is public, and that is the interesting decision.** Its readers include a teacher whose
board has blocked the app, one who has already revoked access, and a Google reviewer — none of whom can sign
in. A page explaining how to undo a sign-in must not require one, which is the same reasoning that put
`/for-admins` outside the auth boundary in Step 5a. It is written as an instruction sheet: where it overlaps
the privacy policy, the policy is authoritative on what is held and this page on which button to press.

**Getting started is now conditional, and the condition cost a column.** Offered until the account has a
student, then not. `users.first_student_at` (migration 0009) answers it, and the non-obvious part is that a
**roster read** sets it as well as a create. The roster lives in the teacher's Google Sheet, so no migration
could backfill the column and reading the sheet to answer a menu question would put a Sheets call behind
chrome that renders on every page — against the very quota Step 6a exists to protect. So it starts null and
the first non-empty roster read sets it, which for an existing account is their next visit to the app's
index route. Third variation on the backfill question in that file, and each of the three answered
differently for its own reason: 0007 backfilled onboarding, 0008 refused to fabricate consent, 0009 cannot
know.

**The deletion path's ordering is the part worth remembering.** Cancel the subscription, revoke the Google
grant, revoke the sessions, delete the row. **Stripe is the only step whose failure aborts everything**: a
subscription outliving its account charges a card every month with nothing left that could stop it, because
the portal is reached through a session that no longer exists. Google's revocation is deliberately the
opposite — best-effort, because an unrevoked token is inert once our copy is gone, and refusing to delete on
it would trap a teacher in an account they asked to leave. Session revocation is explicit rather than left
to `ON DELETE CASCADE`, so it is a property of the endpoint rather than of the schema.

The Google revocation also closes something that was simply missing: `delete(googleSub)` was a bare
`DELETE FROM users`, and OAuth 2.0 Policies require revoking tokens when access is no longer needed.

- **Tests:** server **430 pass** (17 added, in two new files), client **317 pass** (14 added). Typecheck and
  build clean on both; client lint at the same 5 pre-existing problems.
- **One assumption worth flagging:** "the currently existing email page" in the brief was read as the
  existing support/contact form at `/support`, which is the only reading that makes sense under a Help
  heading.
- **Two 6d items this discharges:** account deletion, and the session-revocation path that the legal
  consistency pass had handed forward. The remaining two from that pass — the `support_requests` retention
  sweep and log retention at 30 days — are unaffected and stay in 6d.


### Phase 2 Step 6f follow-up (review fixes, and a Modal bug found underneath one)

Four changes from a review of 6f, one of which turned out to be a shipped bug in a shared primitive.

**Both destructive actions were landing on an error screen.** "Log out of all sessions" used
`navigate('/', { replace: true })`, which keeps the single-page app alive with an `AuthProvider` that still
believes it is signed in — so the roster it lands on issues a request, gets a 401, and renders the "your
session ended" screen. Exactly what a teacher who just pressed a button should not see. Both now leave by
full page load, which re-runs `/auth/me` against no session and lands on the marketing home page, and which
also drops every piece of student data still resident in React state. `redirectTo` is injectable for the same
reason `AuthProvider` takes one: jsdom has no navigation to spy on.

**Deletion now requires typing the word "Delete".** The field sits below the list of consequences rather than
beside the button, so the list has to be read past on the way to it, and the confirm button is disabled until
it matches. Trimmed and case-insensitive: the point is deliberateness, and someone who typed the word was
deliberate.

**The Help hub gained the FAQ, privacy policy and terms**, under a "Reference" heading rather than appended
to the existing two rows — five undifferentiated rows would bury the support form among documents.

**The bug underneath the typed confirmation.** The field accepted exactly one character. `Modal` focused its
panel from the same effect that registers the Escape listener, keyed on `onClose`; a caller passing an inline
arrow gets a new identity every render, so every keystroke re-ran the effect and pulled focus back to the
panel. It had been latent since the primitive was written and stayed hidden because the modals built first
keep their field state in a child component, so the parent does not re-render as you type. **It was not
hypothetical:** `HighAbsenceSetting` has the broken shape — an inline `onClose` with the rate input's state
in the same component — so entering a two-digit threshold there has never worked. Fixed by moving the focus
call into a mount-only effect, with the regression asserted on the primitive rather than on the page that
happened to surface it.

**The marketing header asked for a decision, and got one.** These pages render outside `AuthProvider` by
design, so the header cannot know about a session — and with the Help hub now linking to four of them, a
signed-in teacher kept meeting a "Sign in" button that would send them through Google's account chooser.
`MarketingLayout` takes a `probeSession` flag, set on the five pages the app links to and deliberately not on
the landing or pricing pages, so Step 5's promise holds where it was aimed: a visitor deciding whether to
sign up pays for no round trip. The alternative considered and rejected was a non-HttpOnly hint cookie, which
would have been free on every page but made the privacy policy's "We use one cookie" false and cost another
version bump. The probe only ever swaps the button to "Back to the app"; every failure leaves "Sign in",
because offering a way into an app the reader cannot enter is the worse error.

- **Tests:** client **328 pass** (11 added, including a new `Modal.test.tsx` and `MarketingLayout.test.tsx`);
  server unchanged at **430**. Typecheck and build clean; lint at the same 5 pre-existing problems.

---

### Rebrand to Teachneat (naming work; execution scheduled as Step 6g)

A naming session, not an implementation step. No code changed; the planning documents were retitled and
Step 6g was added to carry the sweep.

**What prompted it.** `teachertoolkit.app` is a live AI quiz generator on the same TLD in the same market,
`teachertoolkit.co.uk` is a decade-old UK education brand ranking as one word, and a US trademark on TEACHER
TOOLKIT is registered for classroom software in special education — adjacent to the app's IEP tracking. The
Ontario registration of "Elementary Teacher Toolkit" was found to be irrelevant in both directions: the
Business Names Act permits identical registrations and confers no right to use. The decisive point was not
SEO but registrability: "teacher toolkit" is descriptive of a set of tools for teachers, so it would likely
draw a s.12(1)(b) objection at CIPO, meaning the name could never be defended against anyone.

**How the candidate was found.** Roughly two hundred and fifty candidates across seven rounds, screened
against two gates: NS-delegation checks on `.com` / `.app` (and `.ca` until it was dropped), and a search
test — the string must return itself rather than a correction toward something else. The gates proved close
to uncorrelated at short lengths, which was the main finding: availability is high precisely where the string
is a generic-looking fragment, so a Belarusian retailer, a Destiny 2 raid weapon, or a Windows DLL had
usually got there first. Rare Latin (Tabella, Notula) failed because dictionary entries in Italian,
Spanish and Portuguese make such words neither rare nor unclaimed. Short common words failed on autocorrect
(Nib returned an Australian insurer; Apostil was rewritten to "apostille"). A seeded Python generator
(portmanteau / alliteration / rhyme / suffix over a 493-word master list) produced three hundred more.

**Why Teachneat.** It survived both gates with `.com` and `.app` free and an empty exact-string SERP, and it
beat the two coined finalists (Scholim, Chartimor) on the channels that actually matter for a solo B2C
operator with no ad budget: **Marketplace internal search**, where "teach" is a free keyword match on the one
search box the app can rank in, and **staff-room word of mouth**, where a name has to survive being heard
once and typed correctly. Chartimor is the stronger trademark and the weaker product name; that trade was
made deliberately, on the grounds that defensibility matters once there is a brand worth attacking and
spellability matters on day one.

**The risk that was identified, and since cleared.** "Teach-" is a dense field in classes 9 and 42, and
**TEACHASSIST (CIPO 1429176)** is registered in Canada in class 9 for educational software covering student
assessment and teacher-parent communication, which overlaps this app on two fronts. Mirror databases showed
no TEACHNEAT record in either country, but CIPO's and USPTO's own interfaces are JavaScript applications that
could not be queried from this session, so clearance was carried as an open task rather than a finding. **It
has since been completed and the name is clear**; neither Step 6g nor the Marketplace listing is gated on it.

### Phase 2 Step 6g (Rebrand to Teachneat)

The execution of the rename decided above. Four parts, of which two are shipped code, one is a manual
operation the app cannot do for itself, and one is a decision left with the user.

**The name sweep.** Every user- and developer-visible "Teacher Toolkit" became "Teachneat": both wordmarks,
`index.html`'s `<title>`, `appName` in `GET /public/app-info`, the consent gate's acknowledgement sentence,
the account settings deletion copy, the FAQ, the for-admins page, the landing page's product shots, and the
test fixtures that assert on any of them. The privacy policy and terms needed no edit of their own — both
name the service through `OPERATOR_BUSINESS_NAME`, so changing the constant changed every clause that
identifies the counterparty. That was the point of putting it in a constant at 6c.

**The Drive identifiers, moved as a set.** `TEACHER TOOLKIT DATA` → `TEACHNEAT DATA`, `Teacher Toolkit Data`
→ `Teachneat Data`, and the three markers `ttk_app` / `TTK_APP_MARKER` / `ttk_filed` → `tn_`. The commit
that does this is what makes the existing spreadsheet undiscoverable, which is the intended sequence rather
than a fault: bootstrap finds a folder and a file by those markers, so the next sign-in creates fresh ones
and the old contents are ported by hand. **The port has not been run yet** — the sequence and the one trap
in it (do not overwrite the newly seeded `meta` tab, which carries the new marker and the current
`schemaVersion`) are in NEXT_STEPS. `SPREADSHEET_TITLE` was exported from `bootstrap.ts` for one reason: so
`config/schema.test.ts` can assert all five as a single object. Asserted as a set deliberately, because the
failure this rename can produce is not a wrong string but a **mixed pair**, one discovery path reading the
old name while another writes the new one, which makes an existing sheet invisible and silently creates a
second.

**What kept the old string, and why.** `meta.appId` stays `ttk`, which TESTING_PLAN had already decided and
which is now asserted so a later sweep does not "finish the job": it is written once, read by nothing, and
seen by no teacher, so changing it would only put the freshly seeded value at odds with a hand-ported `meta`
tab. The same reasoning, with sharper consequences, covers the session cookie `ttk_session` and the
OAuth-state cookie `ttk_oauth_state` (renaming them signs the user out), the `ttk.` localStorage keys for
theme, grouping appearance and name-picker preferences (renaming them silently resets those preferences),
and the `ttk-` CSS class prefix in the email editor and the card deck (no user ever sees it). The repo
directory and git remote were left alone too, which turns a question NEXT_STEPS had been carrying into a
decision: renaming them breaks local paths and any CI reference and buys a reader nothing. Environment
variable and database column names likewise.

**The version bump, and a check that was missing.** `DOCUMENT_VERSION` and `CURRENT_TERMS_VERSION` both
moved to `2026-08-13`, and `EFFECTIVE_DATE` with them, which re-prompts every account through the consent
gate. That is the correct call rather than a cautious one: the documents' identification of the operator and
the service changed throughout, and a consent record naming a version whose text called the service
something else is a record of agreement to a different document. While bumping them, the check TESTING_PLAN
has assumed since 6c turned out never to have been written — nothing asserted the two constants were equal.
`server/src/config/legal.test.ts` now does, by reading the client's `legalMeta.ts` as **text** and matching
one `export const` line. Read rather than imported because the client is a separate package with its own
tsconfig and a DOM lib, and this project has no `shared/` directory by deliberate choice; pulling one
package's source into the other's type program to guard a single string is the larger cost.

**The copy pass.** Two headlines carried the old framing rather than merely the old name. The hero subhead
("Easily make groups, pick names, mass email families, track attendance statistics, and more") listed four
tools and ended with "and more", which asks the reader to judge a collection; and the showcase heading
("Every tool, one class list") led with the collection and buried the claim. Both now lead with the single
class list, which is the mechanism behind the narrower claim the new name makes — the administrative side of
teaching, kept tidy. The pricing page needed nothing, being plan-shaped rather than tool-shaped, and the
for-admins page needed nothing because its register is written for a board administrator and should not
change. `design/landing-page-mockup.html` is now recorded, in the file that references it, as **not
maintained in parallel**; it still carries the old wordmark, deliberately.

**The logo, assessed rather than decided.** The mark is a pencil and ruler fanning out of a protractor that
stands in for a pocket-knife handle — a multi-tool, and a direct visual pun on "Toolkit". Five alternatives
built on the tidiness idea were drawn on the same 32×32 grid and previewed at 112px, 32px, 16px and beside
the wordmark in both themes: bars being squared up, a flush stack, a filed record with an accent tab, a
class list in a frame, and the current mark with the fan deleted. **Nothing was wired into the app.** The
assessment offered was that none is clearly better than keeping what is there, on the grounds that the
pocket-knife reading was the design rationale rather than something a viewer decodes — what a viewer
actually reads is a pencil, a ruler and a protractor, which is a geometry set and survives the rename. The
rename makes the reasoning stale, not the drawing wrong. The decision sits with the user.

- **Tests:** server **436 pass** (6 added: the five-constant set assertion, the `appId` exception, and the
  cross-package version check), client **328 pass**. Typecheck and build clean on both; client lint at the
  same 5 pre-existing problems.
- **Not verified in a browser**, per the project's standing instruction that visual and cosmetic changes are
  reviewed by the user rather than driven through a preview.

### Phase 2 Step 6g follow-up (Brand assets: the mark, the wordmark, the lockup)

The logo question 6g left open, answered over five review rounds, with the assets generated into
[design/brand/](design/brand/README.md). **Nothing is wired into the application yet** — `Logo.tsx` still
draws the Phase 1 protractor, and adopting the new mark is the next session's first task.

**What was decided.** Three official brandings. A **mark**: three books on a shelf, two leaning
at 25° and 12° toward one standing square, which takes the accent. (It was still three plain dominoes when
this entry was first written; the spine detailing that made them books came in the revision below.) A **wordmark**: "Teachneat" in the system
stack at `-0.02em` with a weight split across the join, 650 against 400. A **lockup** of the two,
horizontally, expressed as one rule rather than three numbers — type at 0.625 of the mark and a gap of 0.25,
measured box to box, which at the 32px both headers use is 20px type and an 8px gap.

**The angles are the design, and they were arrived at by elimination.** Below about 15° the lean stops being
visible at 16px, which is the size that decides whether a mark works; past about 25° the leading book
reads as fallen rather than leaning, which is a different and worse message. 25° and 12° is the last setting
before that boundary.

**A fourth asset set fell out of building them, and it is a real finding rather than a variant.** The bars
stand on a baseline inside the 32 box rather than filling it, and tipping two of them pushes ink further
still, so the drawn area covers a little over half the frame's height. That is correct in a lockup, where
the mark has to sit on the same line as type — and wrong in a square slot, where at a 16px favicon it leaves
about nine pixels of actual artwork. Hence an **icon crop**: the same artwork squared to its own ink,
measured off the raster rather than solved by hand, since the tipped bars' corners are the extremes. Use the
crop for every square slot and the uncropped mark everywhere else. The same asymmetry is why a lockup needs
its mark nudged up when it is centred geometrically, which was noticed in the same pass.

**The N was explored at length and set aside, and the reason is worth keeping.** A monogram built from two
uprights and a slanted middle bar was the strongest idea of the middle rounds. Two findings came out of
trying to make it work. First, **a three-bar N needs its diagonal to meet the stems**: a rotated rectangle
floating in the gap leaves two vertical slots and the eye resolves three objects rather than a letter, so a
real N's diagonal starts flush with the whole top of one stem and finishes flush with the whole bottom of
the other, making the counters triangular. Second, **rounded terminals and a colour break each say
"separate objects"**, which is precisely what a letterform needs them not to say. Those two facts are also
what killed it: the brief was items that convey tidiness, and every change that made the N more legible as a
letter made it less legible as items. Stencil-style opened joints were tried as the compromise and are the
version to revisit if the question is ever reopened.

**How the assets are built.** One script, [generate.py](design/brand/generate.py), emits every SVG, PNG and
the `.ico` from a single definition of the geometry, so a raster cannot drift from a vector. Pillow only, no
new dependency, and no rasterizer was needed because the mark is three rounded rectangles — drawn on a
1024px canvas and downsampled, with the two tip angles negated on the way in since PIL rotates
counter-clockwise where SVG rotates clockwise. Opacity is baked into the alpha channel rather than
composited onto a background, so the PNGs sit on any ground the way the SVG does.

**The wordmark is deliberately not outlined.** This project ships no custom font by design, so the wordmark
has no fixed outline: it is type, set live in the system stack, resolving differently per machine on
purpose. The SVG files carry the same font stack rather than converted outlines, because outlining would
freeze one machine's Segoe UI into an asset the CSS would then disagree with. Their `viewBox` widths are
estimates for the same reason, and the README says to scale them by height.

- **Not verified in a browser.** The generated rasters were inspected directly, which is what confirmed the
  framing problem above; the SVGs and the lockups were reasoned through rather than rendered.
- **Still open, and it belongs with the Marketplace listing (Step 9):** whether the square app icon should
  sit on a solid ground rather than on transparency, since a transparent icon lands on whatever the host
  chooses and for apple-touch-icon that is usually black.

### Phase 2 Step 6g follow-up (Book spines: the mark's final form)

A revision to the mark committed one step earlier, taken after the question was reopened: could the three
tipped bars be made to read as book spines without leaving the minimal style. The answer is the **lightened
title panel** — one soft rectangle a fifth of the way down each spine, white at 38%, where a title is
stamped. Nothing else about the mark moves: same width, same height, same 25° and 12°, same gaps, same
accent on the upright.

**Three other directions were drawn and rejected**, and the reasons are the useful part.

**Uneven heights and widths** were the most effective cue by some distance, because they change the
silhouette rather than the surface and a silhouette is what downsampling preserves. Rejected anyway: three
identical objects was where the mark started, and varying them trades that reading for the book reading
rather than adding to it.

**Head and tail bands** read as a hardcover and were the runner-up. The panel won on being the calmer mark
— one soft shape rather than two hard ones — at the cost of some legibility as it shrinks.

**A curved head and tail**, the shallow dip along the top of a closed hardcover, is the direction that
produced the round's one genuine finding. The first attempt used a dip one unit deep against a tightened
1.0 corner, which is about 18% of a 5.5-wide spine; rendered, it read as horns, with the corners coming to
points and the books looking bitten. **Half that depth, against the mark's usual 1.3 corner, reads as a
spine** — found by rendering a sweep of depths rather than by argument. Not taken, and the review files were
scratch rather than repository artifacts, so the numbers are recorded here instead: a dip of 0.5 against a
5.5-wide spine and the standard 1.3 corner, drawn as a quadratic whose control point sits at twice the
depth, since a quadratic reaches half way to its control. The finding generalises past this mark: a dip of
more than roughly a tenth of a shape's width stops reading as a curve and starts reading as a notch.

**Two implementation facts are load-bearing and are recorded in both the generator and the brand README.**
The detailing lightens the spine rather than darkening it, because a dark mark on the accent reads as a
shadow falling across the book instead of as something printed on it. And each book is now a **group**
carrying its own opacity, with spine and panel inside: a panel faded independently would show the page
through it rather than lightening the board. The raster path had to change to match, since Pillow's
`ImageDraw` *replaces* pixels rather than blending them — the first preview of the banded variants came
back with light bands instead of dark ones for exactly that reason, the translucent band having punched a
hole through to the page. The generator now composites the panel onto its own layer before applying the
group's opacity, so the PNGs and the SVGs agree.

**The panel disappears below about 32px**, which is stated in the README as a property rather than left to
be discovered. It is a 5.1-unit mark on a 32-unit grid, so a 16px favicon has no room for it and the mark
degrades to three plain leaning spines. That is the version it started as and a perfectly good small mark,
which makes it the best available failure mode; any detailing added later has to degrade the same way.

- All 37 assets regenerated. The 512px icon crop was inspected directly to confirm the panel composites as
  intended rather than punching through.
- **Unchanged:** the wordmark, the lockup, the 8px gap rule, and the icon crop. Nothing is wired into the
  application yet.

---

### Phase 2 Step 6g follow-up (Brand adoption: the assets go into the app)

The generated assets were wired in. Four decisions worth keeping:

**`Logo.tsx` redraws the mark rather than importing `mark.svg`.** The static file has to bake in literal
colours; the component takes `--color-secondary` and `--color-accent`, so the mark follows the theme like
everything else does. The cost is that the geometry now exists in two places, which is why the brand README
says so explicitly instead of leaving it to be discovered.

**The wordmark is a component, not a string.** The weight split across the join needs two elements, and 650
is not a Tailwind weight step, so it is set inline rather than approximated with `font-semibold` — 600
against 400 is a visibly weaker split, and the split is the whole design. The wordmark deliberately sets no
colour of its own: the marketing footer needs it in the same secondary grey as the sentence around it, and
two competing Tailwind colour classes on one element resolve by CSS source order rather than by the caller.

**Each surface takes the branding the README assigns it.** Lockup in the app top bar, the marketing header
and the consent screen; the mark alone in the landing hero, where the name is already in the header above
it; the wordmark alone in the marketing footer. The app top bar and marketing header previously hand-rolled
a lockup as `<Logo>` plus a `text-md font-semibold` span, which was neither the right type size nor the
right gap; both now call `Lockup` and cannot drift.

**The icon crop went into every square slot**, not the uncropped mark: `favicon.svg` (which switches its
own colour on `prefers-color-scheme`), `favicon.ico` for the browsers that still want one, an
apple-touch-icon, and a `site.webmanifest`.

**The ground question was settled here rather than deferred to Step 9.** The open question was whether a
square icon should sit on a solid ground instead of on transparency. It should, everywhere except the
browser tab: a transparent icon lands on whatever the host chooses, and for apple-touch-icon that is black,
where the leaning books at 55% of a mid grey all but vanish. The tab is the exception because there the
ground is browser chrome and `favicon.svg` already switches its own colour. Three details follow, and the
generator now emits `app-icon-*` for them:

- **The ground is `#fffdf7`**, the app's light canvas, so the icon matches the page it opens. It does not
  follow the theme — a home-screen icon has no theme to follow.
- **No corner radius is baked in.** Every host that uses these applies its own mask, and a rounded tile
  inside a rounded mask reads as a double border.
- **Two art sizes, because the two slots crop differently.** A plain icon is shown whole and fills 78% of
  the tile; a maskable one is guaranteed only the centre circle of 80% diameter, and a square fits that
  circle at 0.8/√2, so it fills 56%. That padding is a requirement rather than taste, and getting it wrong
  is how a launcher clips the outer book off.

- One test changed: `TopBar.test.tsx` matched `getByText('Teachneat')`, which the split wordmark no longer
  produces as a single text node. It now matches the two halves.
- Typecheck, build and the full client suite (328 tests) pass.

---

### Phase 2 Step 6g follow-up (The lean opacities have to be mode-dependent)

Found in review, on a dark browser tab: the two non-gold books were hard to tell apart. The favicon was
already switching its fill on `prefers-color-scheme`, so the colour was not the problem — **the opacities
were**, and they were a single pair used in both modes.

**Fading always moves a book toward the ground, not away from it.** On white, 55% and 80% of a mid grey
land 40 of 255 steps apart. On a dark tab strip the same two opacities land only 31 apart, because both
books are being pulled down toward the same dark ground rather than up away from a light one. At 16px that
is the difference between reading three books and reading two books and a smudge. The dark pair opens to
62% and 100%, which restores 46 steps — wider than light, which is right, since contrast perception is
compressed at the dark end.

The awkward part is that the token version of the mark cannot pick a mode at generate time: the theme
switches under `Logo.tsx` at runtime. So the two leaning opacities became custom properties,
`--logo-book-back` and `--logo-book-mid`, defined under `:root` and `.dark` in `index.css` and mirrored
from `OPACITIES_BY_MODE` in the generator. They were set through `style` rather than the `opacity`
attribute, on a claim that an SVG presentation attribute cannot hold a `var()` — **which is wrong**; a
presentation attribute is parsed as a CSS value and takes `var()` like any other, as the same file's
`fill="var(--color-secondary)"` had been demonstrating all along. `favicon.svg` defines the same two
properties inside its own `prefers-color-scheme` block, so one file still serves both grounds.

- All 42 assets regenerated; the dark 512 crop was composited onto the dark tab colour and inspected,
  since a transparent PNG viewed on white proves nothing about the case that was broken.
- **The light mode is unchanged.** This is a dark-ground fix, not a revision of the mark.

**Superseded within the hour by the entry below.** Two of these three fixes were treating a symptom: the
opacity mechanism itself was wrong, and both the widening and the inversion above are subsumed by
replacing it with opaque greys.

### Phase 2 Step 6g follow-up (Opaque greys replace the mark's lean opacities)

Asked in review: why fiddle with opacity at all rather than name the shades. The answer is that there was
no good reason, and the mechanism had been generating bugs on its own.

**Opacity is not a shade — it composites against whatever is behind the mark.** Two consequences, both of
which had already shipped:

- **The mark rendered a different grey on every surface.** At 55% the back book measured 167 of 255 on the
  white top bar, 161 on the sidebar, 157 on a hover row. Nobody reported it because no two of those sit
  side by side, which is exactly why it survived.
- **The ordering inverted between modes**, which is what the two preceding entries were each half-fixing.
  Fading moves a book toward the ground and the ground changes sides, so the pair making the back book the
  palest of the three on white made it the darkest on a dark tab strip.

The spines are now opaque literals — light `#a7a9ac` / `#7f8286`, dark `#9aa0a6` / `#6c7075` — which are
the composites the opacity form produced against the ground each mode was designed for, so the mark is
unchanged wherever it was already right. They stay *derived* rather than picked: `books()` mixes the mode's
secondary text colour toward the mode's ground, at ratios that are themselves mode-dependent, which is the
one property the opacity form was genuinely providing. Only the title panel is still translucent, and that
is safe because it composites against the spine rather than against the page.

Three things fell out that are worth keeping:

- **The raster path lost its group-opacity step.** With opaque spines, a PNG has only the panel-over-spine
  composite to reproduce, so the last place the rasters and the vectors could disagree is gone.
- **`favicon.svg` switches greys rather than opacities**, through the same two classes.
- **A claim in the entry above is wrong and is corrected there**: an SVG presentation attribute *can* hold
  a `var()`. `mark.svg` now relies on it.

The lesson generalises past the logo and is recorded in DESIGN_SYSTEM: any element separating itself by
opacity alone has both problems, and catching them means compositing against every real background rather
than viewing the asset on white.

### Phase 2 Step 6h (Lifecycle email and the trial-to-free moment)

The app gains a voice of its own. Until this step there was no path by which the operator could send a
teacher a message: Stripe emails receipts and dunning for a card already on file, and the Gmail
integration sends as the *teacher*, to parents. The moment that made this the plan's most expensive
omission is the one it was built for — a teacher who signs up on September 3 reaches the end of the trial
on October 3 having entered a month of attendance, and Statistics stops working unannounced.

**Six messages, and the catalogue is closed in code.** Welcome, trial ending (five days before), trial
ended, promo ending and pause resuming (queued by Step 6i, templated here), and account deleted. Payment
failure is deliberately absent: Stripe's dunning covers it, and ours would make two notices about one card.
The closure is a CASL limit rather than a scope preference, so it is asserted by a test that fails on a
seventh message rather than left to discipline. `RENDERERS` is a total `Record` over the type, so a message
type without a template is a compile error.

**Queued in Postgres, dispatched by a sweep**, beside the session sweep in `index.ts`. Not inline: the
trial-ending message has no request behind it, and an outbound call in the signup path would turn a
provider outage into a failed registration. `UNIQUE (account_id, message_type)` is the design in one line,
and claiming is `FOR UPDATE SKIP LOCKED` with the attempt counter incremented on claim rather than on
failure, so a crash mid-send still costs an attempt.

**Three decisions in the queue's shape are worth carrying.**

- **Keyed on `users.id`, with no foreign key**, which breaks the pattern every other table here follows.
  The deletion confirmation is sent *after* the account row is gone, so `ON DELETE CASCADE` would destroy
  the queued message before the sweep saw it. Keying on the ULID rather than `google_sub` also means
  someone who deletes and re-registers gets a genuine welcome instead of losing it to their own old row.
- **The welcome is queued at consent, not at account creation, and guarded on account age.** Consent is
  the moment the account becomes usable. But that endpoint runs again for every existing account on a
  terms-version bump, which 6j will do, and without the age check that bump would welcome teachers who have
  used the app for a year — the unique constraint does not help, because the accounts it would reach are
  exactly the ones that predate this table.
- **The trial-ended scan has a seven-day floor.** Without it, the first deploy would tell every account
  that ever had a trial expire that it had just happened. The window makes the scan mean what the message
  claims, and bounds a sweep that has not run for a while.

**No SDK.** Resend is the provider, chosen on deliverability reputation and a free tier that covers launch,
but its API is one authenticated POST, made over the platform `fetch` in `services/mailer.ts`. A package
would have pinned the provider's types across the codebase to save a few lines; the swap seam is the
interface, not the dependency. DEPENDENCIES.md records it as reviewed and declined.

**Production with no provider refuses rather than falls back.** The console driver is right in development
and wrong in production, where it would mean a trial expiring with the warning printed to a log nobody
reads. `createMailer` returns null there, no sweep runs, and the messages stay queued for a deploy that has
a key.

**The trial-to-free surfaces got the split the step is named for.** `trialExpired` is a new rendering hint
on `GET /auth/me`, true only on `free` with a trial end date in the past. It changes words and never
locking: a teacher who has read Statistics all month is told what happened, in the past tense, and told
that their records and spreadsheet are intact — the fact they actually need, since the natural assumption
is that the data went with the feature. An account that never had premium keeps the plain invitation;
telling *them* nothing was deleted would only confuse.

**Two development-only controls make the step testable at all.** `POST /internal/dev/trial` moves the
account's trial end date and `POST /internal/dev/lifecycle` runs the sweep on demand, both behind the same
doubled guard as the plan toggle and both answering 404 on refusal. Proving the expiry path otherwise means
waiting thirty days or editing the database by hand. **They are account-menu items rather than endpoints to
curl**, added on request straight after the step: the trial control is a three-position cycle labelled with
what the next press does, matching the plan toggle beside it, because four days out, yesterday and a fresh
thirty are the only dates that mean anything; the sweep reports its counts on its own label rather than
through a toast, since the messages themselves are in the server's terminal and this is only the
confirmation that a pass ran.

**Prices are now stated in one place, which came out of a question about one email.** The trial-ended
message's call to action named $6.99 and $69.90; it now points at the account page and names nothing,
because a figure in an email cannot be corrected after it is sent and the account page is the only surface
that has to be right. The founding-promo reminder still names an amount — its purpose is that the first
charge is not a surprise — but it formats it from `ADVERTISED_PRICES` through a new
`formatAdvertisedPrice`, so a price change reaches the sentence without anyone remembering it exists.

The audit that followed found the real gap. There were three statements of the price, and the client's
`PRICING` strings carried a comment claiming the startup Stripe check caught them drifting from the
server's. **It never did** — that check compares the server's constant against Stripe and has never read
the client's strings. `config/billing.test.ts` now reads them and asserts they carry the server's amounts,
which matters because pricing is unsettled: currency, amounts and localisation are all open, and the
failure to guard against is not a wrong number today but a forgotten copy tomorrow.

**Legal.** Resend is added to `SUBPROCESSORS` and the policy's use-of-information section now enumerates
the six messages and states that no mechanism for marketing exists. **The version bump was deliberately
not taken**, per the ordering note: 6h and 6j both change these documents, and batching them is one consent
re-prompt instead of two. Nothing can be sent before the domain is verified in Step 8c, so no message
leaves under an un-updated policy — but 6j now *owes* that bump rather than merely being able to take it.

- **Tests:** server **468 pass** (32 added), client **336 pass** (8 added). Typecheck and build clean on
  both; client lint at the same 5 pre-existing problems. The counts include the two follow-ups this entry
  records: the account-menu dev controls and the pricing single-source work.
- **Not covered by tests, and manual by nature:** the two trial scans are SQL against `users` with no
  in-memory equivalent, and delivery is the provider's property rather than this code's. Both are driven
  from the dev controls; the pass is written out in TESTING_PLAN.
- **Waiting on Step 8c:** SPF and DKIM on the production domain. Until then Resend delivers only to the
  address that owns the Resend account, which is enough to prove the templates and the flow.

---

### Step 6e follow-up — the cost of a class move, and the retry that made it worse

Found in the manual archive/restore pass carried forward from 6e, run against the newly ported spreadsheet.
An unarchive failed with `SHEET_RATE_LIMITED` and succeeded only on a second attempt. Nothing was lost and
the round trip was otherwise correct, so the feature worked; what it could not do was run twice in a minute.

**The cause was volume rather than a fault.** One move spent about forty Google API calls — roughly
twenty-three reads and fourteen writes, plus a few more rebuilding the response — and that count was fixed
overhead, the same for a class of six as for a class of thirty-six. The ceiling it met is **60 reads and 60
writes per minute per user**, which the granted project-level increase to 600/300 does not raise. Two moves
inside a minute was already close; the client's automatic retry, which re-sent the whole request three
times, spent about a hundred and fifty calls in twenty seconds and guaranteed its own failures. The six
warnings in the log were four requests for the failed attempt and two for the successful one.

**The waste, which was most of it.** Every write re-read the header row of the tab it was about to write,
although the `batchGet` that produced the rows had already validated that header from the same response —
nine reads for an answer in hand, with `headerValidated: true` an existing option that simply was not
passed. Each append counted its destination before and after, when the before-count was the destination the
caller had just read. And the route rebuilt the class list by reading the two enrollment tabs immediately
after the move had rewritten them and dropped the cache, so every one of those reads missed.

**The restructure, which is the other half.** All nine tabs are now read in one call, the whole move is
planned in memory, and the source rewrites go out as a single batch. The student move is derived from the
enrollment plan rather than from a second read asking what the first had just decided. The result is
**eleven calls, pinned by a test**: two `batchGet`, three appends, three verifying counts, two for the
batched rewrite, one for the course stamp.

**Two data-safety holes closed on the way, which matter more than the call count.** Rewriting each tab as
its own step meant the third tab's append happened *after* the first had been emptied, so a failure in the
middle left the class genuinely half-moved; the single batch means nothing is destroyed until every append
is verified. And `replaceTabsRows` now writes the surviving rows **before** clearing whatever they did not
cover, where the old `replaceTabRows` cleared first — a failure between the two used to lose the rows that
were only ever meant to stay, and now leaves duplicates below the good ones instead. That is the same
argument the service already made for appending to the archive before touching the source, applied one
level down.

**Two things the tests caught that the design had wrong.** Writing before clearing, on its own, made a
retry write the leftover tail back permanently — duplicates that never converged, which is corruption of a
different shape rather than a recovery; `dedupeById` on the source rows is what makes the retry heal. And
folding the course stamp into the destructive batch broke recovery outright: **the course row is the
operation's commit record**, since `moveClasses` decides there is nothing to do by reading `archivedAt`, so
a stamp landing beside a failed rewrite marked the class archived and left the repairing retry with nothing
to do and success to report. The stamp is now a separate final write, in place rather than as a tab
rewrite, with its own test.

**Retries moved to where one costs one call.** `trackGoogleCall` retries the individual rate-limited Google
call twice, honouring `Retry-After`, and records every attempt because every attempt spends quota. The two
class-move endpoints opt out of the client's whole-request retry — the only requests in the app that do —
since re-sending a dozen calls after a 429 pushes the account further past the ceiling on each attempt.

The archive dialog's failure message became the generic **"Something went wrong. Please try again."** at the
user's request, replacing wording that promised nothing had been removed. The promise was true and is still
true; the wording is simply no longer made.

- **Tests:** server **472 pass** (4 added: the call budget, the commit-record ordering, and two on the new
  retry), client **338 pass** (2 added, on the move endpoints not retrying). Typecheck and build clean on
  both; client lint at the same 5 pre-existing problems.
- **Confirmed manually**: two classes archived and restored three times in rapid succession, with no error.

### Landing-page copy pass (hero, showcase heading, third trust card)

Copy only, no behaviour change, all at the user's direction after working through alternatives.

- **Hero subhead** ([LandingPage.tsx](client/src/pages/LandingPage.tsx)) is now "One class list. Track
  attendance and accommodations, make groups and seating plans, and send mass communications. All stored on
  your own Google Drive." The rewrite began as a fix for an ambiguous pronoun: the previous line ended "and
  it stays in your own Google Drive", where "it" was meant to be the class list but the thing that actually
  stays on the Drive is every record the tools write, which is the stronger claim. The last sentence is one
  `whitespace-nowrap` span so the ownership claim can never be read in halves. **That only fits because the
  word "data" came out** — at 16px it is roughly 270px of unbreakable text against the 288px a 320px
  viewport leaves after padding, and the hero section is `overflow-hidden`, so it would clip rather than
  scroll. Adding a word to that sentence means going back to breaking it.
- **Showcase heading** ([FeatureShowcase.tsx](client/src/pages/landing/FeatureShowcase.tsx)) collapsed from
  a heading plus a two-line subhead to the heading alone: "Enter your class list once. All tools read from
  the same list." The section was stating one claim at two sizes and the tab list underneath names the tools
  anyway. The break is pinned to the sentence boundary with an unconditional `<br />`; it was briefly
  `hidden sm:inline`, and the user asked for it at every width, accepting that the second sentence wraps
  again on a phone and makes three lines.
- **The wrapper's `max-w-[58ch]` came off** in the same edit, and is worth remembering as a trap rather than
  a tweak. `ch` resolves against the font size of the element carrying the `max-width` — there, a div
  inheriting 16px, so about 464px — while the heading inside renders at `--text-display-md`, up to 32px,
  needing about 510px for the second sentence. The measure had been sized for the paragraph that used to sit
  under the heading, and it silently pushed one word onto a third line at desktop width.
- **Third trust card** now reads "Our servers store your account and nothing more. Your students' data stays
  entirely in your hands." An intermediate draft said "You are the only owner of your students' data" and
  was changed after review: under Ontario education privacy law the board is generally the institution
  holding student records and the teacher handles them professionally, so what the product can honestly
  claim is custody and control, not title. The replaced sentence had handed the teacher an answer to give an
  administrator; that job now falls to `/for-admins` alone.
- `design/landing-page-mockup.html` deliberately not updated — it stopped being maintained in parallel at
  Step 6g. Typecheck clean; no tests assert on this copy.
- **Positional seating plans adopted as a Phase 3 candidate**, likely Premium, recorded in NEXT_STEPS.md.
  This is additive to Step 7 rather than a reversal of it: groups-as-cards stays. It carries the same
  obligation the marble race does, and a sharper one, because the hero now advertises it in the first
  paragraph a visitor reads. Either it ships or the phrase comes out before the page is in front of real
  teachers.

### Step 6i — Founding-user promo and the summer pause

Two subscription-lifecycle features, taken together because both are Stripe work, both need a reminder
email from Step 6h, and both turn on the same question of what `resolvePlan` does with a subscription that
is not straightforwardly paying.

**The founding-user promo needed almost no code, and that was the point of the design.** It is a Stripe
coupon at 100% off with `duration: repeating` and `duration_in_months: 6`, redeemed through a promotion
code on the hosted Checkout page. The only change in the app is `allow_promotion_codes` on the Checkout
Session, and it is set for the monthly interval alone — an annual checkout never presents a field that
would then refuse what was typed into it, which is a better answer than validating the combination. The
card is captured either way, so month seven bills by default and the default outcome is a paying customer
rather than a lapsed one. The rejected alternative was extending `trial_ends_at` by six months with no
card, which is friendlier and requires the teacher to go and subscribe half a year later, which almost
nobody does.

**The promo's one real piece of engineering is the discount date, and it is a trap worth recording.**
`promo_ends_at` is when the repeating discount stops applying, which is the date of the first real charge
and the thing the Step 6h reminder fires seven days ahead of. It is emphatically not `current_period_end`:
a fully discounted subscription still renews every month at zero, so that date moves while this one does
not. Reading it has the same shape as the `current_period_end` trap already documented in `billing.ts` —
the field lives on `discounts` rather than the singular `discount` in recent API versions, and reading the
wrong place yields `undefined` rather than an error. Worse, **webhook payloads are not expanded**, so a
promo-bearing subscription arrives as a list of bare discount ids with no `end` on them, and the naive read
reports "no promo" for every account that has one. The handler therefore re-fetches the subscription with
`expand: ['discounts']` when it sees bare ids, and falls back to the event payload if that call fails: the
status change the event carries matters more than the promo date, and a 500 would have Stripe retrying an
event we could otherwise apply.

**The pause is `pause_collection` with `behavior: void`** — the paused months are not owed and are never
billed later. A teacher told "not paying, not teaching" who returns in September to two backdated invoices
would be right to call that a lie. Default two months, selectable from one to three, once every twelve
months, monthly plan only, and every one of those bounds is enforced on the endpoint rather than only
offered in the dialog, because the endpoint is reachable directly and an unbounded pause is a free
subscription. Refusals are `409 CONFLICT` rather than `400`: each describes an account in the wrong state,
not a malformed request.

**`resolvePlan` gained its first exception to reading Stripe's status at face value**, and this is the part
that had to be built rather than assumed. Stripe holds a paused subscription at `active`, so the existing
status check would have kept granting Premium to an account that had stopped paying. The pause is read as a
**flag** rather than as a date comparison against the resume date, for two reasons: Stripe permits an
indefinite pause with no `resumes_at` at all, and it clears `pause_collection` on resume, so the flag is
what actually tracks the state. The failure mode of trusting the flag is a missed resume event leaving a
teacher on `free` while paying — visible to them immediately and complained about — as against silently
free access, which is the failure mode of the alternative.

**One field is deliberately ours rather than Stripe's.** `pause_started_at` is written by the request the
teacher made, not by the webhook, because Stripe clears `pause_collection` the moment collection resumes and
a once-per-twelve-months rule read from it would allow a new pause every month. Everything else about the
pause is webhook-written, and the sole-writer rule holds: the endpoint tells Stripe to pause and returns no
plan at all, and the client refreshes `GET /auth/me` rather than being told. A test asserts the pause never
writes `plan_override`, which is the mechanism a shortcut here would have reached for.

**Placement was the design decision, and it is a pricing decision rather than a layout one.** At list prices
a monthly subscriber who pauses for two months pays $69.90 a year, which is exactly the annual price, so a
pricing page that advertises the pause tells every visitor that annual has no advantage. It is therefore
offered inside the cancellation flow and nowhere else, which required building one: cancellation ran
entirely through Stripe's hosted billing portal, and Stripe removed `subscription_pause` from portal
configuration, so there was no way to put the offer where the cancelling happens. A distinct **"Cancel
subscription"** row on `/account` now opens a dialog that makes the pause offer and keeps "Continue to
cancel" one click away in the same dialog — a retention offer that makes leaving harder is a dark pattern,
and this product's audience talks to each other. "Manage billing" still goes straight to the portal, so a
teacher who came for an invoice is not handed a retention offer on the way. A test asserts the pricing page
never says "pause".

**The pause reminder is the one lifecycle message that can legitimately recur**, which the Step 6h queue was
not built for: `UNIQUE (account_id, message_type)` is exactly right for a welcome and wrong for a message
that fires again at the next pause a year later. Rather than relax the constraint — which would put a
duplicate "your trial is ending" back on the table — starting a pause clears the previous `pause_resuming`
row, and the scan queues a fresh one. `queueTrialMessages` became `queueScheduledMessages` and gained the
two Step 6i scans, both keyed on dates the webhook mirrors so neither scan reasons about subscriptions at
all. The promo scan excludes an account that has already cancelled, since it is not about to be charged; the
pause scan requires the flag as well as the date, so a pause ended early cannot produce a message announcing
a resumption that already happened.

**The account page now says when a subscription is paused.** Without it the page reads as a free account
with a billing row and no explanation, and a teacher who chose the pause would reasonably conclude they had
been cancelled.

- **Migration 0011** adds `collection_paused`, `pause_resumes_at`, `pause_started_at` and `promo_ends_at`.
  Additive, four columns, no backfill; none of them holds student data, being dates and a flag about a
  payment arrangement.
- **Tests:** server **494 pass** (22 added), client **349 pass** (11 added). Typecheck and build clean on
  both; client lint at the same 5 pre-existing problems.
- **Owed manually, and it cannot be covered by the suite:** the coupon and its promotion code are Stripe
  dashboard configuration, so nothing in the repository proves they exist. The ordered pass is in
  TESTING_PLAN.md under Step 6i, and its sharpest item is confirming `promo_ends_at` actually lands — if the
  expanded re-fetch silently fails, the reminder never queues and nothing else reveals it.
- **Next:** Step 6j, which owes the `DOCUMENT_VERSION` / `CURRENT_TERMS_VERSION` bump covering 6h's Resend
  subprocessor as well as its own change. 6i changed no legal document: a pause and a coupon are billing
  arrangements, and the policy describes what data is held and by whom, which is unchanged.

### Step 6i follow-up — the cancellation flow, reviewed against the running app

Found by driving the new flow manually rather than by the suite, which is the pattern the Step 6e follow-up
also fits: every fault below is in the seam between a control and the account state behind it, and none of
them is visible from a unit test that supplies its own fixture.

**Both billing buttons minted the same URL.** "Continue to cancel" and "Manage billing" each created a
plain billing-portal session, so the cancellation flow ended by depositing the teacher on the portal's front
page to find the cancel control themselves — which is most of the reason for having an in-app flow at all.
Stripe supports deep-linking into a specific flow, so `POST /billing/portal` now takes an optional
`flow: "cancel"` and passes `flow_data`. Wrapping `openPortal` for the Manage billing row is load-bearing
rather than tidiness: `ActionList` hands its `onClick` straight to the button, so passing the function
directly would have React supply the click event as the `flow` argument and that row would have asked for
the cancellation page too.

**The cancellation row was gated on the wrong question, and the two mistakes compounded into a failure that
looked like neither.** It used `hasBilling`, which is only whether a Stripe customer exists. Both the
customer id and `stripe_subscription_id` deliberately survive a cancellation, so every account that has ever
cancelled still carries them — and such an account was offered a cancellation for a subscription Stripe had
already ended, then handed that dead id to `flow_data`, which Stripe rejects outright. The teacher saw
"Billing could not be opened" on a portal that would have opened perfectly if the deep link had not been
attempted.

Fixed on both sides of the boundary, because either alone leaves a hole: `canCancel` on `GET /auth/me` gates
the row on a live subscription, and the portal route drops the deep link rather than sending Stripe an id it
will refuse. `hasLiveSubscription` is the shared test — subscription id **and** an entitling status — and
`canOfferPause` now uses it too, having previously spelled out the same condition inline. The rule worth
keeping is that **"has billing", "is on the paid plan", and "has a subscription" are three different
questions**: a comped account resolves to `paid` with nothing behind it, and a lapsed one has invoices worth
managing and nothing to cancel.

**A diagnosis that turned out not to be a bug, recorded because the next person will hit it too.** A live
test-mode subscription showed the account still `canceled` in Postgres and therefore offered no
cancellation. Nothing in the app was wrong: Stripe cannot deliver webhooks to `localhost`, and
`stripe listen --forward-to localhost:3001/api/billing/webhook` was not running, so the row was frozen at
the last delivered event. The dev plan toggle made it look like a bug rather than stale state, because
`plan_override` forces entitlement and says nothing about subscription state — correctly, since a comp has
no subscription — so a forced `paid` renders a page that says Premium everywhere while its billing rows
describe an account with nothing to cancel. Both halves right, and together they read as broken. **A
development control that wrote `subscription_status` directly was considered and rejected**: it would have
answered the question in one click and broken the sole-writer invariant, which is precisely the invariant
that made the real diagnosis a two-minute database read.

**The dialog was too narrow for its own footer.** It asked for the confirm width, which is 400px and sized
for two buttons; `Button` carries `whitespace-nowrap` and so cannot shrink, so the third pushed the row out
through the side of the panel. It takes the content width now. The shared footer also wraps, as a backstop
rather than the fix — every modal in the app is one component, so the guard covers all eleven callers, and
it engages only when a row would not otherwise fit. Both rules are now in DESIGN_SYSTEM, whose modal section
previously said only "primary on the right" and gave no guidance on a three-button footer.

**Button order is keep, pause, cancel** — least to most consequential, left to right, which is what the
delete dialog and the account rows already do, and which puts the destructive action rightmost. Pinned by a
test, since an added action otherwise lands wherever it is typed.

Account-page wording was revised in the same pass, including the cancellation dialog's closing paragraph,
which claimed rather more about what survives a cancellation than the moment needs.

- **Tests:** server **498 pass** (4 added), client **352 pass** (3 added). Typecheck and build clean on
  both; client lint at the same 5 pre-existing problems.
- **Recorded rather than fixed:** a missed webhook can now fail in the inverse direction to the one Step 7
  already owns — a paying teacher whose event never arrived cannot cancel or pause in-app. It degrades
  rather than breaks, since the portal still opens, and reconciliation against the Stripe API would answer
  both directions at once. Added to that open question.
- **Next:** Step 6j.

### Step 6i manual pass — the live promo checkout, and the four faults it found

The Stripe-dashboard half of 6i, run against the live test-mode account on 2026-08-17. The coupon and its
promotion code are configuration rather than code, so nothing in the repository proved they existed or
charged what the copy claimed. The pass is now complete and 6i owes nothing further.

**The promo was widened to both prices, and to twelve months, during the pass.** Six months on the monthly
price only became one free year on either: twelve months of a repeating discount is a single 100%-off
invoice on annual and twelve zero invoices on monthly, so the two are finally symmetric. `FOUNDINGYEAR`,
capped at 40 redemptions. Worth recording that **no Stripe mechanism could have enforced the original
monthly-only rule** — promotion-code `restrictions` cover first-time-transaction and minimum amount, and
coupon `applies_to` is per-product while both prices sit on one product — so `allow_promotion_codes` was
the whole enforcement, and TESTING_PLAN's requirement for a price-restricted code asked for something that
does not exist. Both that requirement and the claim that the trial and promo "stack" are now removed: the
promo months run from checkout, so a day-one redeemer's remaining trial days add nothing.

**What the live run proved that fixtures could not.** `promo_ends_at` landed twelve months out, which is the
assertion the whole pass existed for — the webhook payload carries discounts as bare ids, so a silently
failing expanded re-fetch would have left every promo account with no reminder and nothing to reveal it.
`current_period_end` came back one month out rather than twelve, confirming as data what the comments
claimed: a fully discounted subscription still renews monthly at zero. The pause was driven in both
directions and the account resolved to `free` while Stripe reported `active`, with `pause_started_at`
surviving the resume that cleared Stripe's own `pause_collection`.

**Four faults, none of which the suite could have found.**

1. **`resolvePlan` checked the trial before the subscription.** A teacher who subscribed during their trial
   resolved to `trial`, so the app kept offering "Upgrade to Premium" in the account menu and a trial
   countdown with its own upgrade button — to someone whose card had just been taken. Entitlement never
   differed, since `trial` and `paid` are entitlement-identical; only the label did, and the label is what
   the client renders, which is why it was invisible until real money went through. The subscription now
   wins, with the pause folded into that check so a pause cannot cost a teacher trial time they still have.
2. **A paused account was offered an upgrade button.** It resolves to `free`, so every locked surface
   prompted it — and taking that prompt would have created a *second* subscription, with the webhook
   overwriting `stripe_subscription_id` and orphaning the paused one where nothing in the app could see it,
   billing again on its resume date. Paying twice, showing one.
3. **The lapsed copy blamed the trial for everything.** `trialExpired` was `plan === 'free'` plus a past
   trial date, true of every lapsed account whatever happened to it, so a teacher who paid for a year and
   cancelled was told their trial had ended. Replaced by `lapsedFrom`: `trial`, `subscription`, `paused`, or
   absent for an account that never had premium.
4. **The cancellation dialog implied a promo survives cancellation.** It does not, and this was verified
   against Stripe directly rather than reasoned from the docs: setting `cancel_at_period_end` returned a
   `cancel_at` equal to `current_period_end`, eleven months before the promo ended. The dialog now says so.

**Two changes narrowing where billing shows through into the interface**, on the principle that most of the
UI should have paid and not-paid states and nothing else. The student-detail statistics overlay says
"Attendance statistics are a premium feature." for every un-premium account, whatever the billing state
behind it; and the pause is no longer offered while a promo runs, because the discount expires on calendar
months rather than on invoices, so pausing spends free months and the once-a-year allowance to stop being
charged an amount already zero. Both refusals are enforced at the endpoint, not only withheld from the UI.

**Migration 0012** adds `subscription_interval`, mirrored from the price id by the webhook. The promo
reminder is the one lifecycle message that names a figure, and it had no way to know which — it named the
monthly price unconditionally, which was correct while the promo was monthly-only and became a wrong number
in an uneditable email the moment an annual subscriber could redeem. Null names no figure rather than a
guessed one. Verified by running the real sweep against the real account row: the rendered message quoted
"$6.99 CAD" from the stored interval.

**Also found: the client's `npx tsc --noEmit` checks nothing.** `client/tsconfig.json` is a solution file
with `"files": []` and only project references, so that command exits 0 having compiled nothing. Real
checking is `npm run typecheck` (`tsc -b`), which `npm run build` also runs. Switching to it immediately
surfaced five genuine errors the other command had passed.

- **Tests:** server 524 pass, client 371 pass. Typecheck and both builds clean; client lint at the same 5
  pre-existing problems.
- **Next:** Step 6j, which still owes the single `DOCUMENT_VERSION` / `CURRENT_TERMS_VERSION` bump covering
  6h's Resend subprocessor.

### Step 6j — Activation instrumentation and the operator metrics view

Two kinds of data, deliberately kept apart by mechanism rather than by convention.

**Milestones** are five more nullable timestamps on `users` (`0013_add_activation_milestones`), in the
`first_student_at` pattern and written the same write-once way: `COALESCE` plus an `IS NULL` guard, so a
call site on a repeating path is a no-op after the first hit. One `markMilestone(googleSub, milestone)`
over a union rather than five near-identical methods; the column comes from a map in the store file and
never from caller input. `first_premium_attempt_at` is the odd one and the cheapest win: `requirePremium`
is a single choke point every premium gate already funnels through, so one call site covers all of them,
and what it records is a refusal rather than a use.

**Usage** is a separate table (`0014_create_usage_counters`), keyed `(account_id, tool, period)` with
`period` reusing `emailPeriodOf`'s `YYYY-MM` key so the free-email allowance and these counters can never
disagree about which month a write fell in. `ON DELETE CASCADE`, which is the **opposite** of the choice
`lifecycle_emails` made and for the opposite reason: that queue must outlive the account to confirm its
deletion, while these must die with it.

**The ceiling is the design.** A count per calendar month cannot be ordered into a sequence, so it cannot
reconstruct a teacher's working day, which is precisely what makes it describable to a school board. A
per-action event table would have been more useful and would have made the "no tracking" posture untrue in
substance rather than only in wording. The migration comment says so, so a later step has to argue against
it rather than drift past it.

**Instrumentation cannot fail a teacher's request.** Both writes happen after the real work has succeeded,
behind one `recordToolUse` so a later call site cannot record one and forget the other; `usage.record`
swallows its own failures and the recorder wraps both. A counter that moved for a save that then failed
would be wrong in the direction that flatters the product.

**The Name Picker forced a real choice.** It has no server endpoints at all — an explicit Step 8 decision —
so counting it meant either an endpoint whose only purpose is telemetry, or riding a request the page
already makes. The second was taken: `GET /students?for=picker`, a marker on the roster read, which
overturns nothing. The cost is that the picker's number counts **opens of the tool, not rounds drawn**, so
it is not comparable to the other three. That asymmetry is carried in the API response as
`pickerCountsPageOpens` and labelled everywhere the number is displayed rather than left to be inferred,
and a client test asserts the marker, because dropping it silently zeroes the column while the page keeps
working.

**The operator surface is two endpoints behind the existing `requireOperator`**, so it inherits the 404-not-403
posture with no new auth work. `GET /support/admin/metrics` is totals only and a test asserts the serialised
body contains no account identifier at all. Per-account state is folded into the **existing support ticket**
rather than given a search box: the question only arises while reading a request someone sent, so there is
no lookup by email and no listing endpoint, and an account that has not written in cannot be browsed. It
loads on expand, so opening triage does not read every account's state. No plan mix on the metrics page:
`resolvePlan` reads several columns and a pause flag, and a SQL re-implementation would be a second copy
free to drift from the one the app enforces — subscriber counts are Stripe's to report.

**Retention is enforced rather than stated.** The counters are pruned to 24 months by an hourly sweep beside
the session sweep. That sweep is not housekeeping: the privacy policy now says 24 months, so the sweep not
running is the policy being untrue. Twenty-four rather than twelve because the comparison worth having in a
school-year product is this September against last September, and the metrics view reads 12 months so it can
never render a partly-pruned month as a decline that did not happen.

**The legal half, which was the real exposure.** The step made one sentence in the privacy policy plainly
untrue — "we do not record what you do inside the app beyond what those logs contain" — and that sentence
was already overstated, since `onboarded_at` and `first_student_at` predate this step. Rewritten in three
places (what we collect, how we use it, the summary) plus a new retention bullet. What survives intact is
everything that was doing work in the trust story: no third-party analytics, no tracking script on any page,
no cookie beyond the session one, no profiling, no ad tech, nothing sold, nothing leaving our
infrastructure. The two cookie/analytics claims needed no change.

**Both version constants bumped to `2026-08-19`**, discharging the debt Step 6h left: 6h added Resend as a
subprocessor and deliberately did not bump, so the repository's policy named a processor no account had
consented to. One re-prompt now covers both, which is exactly the batching the ordering note asked for.

**Reviewed for the Marketplace, board-allowlisting and OAuth-verification goals before building.** No scope
changes, so OAuth verification and the CASA threshold are untouched. Google's Limited Use policy is not
engaged: the counters are derived from the teacher's clicks, not from anything a Google API returned, and no
student name or roster content enters them. The `users` table holds no student PII, and these are the
teacher's actions rather than any student's. The genuine risk was never the data — it was a policy that
contradicts the code, which is cheap for a reviewer to find and costs credibility on every other claim in
the document, including the ones about student data that matter.

- **Tests:** server 552 pass, client 374 pass. Typecheck and both builds clean; client lint at the same 5
  pre-existing problems, none in new files.
- **Next:** Step 6d (hosting setup), then 7 → 8 → 8c → 9.

### Step 6j review pass — four real defects, one wrong call

A second review of the change set found five things. Four were real and are fixed; the fifth was wrong on
its specifics but pointed at a real latent risk, which is also closed.

**Design tokens that do not exist.** `MetricsAdminPage` was the only file in the client using
`text-text-primary`, `text-text-secondary` and `border-border`. `index.css` defines `--color-primary`,
`--color-secondary` and `--color-subtle`, so the classes generate no CSS at all — confirmed by grepping the
built stylesheet, which contains zero matches. Every secondary label rendered at full primary colour and
every table separator fell back to Tailwind's `currentColor`, drawing heavy text-coloured rules. **Neither
typecheck nor any test can catch this**, which is the lesson worth keeping: a Tailwind class name is a
string, and a wrong one fails silently and only visually. `AccountActivitySummary` beside it had the right
classes all along, which is what made the mistake invisible in review.

**A sticky error in `AccountActivitySummary`.** `toggle` never cleared `error` before refetching. After one
failure `activity` stays null, so a later expand does retry — and on success rendered the stale error
message above the data contradicting it, because the two render guards are independent.

**An off-by-one in the window arithmetic, harmless in one place and not in the other.** `period >= floor`
includes both endpoints, so `periodBefore(12)` spans thirteen buckets. On the metrics page that is a chart
one month too wide. In `prune` the same arithmetic kept counters for **twenty-five** months against a
privacy policy that had just been rewritten to promise twenty-four — the wrong direction for a deletion
promise. Both call sites now go through a single `windowStart(months)` helper, and the boundary is asserted
at both ends rather than left to reading.

**No coverage of any recording call site.** The only wiring assertion was client-side. The store and
recorder were well covered in isolation, which is the layer least likely to break; the wiring is what rots,
and its failure mode is a permanently-zero column that reads like a product finding rather than a bug.
`routes/instrumentation.test.ts` now drives all four call sites and the premium gate through the real
routes against the existing `FakeGoogleEnv`, including the two negatives that matter: saving a grouping
must not count, and an ordinary roster read must not count as picker use.

**The one that was wrong, and the real risk behind it.** The review held that existing route tests now hit
a live Postgres pool, citing a `POST /api/attendance` in `classes.test.ts`. They do not: that request is
refused by the account-lock middleware before reaching the handler, and the other cited tests short-circuit
at the entitlement gate or omit the picker marker. Running those four files and grepping for the swallowed
failure produces nothing. **But the latent risk is real** — the routers default their recorder to the
Postgres store, so the first test to exercise a successful POST would attempt a connection whose failure
the recorder silently swallows. A shared `test/memoryActivity.ts` is now injected in every test that builds
a tool router.

Also taken: the in-memory usage double keyed on a space-joined string and split back positionally, which
would mis-key on an id containing a space. It now encodes with JSON, so there is no separator to bet on.
Left alone deliberately: `recordToolUse` stays awaited before `res.json`. It is a latency question rather
than a correctness one, the Sheets round trip dominates by two orders of magnitude, and awaiting is what
keeps every assertion above deterministic.

- **Tests:** server 552 pass, client 374 pass. Typecheck and both builds clean.

---

### Phase 2 Step 6d (Hosting setup — the code half)

Provisioning is the user's half and is not covered here. This is everything 6d needed that could be built
and verified locally, plus a pre-provisioning audit of the deployment plan that found more than the code did.

**The KMS swap, behind the seam Step 1 left for it.** `createKeyedCipher` writes a payload naming the key
that wrote it (`v2:${keyId}.…`), so a key can be rotated out of active use while rows it wrote still
decrypt, and reads pre-cutover unkeyed payloads through `TOKEN_ENCRYPTION_KEY` as a legacy secret.
`kms.ts` unwraps the data key through Cloud KMS with **no new dependency**, because `googleapis` already
carries the KMS v1 client and `google-auth-library`.

The decision worth carrying: **`TokenCipher` stays synchronous.** A refresh token is decrypted on every
account read — traced through `sheetsContext`, which needs it on every tool request — so a KMS round trip
per operation would put a network call on the hot path. KMS unwraps the data key **once at boot** and the
cipher runs from memory. Boot awaits `initTokenCipher()` **before** `buildApp()`, because route builders
default to an account store and the store captures the cipher at construction; resolving it afterwards
would leave every route holding the development cipher. Failure is fatal, deliberately: if no refresh token
can be read, booting successfully into a state where every authenticated request fails is worse than not
booting.

**Two honest limits on what KMS buys, recorded because the analysis nearly went the other way.** The
plaintext data key is in process memory after boot, so an app compromise loses everything either way; and
the KMS service-account credential sits in the same environment as the wrapped key it unlocks, so an
environment leak loses both halves at once. Workload identity federation would fix the second, and App
Platform exposes no OIDC workload token, so a long-lived credential is unavoidable there. What survives is
narrow but real: instant revocation of every wrapped copy by destroying the key version, an audit trail of
unwraps, and key material that never lands somewhere a human copies it.

**Support-request retention**, the first of the two 6c commitments 6d owed. A `resolved_at` column
(migration `0015`) rather than reusing `updated_at`, because a note added to an already resolved request
would push retention past the 24 months the policy promises, which is the direction that matters.
Reopening clears it. An hourly prune sits beside the usage-counter sweep and has the same standing.
The second commitment, log retention, needs no code: the policy states a **ceiling** of 30 days and App
Platform's built-in retention is under it, so a forwarding destination would add a subprocessor and another
consent re-prompt to satisfy something already satisfied.

**Deployment artifacts.** `.do/app.yaml` and `.github/workflows/ci.yml`. Two load-bearing details:
`preserve_path_prefix: true`, because App Platform strips a route prefix by default and the Express app
mounts its routers at `/api`; and **one app rather than two**, because the client calls a relative `/api`
and the session cookie has to be first-party, which removes CORS as a category of bug.

**The pre-provisioning audit found four faults, all mine or inherited, and one live one found later.**

- **CI was not a gate.** `deploy_on_push` built from GitHub in parallel with the checks, so a push with
  failing tests deployed anyway. Deployment is now a CI job that `needs` both check jobs, with a note at
  both ends because re-enabling `deploy_on_push` silently un-gates everything with no visible symptom.
- **The health check answered `ok` unconditionally**, reporting healthy through the one outage it exists to
  catch. It now probes Postgres on a 3s timeout and answers 503 without leaking connection details.
  Google reachability is deliberately excluded: a failing check restarts the instance, and that cannot fix
  someone else's outage but can turn it into a restart loop.
- **Node was unpinned** in both packages while CI tested on 22.
- **A single instance means every deploy is a brief outage and a cold working set**, which is not fixable at
  `instance_count: 1` and is recorded rather than solved.
- **Found after the workflow was written: the client lint was already failing**, and since `deploy` needs
  that job, nothing would ever have deployed. All five errors were the provider-plus-its-hook pattern
  tripping `react-refresh/only-export-components`, whose whole effect is a dev-time full reload. Scoped off
  for `src/hooks/*.tsx` rather than splitting four providers from their hooks and updating every import.

**Operator alerting, and why not Sentry.** Rejected on the product's own terms rather than on cost or
account overhead. An error tracker's value is that it captures context automatically — request bodies,
headers, locals — and in this app a stack frame in a roster handler has student names in scope. Making it
safe means a scrubbing configuration that has to be right and stay right forever, with a silent breach of
the product's central claim as the failure mode.

Instead, a fixed hand-built payload through the `Mailer` seam 6h established: method, router mount path,
status, error class, and the top stack frame as `file:line`. Nothing is captured automatically, so nothing
can leak by default. **The error message is deliberately excluded** — the most useful field and the most
dangerous, because messages interpolate the thing that failed; it stays in the log, inside the PII boundary
and already redacted. The route label comes from the router mount path rather than `req.path` for the same
reason, since the path carries record ids. Deduplicated to one message per distinct problem per hour, capped
at ten per hour, suppressed occurrences counted into the next alert. Never throws and never awaits, because
it runs inside the error handler. Process-level handlers cover errors with no request behind them and
**neither exits**: taking a single-instance app down would turn one failed request into everyone's outage.
The tests that carry the weight drive the real error handler on a real router mount and assert the payload
cannot contain the id, the student name or the message.

**Attendance slimming.** Measured 7.83 MB → 3.31 MB per teacher, 42%, with no schema change and no consumer
changes: the two unused timestamps are no longer read into the record, and a per-read string pool leaves one
copy of each `studentId`, `course` and `date`. The pool is per-read rather than module-level on purpose — a
global one would hold every string any teacher ever read for the life of the process, which is both a leak
and student data outliving the working set's own clocks. Attendance is now the one resource in
[API_CONTRACT.md](API_CONTRACT.md) without timestamps.

The cache ceiling and the in-Canada re-derivation have their own entries under Decisions Made, as does the
rule about our own documents that this step's KMS analysis produced.

**Still owed by 6d:** the rest of the provisioning (the KMS half is now done — see the next entry), uptime
monitoring (DigitalOcean's own alert policies, no new account), the Postgres migration off local, and Drive
push invalidation with the longer working-set TTL that depends on it.

### Phase 2 Step 6d (KMS provisioning — the console half)

A walkthrough session rather than a build one: the code was already in place from the code half, so the work
was creating the Google Cloud resources, wiring the four token variables, and proving the boot path against a
real keyring. What it produced that outlives the session:

- **The resources.** Key ring `teachneat` and symmetric key `token-key` in `northamerica-northeast1`, in the
  existing `teacher-toolkit-dev` project — the same project as the OAuth client, so verification, the
  Marketplace listing and the key share one owner. Rotation is set to **Never**: `TOKEN_KEY_ID` is the app's
  rotation mechanism, and automatic KMS rotation would silently change which version wraps, which the app
  does not model.
- **The grant is on the key, not the project.** The `teachneat-kms` service account was created with no role
  at the project step and then granted **CryptoKey Encrypter/Decrypter on the `token-key` resource alone**.
  Both halves of that role are needed, because `wrapKey` encrypts and boot decrypts.
- **`server/scripts/wrap-token-key.ts`**, the operator path that generates a 32-byte data key, wraps it
  through the `wrapKey` helper, and prints `TOKEN_KEY_WRAPPED`. It reads `TOKEN_KMS_KEY_NAME` and
  `TOKEN_KMS_CREDENTIALS` from the environment, so it necessarily wraps with the same key and identity the
  app will unwrap with, and the raw key never reaches disk.
- **Verified by running the boot path, not by inspection.** `initTokenCipher` logged `Token data key
  unwrapped from KMS`, an encrypt/decrypt round trip passed, and a payload written by the env-secret cipher
  still decrypted through the keyed cipher's legacy secret — which is the non-destructive cutover actually
  working rather than merely designed.

**The static-credential limitation, accepted deliberately.** The service-account JSON is a long-lived
credential, which is what `iam.disableServiceAccountKeyCreation` exists to discourage. Hosting outside Google
Cloud forces it: Application Default Credentials needs a platform identity and DigitalOcean supplies none, a
constraint `.env.example` already stated before this session. Workload identity federation is the better
answer and was not taken now — it needs an OIDC token from the runtime that App Platform may not expose, and
opening that up mid-provisioning trades a bounded risk for an unbounded detour. The risk is bounded because
the credential can encrypt and decrypt exactly one CryptoKey and can read neither the wrapped blob (which
lives in DigitalOcean's config) nor the database; decrypting a token needs both halves, and no single leak
yields both.

**Two facts were tribal knowledge until this session and are now written down.** The operator identity behind
every provider account (`the operator alert address`, the developer Workspace account) had never been recorded in
any document, though the domains and the Ontario sole proprietorship had been. And the keyring now lives in a
project named `…-dev`; moving a key between projects is impossible, so a later production project would mean
a new key and a re-wrap. That is cheap now and expensive once real refresh tokens are encrypted under it,
which is why it was raised at provisioning time rather than at deploy time.

### Phase 2 Step 6d (The first deployment — three faults the spec could not show)

The app is live at `https://teachneat-69ecr.ondigitalocean.app`. App `469481ea-…`, managed Postgres
`teachneat-db` (PG 17, `tor1`, Basic 1 GiB, `dbf6798e-…`). Verified from outside the deployment:
`/api/health` 200 with its Postgres probe passing, the static site serving, `/account` resolving through the
SPA catchall, `/api/nope` 404-ing from Express rather than from the platform (so `preserve_path_prefix`
works), all fifteen migrations applied against the managed database, and `Token data key unwrapped from KMS`
with `keyId: k1` in the boot log. **The KMS design works in production**, on the first attempt that reached
boot.

**The staged KMS plan was wrong.** It called for deploying with the four KMS variables unset and adding them
afterwards, so that a boot failure would have one candidate cause. That is impossible:
`assertProductionConfig` requires `TOKEN_KMS_KEY_NAME` and `TOKEN_KEY_WRAPPED` whenever
`NODE_ENV=production`, and boot calls it before `buildApp`, so such a deploy throws and rolls back. The plan
predated the guard. Resolved by setting the KMS variables on the first deploy rather than by relaxing the
guard, on the grounds that the guard is what makes the privacy policy's sentence about key custody true, and
that those values were the best-tested in the set.

**Three faults, none of which a spec review had found, and all of which a real account surfaced in twenty
minutes.**

- **The build could never have succeeded.** `NODE_ENV=production` was scoped `RUN_AND_BUILD_TIME`, npm reads
  that as `--omit=dev`, and `typescript` is a devDependency — so `npm run build` would have died with
  `tsc: not found`. Both build commands now pass `--include=dev`, which makes the build independent of how
  `NODE_ENV` is scoped rather than merely unbroken today.
- **Every variable defaulted to `RUN_AND_BUILD_TIME`**, which is App Platform's default when scope is unset.
  That put the KMS credentials, the wrapped data key and the Stripe secret into the environment during
  `npm ci`, where any transitive dependency's install script could read them, for no benefit — the server
  build is only `tsc`. All twenty-two are now `RUN_TIME`. This is the one worth remembering: the default is
  the permissive option, and nothing warns.
- **The deployment could not reach its own database.** `self-signed certificate in certificate chain`, from
  the migration runner, at boot. `pg` treats `sslmode=require` as `verify-full`, and DigitalOcean's managed
  Postgres presents a certificate from DigitalOcean's own CA, which is not in Node's trust store. Fixed with
  the CA in `DATABASE_CA_CERT` and full verification kept, rather than `rejectUnauthorized: false`, which
  would encrypt the connection while authenticating nothing. The CA is public, so it lives in `.do/app.yaml`
  as a plain value; production refuses to boot without it.

**The CA fix needed a second pass, and the reason generalises.** Passing both `connectionString` and `ssl` to
`pg.Pool` does not merge them: `pg` parses the connection string and applies the result *over* the explicit
options, so DigitalOcean's `sslmode=require` replaced the `ssl` object wholesale and the CA went out with it.
The deploy failed with the identical error, which made it look as though the variable had not arrived.
`buildConfig` in [pool.ts](server/src/db/pool.ts) now decomposes the URL into discrete fields whenever a CA
is configured, so nothing can overwrite the TLS settings; without a CA the connection string is passed
through untouched and local development is unchanged.

**`.do/README.md` now exists.** `app.yaml` had claimed since it was written that the secrets list lived
there. It carries the variable table, the GitHub secrets, the provisioning order, and the three things this
deployment does not have (no staging, a deploy is an outage, backups have never been restored).

**Two corrections to earlier documents.** `PRIVACY_CONTACT_EMAIL` was listed as an environment variable to
set once the domain resolved; it is a build-time constant in `legalMeta.ts`, so it is a code change and a
rebuild. And **the error alerting built earlier in 6d is inert in production**: it shares the `Mailer` seam
with lifecycle email, and `createMailer()` returns null in production when no provider is configured rather
than falling back to the console driver, so with `RESEND_API_KEY` empty until 8c, setting
`OPERATOR_ALERT_EMAIL` achieves nothing. The `.env.example` comment saying the alerts print to the console
is true only outside production.

**Deploying is now a consequence of pushing.** With `DIGITALOCEAN_ACCESS_TOKEN` and `DO_APP_ID` set, the
deploy job runs after both check jobs pass — confirmed working, including a run where it failed closed with
`Input required and not supplied: token` before the secrets existed, with `server` and `client` both green
ahead of it. Because `instance_count` is 1, every deploy is a brief outage and a cold working set, so the
workflow trade is real: batch commits, and branch for anything risky, since CI runs on a pull request but
only a push to `main` deploys. Markdown and `design/` are excluded from the triggers so a docs push does not
restart production to publish prose.

**Two provisioning details worth carrying.** A `production: true` database in an app spec means *attach to an
existing cluster*, not create one — `apps create` fails with "database cluster was not found" until the
cluster exists, so the cluster is a separate `doctl databases create` first. And App Platform's GitHub
connection is a browser consent flow that `doctl` cannot perform: the first `apps create` fails with "GitHub
user not authenticated" until the GitHub App is installed from the console, which can be done by starting
the create-app wizard, authorizing, and then abandoning the wizard rather than letting it write its own
configuration.

### Phase 2 Step 6d (The real domain, and the first real sign-in)

`teachneat.com` serves the app. The Cloudflare record is a CNAME at the apex, DNS-only, and DigitalOcean
provisioned the certificate within minutes. The DigitalOcean hostname still answers alongside it.

**Sign-in works end to end, on the first attempt.** Checked before driving it that `/api/auth/google` was
emitting the production `redirect_uri`, the three intended scopes and `access_type=offline`, which is the
cheap way to catch an OAuth mismatch without spending a failed attempt on it. Then, in one pass: Google's
consent screen, **6j's consent re-prompt in front of a real account for the first time**, bootstrap
discovering the existing spreadsheet through the Drive marker rather than creating a second one, and the
roster loading with real students.

**The full pipeline is proven.** A push to `main` runs both check jobs and then deploys, confirmed by a run
where `server`, `client` and `deploy` are all green and the resulting deployment went ACTIVE. It took three
attempts, and the reason is worth recording because it wastes time twice: **`gh secret set` with no
`--body` stores an empty string when the interactive paste does not register.** GitHub accepts it, lists the
secret as present, and updates its timestamp, so every signal says the secret exists while the action reports
`Input required and not supplied: token`. Prefer `--body`, or pipe from a file.

**A `pre-push` hook now runs CI's checks before the push rather than after it** (`.githooks/pre-push`,
`git config core.hooksPath .githooks`). Since a push deploys production, a failure caught locally costs two
minutes and the same failure caught in CI costs a round trip. It skips docs-only pushes on the workflow's own
`paths-ignore` list, reads the changed-file list line by line because the repo has a tracked path containing
spaces, and runs the checks whenever it cannot determine what changed rather than assuming.

**Two findings recorded rather than fixed**, both carried into NEXT_STEPS as owed documentation work.

- **DigitalOcean fronts App Platform with Cloudflare themselves.** The `ondigitalocean.app` hostname resolves
  to Cloudflare anycast addresses and answers with `Server: cloudflare` and `CF-RAY`. The recorded rationale
  for keeping our record grey — that authoritative DNS sees no request content, so Cloudflare is not a
  subprocessor — is true about our record and incomplete about the request path, since Cloudflare sits in it
  as DigitalOcean's subprocessor either way. The privacy policy names DigitalOcean and inherits their
  subprocessor list, so nothing is wrong; the reasoning needs correcting and the grey-cloud choice
  re-justified as keeping our own contractual surface smaller.
- **A returning teacher can be shown the first-run guide.** `needsOnboarding` is `onboardedAt === null` and
  nothing else, so an account row that is new while the teacher's Drive is not — the account-deletion and
  re-registration path, since 6f never touches the spreadsheet — gets told to add their first students while
  holding a full roster. Surfaced by the go-live itself, where a fresh production database met an existing
  spreadsheet. `first_student_at` cannot fix it as-is: it is set by a create or a non-empty roster read, and
  no roster read has happened when the redirect fires.

### Phase 2 Step 6d (Billing webhook, monitoring, and the Cloudflare correction)

**The Stripe webhook endpoint is live and verified**, `we_1U899P1zP9a6mkR4h7Y2YX26` against
`https://teachneat.com/api/billing/webhook`, subscribed to exactly the three events in `SUBSCRIPTION_EVENTS`.

**The environment is a Stripe Sandbox and that is not legacy test mode.** Both issue `sk_test_` keys, so the
prefix distinguishes nothing, but objects created in one do not exist in the other; an endpoint built in the
wrong one looks correct and matches nothing. Settled by asking the API rather than the UI: the key in
`server/.env` reports `acct_1TyYQA1zP9a6mkR4`, display name "Teacher Toolkit sandbox", and the configured
price ids resolve there at 699 CAD monthly with `livemode: false`. **Check the environment before the URL.**

**A related non-finding worth recording, because the naming actively misleads.** Asked whether the pause
feature needed `customer.subscription.paused` and `.resumed`. It does not, and cannot use them: Stripe's own
descriptions say both "only apply when subscriptions enter `status=paused`, not when payment collection is
paused", and Step 6i's summer pause is `pause_collection`. Both directions arrive as
`customer.subscription.updated`, which `subscriptionStateFrom` already reads `pause_collection` off as a
flag. `status=paused` is unreachable here regardless, since Checkout sets no trial and captures the card, so
the trial-ends-without-a-payment-method path that produces it never occurs. Subscribing to them would have
looked like coverage and delivered none.

**The endpoint's API version matches the SDK's pinned version**, `2026-06-24.dahlia` against `stripe@22.3.2`.
Not cosmetic: `subscriptionStateFrom` reads `current_period_end` off each subscription *item*, the newer
shape, so an older endpoint version would have left `currentPeriodEnd` null on every event.

**Delivery was verified through `pending_webhooks` rather than the dashboard.** `stripe trigger
customer.subscription.updated` produced `.created` and `.updated`, both at `pending_webhooks=0`. The reading
needs care: `0` also means "nothing subscribes to this", which is why the four `invoice.*` events in the same
batch read `0` too. It is conclusive only for types an enabled endpoint subscribes to, where a rejected
delivery would still be in retry at 1 or more. The outcome inside those 200s is `unknown_customer` by design,
since the CLI invents a customer with no row here; that proves signature verification and connectivity, not
state application.

**Monitoring is set up, and the earlier note that DO covered it "for nothing" conflated two products.**
App Platform alert policies are free but alert on deployments, domains and resource metrics, and cannot say
the site is unreachable. DigitalOcean Uptime is the separate product that probes externally, at $1.00 per
check per month. Both were taken: one Uptime check with downtime and 14-day certificate-expiry alerts, plus
App Platform policies for RAM above 80% and restart count on `server`, over the failed-deployment and
failed-domain defaults.

- **The check targets `/api/health`, not the root.** That endpoint probes Postgres and answers 503 when the
  database is unreachable, so it catches the outage that matters; `/` serves the static site and would stay
  green through a total database failure. The same fault the pre-provisioning audit fixed at the endpoint
  would have been reintroduced at the monitor.
- **The dollar bought avoiding a vendor, not the capability.** A free third-party monitor would not be a
  subprocessor, `/api/health` carrying no personal data, but it would be another party in the
  infrastructure. The project reasoned the same way on Cloudflare and on log aggregation.
- **The downtime threshold is 30 minutes because the form offered 10 or 30.** The stated reason for wanting a
  long window, avoiding false alarms from our own deploys, was overstated: App Platform builds before
  swapping traffic, so a deploy would not trip 10 either. 30 costs nothing while an undetected outage costs
  nothing, and is a launch-time revisit rather than an open question.
- **These are currently the only working alerts.** 6d's error alerting stays inert until 8c, and DO notifies
  through its own system outside that path. They remain complementary afterward: inside-out alerting cannot
  report DNS failure, certificate renewal failure, KMS permissions lapsing, or App Platform itself failing,
  because the sender is then the broken thing.
- Certificate noted as Google Trust Services, expiring 2026-11-23 on a 90-day auto-renew. **A CAA record
  added at Cloudflare must list both `letsencrypt.org` and `pki.goog`** or renewal fails.

**The Cloudflare rationale is corrected in place**, in NEXT_STEPS and in the `.do/README.md` runbook step that
carried the same wrong reasoning. The grey cloud stands, on the narrower ground that it keeps Cloudflare from
becoming *our* subprocessor; it never kept Cloudflare out of the request path, because DigitalOcean puts it
there.

**The returning-teacher redirect is fixed rather than documented.** It had been filed as owed documentation,
which undersold it: it is a bug, and the first thing a teacher sees after re-registering. The fix needed no
new data, because the signal was already computed and discarded — `discoverOrCreateSpreadsheet` returns
`created`, and the callback destructured only `spreadsheetId`. `returningTeacherOnFreshAccount` gates a
`markOnboarded` on three conditions, of which **`spreadsheetId === null` is the one carrying the weight**: it
identifies a fresh account row, because the callback writes the id immediately after. Drop it and a teacher
who abandoned the guide on day one loses it on their next sign-in, since that sign-in also discovers rather
than creates. Tested as a pure predicate; the callback's success path has no coverage because it would need
the entire Google exchange mocked, and the decision worth pinning is the predicate.

Two limitations taken knowingly. A discovered spreadsheet proves prior use, not a populated roster, so
registering, adding nobody, deleting and returning counts as returning; distinguishing them means a Sheets
read on the sign-in path to serve a rarer case than the one being fixed. And the state lands in
`onboarded_at`, a column that reads as "finished the guide" and is counted by `/admin/metrics`, so its
onboarding figure now includes teachers who never saw it. The skip path already overloaded that column the
same way, and a dedicated column is a migration this case does not earn.

**A second pass over the fix found two more things, both left as they are.** First, **the claim was too
broad**: what is proven is a fresh account row meeting an existing, still-accessible spreadsheet — go-live's
own case, and the shape of a database restore — while **the delete-and-register-again path is untested and
may never reach this code**. Deletion revokes the refresh token, discovery runs through `drive.files.list`,
and `drive.file` returns only files the app holds per-file access to; whether those grants survive a revoke
and re-consent is not established by Google's documentation. If they do not, bootstrap creates a second
spreadsheet, the predicate correctly declines, and the guide is right — but the teacher holds two
spreadsheets with the older invisible to the app, which is a different and worse bug that nobody has tested.
Second, **the freshness proxy admits one false positive**: a sign-in that died between `createSpreadsheet`
and `updateSpreadsheetId` leaves a null spreadsheet id behind, and the next sign-in reads a new teacher as
returning, costing a redirect but not the guide. Both closable, neither worth it: the first by a roster read
on the sign-in path, the second by having `upsert` report insertion through `xmax = 0`.

**The ordering the whole thing rests on was invisible and is now commented.** `account` is the row as
`upsert` returned it, before `updateSpreadsheetId` writes. Re-read it there, or move the check above the
write, and the predicate is always false: the bug returns and nothing fails.

### Phase 2 Step 6d closed

The privacy contact is `privacy@teachneat.com`, a role address on the operating domain delivered by
Cloudflare Email Routing alongside `support@`, both forwarding to the operator's inbox. A personal mailbox
was rejected for three reasons: the line is read by a board's privacy officer and by Google's verification
reviewer, a public document should not carry a personal inbox forever, and a role address survives a change
of mail provider.

**Two judgments recorded rather than left implicit.** Filling the constant took **no version bump** — it adds
a channel and changes nothing about what is collected or where it goes, and the contact-form route that
stood while it was empty is still there. And **Cloudflare is not added to `SUBPROCESSORS`** for handling
inbound mail: that list names parties processing personal data *on our behalf*, which Resend does by sending
our messages to our users, whereas Email Routing relays what a person chose to send **to** us. Correspondence
reaching its addressee through a conduit, not processing carried out for us.

**The domain carrying mail hands 8c a silent trap, recorded there.** Onboarding Email Routing wrote an SPF
record; Resend will want one at 8c; **a domain may have only one SPF TXT record**, and a second invalidates
both. The failure is not an error but lifecycle mail quietly landing in spam, discovered weeks later.

**The branch-and-pull-request rule for auth, sessions and billing is withdrawn** from CLAUDE.md. A pull
request with no reviewer is ceremony rather than review, and the `pre-push` hook already runs CI's checks
before anything can deploy. A migration remains the change worth pausing over before pushing, rollback not
being symmetric once one has run, but that is a moment of care rather than a process.

**6d is done.** Its one unfinished item, `OPERATOR_ALERT_EMAIL`, is carried to 8c deliberately: setting it
achieves nothing while `RESEND_API_KEY` is empty, since `createMailer()` returns null in production rather
than falling back to the console. 8c makes both real at once. The DigitalOcean alerts are unaffected,
notifying through DO's own system outside that path. Next is **6k**.

**The dev plan toggle is correctly absent in production**, confirmed against the running app.
`devToolsEnabledFor` requires a non-production environment *and* the allowlist, and `.do/app.yaml`
additionally omits `DEV_TOOLS_GOOGLE_SUBS` so both halves are false rather than one. The consequence is a
change in how Premium gets tested in production: the 30-day trial covers it initially, and the
`plan_override` comp on `/admin/support` is the sanctioned lever afterwards. `SUPPORT_ADMIN_GOOGLE_SUBS` is
set in production and has no environment half to its guard, so the operator surface stays reachable.

### Phase 2 Step 6k — Attendance stored as exceptions

Attendance no longer writes a row per student per class per day. It stores only the non-present marks
(`a` absent, `t` tardy, `e` excused) and infers present from the absence of a row, with a **class-day
marker** per (course, date) recording that the register was taken. schemaVersion 5, the first non-additive
bump and so the first entry in the migration registry that has existed since Step 6e.

Measured on the suite's own fixture: twenty students over five school days with one absence each day is
**ten stored rows against the hundred v4 held**, and all hundred marks still read back. This shrinks the
data rather than a copy of it, so the Sheets read, the sheet's growth and the cold working set improve
together — which is what no amount of cache tuning could reach, and why 6d's measurement of attendance at
98% of a teacher's resident memory turned into a schema step.

**Where the marker lives, which was the open design question.** Sentinel rows in the `attendance` tab:
`studentId` empty, `statusKey` = `d`, carrying `course` and `date` like every other row. The alternative
was a `classDays` tab of its own, which is the tidier schema and loses on three counts. One read and one
cache entry rather than two. A save that writes the marker and its exceptions in a **single append call**,
so the register cannot end up recorded without its marker — with a separate tab that becomes two writes
with no transaction between them, and a rule about which goes first. And class archiving moves markers with
**no code of its own**, because `matchesCourse` keys on the `course` field alone; a separate tab would have
needed a `classDaysArchive`, entries in `ARCHIVE_OF`, `MOVED_TABS` and `READ_TABS`, and two more calls
against a move budget whose test asserts 12 and whose comment records that an earlier forty-call version
rate-limited a teacher on their own second click.

The objection to sentinel rows is real and is contained rather than dismissed: `AttendanceStatusKey` reaches
the client, the heatmap classifier and the email placeholder counts, so a leaked marker would render as a
phantom student. Markers are split off at `loadSnapshot`, **the single place attendance rows are parsed**,
so no marker ever exists as an `AttendanceRecord`. The request schemas validate against the four student
statuses, which exclude `d`, so a marker cannot be submitted; `PUT /attendance/:id` skips markers explicitly
and answers `NOT_FOUND`, because editing one into a student status would change what a whole class-day means.

**A class-day is a marker OR any exception on that date.** Readers take the union rather than trusting
markers alone, so a marker lost to a partial write cannot hide a recorded absence. Belt-and-braces on top of
rule one, not a licence to skip it.

**The client did not change at all.** `listByDate` and `listByRange` expand the stored form back into the
dense per-student records the API always returned, so `EntryView`, `HistoryView` and the student-detail
heatmap are untouched and the client suite is unchanged. `classifyDay` already treated a missing status as
`empty`, which now correctly means the register was not taken. An inferred record carries a `~p:` id that no
row backs; nothing in the client calls `PUT /attendance/:id`, and the endpoint answers `NOT_FOUND` for it.

**`enrollments.startDate`, and the fallback that looked free and was a trap.** Inferring present needs to
know which days a student was in the class, or a student who joined in November reads as present through
September with their absence rate diluted by weeks they were not there. A new nullable `startDate` column
answers it. The first implementation fell back to the enrollment's `createdAt` when unset, which **broke
every existing archive test** and was right to: `createdAt` is when the row was written, so a teacher who
sets up a roster today and then enters last week's attendance has every one of those days precede every
`createdAt`, and the whole backfill is clamped away. Only an explicit date bounds anything now.

The bound also **suppresses inferred presents only**. A mark actually recorded before the start date still
counts, in both `expand` and `computeStats`. A teacher marking a student absent has told us something, and a
bookkeeping field must not be able to delete it.

**The migration, and its ordering.** Three phases, arranged so a failure anywhere loses nothing: append the
new markers (purely additive, so the sheet is untouched on failure); backfill `enrollments.startDate`
(fills empty cells only); then rewrite `attendance` to drop the present rows, the only destructive step and
last. The `startDate` backfill has to sit *before* the rewrite because it is computed from the present rows
the rewrite destroys.

The backfill has two halves, because "no rows" meant two things under v4. A student **with** rows started no
later than their earliest one. A student with **no** rows in a course that has recorded days was never in a
register that was taken — under v4 that read as `daysRecorded: 0`, and left unbounded it would have become
present on every one of those days — so they start the day after the last recorded one, which preserves the
zero exactly.

**The retry test found a real bug and the lesson generalises.** With the attendance rewrite's clear made to
fail, the sheet holds the new form plus a stale tail, *and* the markers twice: once from the phase-1 append
and once from the rewrite that did not finish clearing. The first implementation's rewrite copied markers
through from its read, so the retry faithfully wrote the duplicates back and converged on eleven rows
forever. The fix is that **the rewrite is a normalising projection rather than a copy** — it rebuilds one
marker per class-day from whatever the tab currently holds. Converging on row *count* is not converging, and
a duplicated marker is a class-day counted twice in every denominator.

Reaching that failure needed a new fault injector. `failNextClear` fires on the first clear, which is the
enrollments rewrite, so the test it named was not the test it ran; `failClearAfter` counts past N clears.
The retry test now asserts the half-applied state exists before retrying, or it would pass without
exercising anything.

**One semantic change is deliberate and visible.** A student with no rows now reads as present on every
class-day rather than as having no data — `daysRecorded` counts class-days, not the student's own rows. Two
existing assertions expected the old answer and were updated rather than worked around, since that
difference is the entire point of the marker.

**Not done, and carried as a follow-up.** A student enrolled into an already-running class *after* the
migration gets no start date, so they read as present from the class's first recorded day until one is set.
Closing it means a start-date control in the UI, or inferring one at enrollment time from whether the course
already has class-days — which needs an attendance read on the roster-add path and a service dependency that
currently runs the other way. Recorded in NEXT_STEPS rather than bolted on here.

**Also owed: the manual pass.** The migration has only run against the fake Sheets environment. Driving it
against a real v4 spreadsheet, then checking the History grid and the student-detail heatmap paint the same
days they did before, is in TESTING_PLAN under Step 6k.

**Step 6 is complete.** All eleven sub-steps, 6a through 6k, are done. Next is Step 7.

### Phase 2 Step 6k follow-up — start dates for mid-year enrollments

The one thing 6k shipped owing. Present is inferred from the absence of a row, so a student added to a class
that had already been recorded read as present for every session held before they arrived: their
`daysRecorded` counted weeks they were not there, and their absence rate was diluted against it. A false
negative on the high-absence flag rather than a false alarm, which is the quieter direction and the reason it
was worth closing rather than leaving.

A new enrollment is now stamped with a `startDate` automatically: **the day after the course's last recorded
class-day**, or left empty when the course has never been recorded.

**Derived from the data rather than from the clock, which was the deciding call.** The obvious rule is "today",
and it is wrong twice over. The server does not know the teacher's timezone, so a teacher adding a student at
6pm Pacific gets tomorrow's UTC date and loses the register they are about to take. And it is a second
definition of a question the migration already answers — 6k's backfill starts a student with no rows the day
after the last recorded one — so the two would drift. Using the last recorded day is timezone-free and makes
the system carry one rule.

**A course with no recorded attendance leaves the enrollment unbounded**, deliberately. That is the ordinary
set-up sequence: build the roster, then enter last week. Bounding it there would recreate the `createdAt` trap
6k already fell into once, by a different route.

**The dependency runs through `students.ts`, not between the two services.** `enrollments.ts` cannot read
attendance without a cycle, since `attendance.ts` already imports `listEnrollments`. So `attendance.ts`
exports `lastRecordedDayByCourse` and `startDateForNewEnrollment`, `setEnrollments` takes a
`startDateFor(course)` resolver with a null-returning default, and `students.ts` composes the two — which it
can do because it already depends on both. All three creation paths go through it: `createStudent`,
`updateStudent` when it adds a class, and `createStudentsBatch`.

**Existing enrollments are never restamped.** The start date records when the student joined; adding a second
class to the same student is not that, and re-saving a roster must not silently move the first class's
denominator.

**The cost is one Sheets read, amortised.** It comes off the attendance working set, which nothing on the
roster-add path invalidates, so a burst of single adds pays for it once rather than once per student. Asserted
by call count, because a read per student would spend a 60-per-minute per-user budget on a teacher typing in
their class list — the same constraint that shaped the archive move in 6e.

`dayAfter` moved from `migrationV4ToV5.ts` to `utils/time.ts`, shared by the migration and the enrollment rule
so the two spellings of the rule cannot drift apart.

**No UI control was added, and that is a decision rather than an omission.** The automatic rule is right in
every case examined, and a control a teacher has to know to use would not have fixed the default, which is
where the bug lived. If a correction path is ever wanted, the per-class section of the student detail page —
which already carries the at-risk toggle — is where it belongs.

### Phase 2 Step 6k follow-up — the groupings tab was growing without limit

Spotted by looking at real spreadsheet sizes rather than by any test: the `groupings` tab had run to
thousands of rows. Not a feature keeping history, and not inherent to soft delete either. It was soft delete
meeting an auto-save that fires on **every** interaction.

`saveCurrentGrouping` soft-deleted the course's rows and appended a fresh set, one row per group, and the
Grouping page auto-saves on every generate, drag-move and reorder (debounced 900ms). A class of 30 in groups
of 4 writes 8 rows per save, so one planning session of generate-drag-regenerate-drag is ten saves and eighty
rows, seventy-two of them dead. Across several classes over a term that is thousands.

**Nothing ever read that history.** `listCurrentGroupings` is the only reader and it filters to active rows;
there is no history view, no undo, no export. And it reads the whole tab before filtering, so every cold
grouping load already paid for every dead row — the exact cost that justified class archiving in 6e and the
attendance rewrite in 6k, sitting unnoticed in a third place. Archiving made it worse: the move partitions by
course with no active filter, so archiving a class dragged its tombstones into `groupingsArchive` too.

Worth naming why this was different in kind from the attendance tombstones flagged during 6k. Those accrue
only on corrections, which are rare, so growth tracks *error*. These accrued on ordinary use, so growth
tracked *interaction*.

**The fix: rows are reused rather than replaced.** The course's existing rows are overwritten in place — the
first `min(old, new)` groups take over the rows the previous arrangement used, further groups first reuse
rows this course had soft-deleted before appending new ones, and surplus rows are soft-deleted. Dragging a
student between groups does not change the group count, which is the common case, so the common case now
writes zero new rows. The tab settles at each course's high-water mark of group count. Reusing a row means
reusing the storage, not the record: each row still gets a fresh id, since it is a new arrangement.

**A full-tab rewrite was rejected**, though it would bound growth just as well and more simply. It turns a
concurrent save for a *different* class from "last write wins on a row" into "last write wins on the tab",
which could silently drop another class's arrangement. Touching only the course being saved keeps the blast
radius where it already was.

**schemaVersion 6 clears what had already accumulated**, a pure data transform with no column change:
`groupings` and `groupingsArchive` are rewritten keeping only their live rows. Live arrangements are kept, so
nobody has to regenerate anything — the user was willing to lose the lot, and there was no need to take them
up on it.

**The retry test caught the same bug 6k's did, which is worth noticing as a pattern.** `replaceTabsRows`
writes survivors then clears the tail, so a failed clear leaves the rows just written *and* the originals
they were meant to replace. The first version's retry kept both and settled on two copies of every live
arrangement, which `listCurrentGroupings` would have rendered as double the groups. Deduplicating survivors
by id is what makes it converge. That is now three migrations where "writes before clears" was the easy half
and "converges on content, not just row count" was the half that needed a test to find. `classArchive.ts`
had `dedupeById` for exactly this reason and the lesson did not transfer on its own.

Also fixed in passing: the `ENROLLMENT_COLUMNS` comment in schema.ts still described the `createdAt` fallback
for `startDate` that had already been removed for being a trap.

### Misc fixes (2026-08-25)

A batch of small changes between Step 6 and Step 7, not a plan step. Two of them are worth knowing about
beyond the diff; the rest are copy and layout.

**The health endpoint carries a build stamp, and the CI deploy step no longer reads a timeout as a
failure.** A deploy had failed unnoticed and the symptom surfaced days later as a fix missing from
production. `/api/health` now returns a short commit hash and the process start time on both the healthy
and the degraded response, so "did it land?" is one `curl`. `doctl`'s `--wait` gives up after about thirty
minutes and exits non-zero, which is not the same thing as a failed deploy; the step now resolves a timeout
by asking whether the deployment is *moving* — ACTIVE passes, ERROR/CANCELED fails, progress advancing after
a bounded ten-minute wait passes with a warning, progress frozen fails. Both directions of the mistake come
from the same incident: that deployment did not recover on its own, so treating "still in flight" as benign
would have gone green over a deploy that was already dead. CLAUDE.md gained the two habits the incident was
missing — check the last run's outcome at the start of a session, and confirm production from the health
endpoint rather than inferring it from a green run.

**The first-run guide records completion on arrival rather than on the way out.** This was forced by
removing "Skip for now": `RequireOnboarding` redirects to `/welcome` for as long as the flag is set, so with
the bookkeeping on the exit buttons, deleting the skip link would have left a page whose only exits were its
two Add buttons and made a sidebar click bounce straight back. It is also the more honest reading of a flag
that means "has not been shown the guide", and it costs nothing, because the account menu keeps offering the
guide until the first student is added.

The rest:

- The marketing header is `px-4` at every width, matching the app's top bar, so the lockup does not move
  when a visitor signs in. The footer wordmark drops its weight split (a new `plain` prop): inside a
  sentence at 12px the heavier "Teach" reads as emphasis rather than as a mark.
- The hero subhead names the jobs first and the mechanism second, with a forced break before "All from one
  class list". The old `whitespace-nowrap` on the last sentence is gone — it worked only while that sentence
  fit a 320px viewport.
- Two sentences cut from `/for-admins`: one described what the page was about to do, the other promised that
  on-Drive storage is not something a future release can quietly change.
- The guide's tool strip is a sticky picker: it opens on Students, hovering or clicking another chip moves
  its one-liner into a shared line below, and the selection stays when the pointer leaves. The chips do not
  navigate, because sending a teacher into an empty tool from the page whose job is to get the roster in
  works against the two buttons above it. Each chip carries its synopsis as an `aria-describedby`
  description, since the shared line is useless without a pointer.
- The roster's "IEP" and "Accommodation" selects are one control. They were on the same axis and could be
  set to a combination that can only return nothing ("No accommodations" plus a named type). A new Alerts
  filter makes the two existing warning indicators selectable, scoped by the class filter because the flags
  are per class, and not premium-gated because the indicators are not.
- The tooltip moved from `z-20` to `z-[29]`. The Attendance History grid and the Statistics table pin header
  cells at `z-[25]` and are not their own stacking context, so a free account hovering the disabled
  Statistics segment read the explanation from underneath the grid. 29 clears both and stays under the
  mobile drawer overlay at `z-30`.


### The App Platform deploy wedge, and what CI does about it (2026-08-25)

Three deployments in one afternoon hung in the same shape, and the investigation is worth keeping because
the diagnostic signal is not obvious and the first two attempts to reason about it were wrong.

**The shape.** A builder is allocated, two of the three components build normally, and the third sits in
`RUNNING` **having emitted no build log at all**. It hit the `server` component at 17:36 (left ~2 hours,
ended ERROR) and the `client` component at 20:22 (superseded at 11 minutes). A healthy deploy is about three
minutes end to end.

**The signal that separates it from a slow build is log line count, not phase or progress.** Both the wedged
deployments and a healthy one report `3/8` with a component in `RUNNING`, so the progress number cannot tell
them apart — an early reading that it could was wrong. What does tell them apart: each component emits a
consistent volume of build log, 131 lines for `server` and 174 for `client`, and a healthy client component
climbs 0 → 58 → 169 inside one minute. A wedged component never leaves 0. `updated_at` freshness is *not* a
usable signal either; it keeps ticking on a wedged deployment.

**It is DigitalOcean's build orchestration, not this repo.** It struck different components on consecutive
attempts with no code change touching either build path; the same commit built clean on retry; the failure
is upstream of our build command, which never produced a line; and both build commands are `npm ci` against
a committed lockfile. DigitalOcean's status page reported all systems operational throughout, which is
evidence about their status page rather than about the builder pool.

**There is no cancel. A superseding deployment is the only recovery**, which is what cleared both.

**CI's deploy step is now a small control loop rather than `doctl ... --wait`.** `--wait` was answering the
wrong question in both directions: it gives up at ~30 minutes and exits non-zero, which is not a failed
deploy, and it does not return promptly when its deployment is superseded — the run that prompted this sat
18 minutes polling a deployment that had been cancelled 11 minutes in. The replacement creates a deployment,
**keys on the returned id**, and polls it: ACTIVE passes, ERROR/CANCELED fails, and no new build-log output
for five minutes while still building is treated as wedged. On a wedge or a failure it supersedes its own
deployment once and watches the replacement, failing only if the retry wedges too.

**The first version of that step had two bugs worth recording**, and the second is the better lesson.

`read_phase` read the *newest* deployment rather than the one the job created, so a job could report success
for a deployment it had nothing to do with — it would have gone green over its own failure any time
something else deployed in the window. Keying on the created id is the fix.

The other is that **the whole fallback was dead code and never ran once.** It paired `set -o pipefail` with
`doctl ... | head -1`: `head` exits after one line, `doctl` takes SIGPIPE and dies 141, `pipefail` promotes
141 to the pipeline's status, and GitHub runs `run:` steps under `bash -e`. The run that prompted all this
printed the fallback's first warning and then died with exit 141, so it went red for a reason with nothing
to do with the deployment — which is precisely the confusion the step was written to end. The rewrite drops
`pipefail` entirely and ends every helper in `tr` or `wc`, so a transient `doctl` failure is a poll that
reports nothing rather than a killed job.

The loop is exercised against a stubbed `doctl` across six scenarios — healthy, slow-but-healthy, a flaky
API that fails alternate polls, wedged then recovered, errored then recovered, and wedged twice. Two of
those are there because the harness twice proved less than it appeared to. It first passed while the stub
was silently returning zero log lines for *every* scenario, an argument-position bug, so it said nothing
about the false-positive path that slow-but-healthy exists to cover. And it ran the script under plain
`bash` while GitHub runs it under `bash -e`, which is the difference that hid the SIGPIPE failure above.
**A shell harness that does not reproduce the invoking shell's flags is not testing the thing that ships.**

**The commit hash came off `/api/health`.** The build stamp shipped earlier the same day resolved a commit
from `BUILD_COMMIT`, then `git rev-parse`, then `'unknown'`, and in production it reported `unknown` — the
buildpack leaves no `.git` in the workspace and injects no commit variable, so only the fallback could ever
fire. A field that is honest locally and empty where it matters is worse than no field. `startedAt` stays
and answers the question the incident actually posed, since a process that started before you pushed is not
running your code; the exact commit is on the deployment record as `source_commit_hash`. Putting it back
would mean CI writing `BUILD_COMMIT` into the app spec before each deploy, which is spec churn for something
the API already serves.


### Phase 2 Step 7 — Security hardening pass (2026-08-26)

The step as planned was rate limiting, a header audit, penetration testing, a dependency audit, an
authorization review of every endpoint, and verification of data isolation. It also owned the missed-webhook
question carried from Step 3b. The audit ran as an adversarial pass rather than a checklist, and the findings
were ranked twice: first by confidence and severity of control failure, then re-ranked by harm to student
data and operator liability. The two orderings disagree, and the second is the right one for this product.

**What the audit found clean**, recorded because several are places it expected to find something. Every
Sheets write uses `valueInputOption: 'RAW'` without exception, so a student named `=IMPORTXML(...)` is stored
as text and formula injection is comprehensively closed. Cache keys are `googleSub::constant` with no user
input in any resource string, so cross-tenant collision is unreachable. No SQL carries caller input by
interpolation; the one interpolated column name comes from a closed typed map. No client string reaches A1
notation. Session ids and CSRF tokens are 32 random bytes, hashed at rest, with absolute and idle TTLs
enforced on read, and the OAuth callback mints a fresh session so fixation is closed. `localStorage` holds
display preferences only. Checkout return URLs are server-derived, so Stripe cannot be used as an open
redirect. `emailSend.ts` reads as binary to grep because of one deliberate NUL separator in a composite map
key, which is the right choice and not a defect.

**SMTP header injection, and why it was re-ranked.** `encodeSubject` base64-encodes only non-ASCII subjects,
and CR and LF are ASCII, so a subject carrying a line break reached the RFC 2822 header block verbatim. So
did a recipient address, because `rowToStudent` read addresses back from the sheet as raw strings while the
write path validated them with `z.email()`. Three working attacks were demonstrated against the real
function, the worst of which ends the header block early and supplies an entirely attacker-controlled body.

It was first written up as an audit-and-cap-bypass problem. That was wrong. The spreadsheet is editable by
the teacher **and by anyone they have shared it with**, which for this product is routinely an EA or a
co-teacher, and a `Bcc:` planted in an address cell silently copies every message about a student to a third
party. `emailLog` records only the visible recipient, so nothing surfaces it. That makes it a covert PII
exfiltration channel, which is a different severity from mail-relay abuse.

Fixed in three deliberately overlapping layers: the route schema refuses a break at save time,
`renderSubject` folds the rendered result (covering the template's own text, which `renderPlaceholders` never
saw because it only sanitised substituted *values*), and `assertHeaderSafe` throws when the message is built.
The last runs on the **raw** subject rather than the encoded one, because a check on the encoded form passes
exactly the input it exists to catch: base64 hides the break. One invariant, no exceptions.
`emailAddressSchema` is now shared between the write path and the read path so the two cannot drift again.

**The daily send cap had two independent bypasses, and the second explains the first.** Concurrency was the
one being looked for: the count was read at the top of a batch and written at the bottom, and `getOrLoad`
coalesced concurrent readers onto one promise, so overlapping batches were *guaranteed* the same number. Four
concurrent sends of 150 put 600 messages out against a cap of 200, and the burst limiter allows sixty
requests per ten seconds, so 600 was not the ceiling.

The one found while fixing it needs no race at all. The count came from `emailLog` rows in the teacher's own
spreadsheet. Deleting them reset a hard cap to a full 200. `accountStore` already carried the sentence *a
paywall cannot be enforced from a spreadsheet the teacher can edit*, which is why the monthly free-tier
allowance lives in Postgres; that reasoning was never carried across to the daily cap, even though the daily
cap is the harder limit and the one the `gmail.send` scope's standing with Google rests on.

Both close with the same change: the counter moves to Postgres (migration 0016) and sends **claim** against
it before going near Gmail, one atomic UPDATE returning each batch its own post-claim total. Unused claims
are handed back, so neither the cap stopping a batch nor Gmail refusing a message costs a day's allowance.
`emailLog` stays what it should always have been on its own, the audit record, and dropping the read takes
one Sheets call off the send-status path.

**The working set's byte accounting was broken by Step 6k and nothing failed.** `estimateBytes` sized a value
as `Array.isArray(v) ? v.length * 400 : 1024`. 6k changed the attendance entry from a flat array to
`{ records, classDays }` to carry the class-day markers, and an array test on an object is false, so the
largest thing this process holds, about 98% of a teacher's footprint, was charged the 1 KB floor. Measured at
**345x** on a realistic teacher-year; the same rows in the pre-6k shape account correctly, which is what
identifies it as a regression rather than a long-standing approximation. `groupings` caches a `Map` and hit
the floor the same way.

`MAX_CACHE_BYTES` therefore was not bounding the consumer it was introduced to bound, and capacity eviction
could not fire for it. Nothing had gone wrong in production because the two-minute idle clock is what limits
residency day to day; the capacity bound is the backstop for a burst of concurrent teachers, and the backstop
was not connected. `countRows` now walks containers, stopping at an array and returning its length so sizing
is not itself proportional to the data, depth-bounded at three. The more useful half is the tests, which
assert the shapes each resource actually caches rather than the generic rule — the generic rule was already
covered and passed throughout.

**Subscription reconciliation settles the missed-webhook question in both directions.** Paid entitlement
resolves from the mirrored `subscription_status` alone, so the row is only as correct as the last event
received, and Stripe stops retrying after about three days. A missed `deleted` leaves a cancelled account paid
indefinitely; a missed `created` leaves a *paying* teacher unable to cancel or pause, because `canCancel` and
`canOfferPause` read the mirrored state. The second is the likelier, and was the later of the two to be
noticed.

An hourly sweep asks Stripe about the least-recently-checked accounts, bounded by batch size so the API calls
per run are a constant rather than a function of the paying user count. It is **not** a second opinion: it
derives state through `subscriptionStateFrom` and writes through `applySubscriptionState`, the same mapper and
writer the webhook uses. An empty subscription list is explicitly not a cancellation, since Stripe keeps
cancelled subscriptions listed and writing a cancelled state from an absence would drop a comped account.

Chosen over the other candidate, treating `active` with a past `current_period_end` as lapsed, because that
addresses one direction only and cuts off a teacher whose renewal event is merely in flight.

**And `applySubscriptionState` was an unconditional UPDATE.** Stripe does not guarantee event ordering, so an
`updated` redelivered after the `deleted` it precedes restored `active` and left the account paid: the same
outcome as a missed event, by a different route. It now carries the event's own Stripe timestamp and refuses
to go backwards, with `<=` rather than `<` because Stripe timestamps are whole seconds and several changes can
share one. A stale event is **acknowledged, not failed** — a 500 would have Stripe redeliver it forever, and
it would lose the comparison every time.

**The rest of the audit, in brief.**

- **`trust proxy` was never set**, so `req.ip` was DigitalOcean's ingress and two limiters keyed on it were
  one shared bucket rather than per-client: the global 600/minute, and the 3/hour on the public contact form,
  which is the route a teacher whose board blocked the OAuth app has to reach us by. Now configurable and
  defaulting to present behaviour, with `GET /api/internal/forwarding` (operator-gated) to measure the real
  hop count. **The number is still unset** — see NEXT_STEPS. Guessing high is worse than leaving it, because
  Express would read `req.ip` out of client-supplied `X-Forwarded-For` and it would look like it was working.
- **The HTML document carried no security headers.** Helmet only decorates `/api`; the SPA is served by App
  Platform's static component out of object storage. App Platform cannot add them, verified rather than
  assumed: a `headers` block on an ingress rule fails `doctl apps spec validate` with `unknown field`. The
  CSP now ships inside the document, injected at build time by a Vite plugin — build-only, because
  `@vitejs/plugin-react` injects an inline preamble in dev and a policy in the source document would break
  `npm run dev` and invite the wrong fix. `frame-ancestors` is deliberately absent rather than faked, since
  meta cannot deliver it; `SameSite=Lax` stands in its place, a cross-site frame receiving no cookie.
  **Confirmed enforced in a real browser**, which the test suite structurally cannot do: an image from a
  disallowed origin was refused with an explicit violation, while a `googleusercontent` image and the
  sandboxed `srcdoc` preview both passed. The avatar host was widened to the `googleusercontent` wildcard
  after checking that Google's `picture` claim is not pinned to `lh3`.
- **Drive discovery applied no ownership filter**, so a spreadsheet the teacher does not own could be adopted
  as their data store, which is total compromise of one account's data from a single share. Not reachable
  today (`appProperties` are private to the OAuth client, and under `drive.file` the visible set is
  app-created files with no picker anywhere), and fixed anyway: the impact is catastrophic, the fix is one
  clause, and Step 9's Marketplace listing is what changes the reachability. The fake Drive ignored the clause
  entirely, so the tests would have stayed green with the guard deleted; it honours it now.
- **`NODE_ENV` defaulting to `development`** meant one unset variable simultaneously dropped `Secure` from the
  session cookie and lifted the KMS requirement, both failing open. Flipping the default was the obvious fix
  and the wrong one, since `npm run dev` sets no `NODE_ENV`. Instead the app refuses to boot when
  `CLIENT_ORIGIN` is a public https origin while `NODE_ENV` says otherwise, which cannot be true by accident.
  Deliberately not keyed on `DATABASE_URL`: pointing a laptop at the managed database is a real thing to do.
- **Account deletion left the working set resident.** Now evicted. Writing that test found a second bug, and a
  broader one: dropping a key from `inFlight` does not stop the loader's already-attached `.then` from calling
  `setCached`, so an invalidation landing mid-flight is overwritten by the value it was discarding. On the
  deletion path that put a deleted teacher's data back for a full age window; everywhere else it is a
  staleness bug where a concurrent read beats the write that invalidated it.
- **Dependencies**: 17 advisories across both packages to zero, all transitive, no `--force`, and neither
  `package.json` moved. The `sanitize-html` `javascript:` bypass was checked rather than assumed and is not
  exploitable here — it works through `action`, `formaction`, `data`, `poster` and `background`, and the
  allowlist permits `a[href|rel]` plus `data-if` on four block tags, with none of the carrier tags allowed.
- **Logger redaction** gained `goesBy`, `pronouns` and `notes`. `notes` is the one that matters: free text on
  a student record is where the least appropriate things to log actually live.
- **A pre-existing CI flake was fixed.** Three `ContactPage` tests failed roughly one run in seven, always
  together and always while the server suite ran beside them. Not a wrong test but a slow one: `userEvent`
  waits a macrotask per keystroke and the file types ninety-odd characters across four controlled inputs,
  which fits inside the 5s default on an idle machine and not on a busy one. Worth fixing on a repo where a
  red run blocks a production deploy.

Migrations 0016 (daily email counter) and 0017 (subscription reconciliation) are both additive and nullable.
0016 is deliberately not backfilled: the only source to backfill from is the spreadsheet it stops trusting,
and the column governs a single day, so the worst case is one generous day at cutover.


### Phase 2 Step 7 — Second security pass, independently run (2026-08-26)

A second adversarial pass over the whole app, run without reference to the first pass's conclusions, on the
principle that the first finding in an area is rarely the worst one there. It produced eight findings, of
which one was exploitable, two were inert assertions, and one had been explicitly considered and dismissed
by the first pass.

**The exploitable one: sanitization ran before placeholder substitution.** `sendEmails` composed a body as
`renderPlaceholders(sanitizeEmailHtml(filterConditionalHtml(...)))`, so both sanitizer passes inspected the
`{{token}}` and neither ever saw the value that replaced it. `escapeHtml` covers `& < > " '`, which is
sufficient for a value landing in text and not for one landing inside an attribute the template already
opened. A saved template may legitimately carry `<a href="{{goesBy}}">`, because an href holding only a
placeholder is a relative URL and passes `sanitizeForSave`. The regression test was written first and run
against the old order, which returned `<a href="javascript:alert(1)" rel="noopener noreferrer">Details</a>`
in the sent body. Reordered to filter, substitute, sanitize. Escaping still runs first and still matters:
it keeps a value from being parsed as markup at all, so the sanitizer decides about the template's
structure rather than about structure a value invented. A second test covers an ordinary link with a query
string, because a guard that also drops legitimate links is not a fix.

**Two raw control bytes, both in security-relevant lines, both making something inert.** The first pass
recorded the NUL in `emailSend.ts`'s `pairKey` as "the right choice and not a defect". That call was wrong,
not because the separator is wrong but because a raw `0x00` makes git classify the whole file as binary:
both of Step 7's own email fixes landed as `Bin 15819 -> 22538 bytes` with no readable diff, in the one file
that builds RFC 2822 headers. Written as the six-character escape instead, byte-identical at runtime. The
second was found only by running the client lint: `csp.test.ts` held a raw `0x08` where a word-boundary
escape was meant, so the regex read as a literal backspace followed by `https:`, matched nothing, and the
negated assertion guarding the image policy against a bare `https:` allowance passed unconditionally. It
also failed eslint's `no-control-regex`, so CI's client job could not have gone green and none of the
thirteen pending commits would have deployed. A sweep of all 351 tracked text files now finds no control
bytes at all.

The general lesson, and it generalizes past this codebase: **a raw control byte is invisible in review, and
in a test it converts a guard into a decoration.** Both instances here sat in code whose entire purpose was
to constrain something. Neither would have been found by reading.

**The global rate limiter was keyed on `req.ip`.** It mounts ahead of `requireSession` so it cannot read
`req.session`, and with `trust proxy` unset `req.ip` was the platform proxy for every caller, collapsing the
whole app into a single 600/minute bucket where one busy teacher throttles everyone else. It now keys on the
signed session cookie, hashed, falling back to the IP subnet. The hash rather than the id so a replayable
session id never enters the limiter's key space, and the two branches are prefixed so a session hash and an
address literal cannot share a namespace. A validly signed cookie for a dead session deliberately still gets
its own bucket: such a request is bounded here and then refused by `requireSession`, where skipping the
limiter for it would leave one stolen expired cookie able to spend unbounded 401s.

**Smaller findings.** `assertProductionConfig` warned and started; it is now fatal when
`NODE_ENV=production` and warns elsewhere, so a half-configured laptop stays inspectable while a production
process that cannot serve a sign-in refuses to boot instead. The Stripe webhook is mounted ahead of the
global limiter so the raw body survives, which left it with no limit at all in front of an HMAC over up to
100kB of unauthenticated input; it has its own generous IP-keyed limiter now. `AuthError` looked up
`FAILURES[code]` with a nullish coalesce, so `?code=__proto__` reached an inherited property and rendered a
card with no title and no message; guarded with `Object.hasOwn`. The three GitHub Actions are pinned to
commit SHAs, and `digitalocean/action-doctl@v2` turned out to be a **branch** rather than even a floating
tag, on the step holding the token that deploys production.

**`TRUST_PROXY_HOPS` was measured and is now `2`.** Measured through `GET /api/internal/forwarding` twice,
once normally and once with a forged `X-Forwarded-For`, and the second reading is what settles it. The chain
is one Cloudflare edge plus one DigitalOcean internal router, so the caller sits at index 2 and the forged
value at index 3. Counting header entries would have given the right answer on the clean reading and the
wrong one under a forged request; the number that is actually fixed is how many infrastructure hops append.
Verified against the running process afterwards: with a forged header present, `ip` is still the real
address. Both hostnames, the apex and the `*.ondigitalocean.app` default ingress, sit behind the same
Cloudflare layer, so there is no shorter chain to bypass through. Confirmed that nothing in the server reads
`req.protocol`, `req.hostname`, `req.secure` or the host header, so raising `trust proxy` opened no
forged-host or forged-scheme surface alongside the intended change.

**A deployment fact discovered while applying it, and it is the most reusable thing here.** `.do/app.yaml`
is not what production runs. The live spec was missing four variables the file declares, and CI's deploy
step runs only `doctl apps create-deployment`, which redeploys the existing spec rather than applying the
file. Editing `app.yaml` and pushing therefore changes no configuration while still triggering a full deploy,
because `.do/**` is not in ci.yml's `paths-ignore`. Applying config means pulling the live spec, editing it,
and applying that; the secrets come back as encrypted `EV[1:...]` blobs which App Platform accepts verbatim,
where `.do/app.yaml`'s `${SECRET}` placeholders would be written literally over the real values. Note also
that `doctl apps spec validate` without an app id validates the spec as a *new app*, where encrypted values
are rejected, so it errors on a perfectly good spec; `--schema-only` is the usable form.

This interacts with the fatal assertion above and the interaction is the part worth remembering: adding a
required environment variable is now a two-step change with an order that matters. Set it in DigitalOcean
first, then deploy the code that requires it. Reversed, the deploy fails, though it fails safely, since App
Platform keeps the old instance when the new one fails its health check.

**What the pass confirmed sound**, listed because each is a place it went looking. Multi-tenancy is derived
entirely from `session.googleSub` through `resolveSheetsContext` with no client-supplied sheet id anywhere.
Cache namespacing holds. Every SQL statement is parameterised and every A1 range is built from the closed
`TabName` union. `dangerouslySetInnerHTML` and `innerHTML` appear nowhere outside inert `DOMParser`
documents. The CSRF check is constant-time and mounted router-level. The operator gate answers 404 with no
`NODE_ENV` half, and the dev toggles have both halves. The Stripe webhook verifies before reading and orders
on `event.created`. No secrets are committed and `npm audit` is clean in both packages. There is no
prototype-pollution path through `placeholderValues`, whose inner keys are constrained by the
`placeholderKey` regex.

Nine tests were added. Two of them were run against the pre-fix code and confirmed to fail, which is the
only way to know a regression test is real; the standard Step 7 set for itself and worth keeping.

### Step 8 — Re-measuring the working set, and settling the email log archive

A step with no product surface: two capacity questions the project had been answering from memory, asked
again against the code as it actually stands, and closed.

**The harness had to be repaired before it could be believed.** `measure-working-set.mjs` still built the v4
fixtures it was written against in 6d, so every number it produced described a schema three versions gone.
Brought to the current shapes: attendance is exceptions plus class-day markers cached as an
`AttendanceSnapshot` rather than a row per student per day, with the loader's per-read string interner
modelled because it is a large part of what the entry costs; `groupings` caches a `Map<string, Grouping>`
rather than a list; `groupingConstraints` is cached and was absent from the harness entirely, so the working
set had eight entries and the script measured seven; `CourseRecord` carries `archivedAt` rather than an
`archived` boolean; and `AttendanceRecord` no longer carries `createdAt`/`updatedAt`.

**It also had to change how it measures, which was not anticipated.** Under the new fixtures one teacher's
whole working set moves the heap by less than half a megabyte, which is inside the noise of a `global.gc()`
pair — the first run reported *negative* heap for attendance and for groupings, and a negative weighted mean
per row. It now measures a batch of independent teachers and divides. That in turn needed a second
methodology rule alongside 6d's JSON round-trip: **every identifier and class name is salted per teacher**,
because V8 internalises strings across `JSON.parse` calls and twenty copies of one teacher would share one
set of strings, understating what twenty real teachers cost. Dates are deliberately left unsalted, since
teachers genuinely do share a calendar and that sharing is production behaviour rather than an artifact.

**The result: 0.43 MB per teacher, reproducible to two decimal places across runs, against the 8.0 MB the
project had been carrying.** An 18.6x fall, and the "stale by roughly an order of magnitude" note in
NEXT_STEPS was right about the size of the error. Attendance is 0.29 MB of the total rather than 98% of it;
the per-resource spread is 106 bytes per row (attendance, whose strings are pooled) to 887 (email templates,
which carry a body). On the same unfavourable profile and the same 512 MB usable-old-space assumption that
produced the old figure, this is roughly **1,180 concurrent working teachers per 1 GiB instance rather than
64**, which settles `instance_count: 1` at launch with no argument needed.

`ESTIMATED_BYTES_PER_ROW` moved from 400 to 200. The measured weighted mean is 141, and 200 is deliberately
above it: the constant is a fail-safe bound rather than an accounting of what is resident, so the direction
of the error matters, and the margin covers a teacher whose footprint is roster-heavy and attendance-light.
At 400 it was 2.8x conservative, which cost nothing at launch scale but made `MAX_CACHE_BYTES` bind at about
a third of true capacity. Two tests in `cache.test.ts` had the old 400 baked in as a magic threshold and now
express the same assertions against the constant, which is what they were always about.

**The `emailLog` rolling archive, the step's other half, was not built.** The conclusion and its arithmetic
are under Decisions Made below. Briefly: the step's own premise did not survive being checked. The archive
was scoped to keep two readers fast, and `grep` finds neither — Step 7 moved the daily cap to a Postgres
counter, and the audit view was never built, so the tab is written by one call site in `emailSend.ts` and
read by nothing in the app, not the client, not a route, not class archiving, not bootstrap's header pass.
It moved to Phase 3 as a candidate with a stated trigger.

A stale comment was fixed on the way past: `config/email.ts` still described the daily cap as "enforced
against the emailLog `sent` count", which Step 7 made untrue and which is exactly the sentence that would
have kept the archive looking necessary.

### Phase 2 Step 8c (in progress) — Advertised-feature corrections, and the sending-domain runbook

**The two advertised-and-unbuilt features were corrected in the public copy**, discharging the standing
obligation that had been waiting for the Marketplace listing to make it urgent. The pricing table's Name
Picker row said "Card, Wheel and Marble Race" for Premium against "Card and Wheel" for free; with Marble Race
a Phase 3 candidate the row no longer differs between plans at all, so it moved out of `DIFFERS` and into
`SHARED` as "Name picker, in card deck and wheel modes", which is what both plans actually get. The prose
lists above it already described it correctly and needed no change. The landing hero's
"make groups and seating plans" became "Easily track attendance and communications, make groups, send mass
emails, and more." The second sentence and the `<br />` that separates it are untouched, since the reason for
that break is about the ownership claim rather than about the first sentence.

**The sending-domain runbook, with one documented trap corrected.** NEXT_STEPS had recorded that Resend's
SPF record would have to be merged into the apex record Cloudflare Email Routing wrote for `privacy@` and
`support@`, on the correct general rule that a domain may hold only one SPF TXT record. Checked against
Resend's own Cloudflare guide and against live DNS on 2026-08-27, that does not apply here: **Resend's SPF
and its bounce MX both go on the `send` subdomain**, because SPF is evaluated against the Return-Path, which
defaults to `send.teachneat.com`. The apex record (`v=spf1 include:_spf.mx.cloudflare.net ~all`, confirmed
live) is not involved, and editing it would have broken inbound routing while fixing nothing. The general
rule survives with its scope corrected: one SPF record per *hostname*.

The records to add at Cloudflare, all with the proxy set to DNS only, values copied from the Resend
dashboard rather than from here:

| type | name | value | note |
|---|---|---|---|
| MX | `send` | `feedback-smtp.<region>.amazonses.com` | priority 10; bounce and complaint feedback |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | same hostname as the MX above |
| TXT | `resend._domainkey` | the key from the dashboard | DKIM; DNS only, or Cloudflare error 1004 |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@teachneat.com` | a dedicated address, not `privacy@` |

DMARC alignment works out without further configuration: DKIM signs `d=teachneat.com` and aligns strictly,
and SPF authenticates `send.teachneat.com` against a `From:` at the apex, which is relaxed alignment and
passes under the default `aspf=r`.

**No code change was needed to turn email on.** `createMailer()` needs `RESEND_API_KEY` and
`LIFECYCLE_EMAIL_FROM` both non-empty, neither is checked by `assertProductionConfig`, and so setting them on
the live App Platform spec is an ordinary configuration change rather than the two-step ordering hazard a
required variable would be. `LIFECYCLE_EMAIL_FROM` should be an address that receives as well as sends —
`support@teachneat.com` already routes to a real inbox — because a teacher replying to a trial-expiry notice
should reach a person rather than a bounce.

**The sending domain was verified and outbound email went live**, which was the point of the runbook. The
records went in at Cloudflare as described, all three of DKIM, SPF and DMARC report `pass`, and
`RESEND_API_KEY`, `LIFECYCLE_EMAIL_FROM` and `OPERATOR_ALERT_EMAIL` were set on the live App Platform spec
through the console rather than the CLI, which keeps the key out of a shell history. Production restarted at
`2026-08-28T00:25:52Z`. The first verification message landed in spam, which is what a domain with no sending
history earns from consumer Gmail and not a configuration fault; a real lifecycle message, with a real
subject and both text and HTML parts, reached the inbox.

**DMARC's `rua` address was moved off `privacy@`.** The first draft of the runbook pointed aggregate reports
at `privacy@teachneat.com`, which is published in the privacy policy as the channel for teachers' privacy
requests. Burying that inbox under daily XML from every mail provider is a bad idea; a dedicated address
routed to the operator is the fix.

**Turning the key on drained the queue, and that is now a standing rule.** A welcome message arrived for an
account nobody remembered creating. `createMailer()` had been returning null in production, and the dispatch
sweep leaves rows queued rather than sent or discarded, so every welcome message for every account ever
created on production had been accumulating in `lifecycle_emails` since launch. The claim query orders by
`queued_at` with no age cutoff, deliberately, so enabling the provider and flushing the whole backlog were
the same action. The blast radius was one operator inbox because there are no real users; the two trial
scans are window-bounded and did not fire retroactively. The general rule went to the deployment section of
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Worth recording that the consequence was already written
down in NEXT_STEPS before it happened, in the sentence "a later deploy with a key delivers them", and was
read without being connected to the act of setting the key.

**Board allowlisting moved to Phase 3 and a Step 10 was added.** Reasoning under Decisions Made below.


### Phase 2 Step 8d — The data-handling claim, corrected

An accuracy pass over one sentence, scoped to the two internal statements that were wrong and the one
user-facing summary that overstated. `CLAUDE.md` had already been corrected when the step was planned, so
the work here was the remaining three items.

**`ProductShots.tsx` said the central claim is "that student data never reaches us".** It is not: every read
and write transits the server, because the server is what holds the token and calls the Google APIs; the
working set holds a teacher's roster in process memory under the two clocks in `config/cache.ts`; and email
personalisation substitutes student names server-side. The comment now states the durable-copy claim, and
the inference it was there to justify gets stronger rather than weaker: a real student name checked into a
marketing asset would be exactly the durable copy the claim denies.

**The privacy policy's administrators section opened with "the vendor holds no student records".** That is
defensible on a reading of "holds" as durable custody and false on any other, and it is the first sentence a
technical reviewer tests. It now reads that the vendor keeps no durable copy of student information and that
none is written to the database, the logs or the backups. The rest of the paragraph is unchanged; the
semicolon list it leads was already accurate.

**A test holds the phrasing**, in the same block as the scope enumeration and the Limited Use statement, and
for the same reason: these are sentences whose loss breaks nothing at runtime and costs a review months
later. It asserts the durable-copy sentence is present, that the old wording is not, and that the leading
section's "a short-lived copy sits in our server's memory" is still there, because the durable-copy claim is
only honest beside the sentence that concedes the transient one.

**The consent version was not bumped, and the reasoning is recorded in `legalMeta.ts`** beside the
precedent it follows. The change makes a summary line consistent with the body that already governed it;
nothing changed about what is collected, why, where it goes, or who touches it, which is the test the
contact-address non-bump was judged against. Step 8a is the substantive change to both documents and is the
one that re-prompts, so batching behind it also follows the Step 6h ordering note.

**`YourDataPage` was left alone deliberately.** Its "your students' information is not stored on our
servers" is the same defensible-on-"stored" construction, but the page is addressed to a teacher managing
their own data rather than to a reviewer testing a claim, and 8d was scoped to one user-facing line. Worth
revisiting only if the phrasing is ever quoted at a board.

### The lifecycle email shell (2026-08-28)

A review of the six Step 6h messages that started as a read-through of the copy and ended in the markup.
The copy came out well and is unchanged: reassurance-first at the end of a trial, no urgency, no discount,
no countdown, no figure except in the one message whose purpose is that a first charge is not a surprise.
**What was wrong was that none of it looked like it came from a company.** The messages were a single
`<div>` with a `max-width`, signed with the word Teachneat in 13px grey, which reads as mail from a person
and would have been the first impression of the product for a teacher who had never seen anything from it
before.

**The shell is typographic, and that is the decision worth carrying.** The obvious way to brand an email is
a logo at the top, and the obvious way to put one there is an `<img>` at a URL we serve. That request
carries the recipient's IP, the time they opened it and their client, which makes it an open beacon whether
or not anyone ever reads the log, and the privacy policy states that the product uses no tracking pixel.
The alternative that keeps the mark is an inline CID attachment, which makes no request at all, but several
clients then flag six messages that carry no attachment as having one. So the masthead is the wordmark set
as type: the same weight split as `Wordmark.tsx`, 650 on "Teach" against 400 on "neat", at the same
negative tracking, with clients that cannot resolve 650 rounding it to bold and keeping the split rather
than losing it. **A test asserts the HTML loads nothing from the network** — no `img`, no `url(`, no `link`
or `script` — so the beacon cannot arrive later as a well-meant one-line improvement.

**Tables, and a full document, both for reasons that only show up in clients nobody develops in.** Outlook
for Windows renders with Word's engine, which ignores `max-width`, so the previous messages ran the full
width of the window there and the fix is the `mso` ghost table rather than any amount of CSS. The
`color-scheme` meta tags that stop Apple Mail and Outlook.com auto-inverting the palette need a `<head>` to
sit in, which is what turns the output from a fragment into a document. The palette is a `PALETTE` constant
of the light-mode DESIGN_SYSTEM values, since an email has no tokens and no theme; links take `#1a5fb4`
because the accent fails WCAG AA as text, which is a standing rule that does not stop being true in an
inbox, and the accent appears exactly once, as a 3px edge.

**The footer is the part that actually reads as official**, and it is also an obligation. CASL exempts
these six from consent and from carrying an unsubscribe mechanism, because each is tied to an account the
teacher opened, but the identification requirements are separate and the exemption does not lift them: the
old footer was one word. It now carries why the message arrived, then Account settings, Contact and Privacy
policy, then the postal address once there is one. `FOOTER_REASON` is a total record over the message type
for the same reason `RENDERERS` is, so a seventh message type is a compile error rather than a message that
reaches a teacher with no explanation of why they are being written to. The deleted account gets no account
link, since there is no account, and its line ends by saying it is the last message that address will
receive.

**A drafted second sentence was cut on review**: "This is a service message about your account, not
marketing." A recipient who needs telling is not reassured by being told, and the sentence invites the
question it answers.

**None of the six templates changed.** The renderers now return a subject and its paragraphs rather than a
finished message, and the shell is composed one level up in `renderLifecycleMessage`, which is the only
place the message type is known. The templates stay lists of sentences that never see markup, and both
bodies still come from the one list, so the plain-text and HTML parts cannot say different things.

**The preheader is derived rather than written.** Every one of the six previewed in the inbox as "Hi
Sarah," until now, spending the most-read line in the message on the one word carrying nothing. Six new
lines of copy would drift from the bodies they summarise; the second paragraph, truncated at 140 on a word
boundary, cannot, and it means the dated and undated branches each preview the sentence they actually sent.

**`OPERATOR_POSTAL_ADDRESS` ships empty and the footer omits the line while it is**, because a placeholder
address is worse than an absent one. Setting it is a one-line edit, and it waits on the business-name
registration in 8c, where the remaining gaps are now recorded: that address, a display name and `Reply-To`
on the sender, and a privacy-policy paragraph describing the footer. The tier-naming correction the review
also turned up — "free plan" where the term is "free account", and `trial_ending` never naming Premium —
went to 8a instead, since that step disables both messages and is where their copy is open anyway.

- **Tests:** server **707 pass** (5 added). Typecheck clean.
- **Not covered by tests:** how any of this renders in a real client. The suite asserts the ghost table and
  the meta tags are present, not that Outlook honours them.


### The lifecycle email shell, finished (2026-08-28)

A review pass over the branded shell from earlier the same day, which found one defect the shell had made
more visible rather than less, and closed the code half of the three gaps that step left open.

**Five of the six messages had an unclickable call to action.** The templates write their calls to action as
sentences with the address spelled out — `Open the app: https://…`, `Manage your subscription: https://…` —
because both bodies are generated from one list of paragraphs and the plain-text part needs the address
readable. `toHtml` escaped each paragraph and stopped there, so in HTML those lines were text. The footer's
links were anchored and the body's were not, which is the wrong way round: the footer is boilerplate and the
body line is the reason the message was sent. `paragraphHtml` now linkifies per segment, escaping the prose
and the URL separately so the URL is escaped once for the attribute and once for the visible text, with
trailing sentence punctuation split off the address. The link colour is stated rather than inherited,
because a client's default anchor colour is not ours to pick.

Three tests hold it: that every URL in a message's own body appears as an `href` in its HTML, that a name
that looks like markup is still escaped when it shares a paragraph with a link, and that trailing
punctuation stays outside the href. The first was checked against the old renderer and fails there, so it is
testing the fix rather than restating it. The name is the one thing in these messages the project does not
author, which is why it is the injection fixture.

**`reply_to` is now sent when configured.** `LIFECYCLE_REPLY_TO` is optional and the field is omitted from
the Resend payload when it is empty, rather than sent blank — a message advertising a reply address of
nothing is worse than one that quietly replies to `from`. Being optional, it carries no deploy-ordering
hazard. The point is to decouple two addresses chosen on different criteria: the from address is picked for
deliverability, the reply address for reaching a person, and a teacher answering a trial notice is the
likeliest first contact anyone makes with this product.

**The display name needs no code.** `LIFECYCLE_EMAIL_FROM` accepts `Teachneat <address>` directly, so that
gap is a console value rather than a change. Both it and the reply address are recorded in 8c with the
postal line, which still waits on the business-name registration.

**Footer link hrefs are escaped**, which they were not. They are built from `env.clientOrigin` and operator
configuration rather than from user input, so this closes a quoting bug rather than an injection.

**Noticed and routed rather than fixed here:** `trial_ending` and `trial_ended` list "IEP information" among
what survives the trial, and 8a removes IEP from the product. That sentence has to move in the same pass as
the tier-naming correction already assigned to 8a, and it is the same failure mode — copy nobody reads while
the message is dormant, sent to everyone on the day it is not.

Server 711 pass, 4 added.


### Phase 2 Step 8a — Launch scope reduction

The step that decides what the product is, ahead of every step that describes it to somebody. Ontario only,
free to every account, and no IEP. Six commits: server IEP removal, the billing flag, client IEP removal,
the client affordances, the email cap, the public surface and consent bump, and a follow-up on the terms.

**IEP is deleted, not flagged, and that changed from the plan.** IMPLEMENTATION_PLAN specified a build flag
with the test suites kept and skipped. The user's instruction this session was that the legal requirements
and risk make it not worth including at any point on the roadmap, so it came out entirely: `services/iep.ts`
and its 72-assertion suite, the five routes, both Zod schemas, the roster warm-up's third tab, the detail
read's second, the send path's accommodation lookup, the `hasAccommodations` condition metric, and on the
client the editor, the catalogue, the roster filter and row tags, the detail card and modal, and the API
module. Then every mention across the marketing pages, the FAQ, `/help/your-data`, `/for-admins`, the
feature showcase, the product shots and both legal documents.

**The `iep` tab stays in the sheet.** Removing it would need a `schemaVersion` bump and a non-additive
migration decision about tabs already carrying a teacher's rows; leaving it costs one unused tab and
preserves what a teacher wrote, on their own Drive. A comment on the tab and a rewritten SHEETS_SCHEMA
section both say nothing reads it and not to build against it.

**Two measured costs moved.** A cold roster load went from three Sheets reads to two, and a cold
student-detail open now reads nothing when the roster is resident. Both suites assert the new numbers rather
than the old, including the baseline they are compared against.

**Billing is switched off behind one function.** `BILLING_ENABLED` defaults to false. `resolvePlan` is
untouched; `resolveEffectivePlan` beside it returns `paid` while the flag is off and is the single point the
reduction acts through, so `requirePremium`, `isPremium`, `effectiveHighAbsence`, the grouping constraints
flag and the email monthly cap all resolved to full access with no edit of their own and cannot disagree.
`requirePremium` short-circuits before its body so no `premiumAttempt` milestone is recorded against a wall
nobody can meet.

**The flag is a function reading `process.env` rather than a field on `env`**, which resolves once at import.
Production behaviour is identical; what it buys is a suite that exercises both directions. The entire
premium boundary now ships dormant, and dormant code comes back broken unless something exercises it, so the
suites describing the paid product declare `withBillingEnabled()` and the launch behaviour is asserted beside
them rather than replacing them.

**The lifecycle scan guard went in `dispatchLifecycleEmails`, not the pg store.** The pg store's scan has no
test at all — it needs a real database — so a guard inside it would have shipped unverified. In the sweep it
holds for every store implementation and is asserted with a counting fake.

**The `/me` profile withholds rather than falsifies.** `billingEnabled` is added and `trialEndsAt`,
`lapsedFrom`, `paused`, `pauseResumesAt`, `promoEndsAt` and `currentPeriodEnd` are omitted entirely. A
`trialEndsAt` on every profile is a date the client has to know to ignore.

**The client learns it from the profile, not from `plan === 'paid'`.** A comped account is also `paid` and
should still see that Premium exists. `EntitlementsProvider` takes `billingEnabled` as a **required** prop:
its two call sites want opposite defaults — the app renders the launch shape, the test harness describes the
product that returns — so any default would be silently wrong for one of them. The sidebar plan footer
returns null entirely rather than emptying, border included; an emptied bordered block is a rule drawn across
the sidebar with nothing under it. The eight gated surfaces needed no edit, verified by reading each.

**One thing was wrong rather than merely dormant.** The email quota chip showed the daily figure while the
tooltip beside it said sending more than 30 a month is part of Premium, because the server omits the monthly
cap when it does not apply. The two disagreed the moment the flag flipped. The sentence now keys off the same
value the chip reads.

**The daily email cap dropped from 200 to 120** on the user's instruction, mid-step. Three server assertions
named 200 as a literal and now derive from `EMAIL_DAILY_CAP`. `MAX_RECIPIENTS_PER_SEND` stays at 200 and now
exceeds the cap deliberately, recorded on the constant so it does not read as a mismatch.

**The pricing page kept its route and lost everything else.** No figures, no tiers, no comparison table. The
nav, the terms, the FAQ and the welcome page all point at it, and answering "what does this cost" with a 404
reads worse to a Google reviewer and a board administrator than answering it plainly. It says free during
early access and that a paid plan would be announced first — the thing a teacher moving a year of attendance
data in actually needs to know, and the promise the page must not overreach on.

**The terms name no category of student information at all**, which took two passes. The first kept the
consent warranty's caution about accommodation and health-related information on the grounds that a teacher
can still type it into a note field. The user's correction was that naming a category in the one clause
governing what may be recorded reads as confirmation that the Service is a place to record it, which is
exactly what removing IEP was meant to stop implying. The warranty is general instead and slightly stronger:
consent for anything entered, before it is entered, remaining in effect for as long as it is recorded, plus
an acknowledgement that the Service is represented as suitable for no particular category of information and
for no regulated purpose.

**Stripe removed as a subprocessor**, and from the terms' dependency list and the `/for-admins` bullet. The
user asked whether keeping it would spare a future re-verification when billing returns; it would not.
Google's OAuth verification keys on scopes, branding and the policy's URL rather than its contents, and a
board's allowlisting keys on the OAuth client id and its scopes, so a subprocessor change re-enters neither
queue. That reasoning is recorded in `legalMeta.ts` with the verbatim entry to restore, and flagged as
process knowledge with a shelf life for 8c to confirm.

**The scrub is guarded by a sweep test** across five public pages plus the terms. The reason is that this
copy reads plausibly with the mentions left in — "accommodations" sits unremarkably in a list of what a
roster holds — so a stray one survives any review not specifically looking for it.

**The consent version bumped to `2026-08-31`** and re-prompts, on four counts.

Server 712 pass, client 396 pass.

### Phase 2 Step 8b — The three conditions coverage is written against

The three things an underwriter commonly makes a condition of tech E&O and cyber cover, done ahead of the
insurance conversation in 8c: an audited list of administrative accounts and their second factors, a
written incident response plan, and a database restore actually performed and timed. Worked 2026-09-10 to
2026-09-11. No application code changed, so neither test suite was run; the one new script was typechecked
standalone and its guards exercised without a database.

**Found before starting: 8a was already live.** NEXT_STEPS and CLAUDE.md both said 8a was committed but not
pushed. `origin/main` was at 8a's last commit, CI had passed on 2026-08-31, and `/api/health` showed a
process start five minutes after the push. Both documents were corrected, which also unblocks the OAuth
demo video.

**The deliverables live in `ops/`**: `INCIDENT_RESPONSE.md`, `ADMIN_ACCOUNTS.md` (the Administrative Account
Register) and `RESTORE_TEST.md` (the Database Backup and Restore Procedure with its test record). They were
first drafted in the working documents' voice and then rewritten at the user's instruction for third-party
readers: no reference to phases, steps or planning documents, no commentary, a document-control header on
each, and only remediation items the operator has decided. The two legal questions the draft carried inline
moved to 8c's list in NEXT_STEPS for that reason.

**The incident plan's token-compromise section is written but unrehearsed.** It states the intended
procedure (rotate the OAuth client secret add-then-disable, revoke and clear the stored tokens, disable the
KMS key where both could be exposed) and says plainly that it has not been rehearsed. 8f's rehearsal is
what changes that sentence.

**`server/scripts/check-restore.ts`** counts rows in every public table and decrypts every stored refresh
token under a ring built the way `initTokenCipher` builds it, printing counts only. It connects only to
`RESTORE_DATABASE_URL`, refuses a value equal to `DATABASE_URL`, and refuses a TLS connection string with no
CA with a message saying so, rather than the certificate-chain error the first real run hit.

**The restore passed.** The 2026-09-10 09:50 UTC daily backup was restored to a scratch cluster in `tor1`,
provisioned in 6m 06s and verified about ten minutes after the start, a figure that includes one repeated
step. Every table was present and the one stored token decrypted under `k1`. The production baseline was
not taken: the session's permission classifier refused fetching production's connection string, and the
operator ran the check with the scratch cluster's credentials loaded into their own shell rather than
routing them through the session. `doctl databases create` defaults to `nyc1`, so the procedure pins
`--region tor1`; a copy of production in New York would contradict the privacy policy. The scratch cluster
was deleted the same day.

**What the audit found.** Every account has an authenticator-app second factor, and the operator removed
SMS from the Google account that owns the Cloud project and receives every password reset. CI's
DigitalOcean token is already scoped to App Platform. Resend offers no backup factor, recorded as an
accepted exception. The weak point is the operator's desktop: Windows 10, whose consumer security updates
end on 2026-10-13, no disk encryption, a password-only sign-in, and holding the GitHub CLI token, a
full-access `doctl` token, the KMS service account key and every account's backup codes. The operator first
decided to move to Windows 11 and to regenerate the backup codes; on 2026-09-11 that changed to moving the
codes to removable media held elsewhere, with the Windows 11 upgrade planned but undated and the unencrypted
disk recorded as an accepted exception.

**Two findings routed to 8f.** The KMS service account has exactly one key, so the desktop and production
hold the same credential, and the restore proved it decrypts production's tokens. The key also lives in a
Cloud project named `teacher-toolkit-dev`.

**Also this session, outside 8b:** the Phase 3 attendance-automation candidate's 2026-09-09 lever expansion
was committed, with the decision that a due cadence rule is evaluated on the teacher's next visit rather
than by a background job.


### Marketing copy — the cost subject gated out of the public surface

2026-09-11, at the user's instruction and outside any numbered step. Client only; 399 client tests pass and
the build is clean.

**The product shot.** The Students detail panel in the feature showcase gave its example student a second
course of "Grade 11 Biology" alongside Grade 9 Science, in the header and again in the Academic Risk card.
Both now read "Grade 9 Art", which is a combination a real timetable produces.

**`client/src/config/publicBilling.ts`** is a single build-time constant, `PUBLIC_BILLING_VISIBLE`, false.
It is a constant rather than a value from the server because the pages it guards render outside
`AuthProvider` and deliberately cost no `/auth/me` round trip. Gated behind it: the `/pricing` route, which
now redirects to the landing page rather than 404ing; the Pricing entries in the marketing nav and footer;
the showcase's "Every tool above is included with every account, at no cost while Teachneat is in early
access" note and its "What that means" link; the FAQ's "See pricing" footer; and the billing-retention
sentence in the data documentation. The landing page's two calls to action read "Create your account"
rather than "Create your free account", and its closing line is "Registration and setup is quick and easy"
with the "every feature is included from the first day" clause dropped.

**Three pieces were gated and then restored the same day, at the user's instruction**: the landing page's
three points beside the closing call to action, the FAQ's "What does it cost?" question, and the
`/for-admins` bullet about payment. The line that emerged is where the reader is. Each of the three answers
a question its reader already has at the point of reading — a teacher at the button, a teacher who went
looking, a board privacy officer asking who touches the data — while what stayed gated volunteered the
subject to someone who had not asked. The FAQ entry is now the only place the product answers what it
costs, the pricing page having been the previous answer.

The welcome page's "Premium is unlocked" card gates on the account's `billingEnabled` instead, being inside
the app where that flag is available, and the section it sits in drops to one column without it.

**Nothing was deleted, and the reason for the flag is the restore.** The `PricingPage` component and every
assertion about its copy are kept, because the copy is what the flag is holding back. Whoever sets the flag
rewrites that page first: what it currently says is that there is no paid plan.

**The legal documents were left alone.** The privacy policy's plan and billing fields and the terms' price
and payment section are disclosure rather than pitch, and a reader is worse served by their absence.

**This reverses 8a's reasoning about the pricing page**, which kept the page routed so that "what does this
cost" was answered plainly rather than with a 404. The objection is that every sentence of that copy named
a paid plan, a card, a trial or a premium tier in order to deny it, which raises the question for a reader
who did not have it. IMPLEMENTATION_PLAN's Step 8a records the reversal in place.


### The session-ended screen was a dead end, and a loop

2026-09-11, found while the user was signing in to a local build. Client only; 401 client tests pass.

**The loop.** `GET /auth/me` reads the session row and the account row and never touches Google, so an
account whose refresh token has died — revoked in the Google account, or a local build pointing at a
different OAuth client — gets 200 from it and `REAUTH_REQUIRED` from the first tool request. The 401 puts
`AuthProvider` into `sessionEnded`, which replaces every in-app route including `/`. Reloading repeats the
same sequence and lands back on the screen. The only exits were signing in again, which re-consents and
works in the ordinary case, and clearing cookies by hand. The session cookie was never cleared, so nothing
had actually signed the teacher out; the user reached the marketing pages by signing in in order to sign
out.

**Two changes.** Entering `sessionEnded` now fires `POST /auth/logout`, best effort, which destroys this
session only and clears the cookie, so the next `/auth/me` is a 401, which is `unauthenticated`, which is
the landing page. `DELETE /auth/sessions` would have been the wrong call: a dead Google token on one device
is not a reason to sign a teacher out of their others. A ref guards against the cleanup running twice, since
parallel requests each notify and the logout can notify again, and it is re-armed whenever a session is
established. The CSRF token is already cleared by `api/client` before it notifies, so the POST is rejected
once and replayed by the client's own stale-token retry; two round trips once per dead session is cheaper
than holding the token somewhere to avoid them.

The screen also gained a "Back to the home page" link beside the sign-in button. It was one button on a page
with no header, no footer and no route to the FAQ, the contact form or `/for-admins` — all of which
`/auth/error` already offers, which is the page a teacher whose board blocked the app would rather be on. A
plain anchor rather than a `Link`, because this component is what renders at `/`, so a client-side
navigation there re-renders the same screen and looks broken.


### The attendance tests failed on a Saturday

2026-09-12. The CI run for the session-ended fix went red on four tests in
`AttendancePage.test.tsx`, a file that session had not touched.

**The cause is the runner's clock, not the code.** The entry view opens on today and disables every
control at weekends, and `todayIso()` reads the machine's local date. CI runs in UTC and the operator is
UTC-4, so a push at 21:25 on the Friday arrived on a runner where it was already Saturday: the page came up
read-only, `aria-pressed` was false on every status button, and Save never fired. The window is every
Friday evening to Sunday evening local, which is wide enough to be hit and rare enough that nothing in the
suite had said so — the previous green run went out on a Friday at 01:40 UTC. Reproduced locally with
`TZ=UTC npx vitest run`, which is the whole diagnosis in one command.

**The fix pins the clock for that file** to noon UTC on a Wednesday, faking `Date` alone so `waitFor` and
`userEvent` keep real timers. Noon rather than midnight so the local calendar day is the same weekday in
every timezone the product plausibly runs in. The three other date-sensitive test files passed on the same
runner and were left alone.


### The deploy job waited 23 minutes on a deployment that was already live

2026-09-12, immediately after the attendance-clock fix. Both check jobs passed, the deployment succeeded,
and the run was red anyway.

**What happened.** `digitalocean/action-doctl` is pinned to a SHA, but its `version` input defaults to
`latest`, which it resolves by asking the GitHub releases API — unauthenticated, from a shared runner IP.
That request came back `403 API rate limit exceeded` and the action fell back to **doctl 1.98.1**, a 2023
build whose `apps get-deployment --format Phase` prints `<nil>` rather than the phase. The watch loop's
terminal cases never matched, the phase was not `BUILDING` either so the stall detector stayed disarmed,
and the only thing left to end the wait was the 1500-second attempt cap — after which the job would have
created a **second deployment of an unchanged commit**, restarting production to recover from nothing. The
run was cancelled at 02:10:44, about ninety seconds before that. Deployment `9d1c6de0` had gone ACTIVE 8/8
at 01:50:00 and production had restarted at 01:49:13; the push was live the whole time the job was
watching it.

**Two changes.** `version: 1.167.0` is pinned on the action, which removes the lookup entirely: no request
to be rate-limited, no fallback to land on. Bumping it means checking that `apps get-deployment --format
Phase` still prints a bare phase, which is the one string the loop reads.

And the loop now checks that string against the set of phases App Platform actually reports. Five
consecutive unrecognised answers — `<nil>`, an empty string, anything — fail the step in about a hundred
seconds with the doctl version in the error, and **do not trigger the retry**: the retry exists to clear a
wedged deployment, and creating one here would restart production on the strength of a string the loop did
not understand. Five rather than one because a single empty answer is an ordinary API blip that the helpers
are already written to absorb. The wedge detector and the ordinary `ERROR`/`CANCELED` retry are unchanged,
both verified against the extracted script with stubbed helpers.

The general lesson, which the step's comment block now carries alongside the two DigitalOcean-side hangs it
already documented: this one was the loop's own fault. It trusted a string it had never checked, and a
phase that cannot be read is a reason to stop and look rather than a reason to touch production.

### Step 8c — the `spreadsheets` scope dropped before the OAuth submission

2026-09-12. Drafting the scope justification for verification raised the question a reviewer asks first,
whether a narrower scope would do, and for `spreadsheets` the code said yes. A live test with the grant
revoked confirmed it (reasoning under Decisions Made). `GOOGLE_SCOPES` is now `openid`, `email`,
`profile`, `drive.file` and `gmail.send`. The privacy policy's permissions section lists two data scopes
and says `drive.file` covers reading and writing the sheet; the administrators summary and `/for-admins`
say the same. The version change came with the accuracy sweep below. A new
`googleAuth.test.ts` pins the exact list, which the `publicInfo` test's comment had already claimed existed
and did not. Existing grants keep the extra scope until the account next signs in, and nothing reads it.

### Testing feedback — Phase 3 additions and a UI rework

2026-09-13. A batch of changes from user testing, none of them a numbered step.

**Planning.** Two Phase 3 entries, and Phase 3 split into **Committed** and **Candidates**. Google Classroom
roster import is committed and high priority: on-demand, read-only (`classroom.courses.readonly`,
`classroom.rosters.readonly`, `classroom.profile.emails`, optionally
`classroom.guardianlinks.students.readonly`), scopes requested incrementally at the moment of import, no
sync, no posting and no add-ons. None of those scopes is on Google's restricted list, so the cost is a second
scope review after the 8c submission rather than CASA. Board allowlisting moved under Committed, since it was
already targeted at January 2027. A standalone notes tool (text or checklist notes, free-typed tags) was
adopted as a candidate. The class management candidate was closed once the page below shipped; deleting
classes and bulk student moves went with it rather than surviving as a smaller entry.

**One way to add students.** The roster, empty roster and first-run guide each offered a single add and a
bulk add. There is now one "Add Students" button opening the grid, retitled "Add Students", which already
handled one student. The student modal became edit-only, `?add=one` was retired, and the create-mode form
tests moved to the edit form. The one behaviour lost is being taken to the new student's detail view after a
single add.

**Class archiving became Manage Classes, with renaming.** The archive dialog became a page and then the
second Students tab, at `/students/classes`. Its design settled after two passes. The first put an Archive
and a Restore button in separate columns, which reintroduced the two opposite primary buttons the dialog's own
review had removed; the second replaced them with one sticky selection bar holding the count, the action, the
progress and the result with Undo, and brought the lists onto the table spec (select-all header checkbox,
row hover, selected tint). The explanatory line, the "started" date on current classes (it was the date the
app first saw the class) and year subheadings on the archived list (every row already carries its dates)
were all tried and removed. A leave prompt guards closing or reloading the tab mid-operation; in-app
navigation is not blocked, because the server completes the operation regardless.

`PATCH /classes/:classId` renames a live or archived class, under the account lock, touching only the tabs
on that class's side. **The rows and the course row go in a single `values.batchUpdate`, and a test caught
why that is required rather than tidy:** written rows-then-course-row like the archive move, a failure
between the two reads back through `listCourses` as an emptied class (soft-deleted) plus a new class under a
fresh id, and the retry finds nothing to rename. Renaming a live class carries the roster filter and each
tool's remembered class to the new name. An existing gap closed on the way: a teacher who archived every
class had an empty roster and no route back to restore one.

**Sub-pages became URL-backed tabs.** Attendance (Daily Entry / History / Statistics), Students (Roster /
Manage Classes) and Email (Compose / Templates) moved from segmented controls in the page header to a
`TabNav` row under it, each tab its own route, the bare path landing on the tab last used in the session.
Tried on Attendance first against nesting sub-pages under their sidebar item, which the tablet icon rail
cannot show; the rest followed once it was seen. `/` now redirects to `/students` (carrying the query
string, so `?add=bulk` still arrives) and `/classes` to `/students/classes`, and the Students sidebar item is
active on a student's detail view for the first time. `useTabRoute` reads the path rather than a route param
so the Students tabs can be static routes beside `/students/:studentId`. On Students the class filter moved
into the header and shows on Roster only, and the roster toolbar reads Sort, Alerts, Add Students; on Email
the sending allowance sits under the tabs on Compose only. The landing page's product shots were updated to
match.

**Two follow-ups after seeing the tabs.** A full-width rule under the tab row, together with the top border of
the list below each toolbar, boxed the controls between two page-width lines that read as an empty table row.
The rule went, and each tab now sits on its own 3px bar, accent when active and grey otherwise. The Templates
heading, which the tab now repeated, went too. The Email title sat higher and further left than the other
tools' for two unrelated reasons: a `PageHeader` with no control shrank to the title's line height (fixed with
`min-h-9`, which also stops Students jumping when Manage Classes hides the class filter), and Compose is tall
enough to scroll, so the centred content column shifted by half a classic Windows scrollbar against pages that
do not (fixed with `scrollbar-gutter: stable` on the document).

**Fixes from a review of the batch before it was pushed.** Roster and Manage Classes render one mounted
`StudentsPage`, so dropping the archive dialog's reload callback left the Roster tab showing the roster from
before any archive, restore or rename until the teacher left the page, and the rename's carried class filter
was reset to All by the first reload that did arrive. `ClassesView` now reports each change to the page,
which reloads the roster and moves its own filter state, and the filter fallback waits out an in-flight
reload. The regression test holds the reload open, since with an immediately resolving mock the stale render
never happens and the test passed without the fix. `TabNav`'s `overflow-x-auto` clipped the disabled
Statistics tab's tooltip (invisible only while billing is off), and the Step 3a anchoring test had gone with
the segmented control: the row now wraps instead, the tooltip anchors right, and the test is back with a
check for clipping ancestors. The move notice said "restored" after an archive that had to rename a class to keep
archived names unique; it now names the direction. The docs had described archived classes as able to share a
name, which the archive move has never allowed and which the rename's matching by name depends on.


### Step 8c — OAuth verification approved

2026-09-24. Google approved the app's OAuth verification: brand verification and the sensitive-scope
review of `gmail.send`, against the five scopes left after the 2026-09-12 reduction. The submission used
the justification in `ops/SCOPE_JUSTIFICATION.md`, a demo video walking the consent screen with the client
id visible, the Drive folder and sheet the app creates, the roster and attendance writing to it, and a send
from the Email tool arriving from the teacher's own address, and a 120px consent-screen logo generated from
`design/brand/generate.py` as `app-icon-120.png`. New users no longer see the unverified-app interstitial
and the 100-user cap is lifted. The Marketplace listing, Step 9's other half, is still to do.

### Sunset — tester round, portfolio record and teardown preparation

2026-10-18. The project is sunset; Step 8c and everything after it will not be done. The decision and its
reasoning are under Decisions Made below.

**Tester round.** Colleagues at the operator's school were given the app with an explanation of each tool
and a gift card draw for feedback. Two created accounts (2026-10-16 and 2026-10-18). Read from production as
aggregates: both added a student within minutes and opened the Name Picker, neither saved attendance,
generated groups or sent an email, and each recorded one session. Neither used a school-managed Google
account. The anonymous exit poll had two responses by 2026-10-18 and closes 2026-10-23; both rated their
likelihood of creating an account at 4 of 5, and one suggested grouping only the students present today.

**Phase 3.** Four candidates were added to IMPLEMENTATION_PLAN.md so the ideas outlive the deployment:
grouping only present students, dragging a student to open space to make a group, PowerSchool integration,
and CSV roster import.

**Portfolio record.** `portfolio/` holds a case study page (also published as a private artifact),
screenshots of every tool and the public pages taken from a demonstration account, the aggregate data behind
its charts, and resume and interview material.

**Teardown preparation.** The ordered runbook is kept privately. `server/scripts/revoke-all-grants.ts` revokes
every stored Google grant before the database is deleted; its dry run against production on 2026-10-18
decrypted all five stored tokens and revoked nothing.

## Decisions Made


Settled questions, with the conclusion and a brief rationale. Durable design facts also appear in the
relevant spec (SHEETS_SCHEMA, API_CONTRACT, DESIGN_SYSTEM, IMPLEMENTATION_PLAN); this is the record of
what was decided and why. Where the Work Log above already describes *what shipped* for a step, the entry
here keeps only the reasoning and the rejected alternatives rather than repeating the mechanics.

- **The project is sunset (2026-10-18).** The operator judged that the product has no route to
  profitability worth its risk and effort. Four lines of evidence agreed: the accommodation module, behind
  the research's most severe finding, was removed by 8a and cannot return; the tester round produced no
  repeat use despite context and an incentive; no tester signed in with a school-managed account, so real
  use would wait on per-board allowlisting; and fixed costs (hosting near $31 USD a month, then insurance,
  legal review and tax registration) arrive long before revenue. Stopping now, before any of 8c's
  commitments were signed, keeps the total outlay to hosting, the domain and the business-name filing.
  Production stays up until the exit poll closes on 2026-10-23 and the testers have had notice, because the
  terms promise 60 days' notice of discontinuation.

- **The `spreadsheets` OAuth scope is dropped; `drive.file` covers the sheet (2026-09-12).** The Sheets
  API accepts `drive.file` for any file the same OAuth client created, and the app only ever touches its
  own spreadsheet: it creates it, and both discovery paths start from a Drive `files.list` that `drive.file`
  bounds whether or not `spreadsheets` is granted. So `spreadsheets` could never reach a sheet the app did
  not already have, including a copy the teacher made by hand. It was kept anyway because it had been in the
  list since Phase 1. It cost a second sensitive scope to justify in verification, a consent-screen line
  claiming access to every spreadsheet the teacher owns, and a broader permission for a board to approve.
  Verified live rather than read from documentation: with the grant revoked first (the client sends
  `include_granted_scopes`, so an unrevoked grant would have folded the scope back in), an existing
  account's sheet was found, read and written and a fresh account's folder and sheet were created, with
  the granted-scope string logged at the token exchange showing no `spreadsheets`. `gmail.send` is now the
  only sensitive scope. On its own this would not have re-prompted, by the 8d test, since access only
  narrowed; it shipped inside the `2026-09-12` accuracy sweep, which does. The rejected alternative was submitting with
  three scopes and narrowing later, which spends a review cycle defending a scope that grants nothing and
  risks a rejection for over-scoping.

- **Documents in `ops/` are written for third parties (2026-09-10).** The incident response plan, the
  administrative account register and the backup and restore procedure are handed to an insurer, a school
  board or a lawyer, so they carry no reference to phases, steps or the planning documents, no commentary,
  and only remediation items the operator has decided, each with a date. Internal open questions about them
  go to NEXT_STEPS. The rejected alternative was the first draft: one document serving both audiences with
  internal notes inline, which would need stripping by hand every time it was shared, and where a missed note
  reads to the recipient as an unfinished plan.

- **Step 8's sub-steps were renumbered on 2026-08-28, and the old numbers are not aliases.** The map is:
  old 8a (launch administration) → **8c**; old 8b (the data-handling claim, already complete) → **8d**; old
  8c (launch scope reduction) → **8a**; old 8d (board provenance) → **8e**; old 8e (token path hardening) →
  **8f**. A new **8b** was inserted for the three conditions an insurer writes coverage against. Every
  reference in the working documents was permuted in one pass; anything outside them predating that date
  still carries the old numbers, including the commit message for what is now 8d.

  Two reasons, and the first is the one that matters. **The scope reduction decides what the product is, and
  every item in launch administration describes the product to somebody** — a lawyer reading the terms, an
  underwriter pricing the exposure, a Google reviewer watching a demo video, a board reading the assessment
  package. Running the administration first meant paying four external parties to look at a product about to
  change underneath them, and the demo-video dependency makes that concrete: a video recorded against the
  old surface shows an IEP editor and a pricing page that will not exist. **Second, the insurance
  application asks three security questions — MFA, a written incident response plan, tested backups — that
  this project could answer with a "no" three times over.** The previous ordering called discovering those
  conditions during procurement "the point, not a side effect", which is a good argument about conditions
  nobody has thought of and a bad one here, because all three were written down in this plan months ago. The
  discovery had happened; only the work had not. Hence 8b, placed ahead of the conversation it exists to
  answer.

  What did **not** move the decision: batching legal-document changes into one consent version bump. Only
  the operator's account exists, so a re-prompt costs nothing until Step 10, and the sequence should not be
  contorted to save one. Recorded because it is the plausible-sounding argument a later reader is most
  likely to reconstruct.

- **Board allowlisting moves to Phase 3, and launch targets teachers on boards with no allowlist.** Step 8c
  originally carried "open the board allowlisting conversation" as an item to start early, on the reasoning
  that an IT queue's timeline is not ours and the wait should be started before it is needed. That reasoning
  is sound about the queue and wrong about the meeting. The conversation is one shot with someone who will
  ask what the app is, who is behind it, what happens to student data, and who carries the liability; a
  verified Marketplace listing, a registered business, lawyer-reviewed documents and a policy in force answer
  all four, and none of them can be promised credibly in advance. So the order inverts: finish Step 9 and the
  rest of 8c, launch to the teachers who can install without an admin, and open the board conversation from a
  position of having users. **Target the term-2 boundary, roughly January 2027**, because a board's own
  calendar makes a new tool plausible then and a mid-term request competes with the term it interrupts.

  The launch cohort this implies is teachers whose board uses Google Workspace but has not configured
  third-party app blocking. The assumption is that an allowlist is not yet the default posture: the
  operator's own board is well funded and technically capable and only configured one in the past year. That
  is a single data point and it is the assumption the launch rests on, so it is worth testing early — the
  observable is whether early sign-ups stall at the OAuth screen rather than at the pricing page.

  The consequence is that **Step 10 needs a distribution plan and does not have one.** A Marketplace listing
  makes the app installable and does not make anyone look for it. Deliberately left to a discussion held once
  the rest of Phase 2 is closed rather than guessed at now.

- **The working-set ceiling was the wrong unit and about 7x too permissive.** Measured in Step 6d with
  `server/scripts/measure-working-set.mjs`, which is committed so the number can be re-derived rather than
  trusted.

  The old bound was `MAX_ENTRIES = 2_000`, and the file itself asked for exactly this revisit "in 6d, where
  the instance size is actually known". Measured against an unfavourable but realistic teacher (five classes,
  150 enrolments, a full unarchived year of attendance):

  | resource | rows | heap |
  |---|---|---|
  | attendance | 27,000 | 7.85 MB |
  | students | 120 | 0.07 MB |
  | enrollments | 150 | 0.03 MB |
  | iep-all | 72 | 0.02 MB |
  | courses, templates, groupings | 18 | 0.01 MB |
  | **total, 7 entries** | | **7.98 MB** |

  **A methodology note that cost a wrong number first time.** The harness originally built the rows field by
  field and measured 12.76 MB. V8 internalises repeated strings during `JSON.parse`, so the identical data
  parsed from JSON costs 7.98 MB, and production reads it from the Sheets API as a parsed JSON response.
  Constructing the fixtures directly overstated the working set by about 60%. The harness now round-trips
  through JSON, and any future measurement of a cached shape has to do the same or it is measuring a path
  the app never takes.

  Two conclusions. **Attendance is 98.5% of a teacher's footprint**, so a bound that counts one attendance
  entry and one courses entry as "1" each is measuring something unrelated to memory: one attendance entry
  costs as much as about 110 student entries. And **the ceiling was unreachable** — 2,000 entries is roughly
  285 concurrent teachers, needing about 2.3 GB of heap on a 1 GiB instance, so the process would have died
  long before the guard fired. The guard was not conservative, it was decorative.

  Replaced with a byte budget (`MAX_CACHE_BYTES`, default 256 MB, overridable by `CACHE_MAX_MB` so a bigger
  instance is a config change). Sizing is rows times a measured 600-byte constant rather than
  `JSON.stringify(value).length`, which is exact and self-defeating: sizing the attendance entry that way
  allocates a 5.8 MB string on every cold load, which is the GC pressure the bound exists to avoid. An entry
  larger than the whole budget is kept rather than evicted, because a load that evicts itself re-reads from
  Sheets on every request.

  **The capacity figure this produced was about 64 concurrent active teachers on a 1 GiB instance**, since
  Node settles near 512 MB of usable old space there. It was a launch-adequate number and a surprisingly
  close ceiling, and it was set almost entirely by one design choice.

  **Superseded: Step 8 re-measured it at 0.43 MB per teacher, about 1,180 per 1 GiB instance.** Step 6k
  (attendance as exceptions plus class-day markers) is most of the 18.6x fall. **Quote the Step 8 figure,
  not the 64.** The methodology note above still holds and Step 8 added a second rule beside it.

  **The follow-up this entry proposed is no longer worth doing.** `listAttendance` caches the whole
  attendance tab as one entry, and scoping it by class and date range was recorded here as worth more than
  any tuning of the ceiling. That was true when attendance was 7.85 MB of an 8.0 MB footprint. It is now
  0.29 MB of 0.43 MB, so the change would buy a fraction of a megabyte per teacher in exchange for touching
  every attendance read path. Dropped rather than carried.

- **The `emailLog` rolling archive is not built, and moves to Phase 3 with a reader as its trigger.**
  Decided in Step 8, which owned it, on two findings that between them removed the reason for it.

  **It has no reader.** The archive was scoped to keep two things fast: the daily-cap scan and an audit
  view. Neither exists. Step 7 moved the cap to a Postgres counter claimed before sending, precisely because
  a cap counted from rows in the teacher's own spreadsheet could be reset by deleting them. The audit view
  was never built. So `emailLog` is written by one call site in `emailSend.ts` and read by nothing in the
  app — no route, no client code, not class archiving, and not bootstrap, whose header pass reads row 1
  only. Its sole reader is the teacher opening the tab in Google Sheets. An unread tab cannot be slow, and
  bounding it would have been optimising a query nobody runs.

  **The remaining bound is the spreadsheet's own cell ceiling, and it is roughly nine years out.** Google
  allows 10,000,000 cells per spreadsheet. Two details make the arithmetic worse than the schema suggests
  and it still does not bind. The 16 tabs are created with `addSheet` and no `gridProperties`, so each gets
  the default 1000 x 26 grid: **416,000 cells are allocated before a single row of data**. And a row costs
  its sheet's full column count, not its schema's — appends grow `rowCount` and leave `columnCount` at 26 —
  so an `emailLog` row costs 26 cells rather than 7.

  Against the 9,584,000 cells left, a teacher sending at the hard 200/day cap every school day writes
  38,000 rows a year, or 988,000 cells; call non-`emailLog` growth 100,000 cells a year on the same
  unfavourable profile. That is **about 8.8 years of continuous maximum-rate sending** in one spreadsheet
  that is never reset. A realistic heavy pattern — every one of 120 parents emailed weekly for 40 weeks —
  is 4,800 rows a year and puts the ceiling past 40 years. A free account at 30 emails a month writes 300
  rows a year. The conclusion is robust to the one assumption taken from documentation rather than measured
  (the 1000 x 26 default): if a row cost 7 cells rather than 26, the horizon only gets longer.

  **What would change the answer is a reader, not a row count**, which is why the Phase 3 entry names one.
  An in-app send-history or audit view over `emailLog` would make the tab's size matter for the first time,
  and the archive belongs to that feature's scope rather than sitting as unbuilt work ahead of it.

- **In-Canada hosting is a trust decision, not a compliance requirement.** Re-examined during the Step 6d
  pre-provisioning audit, under the principle above.

  Step 6b eliminated most of the hosting field on region alone, on the grounds that Nova Scotia's PIIDPA
  binds public bodies and their service providers to in-Canada storage until 2027-04-01. Followed through
  against the architecture, that argument mostly does not reach us. PIIDPA reaches a service provider **to a
  public body**; here the board is explicitly not the buyer, the teacher is an individual consumer, and the
  server holds **no student data at all**. What is in Postgres is a teacher's own name, email, Google sub,
  spreadsheet id, subscription state, encrypted refresh token and support messages, which is a B2C customer
  record rather than a public body's information holding.

  What survives is narrower and still real: the refresh token grants access to the student data, so custody
  of the token is adjacent to custody of the data, and "your data stays in Canada" is a genuinely useful
  sentence in front of a board's privacy reviewer.

  **Toronto is unchanged; what changed is why.** The distinction matters because the original framing let
  region **veto** the provider search outright, removing Fly.io, Render and Railway before price or fit were
  considered. As a trust and marketing preference it should not silently veto a materially better option
  later. Worth putting to the lawyer hour already budgeted in 8c.

- **Our own documents do not count as evidence for the decisions they record.** Raised by the user during
  Step 6d, while the KMS swap was being justified.

  The failure was concrete and worth writing down because it will recur. Asked whether Cloud KMS was worth
  doing at all, the analysis concluded that its security gain over a well-managed environment variable was
  narrow — the plaintext data key sits in process memory after boot, so an app compromise loses everything
  either way, and the KMS service-account credential sits in the same environment as the wrapped key it
  unlocks, so an environment leak loses both halves at once. Having reached that, the recommendation kept
  KMS anyway, and the argument it leaned on hardest was that the privacy policy already claimed it and
  changing that text would cost a paired version bump and a consent re-prompt.

  That argument is circular and the cost it invoked is imaginary. We wrote the privacy policy. It is a draft.
  There are no accounts, so a re-prompt re-prompts nobody. Citing it as a constraint on a design decision
  reasons from our own earlier output back to itself, and it would have quietly locked in every provisional
  answer in every document in the repo, which is a large amount of unexamined inheritance for a project
  still deciding things.

  The rule, now recorded under Design Principles in IMPLEMENTATION_PLAN.md: work out what is right for the
  product, then change the document. The genuine arguments are the ones that survive without the document.
  **This inverts at the first real account**, when the text becomes a promise someone relied on and the
  re-prompt has a real cost; the paired-bump discipline in Step 6c is about how to make a change, not
  whether one is permitted.

  For KMS specifically, the decision was re-derived on its merits and is recorded with the Step 6d work.

- **Activation is measured as monthly counts, never as events; and the picker is measured differently on
  purpose.** Decided in Step 6j planning, before any code.

  Three mechanisms were available for ongoing usage. Rewritten `last_used_at` columns answer only "still
  using it", with no trend and no history, because each write destroys the previous value. A per-action
  event table gives full fidelity, grows without bound, needs its own retention rule, and makes the "no
  tracking" posture untrue in substance rather than merely in wording. Monthly per-tool counters sit
  between: they answer adoption, trend, and retention cohorts, and they cannot be ordered into a sequence,
  so a teacher's working day cannot be reconstructed from them. The last property is the one that matters,
  because the audience for the privacy policy includes a school board deciding whether to allowlist the app.

  Within that, **completed actions are counted rather than requests**. Counting requests from one middleware
  would have been far less code and impossible to miss a call site with, at the cost of a number that counts
  page loads, re-renders and polls as use. The smaller set of write-path call sites gives a number that
  means something.

  **The Name Picker is the exception, and its number is not comparable.** It has no server endpoints at all,
  by the Step 8 decision, so the choice was an endpoint existing purely as telemetry — the one such call
  site in the app — or a marker on the roster read its page already makes. The marker was taken, so every
  measurement rides a request made for another reason. The cost is that the picker counts opens rather than
  rounds, which is carried in the API response and labelled at every display rather than left to be
  inferred. Rejected: adding the telemetry endpoint, and leaving the picker uninstrumented.

- **The operator sees totals, or one account that has written in — never a search.** Decided in Step 6j.

  A standalone account lookup was rejected in favour of folding per-account state into the existing support
  ticket. The operator question it answers only ever arises while reading a request the account sent, and
  the ticket view already holds that account, so folding it in gives the whole triage benefit with no new
  lookup surface: there is no search box to point at an arbitrary account, no lookup by email, and no
  listing endpoint. The narrower disclosure follows from the narrower capability rather than being asserted
  about a broader one. The cost is that an account which has never contacted support cannot be investigated,
  which was judged not to be a real operator need at this scale.

  An access audit trail for operator views was considered and declined for now, on the ground that the
  allowlist currently holds one person and the trail would record only their own access. It becomes worth
  adding if the allowlist grows.

- **Retrying a rate-limited Google call belongs at the call, not at the request; and a whole-tab rewrite
  writes before it clears.** Decided in the Step 6e follow-up, from a real failure rather than from review.

  Two rules, both learned from one rate-limited unarchive. **Retry granularity:** a request that is a dozen
  Google calls cannot be retried as a unit, because re-sending it re-spends every call that already
  succeeded, so each attempt pushes the account further past the per-minute ceiling and is likelier to fail
  than the one before. Retrying the individual refused call costs one call and usually succeeds. The
  client's whole-request retry is kept for ordinary single-call requests, where the argument does not apply,
  and the class-move endpoints opt out of it explicitly.

  **Rewrite ordering:** clearing a tab before writing its replacement means a failure between the two loses
  the rows that were only ever meant to stay. Writing first and then clearing whatever the new rows did not
  cover means the same failure leaves duplicates, which a retry removes by id. This is the same trade the
  archive already made one level up — append and verify before touching the source — and the same reasoning
  decides it: for a teacher's attendance records, duplicated rows are recoverable and missing rows are not.
  The corollary is that **the commit record is written last and alone**. The course row's `archivedAt` is
  what tells a retry whether the work is done, so it cannot land in the same batch as the work; folding it
  in marked classes archived over rewrites that had failed.

  Rejected: trusting the append response's `updatedRows` instead of an independent re-read, and folding the
  appends into the same batch as the rewrites by computing their destination ranges. Both were available and
  would have taken eleven calls to about six, and both spend part of the guarantee the operation exists to
  provide for a saving that no longer matters once the count is inside the ceiling.

- **Legal documents → written in-house against the data inventory, aggressive but bounded by consumer law;
  not lawyer-reviewed.** Decided and executed in Step 6c.

  The drafting instruction was to minimise liability and maximise the account holder's assumed
  responsibility. The judgment call was how far that goes, and the answer taken is that a clause which
  matches the architecture survives review while one that reallocates a burden the operator actually carries
  does not. Hence: the teacher is the responsible party for student information **because they are** — it is
  in their Google account, entered by them, under their professional obligations — and the documents say so
  in those terms rather than by disclaimer.

  Three limits were treated as binding rather than drafted through. **Ontario's Consumer Protection Act,
  2002 applies**, because a teacher paying personally is a consumer, so the arbitration and class-action
  waiver is scoped to US residents, carries a 30-day opt-out, and is expressly disapplied for Ontario
  consumers; writing it to bind everyone would risk the surrounding clauses being read down. **Fraud, wilful
  misconduct, gross negligence and personal injury** are carved out of the liability cap in their own
  section. **The cap is the greater of twelve months' fees or CAD $100**, with a stated rationale rather
  than a bare number.

  Two disclosures were kept that a more aggressive draft would have omitted, because a privacy policy that
  is provably incomplete is itself a liability: the support form's free-text field is named as the one place
  student information can reach our database despite the design, and the in-memory working set is described
  rather than hidden behind "we do not store student data".

  **The Google Limited Use statement is in the policy verbatim**, not because a teacher will read it but
  because OAuth verification at Step 9 checks for it.

  Rejected: writing from a template, and deferring to a lawyer before writing anything. The first produces a
  document that describes a different product; the second bills for drafting rather than for review. The
  documents are written to be reviewed, and the versioned consent makes a reviewed revision a one-line bump
  that re-prompts everyone.

- **Hosting → DigitalOcean App Platform + DigitalOcean Managed Postgres, Toronto (`tor1`), about $25/month
  USD, with Google Cloud KMS holding the refresh-token key.** Decided in Step 6b, before anything was
  bought. Mechanics and the verified prices are in the Work Log entry; what belongs here is why, and what was
  turned down.

  **Region came first and did most of the eliminating: Canada, for teachers in both countries.** No US law
  requires student data to stay on US soil (FERPA has no residency clause, and neither do NY Education Law
  § 2-d, Illinois SOPPA or California SOPIPA, which govern access, use, encryption and deletion instead), so
  Canadian hosting is lawful for a US teacher. The reverse is not symmetric: PIPEDA permits cross-border
  processing with disclosure, but Nova Scotia's PIIDPA still binds public bodies and their service providers
  to in-Canada storage until 2027-04-01, and Quebec's Law 25 adds a privacy impact assessment. US hosting
  would therefore create a real obstacle in part of the home market to avoid a checklist preference that
  mostly never reaches a product sold direct to teachers rather than through procurement. The price of
  choosing Canada is latency a teacher cannot perceive.

  **The architecture is what makes the region a small question at all**, and this is the sentence that should
  survive into the privacy policy: our database holds no student data, only the teacher's own identity, sheet
  id, subscription state and encrypted token. Student information stays in the teacher's own Google account,
  in their board's own tenancy. That does more work with an administrator than a region name does.

  **Rejected: Google Cloud Run + Cloud SQL, Montreal**, which was the earlier recommendation and lost on two
  arguments that did not survive being examined. The first was that the existing Google integration favours
  it; it does not. The app talks to Google *APIs* over ordinary HTTPS with a client id and secret, from
  anywhere, and shares nothing operationally with Cloud Run or Cloud SQL beyond a web console. The second was
  the KMS commitment from IMPLEMENTATION_PLAN, and Cloud KMS turns out to be callable from DigitalOcean using
  the Cloud project that already exists, so the commitment is kept without the hosting. What remained was a
  comparable price with materially more setup (container build pipeline, Cloud SQL connection path, Secret
  Manager, least-privilege IAM across all of it) and a custom-domain path that may need a ~$20/month load
  balancer in that region.

  **Rejected: Fly.io Toronto**, on price alone: its Managed Postgres starts at $38 against DigitalOcean's
  $15.15 for the same size. **Rejected: Render and Railway**, on region alone: neither has a Canadian region.

  **Accepted knowingly: a single non-redundant database node.** Both cheap tiers are single machines with
  maintenance restarts, and because sessions live in Postgres a restart is a brief window of errors rather
  than data loss. Redundancy roughly doubles the bill and is not worth buying before there are users. The
  earlier SLA caveat against Cloud SQL's shared-core tier was **withdrawn as near-irrelevant**: an SLA is a
  promise whose remedy is service credits, so at this scale it refunds a few dollars and predicts nothing
  about reliability.

  **Two consequences for other steps.** 6a's single-instance and sticky-sessions decision is confirmed
  against the provider as that step required, and no shared cache is introduced. And the built client will be
  served by the same Node process, so production runs on one origin and the cross-site cookie and CORS
  handling that dev needs does not exist there.

- **Operating entity → sole proprietorship in Ontario, Canada, with a registered business name; incorporate
  later, on exposure rather than on revenue.** Settled in Step 6b, and it unblocks the half of Step 6c that
  was never waiting on hosting. 6c can now state the entity, Ontario governing law and Ontario as the forum.

  The downside accepted is the real one: a sole proprietorship is not a separate legal person, so a claim
  against the product is a claim against personal assets. The terms of service will cap liability but caps do
  less than people assume here, because the customers are individual teachers buying personally and are
  therefore consumers under Ontario's Consumer Protection Act, 2002, which limits what a consumer contract
  may disclaim; and caps do little against statutory privacy claims or a negligence claim from a parent who
  never agreed to anything.

  **The trigger for incorporating was corrected during the discussion.** The user's plan was to incorporate
  "if it becomes lucrative", which ties the decision to revenue while the exposure tracks users and data. A
  hundred teachers paying nothing still put thousands of students' information in the app's path, so the
  trigger is the first real cohort using it with real student data, which arrives at hosting. Incorporation
  in Ontario is a few hundred dollars plus an annual return and a corporate filing, and the migration cost
  later is modest: the Stripe account, the entity on the OAuth consent screen and verification record, and
  reissuing the terms, which the versioned consent from Step 5c already handles as a clean re-prompt.

  **Tech E&O and cyber liability insurance is the companion measure, not an alternative to either.** It
  addresses the actual failure mode, which incorporation does not cover; a corporate veil does not answer a
  breach, it only decides whose assets are behind it.

- **Multi-instance model → sticky sessions if and when we scale out, never a shared cache holding student
  data; and a single instance to begin with.** Written in Step 6a, confirmed against DigitalOcean App
  Platform in 6b.

  The working set holds student data in instance RAM, so the question the plan posed was whether a teacher's
  requests must reach the same resident copy, and if so how. The decision is **not** made on performance
  grounds. A shared cache (Redis or equivalent) would mean student names, pronouns, IEP accommodations and
  attendance sitting in a datastore we operate — which is the one thing this product says it does not do. The
  entire trust argument, the `/for-admins` page, the answer a board administrator gets, and the reason the
  scopes stay narrow all rest on the Sheet being the only durable copy and our servers holding nothing. A
  shared cache trades that for even load balancing. That is not a trade worth making, and it is a
  privacy-boundary decision rather than an infrastructure default, which is why it is recorded here rather
  than settled in a config file.

  **The design degrades gracefully, which is what makes this cheap.** Stickiness is an optimisation, not a
  correctness requirement. Sessions already live in Postgres, so authentication does not care which instance
  a request lands on; only the cache does, and a request that lands on the wrong one simply re-hydrates. With
  the Step 6a batching that costs a single Sheets read. So the failure mode of *not* having sticky routing is
  a slightly higher read rate, never a wrong answer and never a broken session — which also means the app can
  be deployed multi-instance before any sticky-routing configuration exists, and stickiness added later purely
  as a cost optimisation.

  **Start with one instance.** Correlated peaks are the risk, not sustained load, and one instance plus the
  working set covers far more concurrent teachers than this product will have at launch. A second instance
  buys availability during a deploy or a crash, which is a real reason to want one, but it is a 6b/6d
  decision about the hosting plan rather than something the read architecture needs.

  Rejected: a shared cache for even load and clean failover (loses the PII boundary, as above); sticky
  routing from day one (configuration and a failure mode to reason about, bought before there is a second
  instance to route between); and per-instance caches with no stickiness *as a deliberate design* rather than
  as a tolerated fallback (fine for correctness, but it multiplies cold reads by the instance count for no
  benefit once stickiness is available).

- **Landing page design → settled over a review pass, and committed to the repo.** The full design, its
  rationale, and the rejected alternatives live in
  [design/landing-page-mockup.html](design/landing-page-mockup.html). The decisions worth keeping here:
  - **Product shots are rendered in the DOM, never captured as images.** Forced by the PII boundary: a real
    screenshot of a roster contains real student names, which cannot appear in a marketing asset for a
    product whose claim is that it never holds student data. Since any shot needs invented data anyway,
    DOM costs nothing and adds theme-following and immunity to token drift. Accepted cost: they are a
    representation maintained apart from the real component, so they need re-checking when a tool's layout
    changes. They were built by reading the components, not by approximation — the first draft had
    attendance as a heatmap grid when daily entry is actually P/A/T/E buttons per student.
  - **Logo → a pencil and ruler fanning out of a protractor**, replacing the graduation-cap placeholder.
    Chosen over a literal pocket knife (busiest, closes up at 16px), crossed implements (least
    distinctive), and an abstract "class of students" mark (about the audience rather than the name).
  - **Three marketing-scoped additions to DESIGN_SYSTEM, approved:** two display type steps above the app's
    24px ceiling, `--color-canvas` as a fourth ground for full-width bands, and a 48px call-to-action size.
    None is used inside the app. A fourth flag was withdrawn: the premium star had begun marking whole
    tools, a second meaning for an existing symbol, and removing stars from tool names dissolved it — every
    tool has premium parts, so marking some of them drew a distinction that does not exist.
  - **No copy names a fixed number of tools**, so a sixth tool cannot silently make the page wrong. A test
    asserts it.
  - **Pricing and FAQ are separate pages.** Pricing answers "what do I get", with a comparison table for
    someone checking a specific claim; FAQ answers "what happens if", including the two questions that
    exist because a board can block the app before a teacher ever sees it.
- **Step 5 scope → split into 5 (public surface) and 5a (onboarding & allowlisting); legal content held
  back.** Four choices settled with the user before the build.
  - **Split, not one step.** The original Step 5 bundled a marketing surface, a legal surface, an
    onboarding flow, and the board-allowlisting path. Sub-numbered as 5 and 5a rather than renumbered, the
    same convention as 3a/3b and Phase 1's 4a/4b, so no later cross-reference moves.
  - **The public shell lives at `/`,** with the landing page rendered for a signed-out visitor and the
    roster for a signed-in one, and `/pricing`, `/contact`, `/privacy`, `/terms` always public. Rejected
    putting the landing page at `/welcome`: the Marketplace listing (Step 9) needs a homepage URL, and the
    root is what that means. Rejected keeping the auto-redirect with public pages beside it, which would
    leave the product with no landing page in the sense the plan intends.
  - **Legal routes now, legal content later, and explicitly not as a side effect.** The privacy policy and
    terms depend on the operating entity, its jurisdiction, retention and deletion commitments, and DPA
    wording — none of which the codebase holds, and all of which are legal exposure if guessed. The routes
    ship with content that says plainly it is a placeholder. The user has asked to be warned before the
    real text is written so it can be done deliberately on a higher-capability model; treat that as a hold.
  - **Onboarding gets a short first-run guide**, not a wizard and not nothing. An empty roster is the least
    informative first screen the app can show, but a multi-step setup wall in front of a teacher who would
    rather look around is worse. Deferred to Step 5a with the rest of onboarding.
  - **The public contact route's abuse controls are a rate limit and a honeypot, not a captcha.** Weighed
    against a captcha's dependency, third-party script, and accessibility cost. Revisit only if abuse
    actually appears; nothing about this endpoint is valuable enough to automate against at present.
  - **One table with `google_sub` nullable, not a second table for anonymous requests.** Triage should show
    one queue, and the rows differ only in where the identity comes from. The cost is that the triage join
    had to become a LEFT join in the same change — an inner join would have hidden precisely the messages
    from people unable to sign in.
- **Support system scope → signed-in submission, an in-app allowlisted triage view, no email alert.**
  Three choices settled with the user before Step 4 began.
  - **Submission is signed-in only.** The account supplies the identity, email, name, and plan, so the form
    asks only for what a teacher can tell us that we do not already know. The alternative — accepting
    anonymous submissions now — buys an unauthenticated write endpoint, a captcha problem, and an
    address-validation problem in a step that needs none of them. A signed-out contact route is Step 5's (now built),
    where the landing page puts it in front of the people who cannot sign in.
  - **Triage is an in-app route behind the operator allowlist**, not a server-rendered page (a second UI
    idiom, no component or auth reuse) and not a psql script (triage would mean opening a terminal, and
    nothing would be reusable). It reads a support-admin allowlist with **no `NODE_ENV` half** — the
    opposite of the dev plan toggle, deliberately, because triage is a production task while a live
    entitlement endpoint in production is not. The 404-not-403 refusal carries over unchanged.
  - **No email notification of a new submission.** Sending one would have to use the submitting teacher's
    own Gmail token, which is the wrong identity for a message from us; an app-owned transactional sender is
    a hosting decision (Step 6) and a dependency to review. Until then the triage view is the read path.
  - **The one PII exception is named rather than hidden.** The free-text message field is the only place in
    the schema a teacher could put student information into our database. The form says not to, nothing logs
    the subject or body, and the migration comment marks it as the field a retention policy has to address.
    The claim the design supports is "the app never puts student PII there", not that the column could not
    hold it.
  - **Comps go through `plan_override`**, as Step 3 intended when it created the column, so support never
    writes a Stripe-managed field and a comp is lifted by clearing the override.
- **Billing provider → Stripe as our own merchant of record, not a merchant-of-record service.** Settled
  by research before starting Step 3b, after asking whether Stripe is actually the right tool for this
  product rather than the default one. Rates below are CAD, domestic cards, checked July 2026 and worth
  re-checking against the real account.
  - **The fee nobody budgets for: Stripe Billing is 0.7% of billing volume on top of 2.9% + CA$0.30**, so
    the real subscription rate is **3.6% + $0.30**. Verify this on the live account; it is a fifth of the
    effective cost on the annual plan.
  - **Cost at our two price points** (the real ones: **$6.99/month, $69.90/year CAD**). Stripe: **7.9%**
    on monthly, **4.0%** on annual. A merchant-of-record service at the standard 5% + 50¢ (Paddle, Polar's
    current Starter tier, Lemon Squeezy): **12.2%** and **5.7%**. Stripe Managed Payments (3.5% stacked on
    top of processing): **10.7%** and **6.8%**. The fixed 30¢ is what drives the monthly/annual gap — it is
    paid twelve times a year on monthly and once on annual.
  - **Annual is fee-cheaper but not revenue-better, and the first draft of this decision got that wrong.**
    The rate comparison (4.0% vs 7.9%) is correct, but it does not mean annual earns more: a monthly
    subscriber who stays twelve months nets **$77.26**, an annual subscriber nets **$67.08**, because the
    ~16.7% annual discount is far larger than the 3.9-point fee saving. **Annual wins only if the average
    subscriber churns before ~10.4 months.** For a teacher product that is plausible — summer break makes
    sub-10-month retention likely — so annual prominence at checkout is still the recommendation, but it
    rests on **retention and cash-up-front, not on fee efficiency**. Revisit if retention data says
    otherwise; this is a pricing judgement, not something the arithmetic settles.
  - **The tax case for a merchant of record does not apply to us.** An MoR exists to become the legal
    seller and handle sales tax across jurisdictions. Our market is Ontario school boards, so: Canada's
    **small-supplier threshold is CA$30,000** of worldwide taxable revenue over four consecutive quarters
    (~430 annual subscribers, or ~360 billed monthly) before GST/HST registration is required at all;
    past it, it is one
    registration in our own country, where we already file. US SaaS economic nexus is typically $100k
    *per state*. Paying 2–4 points of margin from day one to pre-solve a problem that begins at a few hundred
    subscribers, in one jurisdiction, is a bad trade.
  - **The deciding argument is the exit, not the entry price.** Stripe now sells merchant-of-record as a
    feature of itself (**Stripe Managed Payments**, launched Feb 2026, public preview as of Apr 2026), so
    outgrowing self-MoR becomes a configuration change on an account we already have rather than a
    re-integration with a different provider, webhook vocabulary, and customer records. That removes
    lock-in avoidance as a reason to start on an MoR.
  - **Also weighed:** with Stripe we control the statement descriptor and the receipt carries our own
    name, where an MoR's carries theirs — teachers commonly expense classroom tools, and an unrecognized
    entity on a card statement is real friction for a product whose distribution depends on board trust.
    Stripe Invoicing also covers a PO/invoice sale if a board ever wants one, which MoRs handle poorly.
    Fraud absorption, an MoR's other selling point, is worth little at an $8 price.
  - **Deferred deliberately: Stripe Tax.** Nothing to collect below the threshold; add Tax Basic
    (0.5%/transaction) at registration time, not before.
  - **Revisit trigger, written down so it is a decision rather than a drift:** selling into the EU or UK
    (no small-seller threshold exists for non-resident digital sellers, the one genuine MoR trigger), or
    Canadian compliance overhead exceeding the margin difference. Not a vague "when we grow."
  - **Assumptions this rests on**, to re-open the question if either is false: the business is based in
    **Ontario**, and customers are **overwhelmingly Canadian**. Also noted: this is not tax advice, and
    the GST/HST timing should be confirmed with an accountant before approaching the $30k threshold.
  - Unchanged by this: the 30-day trial stays **app-managed** (`trial_ends_at`, no card up front), so it
    never depends on the billing provider, and `plan_override` stays separate from the Stripe-owned
    subscription fields. Both are what keep the provider swappable.
- **Step 3 build decisions → four choices settled while implementing.**
  - **The email tool got its own ungated metrics endpoint** (`GET /email/recipient-metrics`), resolving the
    spec conflict described in the Step 3 work-log entry. Rejected leaving `/attendance/stats` ungated (it is
    the statistics view's endpoint, and the split's core is that analysis is premium) and rejected widening
    `/students/risk-summary` (it exists for the roster's indicators and does not carry attendance totals).
  - **`GET /attendance/range` is _not_ gated; only `/stats` is.** ~~The range endpoint has exactly two
    readers, the History grid and the student-detail heatmap, both premium.~~ **Corrected during the Step 5
    documentation pass:** this entry recorded an intermediate decision that was reversed before Step 3
    shipped, and it had been contradicting IMPLEMENTATION_PLAN and the code ever since. What shipped, and
    what IMPLEMENTATION_PLAN describes, is that **the History grid and the student-detail heatmap are free**:
    both show the record of what was taken rather than anything computed from it, and a teacher checking
    what they already recorded is still inside the daily-entry loop. The premium line is the *computation* —
    totals, absence rates, streaks, flags — which is `GET /attendance/stats` and the student-detail
    attendance summary. `GET /students/:id/detail` needed no change for a different reason than this entry
    gave: it omits the attendance *summary* on `free` while still serving contact details, notes, and IEP
    records.
  - **Reject-in-full applies to the monthly cap, not the daily one.** The contract's "rejected in full"
    wording sits in the free-plan paragraph, and the daily cap's existing mid-batch behaviour (overflow
    marked `daily_cap`, earlier messages sent) is tested and shipped. Reading it as scoped to the free
    monthly allowance keeps both: a free account never gets a partially applied send, and the 200/day
    behaviour for `trial` and `paid` is untouched. The reasoning for the free case is that a teacher who
    hits the paywall mid-send should be able to retry the identical send after upgrading, rather than
    reconstruct which half of the class already heard from them.
  - **The entitlements provider takes the plan as a prop.** `EntitlementsProvider` was first written to read
    `useAuth()` itself, which made it untestable in the many component tests that render without an
    `AuthProvider`. Split into a pure `EntitlementsProvider({ plan })` plus an `AccountEntitlementsProvider`
    that does the wiring in `App`. The provider stays pure, and a test picks a plan directly.
  - Also settled: the account is loaded at most once per request (`loadAccount` memoizes on the request
    object), because a gated endpoint needs it for both the plan check and the Sheets context and would
    otherwise read the same Postgres row twice on every call.
- **Step 3 scope and entitlement edges → settled before implementation.** Five decisions taken with the
  user when speccing Step 3.
  - **Stripe splits out as Step 3b.** IMPLEMENTATION_PLAN titled Step 3 "Plan entitlements & Stripe
    integration" while NEXT_STEPS listed Stripe later in the sequence; resolved in favour of two steps.
    Entitlements are fully buildable and testable with plan state written directly to the account record,
    and separating them keeps a step of pure application logic away from Stripe account setup, webhook
    plumbing, and signature verification. Sub-numbered (3b) rather than inserted as a new Step 4, so the
    later step numbers do not shift — the same convention as Phase 1's 4a/4b and 5a/5b.
  - **The free monthly email counter lives in Postgres, not the Sheet.** The 200/day cap counts `emailLog`
    rows, which is fine for a limit protecting the teacher's own Gmail reputation, but a paywall cannot be
    enforced from a spreadsheet the teacher can edit. The monthly count is a per-user integer in our
    database — a count with no PII, inside the durable-storage boundary — and `emailLog` stays the audit
    record. Also avoids a Sheets read to total a month on every send.
  - **The analysis views are premium; the indicators are not.** Statistics and the student-detail
    attendance summary are gated. (This bullet previously listed History and the heatmap as gated too;
    corrected in the Step 5 pass — see the `/attendance/range` entry above for what shipped and why.)
    The roster's warning icons and the email
    templates' `atRisk` / `lateCount` conditions stay free: at-risk is a flag the teacher sets by hand
    rather than analysis the app performs, and the conditions belong to a tool the free tier already has.
    Gating them would degrade two free tools and make the roster least informative for the accounts most
    likely to upgrade. `GET /students/:id/detail` is therefore not gated as a whole — it omits the
    attendance payload on `free` and still serves contact details, notes, and IEP records.
  - **A configurable high-absence threshold is a new premium feature in this step** (`GET` / `PUT
    /settings`, stored on the account, one threshold per account rather than per class). The flag is
    computed on every plan; choosing where it sits is premium. On `free` the flag is computed with the
    **default** even when a stored override exists — "stored but not applied", the same rule grouping
    constraints follow — so the free tier keeps a single fixed definition and a free account's tooltip
    always reads 15%. `GET /settings` returns the effective threshold plus a `storedOverride` when the two
    differ, so a lapsed teacher can be shown what upgrading restores. `PUT` is gated; `GET` is not,
    because the tooltip must name the threshold on every plan.
  - **The threshold is now stated in the UI wherever the flag appears** ("High absences (over 15% of
    recorded days)"), which it was not before. A teacher cannot judge a warning whose rule they cannot see.
  - **The quota indicator shows the limit that binds.** On `free` the Email tool reads the monthly
    allowance ("18 of 30 remaining this month"), not the daily one; `remaining` from
    `GET /email/send-status` is always the lower of the two so a client reading only that field cannot
    overstate what may be sent. Rejected the alternative of an additional per-send recipient cap on free:
    30/month is already useless for spam, the 60-per-10s burst limit and 200/day cap still apply, and a
    second dimension complicates the story a teacher has to understand.
  - **A development-only plan toggle ships with the step**, as a menu item beside Sign out cycling `free`
    → `trial` → `paid`. Chosen over a database script because most of Step 3's manual testing is
    presentation, and watching a control change state without leaving the page is a much faster loop.
    Three guarantees make it safe to have in the codebase: (1) the endpoint requires the session's
    `google_sub` in a `DEV_TOOLS_GOOGLE_SUBS` allowlist **and** a non-production `NODE_ENV` — an allowlist
    alone turns a typo or a copied `.env` into a live entitlement endpoint, an environment check alone
    lets anyone on a dev deployment self-grant premium; (2) it writes only `plan_override`, never the
    Stripe-managed subscription fields, so Step 3b's webhook stays the sole writer of billing state and
    the two can never disagree; (3) it answers **404**, not 403, so probing cannot confirm it exists.
    `GET /auth/me` gains a `devTools` flag, which is a rendering hint the endpoint re-checks rather than
    trusts. It cycles three states rather than toggling premium/free because a premium control on `trial`
    is simultaneously live and badged — the only state with that combination, and so the one most likely
    to be built wrong. Noted deliberately: this is a hidden entitlement-mutating endpoint in a codebase
    headed for OAuth verification, accepted on the strength of the doubled guard.
  - **`plan_override` doubles as the comp-account mechanism** for support (Step 4), so that need does not
    later invent a second path into plan state.
  - Reconciled conflict: DESIGN_SYSTEM described the high-absence default as "5 absences, or a 10%
    absence rate", which is not what shipped. Corrected to the actual rule — an absence rate over 15%
    across at least 5 recorded days (`HIGH_ABSENCE_RISK`) — and the stale note that configurable
    thresholds would arrive with the deferred automated-communications feature was replaced.
- **Session design → opaque server-side sessions, per-session CSRF token, gating at the router mount.**
  Four choices settled while building Step 2; the mechanics are in the Step 2 work-log entry above, and the
  reasoning is here. **Opaque id, state server-side**, because the point of the step was making sign-out a
  revocation — a self-describing cookie stays valid until it expires no matter what the server does. Storing
  only the id's hash means a database dump yields nothing replayable; the signature is kept purely so a
  forged or truncated cookie is rejected without a database round trip. **`last_seen_at` is rewritten at
  most hourly** because a session write per request would have put a database write on the hot path of every
  read, which is the opposite of the read-cost work in Phase 1. **CSRF is a per-session token, not
  double-submit:** with sessions already server-side there is a natural place to keep the authoritative
  token, so the client never holds it in a readable cookie. `SameSite=Lax` stays as the layer beneath it
  (Lax alone still permits some top-level cross-site POSTs), and `Lax` rather than `Strict` because the OAuth
  callback is a cross-site redirect that must carry the cookie. The client replays a `CSRF_INVALID` request
  exactly **once**, which covers a re-sign-in in another tab without risking a loop. **Gating moved to the
  router mount** rather than each handler checking for itself: a new endpoint is then authenticated by
  default instead of by remembering to add a line. Logout is idempotent — signing out when already signed
  out clears the cookie and returns 204 rather than erroring.
- **Free vs paid account model → settled.** Three plan states (`free`, `trial`, `paid`); `trial` and `paid`
  are entitlement-identical. **Free:** full roster, full IEP tracking, attendance daily entry, both Name
  Picker modes, random grouping, and mass email capped at **30 sends per calendar month**. **Paid:**
  attendance statistics + history + at-risk flags, email above the free cap (to the existing 200/day cap),
  grouping constraints, and all display/styling options (Grouping's and the Name Picker's Display options
  modals). **Trial: 30 days**, full access, no card up front; expiry **drops the account to free, never a
  lockout**. Free accounts are provisioned a spreadsheet immediately. The full split, with the reasoning per
  feature, is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2 Step 3; the UI affordance is in
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) ("Premium feature affordance"); endpoints, `PREMIUM_REQUIRED`, and
  `MONTHLY_EMAIL_CAP` are in [API_CONTRACT.md](API_CONTRACT.md). The load-bearing rationale:
  - **Attendance entry free, analytics paid** is the core of the model. Entry is the daily-habit loop and
    the engine that accumulates the data that *is* the switching cost; analysis is the payoff for that
    effort, and the gap between them is the product's most natural upgrade moment, arriving on its own.
  - **IEP is free** despite being a strong differentiator. Charging teachers for the tool that helps them
    deliver legally mandated accommodations to students with disabilities is a reputational liability that
    outweighs the revenue in a market whose buyers talk to each other and whose distribution depends on
    school-board goodwill. Accepted consequence: the paid tier now rests almost entirely on Email plus
    attendance analytics, which makes Email load-bearing for the whole business.
  - **The 30/month free email allowance replaced a longer trial.** A 90-day trial was considered and
    rejected: on an Ontario semester it would expire *after* the midterm communications crunch rather than
    during it, handing the peak-value moment away for free and prompting an upgrade in the quiet stretch
    afterward. It would also delay the founder's first real conversion signal by three months, vary wildly
    in effective length by signup date (an April signup burns a third of it on summer break), front-load
    infrastructure cost against back-loaded revenue, and turn the drop to free into a cliff. The standing
    allowance solves the actual problem — that the value moment for Email arrives late and unpredictably —
    by keeping the tool present whenever the need shows up, and a teacher who hits the cap mid-send
    discovers the paywall at the exact instant they most want the feature. The cap is also the abuse and
    deliverability control that a paywall used to provide (30/month is useless for spam), which matters
    because free-tier sending rides on the OAuth app's own reputation during and after Google verification.
  - **Trials are extended, never clawed back.** An individual trial can be extended with one database
    update, so the default is deliberately short and extensions are a case-by-case goodwill lever.
  - **Gate decoration, never legibility.** Grouping's Scale and fullscreen, the Name Picker's Size,
    fullscreen, and sound, and the app-wide theme stay free — they govern whether projected content is
    readable across a room, which is accessibility, not cosmetics. Only the Display options modals are paid.
  - **Marble race (Phase 3 candidate) is premium-only in its entirety** if built — the Style option itself,
    not just its display options.
  - **No middle tier**, and **no cap on classes for free accounts**: a class cap would land hardest on
    secondary teachers with five or six sections, who have the most administrative pain and the highest
    willingness to pay. If a free-tier quota valve is ever needed, a total-student cap is the next lever.
  - **Enforcement is server-side** on every gated endpoint. The exception is the display/styling options,
    which are cosmetic localStorage preferences gated client-side only, where bypassing gains nothing.
  - Reconciled conflict: the security practices section previously read "require an active subscription
    before granting Google API access" as the quota-abuse barrier. That is incompatible with a free tier and
    has been rewritten (per-user rate limits, the free email cap, and Google's own 60 reads/min/user are the
    barrier instead).
- **Phase 2 database stack → Postgres + raw `pg`, no ORM; native local install.** The account model needs a
  multi-user store; Postgres is the durable choice for a hosted product and for the Phase 2 growth (sessions,
  Stripe, support). Raw `pg` with hand-written SQL and an ordered in-code migration list was chosen over
  Drizzle/Prisma to keep the dependency surface minimal for a small schema, matching the project's
  low-dependency ethos ([DEPENDENCIES.md](DEPENDENCIES.md) updated: `pg` approved, ORMs declined). Local dev
  runs Postgres natively on Windows (Docker and a hosted dev DB were the alternatives). The plan's KMS-held
  encryption key is deferred to the hosting step (Phase 2 Step 6), where the infra to hold it first exists —
  the `TokenCipher` seam lets a KMS impl swap in with no call-site change.
- **Attendance History view (Step 4b) → read-only, single-class, weekday-only, trailing-window grid.** Four
  design choices settled during speccing. **Read-only:** the grid never writes; corrections stay in Daily
  Entry, which already loads a past date and overwrites it — this avoids a second write path, optimistic
  update/rollback, and stray-click edits on a dense grid. **Single class only:** mirrors Daily Entry (attendance
  is taken per class, so a class is always selected), giving one unambiguous row per student; this is where
  History deliberately diverges from Statistics' row-per-enrollment. **Weekday-only columns:** Mon–Fri get
  columns, weekends get none — a small fixed gap between weeks (settled during the build as an 8px transparent
  border, not a rule) marks the boundary so no horizontal space is spent on days that can't hold data, while
  unrecorded weekdays still show a faint "no record" cell because a missed attendance day is worth surfacing.
  **Trailing 26-week window scrolled to today:** reuses the heatmap's constant and open-on-most-recent
  behavior, no date controls to learn. Also decided: the day classifier and status-color map move from
  `features/students/heatmapDays.ts` into the attendance feature so the History grid and the detail heatmap
  share one source of truth (they must never disagree on a color). Refined during the build: a sticky two-row
  header and sticky name column in a bounded scroll container, a faint zebra stripe, and an overlay-bar
  cross-highlight that avoids re-rendering the grid. Specs updated: IMPLEMENTATION_PLAN, DESIGN_SYSTEM,
  API_CONTRACT, TESTING_PLAN.
- **Distribution & legitimacy → publish as a verified Google Workspace Marketplace app.** Managed Google
  Workspace for Education domains increasingly block unconfigured sensitive-scope OAuth apps (the wave that
  followed Google's Aug 2023 third-party-app-access changes); this already happened to a pilot board. A
  Marketplace listing plus OAuth App Verification is what makes the app something a board admin can
  allowlist/trust, and is the end-goal distribution channel. It changes no product feature or data model —
  it is a production-footprint + verification + listing layer over the existing web app. See
  [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2.
- **Business model → stays B2C: individual teachers register and subscribe directly.** The target customer
  remains the individual teacher ($6.99/month or $69.90/year CAD, single plan), billed through our own Stripe
  integration (Phase 2). The Google Workspace Marketplace does not process payments and the board is not
  the buyer; listing there is for trust and allowlisting, not sales. Trust and billing are independent: a
  board admin allowlisting the app is a governance action, not a purchase.
- **Managed-domain onboarding → per-board allowlisting path.** Only a domain admin can lift the OAuth
  block, so onboarding gains a per-board allowlisting step: the admin trusts/allowlists the Marketplace app
  (optionally scoped to an org unit of requesting teachers), then individual teachers install, consent (now
  unblocked), and subscribe. To make that approval fast we need a plain-language data-handling summary and a
  signable DPA template; the no-durable-PII design (Sheets on the teacher's own Drive, no student PII stored
  server-side) is the primary asset for passing a board privacy review (Ontario boards commonly require a
  PIA / signed data agreement). This is a go-to-market gate, not a code change. Individual install uses the
  normal per-user consent flow, so no admin-delegated/silent-consent flow is needed and the account model
  stays per-teacher.
- **OAuth scope discipline → stay in the sensitive/non-sensitive tiers; never request a restricted scope.**
  The current scopes — `gmail.send` (sensitive), `spreadsheets` (sensitive), `drive.file` (non-sensitive) —
  require OAuth App Verification but **not** the annual third-party security assessment (CASA), which is
  triggered only by *restricted* scopes (full `drive`, any Gmail read scope, etc.). Adding a restricted
  scope would trigger CASA and its recurring audit cost and enlarge the data-access surface a board must
  approve, so avoiding them is now a hard design constraint. `gmail.send` staying sensitive is what lets
  email be sent from the teacher's own address without incurring CASA.
- **Students in multiple courses → Option C (enrollments join).** A dedicated `enrollments` tab keyed
  `(studentId, course)`, with attendance keyed `(studentId, course, date)`. Chosen because attendance
  is genuinely per class per day, and because it is the only durable model that keeps one student
  record for identity and IEP while supporting per-class attendance. Adopted before Steps 5–6 built
  further on the single-course assumption.
- **Schema migration → automated runner shipped (superseded the clean-reset policy).** The v1→v2 and
  v2→v3 bumps were originally handled by deleting the sheet and letting the next bootstrap recreate it
  (clean reset), acceptable pre-launch with only disposable placeholder data. That is no longer the
  policy: bootstrap now brings an existing sheet up to the current schema automatically, in two layers
  (pulled forward from "the first post-launch change should ship a runner" because re-seeding during
  development was costing time). **Layer A — additive reconciliation** ([bootstrap.ts](server/src/services/bootstrap.ts)
  `reconcileSchema`): a tab whose header is a *prefix* of the current schema (new trailing columns were
  appended) is extended in place by rewriting row 1; new columns are nullable/defaulted so existing rows
  need no backfill (a blank cell reads as the default). This alone covers the common case (it would have
  handled v2→v3's `enrollments.atRisk`) with no per-bump code. **Layer B — version-gated registry**
  ([migrations.ts](server/src/services/migrations.ts)): an ordered `{from,to,migrate}` list for
  non-additive changes (renames, removals, data transforms), applied from the stored `schemaVersion`
  toward the code target, stamping the version after each step, with a best-effort Drive backup copy
  before the first step. The registry is empty today (no non-additive bump has shipped since). A header
  that diverges from the schema in an existing position (not a clean prefix) with no registered migration
  still fails closed with `SHEET_HEADER_MISMATCH`. Bootstrap runs Layer B, then Layer A, then restamps
  the recorded version to the target.
- **Bulk add → server batch endpoint (`POST /students/batch`), all-or-nothing.** Bulk add previously
  issued one `POST /students` per row in a serial client loop, and each create did ~4–5 sequential Sheets
  round-trips (header-validate + append for the student row, read + append for enrollments), so a 16-row
  add cost ~70–80 serial calls and took 15–30s. The endpoint now appends all student rows in one Sheets
  call and all enrollment rows in one more (`appendRows` on each tab), ~4 calls for the whole batch
  regardless of size. Validated per-row by the same Zod schema as the single create (capped at 100 rows);
  any invalid row rejects the whole request and creates nothing. All-or-nothing replaced the old per-row
  partial-success/keep-failed-rows UX — acceptable because the client validates every row before submit,
  so the realistic remaining failure is a Sheets error that fails the batch wholesale (the rows are kept
  for retry). See [API_CONTRACT.md](API_CONTRACT.md).
- **System of record → Google Sheets in all phases; PII boundary is _durable storage_, not _touching
  the server_.** The precise rule (corrected from the looser "the server never sees the data"): the
  server never durably stores, persists to disk, writes to a database, or logs student PII. PII does
  transit and is transiently cached in RAM during a request, because the server is the intermediary for
  every Google API call. That transient processing is permitted, kept minimal, and never persisted. This
  distinction is load-bearing: it is what the scaling work below is allowed to operate within, and it is
  now the wording in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The teacher (and their
  school/district) is the data controller; we take on no durable custody, to minimize liability and
  compliance surface.
- **Sheets read-quota strategy → cut calls per user, raise/pay the ceiling; never a durable PII replica.**
  The binding limits (confirmed against Google's docs): 300 reads/min and 300 writes/min per **project**
  (shared across all users, the real scaling cliff), 60/min per **user** for each (scales with the user
  base). Because the boundary above forbids a durable server-side PII store, mitigation stays within
  "fewer, smarter Sheets reads plus ephemeral in-memory state," never a durable read replica. Shipped:
  header+data collapsed into one read, `values.batchGet` for multi-tab reads, and 429s surfaced as a
  retryable `SHEET_RATE_LIMITED` rather than a hang. Also shipped (Phase-1 backlog, now closed): a
  single-flight `getOrLoad` seam that coalesces concurrent misses onto one call (clearing the in-flight
  promise on settle incl. rejection so a failed read never poisons the key), a shared `iep-all` cached read
  that the roster summary / per-student `listIep` / student detail all derive from, and a merge-not-drop
  `updateCached` seam that keeps the hot editing loops warm.
- **Cache model → cache derived domain objects, merge by id; row numbers live only in the write path.**
  The per-user cache holds derived typed objects (`Student[]`, `Enrollment[]`, `IepRecord[]`, an `iep-all`
  set, attendance records, a per-course groupings map, …), not raw sheet rows. Reads derive-and-cache;
  mutations write through to the Sheet (which re-reads the tab fresh for the affected row's number), then
  either merge the result into the warm derived cache keyed by the object's `id` (`updateCached`, for the
  hot single-/few-row editing loops) or invalidate it (cross-tab cascades like student delete). Because row
  numbers are only ever needed by the write path's fresh read, the read cache never tracks them, so appends
  into a derived list are safe. `getOrLoad` (single-flight read) and `updateCached` (merge) are the two
  seams; Phase 2's in-memory working set swaps in behind them with no call-site change.
- **Scale strategy for hundreds of users → approved: read-side in-memory working set (write-through) +
  Drive push invalidation + Drive-export hydration, built in Phase 2.** Approved after deep analysis.
  Rationale and mechanics live in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2 Step 6. Key
  points: (1) hold a teacher's data in RAM for their active session and serve reads from it, dropping
  steady-state reads to ~0 Sheets calls — a quantitative widening of the transient in-memory surface,
  inside the durable-storage boundary, accepted deliberately; (2) **writes stay write-through** (Sheet
  authoritative on every write) — write-behind rejected as too much durability risk for too little gain;
  (3) invalidate via Drive `files.watch`; (4) hydrate cold via one Drive `files.export` (the Drive quota
  bucket is ~16× roomier for whole-file reads and separate from the Sheets bucket); (5) the sticky-vs-
  shared-cache multi-instance choice is made in the Phase 2 hosting step (prefer sticky, to keep PII
  per-instance). **Timing → Phase 2, not now:** the 300/min ceiling is a multi-user problem that does not
  exist in single-user Phase 1, the design depends on Phase 2 hosting/session decisions, and the current
  `cache.ts` seam lets it swap in later with no rework. Drive-export is deferred with it (a single
  `values.batchGet` already covers single-user reads). **In Phase 1, do only:** call-volume
  instrumentation (done — see HISTORY.md) and keep all Sheets access behind the service/cache seam.
- **Quota ceiling → quota increase requested; paid overage is the relief valve.** A per-project quota
  increase has been requested. Google is moving Sheets/Drive quota overage to paid billing (later in
  2026), so the 300/min ceiling becomes a cost rather than a wall; this is the valve for peaks the working
  set does not absorb. Project sharding across multiple Cloud projects is a documented last resort (Google
  discourages it; may draw verification/audit scrutiny).
- **Email daily-cap caching → integer count only.** The server caches the count of today's sends, never
  the `emailLog` rows themselves, which contain recipient PII.
- **Email body safety → sanitize-and-store, plus reject on dangerous markers.** The canonical stored/sent
  `bodyHtml` is always the `sanitize-html` output (strict allowlist matching the editor). A separate
  guard additionally returns `VALIDATION_ERROR` when the incoming body contains markup the editor never
  emits (`<script>`/`<style>`/`<iframe>`/event handlers/`javascript:`), satisfying the "reject raw HTML"
  test without risking false positives on benign formatting. Chosen over exact round-trip comparison,
  which is brittle against sanitizer normalization.
- **Email preview → sandboxed `iframe srcDoc`, not `dangerouslySetInnerHTML`.** The latter is banned
  project-wide. An empty `sandbox` disables scripts, so even unexpected HTML renders inert.
- **Rich-text editor → TipTap StarterKit narrowed to the sanitizer allowlist; Link via the bundled
  StarterKit extension (v3).** `@tiptap/extension-mention` was **not** installed — placeholders are
  inserted as literal `{{token}}` text via a menu, which is simpler, adds no dependency, and is exactly
  what the substitution operates on. The DEPENDENCIES allowlist anticipated mention for "placeholder
  chips" but leaves first-party extension choices open.
- **Email burst limit → request-based, 60 requests / 10s per user** via `express-rate-limit` on
  `POST /email/send` (keyed on the session sub). Simpler than a rolling per-message counter and
  satisfies the "100 requests in 10s is blocked" test; the hard 200/day cap is the real security
  boundary. Tunable in [config/email.ts](server/src/config/email.ts).
- **Email tool code-split.** `EmailPage` is lazy-loaded so TipTap/ProseMirror (~140 KB gzipped) load
  only when a teacher opens Email, keeping the common Students/Attendance path lean (~91 KB gzipped).
- **Email recipients are per (student, course).** A recipient entry carries a `course`, and a student
  enrolled in several classes appears once per course. `courseName` / `lateCount` / `unexcusedAbsences`
  therefore resolve for that specific class, which suits per-class attendance notices and aligns with
  the deferred automated-communications feature (Phase 3 candidate; also per-course). Chosen over the earlier student-centric aggregation, which
  made "number of lates" ambiguous for a multi-course student.
- **Recipient selection → per-address-kind checkboxes, never raw addresses.** The client sends
  `includeStudent` + `includeParents` (the guardian flag includes all of a student's guardian emails),
  and the server resolves the actual addresses, keeping the "server resolves addresses" invariant. The
  one deliberate exception is the optional teacher-entered `copyAddress` (CC/BCC on every message,
  default BCC), validated as an email — a scoped relaxation of "the client never supplies email
  addresses."
- **Template conditionals → bounded, server-owned comparison, not an engine.** The security spec bans a
  logic-capable templating engine (server-side template injection risk). A condition is therefore a
  fixed metric + fixed operator + one validated literal, parsed by a small hand-written grammar, with
  no expression evaluation. It is stored in a `data-if` attribute the sanitizer explicitly allows and
  validates on block tags, dropped/stripped at send. This keeps the "logic-less string replacement"
  posture: the only teacher-controlled part of a condition is a number or a boolean. Malformed
  conditions are rejected on save and fail closed at send.
- **Gmail communication-history deep link → `authuser` query param, not an email in the path.** The
  link uses `https://mail.google.com/mail/?authuser=<teacherEmail>#search/<query>`. The originally
  planned `/mail/u/<teacherEmail>/` form returns a hard 404 — Gmail's `/mail/u/<n>/` path segment
  accepts only a numeric account index, never an email (percent-encoding the `@` is not the issue; the
  path form is simply unsupported). `authuser` still resolves to the correct account when several Google
  accounts are signed in, which was the reason for targeting by email. Verified by live testing against a
  real multi-account session. The teacher email is left literal in the query value (Google account
  addresses contain no `&`/`=`/`#`); only the search query is `encodeURIComponent`-escaped.
- **IEP accommodation types → fixed set of 7 for Phase 1.** May be revisited after Phase 1.
- **Name picker / grouping / seating → shared roster with a class dropdown filter.** Single source of
  truth; each tool scopes to a course.
- **User-facing terminology → "Class"; the schema/code term stays "course".** Every visible label a
  teacher reads uses "Class"/"Classes" (the scoped-tool dropdowns, the roster filter + sort option, the
  stats table column, the add/bulk-add enrollment fields). The Sheets schema, API, and all identifiers keep
  `course`/`courses` — this is copy only, no data change. Settled during the Step 9 consistency pass;
  teachers say "class," so the visible copy matches that even though the data model is course-keyed.
- **Offline behavior → read-only mode with cached data.** When Sheets is unreachable, show the last
  cached data behind a prominent unavailability banner rather than failing.
- **Accent color → warm orange-gold `#ffab00`, on larger elements and badges only.** Restricted to
  larger UI elements and badges in both modes; never used as text color, since it fails WCAG AA on both
  light and dark surfaces at body-text sizes.
- **Default theme → light mode.** Toggle to dark in the top bar; preference persists in localStorage.
- **OAuth scopes → `spreadsheets`, `drive.file`, `gmail.send`.** `drive.file` is required for the Drive
  `appProperties` discovery marker.
- **Saved groupings → one current grouping per course, auto-saved (no history).** The `groupings` tab
  holds one row per group (shared `groupingId`), keyed by a `course` column. Each class keeps exactly one
  active grouping: every change (generate, drag a student between groups, renumber) upserts it
  (soft-deletes the course's prior active rows, appends the new arrangement), and opening the page or
  switching class restores it. This replaced the earlier multi-save + History design — a teacher wants
  "the current seating for this class," not an archive. Endpoints: `PUT /grouping/current`,
  `GET /grouping/current?course=`. Existing sheets gain the tab/`course` column via reconciliation (still
  v3).
- **Grouping generation → exactly one of `groupSize` or `groupCount`.** Supplying both or neither is a
  validation error.
- **Grouping is class-scoped → `generate` takes a `course`.** Step 7 scopes to one class at a time (the
  shared-roster + course-dropdown decision above), but the original `POST /grouping/generate` contract
  named no population. Resolved by adding a required `course` field to the generate body; the server
  resolves the population from that course's active enrollments (the client never sends a student list),
  mirroring how attendance and email scope by course. Recorded in [API_CONTRACT.md](API_CONTRACT.md).
  `save` needs no course — it persists the client-provided groups directly.
- **Grouping display → groups-as-cards on an arranged canvas, not a positional seating chart.** The
  backend models groups only (`groupings` = studentIds per group, no desk coordinates); the "Seating
  Creator" need is met by rendering each group as a labeled **"Group N"** card laid out across a canvas so
  students can find their group when projected. The projected view (DESIGN_SYSTEM "Grouping
  Tool" section) supports: **drag-to-move** a student between groups and **◀/▶ renumber** controls on each
  card (both auto-persist); a generous **scale** control (one em-based font-size knob, unitless
  line-height so names don't overlap); **fullscreen** (Fullscreen API, groups centre vertically); and a
  **Display options** modal (font, header colour, leader-star) stored in localStorage. The originally
  planned **hide-controls** toggle and **History** view were dropped in the refinement pass — fullscreen
  covers the clean-projection need, and persistence is one-current-per-class (above), so there is nothing
  to browse.
- **Group generation → client-side, with a debounced auto-save.** Generation was originally a server
  round-trip (`POST /grouping/generate`) plus a second write, which made Regenerate feel laggy and
  un-mashable. The solver is a pure function over data the client already has (the roster) plus
  constraints (one cached fetch), and generating client-side leaks no PII (the client already shows every
  name). So the client now runs a **mirror of the solver locally** for instant, mashable Regenerate, and
  persists the arrangement with a **~900ms debounce** so a flurry of presses/drags collapses into a single
  `PUT /grouping/current`; class-switch and unmount flush the pending write. Trade-off accepted: the pure
  solver exists in two places (server `services/groupingAlgorithm.ts` and client
  `features/grouping/groupingAlgorithm.ts`), each unit-tested and marked "keep in sync"; a `shared/` module
  was rejected as more invasive than duplicating a stable ~150-line pure function (the repo has no root
  package and separate client/server tsconfigs). The server `POST /grouping/generate` endpoint stays for
  the documented API but the web client no longer calls it. **Known, accepted consequence of the debounce:**
  refreshing within ~1–2s of a drag/regenerate can briefly show the pre-edit grouping — the debounced write
  (plus the multi-call Sheets save) may not have landed before the reload's read fires; the edit is not lost
  and appears on the next load. Reviewed and left as-is (a "Saving…"/`beforeunload` guard is the fix if it is
  ever worth closing). This is unrelated to the read-cache work — the same race exists under both the prior
  drop-and-reread and the current merge-on-write cache behavior.
- **Grouping conflict semantics → `CONFLICT` (409) for two cases.** A pair required both `together` and
  `apart` (directly or transitively via together-clustering), and `apart` rules that cannot fit the
  requested number of groups, both fail closed with `CONFLICT`. Constraints naming students outside the
  scoped course's population are ignored rather than erroring.
- **Name picker → entirely client-side, no server endpoint or schema change.** Selection runs in the
  browser over the roster `useRoster` already holds (`GET /students`), so a pick is instant and mashable
  and adds nothing to the Sheets read load. The winner is decided up front by a uniform `pickRandom`
  (injectable RNG, distribution-tested) and only then handed to the animation, so a mode's visuals can
  never bias the outcome. Recorded as "no new endpoints" in [API_CONTRACT.md](API_CONTRACT.md).
- **Name picker modes → card deck + wheel shipped in Phase 1; marble race moved to Phase 3.** The two
  committed modes per the plan shipped; the marble-race physics mode was demoted out of Phase 1 to a
  post-launch Phase 3 candidate (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3 and the Next
  Step section). Two pure helpers back the shipped modes (`picker.ts` selection, `wheelGeometry.ts`
  geometry), each unit-tested; the animation quality itself is a manual-verification item.
- **Marble race fairness → sim-decided, not `pickRandom`-decided.** Unlike the card-deck and wheel modes,
  the marble race is intended to be mostly-realistic physics, so its outcome is non-deterministic and the
  simulation itself picks the winner. `pickRandom` and the "animate a pre-chosen winner" pattern therefore
  do **not** apply to this mode. Fairness instead has to be engineered into the sim via symmetric,
  randomized initial conditions (equal geometry per marble plus small independent perturbations to launch
  position/velocity/force) that give every marble an equal expected chance, validated empirically over many
  simulated runs rather than from a uniform draw. `prefers-reduced-motion` for this mode resolves to a
  winner without the visible race (likely a single fair `pickRandom` draw as the fallback). Recorded now
  because it changes the mode's architecture; the build itself is a post-launch Phase 3 candidate (see
  [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3), not scheduled Phase 1 work.
- **Name picker exclusion → per-round "don't pick twice" with an explicit Reset.** Optional toggle; a
  drawn student leaves the pool until Reset, an emptied pool shows an "Everyone has been picked" state
  rather than erroring, and switching class starts a fresh round. Style + exclusion persist in
  localStorage. Every unique winner is recorded regardless of the toggle, so turning exclusion on later
  still behaves correctly.
- **Name picker reduced motion → skip the JS timers, not just the CSS.** Under `prefers-reduced-motion`
  both modes resolve straight to the result via a `usePrefersReducedMotion` check, on top of the global
  reduced-motion CSS rule, so the reveal is instant rather than a near-zero-duration transition.
- **Attendance stats default range → all recorded data.** No school-year boundary; the client passes an
  explicit range to scope the view.
- **Automated Attendance Communications (Step 6) → tabled and moved to Phase 3 as a candidate.**
  Deferred during Step 6 planning (worth building, but no longer a committed Phase 1 deliverable). The
  choices made before tabling, to honor if it is built (full description in
  [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3): (1) the interface lives in the **Email tool
  as its own tab** (Compose / Templates / Automation), not in Attendance; (2) the pending-review
  indicator is a **badge on the Email sidebar item** (supersedes the earlier Attendance-sidebar badge) —
  and because every send stays teacher-approved and synchronous, it is a review-queue count, not a
  background-send alert; (3) **no per-student automation marker on the Attendance page** in the first
  cut, and if added later it stays a distinct marker separate from the high-absences flag; (4) the only
  lever in the first cut is **number of absences**, with date/frequency-per-unit-time and
  duration-based "at risk" levers explicitly deferred within the candidate (**superseded 2026-09-09**:
  the candidate's first cut now carries five levers, adding rolling-window absences, consecutive
  absences, lates and a recurring cadence; only the duration-based "at risk" lever stays deferred, and
  the teacher-approved synchronous send was re-examined against the cadence lever and kept; **decided
  2026-09-10**, a cadence rule is evaluated on the teacher's next visit after its period closes rather
  than by a background job, because background evaluation would read a sheet with a stored token while
  no session exists and would buy nothing, since every send waits for the teacher anyway); (5) absence counts are
  scoped **per course**, so the queue dedupe key and `emailQueue` row gain a course dimension (schema
  change, cheap as a clean reset pre-launch). The `attendanceRules` / `emailQueue` tabs and their
  API_CONTRACT endpoints already exist but are provisional and predate the tabling — revisit before
  building.
- **Attendance rules queue → at most one item per (rule, student), any status.** No repeat option;
  queue items are approve/reject only (no edit). (Recorded from the tabled Step 6 design; carries into
  the Phase 3 candidate, where the dedupe key also gains a course dimension per the decision above.)
- **Attendance summary on student detail → live summary + heatmap.** Wired up in Step 4, replacing the
  Step 3 placeholder.
- **Landing page → the roster (Students page).** No separate dashboard view.
- **Search bar → none.** A single teacher's data set is small enough for in-tool filtering.
- **Notifications → no top-bar icon.** Automated attendance-communication alerts show inline as a badge
  on the Attendance sidebar item.
- **Toasts → not built in Phase 1; inline confirmations are the accepted solution.** The DESIGN_SYSTEM
  toast component (bottom-right, auto-dismiss) is not built; feedback stays inline within the acting view
  (the Email "sent" banner, the bulk-add summary, per-field validation). An **inline/toast hybrid** — keep
  inline banners for contextual feedback, add corner toasts only for transient, location-independent
  success confirmations — is recorded as a **Phase 3 consideration** in
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (Toasts / Notifications). Chosen because inline feedback sits next to
  the control that produced it, which suits Phase 1's forms.
- **Tool toolbar → per-tool.** Each tool defines its own toolbar layout; there is no universal template.
- **Sidebar order → fixed.** Students (roster + IEP), Attendance, Grouping, Name Picker, Email.
- **Sidebar icons → initial Lucide set chosen.** Will iterate later (see DESIGN_SYSTEM Iconography).
- **Destructive actions → confirmation modals, not optimistic undo.**
- **Keyboard shortcuts → deferred to a later phase.**
- **Students page layout → list/detail (Gmail inbox/email pattern).** Roster list with per-row IEP
  indicators; clicking a student opens a full detail view (contact, notes, attendance summary, and a
  read-only IEP panel whose toggles live in an edit modal); the back button returns to the list.
- **Dev runtime → `tsx` instead of `ts-node`.** `ts-node`'s ESM loader silently exits under Node 22 +
  NodeNext. Recorded in [DEPENDENCIES.md](DEPENDENCIES.md), along with `@tailwindcss/postcss` (Tailwind
  v4's PostCSS adapter) and `jsdom` (Vitest environment).

Early setup and cleanup (done): removed Vite template boilerplate; removed `@react-oauth/google`
(OAuth is server-side), `jsonwebtoken` (cookie sessions in Phase 2), and `stripe` (Phase 2); `npm audit
fix` on the client; set the `index.html` title; authored CLAUDE.md; designed SHEETS_SCHEMA; drafted
API_CONTRACT and the DEPENDENCIES allowlist; converted schema field names to camelCase (column codes
unchanged).

### Accuracy sweep of the public documents against the deployed product

2026-09-12. Every page a teacher, board or reviewer reads was checked against the code rather than against
the planning documents: the privacy policy, the terms, `/for-admins`, the FAQ, Managing your data, the
landing page and the in-app help rows. Both legal documents move to `2026-09-12` and re-prompt, because the
terms still said 200 emails a day "and lower limits on some plans" after 8a had made it 120 with no plans.
The full list of corrections sits beside the version in `legalMeta.ts`.

**One finding was the code, not the copy.** `lifecycle_emails` rows carry the teacher's email and name,
account deletion enqueues the confirmation after nothing else will ever clear the account's rows, and so
every deleted account left its welcome and deletion rows behind indefinitely, against the policy's promise
that account information is gone within 30 days of closure. An hourly sweep now deletes finished rows (sent
or abandoned) whose account no longer exists, leaving an unsent confirmation its retries. The SQL was run
against a local database inside a rolled-back transaction; the in-memory double carries the unit tests,
since the suite has no Postgres.

Also found: Managing your data called the spreadsheet "the only copy" while pre-migration backups sit
beside it in Drive, so the deletion instructions now name them; the landing page's "We never hold student
information" and "nothing more" became the durable-copy wording; the cookies section now lists the OAuth
state cookie; `SHEETS_SCHEMA.md` and a `bootstrap.ts` comment no longer claim the `meta` marker recovers a
teacher's hand-made copy.
