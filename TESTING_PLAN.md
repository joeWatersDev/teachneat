# Teachneat — Testing Plan

This document defines how to verify completion of each feature listed in the implementation plan. Tests are organized by phase and step, matching the structure of IMPLEMENTATION_PLAN.md.

---

## Testing Tools & Conventions

- **Client unit/component tests:** Vitest + React Testing Library
- **Server unit/integration tests:** Vitest + Supertest for HTTP assertions
- **E2E tests:** Playwright (runs against a local dev server with mocked Google APIs). **Approved in
  [DEPENDENCIES.md](DEPENDENCIES.md) but not yet installed**, so every criterion below that names a
  Playwright viewport test is currently unimplemented and its coverage is manual. The responsive checks have
  been run by hand instead (Step 9's audit and the per-step manual/visual items); this note exists so that
  reads as a known gap rather than as passing coverage.
- **Manual verification:** noted where automated testing is impractical (animations, visual polish)
- **Google API mocking:** all tests that touch Google Sheets or Gmail use a mock service layer, never real API calls. A small set of labeled integration tests may hit a real test spreadsheet for schema validation, run separately from the main suite.

---

## Phase 1

### Step 1 — Google OAuth + Sheets Bootstrap

**OAuth flow**
- Server returns a redirect URL to Google's consent screen when the client hits the auth endpoint.
- After consent, the callback endpoint exchanges the authorization code for tokens and stores a refresh token.
- If the authorization code is invalid or expired, the server returns an appropriate error (not a stack trace or internal details).
- Requesting a protected route without a valid session returns 401.

**Spreadsheet bootstrap**

- On first login, the service creates a new spreadsheet on the user's Drive with the full set of tabs, column codes, and required `meta` rows defined in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md). Assert the Sheets API `create` call includes the correct sheet names and that the Drive `appProperties` marker (`tn_app: v1`) is set on the file.
- On subsequent logins, the service finds the existing spreadsheet via both discovery signals (Drive `appProperties` and the `TN_APP_MARKER` row in `meta`) and does not create a duplicate. Assert that `create` is not called when the spreadsheet already exists.
- If the spreadsheet exists but is missing a tab (e.g., user deleted it), the service detects the discrepancy and recreates the missing tab with the correct column codes.
- If a tab's row 1 does not match the expected column codes, the bootstrap refuses to proceed and surfaces a clear error (header validation invariant).

**Token refresh**
- When an access token is expired, the service uses the refresh token to obtain a new one transparently. Mock an expired-token response from Google and verify the retry succeeds.
- When the refresh token itself is revoked, the service returns a response that prompts re-authentication (not a generic 500).

---

### Step 2 — App Shell + Theme System

**Three-zone layout (client)**
- The app renders a top bar, sidebar, and main content area. All three zones are visible at desktop width (≥1280px).
- The top bar is fixed and spans the full width. It contains the wordmark (left) and user avatar + settings + theme toggle (right).
- The sidebar is 220px wide and contains navigation items for each tool.
- Clicking a sidebar navigation item changes the content area to the corresponding tool page. The active item is visually highlighted.
- The sidebar footer displays the Phase 1 placeholder line (real subscription status arrives in Phase 2).

**Responsive behavior (client)**
- At tablet width (≥768px, <1024px), the sidebar collapses to icon-only mode (~64px).
- At mobile width (<768px), the sidebar becomes a slide-out drawer toggled by a hamburger icon in the top bar.
- Playwright viewport tests at 1920x1080, 1366x768, 768x1024, and 375x812.

**Light/dark mode (client)**
- The toggle switch in the top bar switches between light and dark modes.
- The mode preference persists across page reloads (stored in localStorage).
- Light mode is the default for new users (no stored preference).
- All design tokens (backgrounds, borders, text colors) change correctly between modes. Verify by snapshot-testing a representative page in both modes.

**Default landing**
- Navigating to the root URL loads the Students page (once built; before Step 3, a placeholder is acceptable).

---

### Step 3 — Students Page (Roster)

> **Phase 2 Step 8a removed the IEP surface permanently.** The criteria for accommodation CRUD, the
> roster's accommodation indicators and filter, and the detail view's IEP panel are deleted below
> rather than marked skipped, because there is no feature to come back to. The `iep` tab still exists
> in the sheet and is read by nothing; see SHEETS_SCHEMA.md.

**Roster CRUD operations (server)**
- `POST /students` with a valid student object creates a row in the Sheets mock and returns the created record with an internal ID.
- `POST /students` with missing required fields (e.g., no student name) returns 400 with a descriptive validation error.
- `POST /students` with unexpected fields returns 400 `VALIDATION_ERROR`. Service functions never receive passthrough of unexpected data.
- `GET /students` returns all students in the expected format.
- `PUT /students/:id` updates the specified student's data in the correct row. Verify the row index mapping is accurate.
- `DELETE /students/:id` soft-deletes the student (sets `deletedAt`) and cascades the soft delete to the student's enrollment and attendance rows. Verify subsequent reads no longer include the deleted student or their attendance records.
- String fields respect maximum length limits. A student name exceeding the limit is rejected.

**Roster list view (client)**
- The Students page renders a list of student rows fetched from the API.
- Each row displays: student name (with "goes by" in parentheses if set), course, student email, and the two warning indicators (academic risk, high absences).
- The "+ Add Students" button is the roster's only add action and opens the add grid titled "Add Students". Submitting creates the students and the new rows appear without a full page reload. There is no separate single-student add form; the edit modal is edit-only.
- Empty roster state: when no students exist, the page displays an appropriate empty state with a prompt to add the first student.

**Roster list toolbar (client)**
- Filter by course: selecting a course shows only students in that course.
- Filter by alert: "All", then "Academic risk" and "High absences", matching the two warning
  indicators already drawn on the rows. Not premium-gated, because the indicators are not.
- An alert is scoped by the class filter: with a class chosen, a student appears only when the flag
  is set in **that** class. On "All", a flag in any class qualifies.
- Sort by last name (default), first name, or course. Verify each sort produces the correct order.
- While a specific course filter is active, the course sort option is hidden; if course sort was selected, the sort falls back to last name. The option returns when the filter is set back to "All".
- Multiple filters can be combined (e.g., course = MTH1WI-10 AND at academic risk).

**Student detail view (client)**
- Clicking a student row navigates to the detail view. The list view is replaced by the detail content (not a modal).
- A back button at the top-left of the content area returns to the roster list view. The list view preserves its previous filter/sort state on return.
- The detail view displays: student name (large heading), pronouns, "goes by" name, course.
- Contact info section shows student email and parent/guardian email(s). Multiple parent emails are displayed as separate items (not a raw delimited string). The API returns `parentEmails` as a JSON array.
- Attendance summary section shows aggregate data for this student (once the Attendance tool is built). Before Step 4, this section shows a placeholder.
- Notes section allows free-text entry. Notes persist via the API.
- The sidebar remains visible with "Students" highlighted as the active item.

**Student editing and deletion (client)**
- The detail view has an edit mode for modifying student info (name, pronouns, course, contact info).
- The "Delete Student" button (danger styled) triggers a confirmation modal that states the student and their attendance records will be removed.
- After deletion, the user is returned to the roster list view and the deleted student no longer appears.

**Data schema**
- The spreadsheet rows use encoded/opaque column keys, not human-readable labels like "Student Name" or "Guardian Email." Assert that the header row values match the expected column codes defined in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) for each tab.
- The header validation invariant is enforced: if row 1 of any tab does not match the expected codes, reads and writes are refused. Assert that a tampered header row surfaces an error rather than silently corrupting data.

**Pattern validation**
- This is the first full feature module. Verify the code follows the feature-folder convention: components, hooks, and types specific to the Students page live inside `client/src/features/students/`, not in the shared `components/` directory.
- Server routes are in their own file(s), not merged into a monolithic router.
- Route handlers call service functions; they do not call the Google Sheets API directly.

---

### Step 4 — Attendance Tracker

**Daily logging (server)**
- `POST /attendance` records attendance for a set of students on a given date. Verify each student's status (present, absent, tardy, excused) is written as one row per (student, date) per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md).
- Submitting attendance for a date that already has data overwrites cleanly (no duplicate rows).
- Submitting attendance with an invalid student ID in the payload returns 400 (or 404) and does not write a partial record.

**Statistics / aggregation (server)**
- `GET /attendance/stats` returns per-student aggregate data: total absences, total tardies, absence rate, and current consecutive-absence streak.
- Statistics are calculated correctly against known test data. Use a fixture with predictable attendance patterns and assert exact numbers.
- Date range filtering works: requesting stats for a specific range returns only data within that range.

**Threshold detection (server)**
- The service correctly identifies students who have crossed configurable thresholds (e.g., 5 absences, 10% absence rate). Test with threshold values at boundary conditions (student at exactly the threshold, one above, one below).

**Weekend handling (server + client)**
- `POST /attendance` with a Saturday or Sunday date is rejected with `VALIDATION_ERROR` and writes nothing.
- `computeStats` / `GET /attendance/stats` ignore any weekend-dated records: they do not count toward `daysRecorded`, absence totals, absence rate, or the streak.
- A consecutive-absence streak spans an intervening weekend: absences on Thursday, Friday, and the following Monday produce a streak of 3.
- In the entry view, selecting a weekend date renders every student read-only as Excused with the status controls and note fields disabled and Save blocked.

**Class scoping (client)**
- The attendance page has a course dropdown defaulting to the first course alphabetically. (Step 4a removed the "All classes" option — attendance is per class, so a class is always selected.)
- Changing the class updates both the entry list and the statistics table to that class's students.
- Saving attendance while scoped to a class submits only that class's students and leaves other students' records for the date untouched.

**UI (client)**
- The attendance entry page shows the in-scope roster students with a way to mark each as present/absent/tardy/excused, defaulting to present.
- The statistics dashboard shows per-student absence counts and rates.
- Students exceeding a threshold are visually flagged (highlighted, badged, or otherwise distinguishable).
- Selecting a date in the past loads that day's recorded attendance data for review or editing.
- Clicking a student's name in either the entry list or the statistics table navigates to that student's detail view on the Students page (`/students/:studentId`).

**Attendance heatmap (client)**
- The student detail page renders a GitHub-style heatmap below the attendance summary: columns as weeks, rows as the five school days (Mon–Fri; weekends omitted).
- The `classifyDay` classifier maps a day to present (blue), tardy (yellow), absent (red), excused (dark gray), no-record (faint fill), weekend, or future; boundary cases (weekend precedence, future days, unrecorded past school days) are unit-tested.
- The heatmap reads the shared attendance range endpoint and shows only this student's data. With no records it renders nothing (the summary conveys the empty case). It is horizontally centered and scrolls to the most recent week when it overflows.

---

### Step 4a — Students in Multiple Courses (enrollments)

**Schema / bootstrap (server)**
- A freshly bootstrapped spreadsheet contains the `enrollments` tab, the `attendance` tab has the `course` column (`c09`), and the `students` tab has no `course` column. `validateAllHeaders` passes and `GET /bootstrap/status` reports the current `SCHEMA_VERSION` — `2` when this step shipped, `4` today. Assert against the constant rather than a literal, since every additive bump moves it.

**Enrollments service (server)**
- Creating a student with `courses: ["A", "B"]` writes two active `enrollments` rows and `GET /students` returns `courses` containing both.
- A create/update request with a duplicate course name in `courses` (e.g. `["A", "A"]`) is rejected with `VALIDATION_ERROR`.
- Updating a student's `courses` diffs correctly: courses added appear as new rows, courses removed are soft-deleted, unchanged courses are untouched; a previously-removed (soft-deleted) course re-added produces a fresh active row.
- `DELETE /students/:id` cascades a soft delete to the student's enrollment rows as well as attendance.

**Attendance per class (server)**
- `POST /attendance` requires a `course`; a `studentId` not enrolled in that `course` is rejected with `VALIDATION_ERROR` and nothing is written.
- The same student, enrolled in two courses, can hold two different statuses on the same date (one row per `(studentId, course, date)`); submitting one course's attendance leaves the other course's record untouched.
- `GET /attendance/stats` returns one row per `(student, course)`; `computeStats` aggregates each course independently. An optional `course` query scopes the result.

**Multi-course UI (client)**
- The add/edit student form manages a set of courses (add and remove), requires at least one to submit, and sends `courses: string[]`.
- Bulk add parses a comma/pipe-separated course cell into multiple enrollments.
- The roster course filter lists the union of all students' courses and matches a student who is enrolled in the selected course; a multi-course student appears under each of their courses.
- The attendance entry and statistics views, scoped to a class, show and submit only that course. On the student detail page, a multi-course student gets a class dropdown in the attendance panel that scopes both the summary and the heatmap to the selected class; a single-course student shows no dropdown.

---

### Step 4b — Attendance History View

**Range endpoint course scope (server)**
- `GET /attendance/range` with a `course` returns only that course's records in the range; without `course` it returns every course's records, unchanged from before (existing heatmap callers keep working).
- An unknown or malformed `course` on `/attendance/range` is handled the same way `GET /attendance` handles it (validation, no leak of internals). Range ordering and the inclusive bounds are unaffected by adding the parameter.

**Shared classifier move (client)**
- The day classifier and status→color mapping now live in the attendance feature; the student-detail heatmap imports them from there and renders identically to before (its existing tests still pass with no behavior change).

**History view (client)**
- The Attendance page shows three views — Daily Entry, History, Statistics — as tabs under the page header, in that order; selecting History keeps the current class scope.
- **Page tabs (Attendance, Students, Email).** Each tab is its own route (`/attendance/daily|history|statistics`, `/students/roster|classes`, `/email/compose|templates`) rendered as a link marked `aria-current="page"` when active. A page's bare path, or an unknown tab, redirects to the tab last used in this app session, or the first tab, carrying the query string (`/?add=bulk` still opens the add grid). `/` redirects to `/students`. The Students sidebar item stays active on both tabs and on a student's detail view. On Students the class filter is in the header and shows on Roster only, and the roster toolbar reads Sort, Alerts, Add Students; on Email the sending allowance shows under the tabs on Compose only.
- History renders one row per in-scope student, sorted by last name (same order as Daily Entry), with a cell per school day; weekend columns are absent and a fixed gap (not a border) separates each week, with every column staying aligned.
- Alternate rows carry a very faint zebra stripe, and both header rows plus the name column stay stuck (dates on top when scrolling down, names on the left when scrolling sideways) within the bounded scroll container.
- A student's status on a given day paints the correct cell color from the shared classifier (present/tardy/absent/excused), an unrecorded past school day is the faint "no record" fill, and days after today are empty.
- A student in two classes shows only the scoped class's records in History (single-class view); switching the class dropdown reloads the grid for the other class.
- The grid opens scrolled to the most recent day; older days are reachable by scrolling left. Leading all-empty weeks are trimmed to a floor, matching the heatmap window.
- The student-name column is sticky on horizontal scroll and links to the student detail view; it is the only interactive element in the grid (cells are not clickable — History is read-only).
- A cell whose record has a note shows the corner dot; hovering any cell cross-highlights its row and column (the column bar's width matches a normal day, not swallowing the week gap) and the readout line names student, date, status, and note.
- Loading shows the shaped skeleton (a blank header bar and a single name-column row, no day cells); a class with no records in the window shows the empty state rather than an all-faint grid.
- Accessibility: the grid is a real table with row/column headers and visually hidden per-cell status text; status is conveyed in words, not by color alone. Reduced-motion and keyboard focus on the name links behave per the shared conventions.

---

### Step 5 — Mass Email Tool

**Gmail API integration (server)**
- `POST /email/send` with valid recipients and a template sends an email via the Gmail API mock. Verify the API call contains the expected `to`, `subject`, and HTML body.
- The sender address is the authenticated teacher's address (from their Google profile), not a hardcoded or app-level address.
- Sending to an empty recipient list returns 400.

**Template system (server + client)**
- Templates support variable placeholders (e.g., `{{studentName}}`, `{{guardianName}}`). Verify that the rendered output contains the substituted values and no raw placeholder tokens.
- Placeholders containing HTML-special characters in their values are escaped in the output (`<script>` becomes `&lt;script&gt;`).
- Templates are produced from a rich-text editor. The client never sends raw HTML authored by the teacher. Verify the API rejects a request containing raw HTML tags that did not originate from the rich-text editor's output.

**Recipient selection (client)**
- Teachers can select individual students, all students, or a filtered subset (e.g., students with excessive absences).
- Selected recipients resolve to guardian email addresses from the roster. Students without a guardian email are flagged and excluded from the send list.

**Preview and confirmation (client)**
- Before sending, the teacher sees a preview of the email as it will appear to a recipient, with placeholders filled in.
- A confirmation dialog shows the recipient count and requires explicit action before emails are dispatched.
- After sending, the UI shows a success/failure summary.

**Daily send cap (server)**
- Sending more than `EMAIL_DAILY_CAP` emails in a single day returns a rate-limit error once the cap is reached. Verify using a counter mock, asserting against the constant rather than the number, so lowering the cap does not require editing the test.
- The counter resets at the start of a new UTC day (per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) and [API_CONTRACT.md](API_CONTRACT.md)).

**Burst protection (server)**
- Sending a large batch in rapid succession (e.g., 100 requests in under 10 seconds) triggers rate limiting even if the daily cap has not been reached.

**Audit logging (server)**
- Each email send writes a log entry with recipient address, timestamp, and template ID.
- The log entry does not contain the email body.

---

### Step 6 — Automated Attendance Communications (deferred — Phase 3 candidate)

> Tabled during Phase 1 planning and moved to Phase 3. These criteria are retained for when the feature
> is built, but are **provisional**: the interface will live in the Email tool (its own tab) rather than
> Attendance, the pending-review badge will sit on the Email sidebar item, and absence rules will be
> scoped per course. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 3 for the current design.

**Rules engine (server)**
- A rule can be configured: "When a student reaches X absences, queue an email using template Y."
- When attendance data is submitted and a student crosses the threshold, the system queues a communication for teacher review. Verify the queue item references the correct student and rule (guardian email and template are resolved at send time via the rule).
- A rule queues at most one item per (rule, student) pair. Verify a student who already has a queue item for a rule — in any status — is not re-queued by that rule.

**Teacher review flow (client + server)**
- Queued communications appear in a review interface within the **Email** tool, as its own tab beside
  Compose and Templates (not a separate page and not a standalone notification center). The **Email**
  sidebar item shows an inline badge indicating the number of queued communications. Both of these
  supersede the earlier Attendance-tool placement; the badge moved with the interface.
- The teacher can approve or reject each one.
- Approved communications are sent via the same email service as Step 5 (same rate limits, same audit logging).
- Rejected communications are marked `rejected` and do not send.

**Integration with Steps 4 and 5**
- The automated system uses the attendance statistics from Step 4 and the email sending logic from Step 5. Verify by running an end-to-end scenario: log attendance that crosses a threshold, confirm the communication is queued, approve it, and verify the email send mock was called.

---

### Step 7 — Grouping / Seating Creator

**Grouping algorithm (server or client, depending on implementation)**
- Given a roster of N students and a target group size or group count (exactly one is supplied), the algorithm produces groups of the correct size or count (with appropriate handling of remainders).
- Lock-together constraints are respected: students marked as locked together always appear in the same group.
- Keep-apart constraints are respected: students marked as kept apart never appear in the same group.
- Conflicting constraints (lock together AND keep apart for the same pair) are rejected with a validation error.
- Running the algorithm multiple times produces different groupings (randomized), unless the constraint set forces a deterministic outcome.

**Persistence (server)**
- The grouping is written to the Sheets backend and can be retrieved.
- **Each class keeps exactly one grouping.** Every change auto-saves and overwrites the prior one (the
  previous active rows for that course are soft-deleted, the new arrangement appended); opening the page or
  switching class restores that course's saved grouping. There is deliberately no multi-grouping history,
  so there is no list of previous groupings to load — an earlier version of this criterion described one.

**UI (client)**
- The configuration interface allows setting group size and adding/removing constraints.
- The generated groups are displayed clearly, with student names visible in each group.
- A "regenerate" button produces a new random arrangement while keeping constraints intact.

---

### Step 8 — Random Name Picker

**Data source**
- The name picker fetches the current roster from the API. If the roster is empty, the picker shows an appropriate message instead of crashing or animating with zero names.

**Card deck mode (client)**
- The animation plays and resolves to a single student name.
- Each student in the roster has an equal probability of being selected (test by running 1,000 picks against a small roster and checking that the distribution is roughly uniform, within statistical tolerance).
- After a pick, the teacher can pick again. Previously picked names can optionally be excluded.

**Wheel mode (client)**
- The wheel renders with one segment per student name.
- The spin animation plays and lands on a name.
- Same fairness test as card deck mode.

**Marble race mode (stretch goal, client)**
- Marbles render with student initials.
- The physics simulation runs and a winner is determined.
- The simulation is non-deterministic (different outcomes on repeated runs).

**General**
- All animation modes are manual-verification items. Automated tests cover the selection logic (random pick from a list), but the visual animation quality is assessed by eye.
- The picker works correctly with small rosters (1-2 students) and large rosters (40+ students).

---

### Step 9 — Design Iteration

This step is inherently subjective. Testing criteria:

- **Navigation:** every feature is reachable within one click from the sidebar. Verify by enumerating routes and confirming each has a sidebar navigation item.
- **Responsive design:** the app is usable at common viewport sizes (1920x1080 desktop, 1366x768 laptop, 768x1024 tablet). Playwright viewport tests.
- **Visual consistency:** shared UI primitives (buttons, inputs, modals) use a single set of components from `client/src/components/ui/`. No feature module re-implements a button or modal from scratch.
- **Loading states:** every page that fetches data shows a loading indicator (not a blank screen) while the request is in flight.
- **Error states:** API failures produce a user-facing error message, not a blank screen or console error.

---

## Phase 2

### Step 1 — Database & Account Model

- The user table schema includes all required fields: Google ID, email, Sheet ID, subscription status, encrypted refresh token.
- Creating a new user record and reading it back returns identical data.
- The Sheet ID stored for a user matches the spreadsheet created during OAuth bootstrap.
- The migration from single-user to multi-user does not break existing functionality: re-run all Phase 1 tests against the database-backed account model.

### Step 2 — Session Management

Three criteria were revised during the build; the reasoning is recorded under "Session design" in
[HISTORY.md](HISTORY.md) Decisions Made.

- Logging in sets a session cookie that is `HttpOnly`, `SameSite=Lax`, and `Secure` (in production). **Lax, not Strict:** the OAuth callback is a cross-site redirect back into the app and the cookie has to be sent on that navigation; the per-session CSRF token below is what carries the protection Strict would have added.
- The cookie carries an opaque signed session id and no account data, so its contents reveal nothing and cannot be edited into a different identity.
- Requests with a valid session cookie access protected routes. Requests without one get 401. A correctly signed id naming no live session also gets 401.
- CSRF tokens are required on all state-changing endpoints (POST, PUT, DELETE), including `POST /auth/logout`. A request with a missing, malformed, or other-session token returns 403 `CSRF_INVALID`. Safe methods (GET/HEAD/OPTIONS) do not require one.
- The client attaches the token automatically and, on a `CSRF_INVALID`, refetches it from `GET /auth/me` and replays the request exactly once — never in a loop.
- Sessions expire after **14 days of inactivity or 30 days absolute**, whichever comes first. **Not 12 hours:** a 12-hour idle window would sign a teacher out between one school day and the next, and the session is not a bearer of student data (that lives in the teacher's Sheet, behind Google's own auth). Simulate by advancing the clock and verifying a subsequent request returns 401.
- Logout revokes the session server-side: the session row is deleted, so replaying the old cookie returns 401. Logging out with no session is a no-op that returns 204.
- Deleting an account revokes all of its sessions.

**Deferred again: "remember me."** The original criterion (a "remember me" checkbox choosing between a persistent and a browser-session cookie) is still not implemented. Step 5 was named as the revisit point because it would give us a page of our own before the redirect to Google, and it now does — but the sign-in control there is a single anchor to the OAuth route, not a form, so there is still nowhere the choice belongs. The honest options are a checkbox beside the sign-in button (a decision asked of someone who has not yet seen the product) or a setting inside the app, which is the more natural home and is not this step's. The cookie remains persistent for every session. Revisit if a teacher on a shared classroom machine actually asks for it, which is the case that would justify the control.

### Step 3 — Plan Entitlements

**Plan state resolution**
- A new account resolves to `trial` with a 30-day expiry set at creation.
- An account whose trial expiry has passed, with no active subscription, resolves to `free` (not locked out).
- An account with an active subscription resolves to `paid` regardless of trial expiry.
- `trial` and `paid` produce identical entitlement results for every gated endpoint.

> **Phase 2 Step 8a switched the plan split off behind `BILLING_ENABLED`, which defaults to false.**
> Every criterion in this section still applies and is still asserted — the split is dormant, not
> deleted, and code that ships dormant is code that comes back broken unless it is exercised — but the
> suites that assert it declare `withBillingEnabled()` (server) or pass `billingEnabled` (client).
> Criteria for the shipped launch behaviour are listed at the end of this section and are what the
> default run covers.

**Free-tier entitlements (positive cases — these must all succeed on `free`)**
- Roster: create, edit, bulk add, and delete students.
- Attendance: submit and edit a day's entry.
- Attendance: the History view and the student-detail heatmap (`GET /attendance/range`). Both are the
  record of what was taken; only the computed statistics are premium.
- Grouping: generate and save a grouping (without constraints).
- Name Picker: draw in both card deck and wheel modes.
- A free account is provisioned a spreadsheet at onboarding, same as any other account.

**Gated endpoints (negative cases — these must return 403 `PREMIUM_REQUIRED` on `free`)**
- Attendance statistics (`GET /attendance/stats`) and the student-detail attendance summary built from it.
- Grouping constraints: create and read.
- Each returns 200 for the same account once it is `trial` or `paid`.
- A `free` account with previously saved grouping constraints can still generate a grouping; the constraints are ignored, not applied, and the request does not error. After upgrading, the same saved constraints apply again.

**Free email cap**
- A `free` account can send up to 30 messages in a calendar month.
- The 31st send in the same month is rejected with 429 `MONTHLY_EMAIL_CAP`.
- A request whose recipient count would cross the cap is rejected in full; no message is sent and no `emailLog` row is written.
- The counter resets at the start of the next calendar month (UTC).
- `trial` and `paid` accounts are not subject to the monthly cap and are still subject to the hard daily cap.
- Where both caps apply to a `free` account, the lower remaining allowance is enforced.
- `GET /email/send-status` reports the plan state and, for `free`, the monthly count and remaining allowance.

**High-absence threshold (premium to change, visible to all)**
- `GET /settings` succeeds on `free` and returns the default threshold, so the roster tooltip can name it.
- `PUT /settings` returns 403 `PREMIUM_REQUIRED` on `free` and succeeds on `trial` and `paid`.
- A saved threshold changes which students are flagged, consistently across the roster icons, the
  student-detail summary, the Statistics badge, and the email tool's "High absences" recipient selection.
  Assert one saved change moves the flag in all four places, since they must never disagree.
- An out-of-range rate (≤ 0 or > 1), a missing rate, or a non-numeric rate returns `VALIDATION_ERROR` and
  leaves the stored value untouched.
- `minDaysRecorded` is not settable: supplying it returns `VALIDATION_ERROR` (the body is strict), and the
  server writes that field from the product default on every successful update.
- An account that lapses from `paid` to `free` keeps its stored threshold but is computed with the
  **default**; `GET /settings` reports the default as effective and the stored value as `storedOverride`.
  On upgrade the stored value applies again without being re-entered.
- The high-absence tooltip states the effective threshold **rate** in words on every plan, and does not
  name the fixed sample floor.

**Quota indicator reflects the binding limit**
- On `free`, the Email tool's quota indicator shows the monthly allowance, not the daily one.
- On `trial` and `paid`, it shows the daily figure and no monthly figures are returned by the endpoint.
- `remaining` from `GET /email/send-status` is always the lower of the two allowances on `free`, so a
  client reading only that field cannot overstate what may be sent.
- A `free` account at its monthly cap is told when the allowance resets, not merely refused.

**Plan resolution**
- Resolution order is `plan_override`, then an unexpired `trial_ends_at`, then subscription state, then
  `free`. Assert each layer wins over the ones below it.
- Setting `plan_override` never writes `subscription_status` or the billing period, so Stripe's fields stay
  Stripe's alone (verified again in Step 3b against a real webhook).

**Development-only plan toggle**
- `POST /internal/dev/plan` steps the **override** through `none` → `free` → `trial` → `paid` → `none`, and
  the new plan takes effect on the next request without a re-sign-in.
- **The cycle reaches all four positions on an account that has both an unexpired trial and an active
  subscription.** This is the case that breaks a cycle keyed on the resolved plan: clearing the override
  resolves to `trial`, whose successor is `paid`, whose successor is clear again — a two-state loop that
  never reaches `free`. Keying on the stored override is what fixes it.
- Clearing the override reveals the account's real plan rather than forcing `free`, so a real subscription
  is never masked permanently.
- It returns 404 when `NODE_ENV === 'production'`, even for an allowlisted `google_sub`.
- It returns 404 for a session whose `google_sub` is not in `DEV_TOOLS_GOOGLE_SUBS`, even outside
  production. Both guards are checked independently, so neither alone can open the endpoint.
- 404 rather than 403, so probing cannot confirm the endpoint exists.
- `GET /auth/me` reports `devTools: false` in production and for non-allowlisted accounts.
- A client that forges `devTools: true` still cannot change plan: the endpoint re-checks. Assert by calling
  it directly with a non-allowlisted session.

**Entitlement enforcement is server-side**
- A gated endpoint called directly with a `free` account's session (bypassing the client entirely) returns 403. The client's lock state is never the only barrier.

**Client presentation**
- On `paid`, no premium star or lock affordance appears anywhere in the UI, and the sidebar footer shows no legend.
- On `trial`, premium controls carry the premium star and remain fully usable.
- On `free`, premium controls carry the premium star and are disabled, with `aria-disabled="true"` and an accessible description matching the tooltip text.
- Every star carries the accessible name `Premium feature`, so it is never icon-only to assistive technology.
- The sidebar footer names the plan and, on `free` and `trial`, explains the star. At the icons-only sidebar width the sentence is replaced by the star alone, which keeps a tooltip and an accessible name. **Assert this at all three plans and at all three sidebar widths** — a defect where the collapsed star appears on `trial` but not `free` was found by hand and is recorded in [HISTORY.md](HISTORY.md) under Step 3.
- The star's tooltip is reachable by **tap**, not only hover: nearly every device narrow enough to collapse the sidebar is a touch device.

**The launch shape, with `BILLING_ENABLED` off — the default, and what actually ships**
- `resolveEffectivePlan` returns `paid` for an account that `resolvePlan` would place on `free`,
  including one with an expired trial, an explicit `free` override, or a paused subscription. With the
  flag on it agrees with `resolvePlan` on every account. **Asserted in both directions**: that is the
  flag's only behavioural claim, and getting it wrong in the second direction breaks the day billing
  returns rather than today.
- Every formerly gated endpoint returns a non-403 to a `free` account: attendance statistics, grouping
  constraints (read and write), and the high-absence threshold write.
- `requirePremium` short-circuits before its body, so no `premiumAttempt` milestone is recorded. A wall
  no teacher can meet must not pollute the one signal that says whether the split is placed right.
- `GET /auth/me` reports `billingEnabled: false` and **withholds** `trialEndsAt`, `lapsedFrom`,
  `paused`, `pauseResumesAt`, `promoEndsAt` and `currentPeriodEnd`, rather than sending falsy values
  the client would have to know to ignore. `canCancel`, `pauseAvailable` and `hasBilling` are false.
- The lifecycle sweep runs no scheduled scan — all four are billing-shaped, and the trial warning would
  tell a teacher their access is about to change when it is not — while still draining what is already
  queued, so the welcome and deletion confirmations are unaffected.
- The client renders no premium marker, no lock, no tooltip explanation, and no upgrade prompt on any
  plan; the sidebar plan footer is absent entirely rather than empty; the account menu offers no
  upgrade and no plan or trial dev toggle; the account page shows no plan badge and no billing row.
- The email quota chip's tooltip describes the limit that is actually in force, keyed off the same
  `monthlyCap` value the chip reads. It said "more than 30 a month is part of Premium" beside a daily
  figure, which is the class of defect this criterion exists to catch.
- **The top bar's right-hand region stays within the viewport at every width**, tablet included. The account avatar was clipped between the mobile and desktop breakpoints until Step 3a fixed the document overflow behind it, and it is the entry point to the account menu.
- A gated surface reached on `free` shows the fixed sentence "<Feature> is a paid plan feature." — the same wording in every such place.
- Legibility controls (Grouping Scale and fullscreen, Name Picker Size, fullscreen, and sound, and the light/dark theme toggle) are enabled and unbadged on every plan, including `free`.

### Step 3a — Entitlement Presentation Fixes

- **The document never grows wider than the viewport.** On the Attendance page with a `free` account —
  the case where the Statistics tab's tooltip is rendered — `document.documentElement.scrollWidth`
  must not exceed `clientWidth`. The same holds for each tool page at 375px, 768px, and 1280px.
  **This is a manual/browser check, not a unit test:** the client suite runs in jsdom, which has no layout
  engine, so `scrollWidth` is always 0 there and the assertion would pass vacuously. What the unit suite
  asserts instead is the structural guarantees that prevent the overflow — that a right-edge tooltip is
  anchored with `align="end"` (`AttendancePage.test.tsx`) and that `main` carries `overflow-x-clip` and not
  `overflow-x-hidden` (`AppShell.test.tsx`). Since the views became tabs, the same Attendance test also
  asserts that no ancestor between the tooltip and the tab row sets an overflow, because a scrolling tab row
  clips the tooltip out of sight.
- A premium tooltip near the right edge of a page header opens inward, not past the edge.
- The top bar's account avatar is fully within the viewport at every width, tablet included, and its menu
  opens without any part of it offscreen.
- The sidebar's star legend is visible without scrolling at every width, on both `free` and `trial`.
- The Attendance page is visually identical between `free` and `trial` apart from the Statistics tab's
  disabled state and its marker — no layout shift, and no scrollbar that only one plan sees.

### Step 3b — Stripe Integration

- The checkout endpoint creates a Stripe Checkout Session and returns the URL.
- Successful payment (simulated via Stripe test webhook) updates the user's subscription status to active, moving the account to `paid`.
- Subscription cancellation (via webhook) updates the user's status. At the end of the billing period the account drops to `free`, retaining access to all free-tier features. No data is deleted and the spreadsheet mapping is untouched.
- Webhook signature verification: a request with an invalid signature is rejected with 400. A request with a valid signature is processed.
- The webhook route uses `express.raw()` for body parsing. Verify by sending a real Stripe test event and confirming signature validation passes (it would fail if `express.json()` were used). The unit suite also asserts the negative directly: the *same signed request* fails when the router is mounted after `express.json()`, so the ordering constraint cannot be quietly undone by a later refactor.
- An unsigned request, one signed with the wrong secret, and a body that does not match its signature are all rejected with 400 and change no account state.
- Unrecognised event types and events for an unknown Stripe customer are acknowledged with 200 rather than erroring, so Stripe does not retry them forever. A handler failure returns 500, so Stripe does retry.
- `current_period_end` is read from the subscription's **items**, not the subscription — it moved there in recent API versions and reading the old location silently yields `undefined`.
- `past_due` keeps access: a card expiring mid-semester must not lock a teacher out during a lesson.
- A billing event never writes `plan_override`; a comp account stays comped across a subscription change.
- Checkout rejects an unknown billing interval rather than defaulting to one, and the portal answers 404 for an account with no Stripe customer.
- Each configured Stripe Price still charges the advertised amount (checked at startup; a Price's amount can be edited in the dashboard without its id changing).
- **The upgrade path:** annual is preselected in the modal; picking monthly starts checkout with monthly; a checkout failure is reported in place and retryable. The account menu and sidebar footer offer the upgrade on `free` and `trial` but not `paid`; "Manage billing" appears whenever a Stripe customer exists, including on a lapsed `free` account, and opens in a new tab.

### Step 4 — Contact / Support System

The endpoint path was settled during the build as `POST /support/requests` (the router also serves
`GET /support/requests` and the `/support/admin/*` triage endpoints); see
[API_CONTRACT.md](API_CONTRACT.md).

- The contact form submits to `POST /support/requests` and returns 201 with the stored request.
- The submission is stored with a timestamp and the **session's** account. A body carrying its own
  `googleSub` is rejected outright as a validation error rather than ignored, so a client cannot file a
  request as another account.
- `planAtSubmit` records the plan the account held at submission, not at read time.
- Input validation: an empty or whitespace-only message is rejected; subject and message are capped at 120
  and 4000 characters; an unrecognised category is rejected.
- Both endpoints require a session, and the submit endpoint requires the CSRF token.
- `GET /support/requests` returns only the caller's own requests, never another account's.
- Submitting more than 10 requests in an hour from one account returns `RATE_LIMITED`.
- **Allowlist refusals:** a signed-in account that is not in `SUPPORT_ADMIN_GOOGLE_SUBS` receives **404**
  (not 403) from every `/support/admin/*` endpoint, and an empty allowlist gives every account the same 404.
- The admin view lists all submissions in reverse chronological order, each with the submitting account's
  email, name, and subscription state, and filters by status.
- Triage: `PATCH` with a status, a note, or both updates the request; a request with neither is rejected; an
  unknown id returns 404.
- **Comp:** setting a plan override through the admin endpoint writes `plan_override` only — a comped
  account's `subscription_status` and Stripe subscription id are unchanged — and setting it to `null` lifts
  the comp.
- Deleting an account removes its support requests (`ON DELETE CASCADE`).
- **Truncation is reported, not silent:** with more than 100 matching requests, both list endpoints return
  exactly 100 with `truncated: true`, and both views say the list was cut short. A list at or under the cap
  reports `truncated: false`.
- A failed comp write leaves the plan-override dropdown on its previous value rather than showing a comp
  that was never granted.
- **Manual/visual:** the support page and the triage view at 375px and 768px, in both themes; the account
  menu shows "Help and support" for every account and "Support triage" only for an allowlisted one.

### Step 5 — Public Surface

- The landing page loads without authentication and **without a redirect to Google**. This is the behaviour
  change: previously any unauthenticated visitor was bounced to the consent screen.
- A deep link into a tool while signed out lands on the landing page, not on a Google error and not on a
  half-rendered shell.
- The two signed-out states stay distinct: a first visit gets the landing page, while a session that ends
  mid-use still gets the "not signed in" screen with a way back in.
- `/pricing`, `/faq`, `/contact`, `/privacy`, and `/terms` all render with no session and issue no
  `/auth/me` call.
- Every sign-in control is an anchor to the server's OAuth route, so it works with middle-click and
  open-in-new-tab. The page body asks for a signup ("Create your free account"); "Sign in" appears only in
  the header.
- **No copy names a fixed number of tools**, so a sixth tool does not silently make the page wrong.
- The data-ownership section is present. It is short, but it is the claim a board privacy review looks for.
- The pricing page states the free-versus-paid split **as shipped**: the attendance history grid and the
  per-student heatmap are free, attendance statistics and the student-detail summary are premium. The
  advertised figures come from the same constant the upgrade modal uses, and the comparison table's rows
  agree with the two plan cards.
- Questions live on `/faq`, not on the pricing page, and the FAQ answers the blocked-board case and points
  at the public contact form — the one question a teacher cannot ask from inside the app.
- The privacy and terms pages render the real documents (written in Step 6c, which replaced the placeholders
  this step shipped). Their criteria are under Step 6c below.

**The feature showcase**, which is a tab pattern and therefore has real keyboard obligations:

- It opens on the first tool, and exactly one panel is exposed at a time.
- Clicking a tab shows that tool; arrow keys move selection *and* focus; Home and End jump to the ends.
- Roving tabindex: only the selected tab is reachable with Tab.
- **No individual tool carries a premium star.** Every tool has premium parts, so marking some of them drew
  a distinction that does not exist; one note under the section carries it instead.

**The product shots** (rendered in the DOM, not captured):

- **Every address uses a reserved example domain.** This is the load-bearing one: a marketing asset for
  this product must never contain a real student's name or address, and the test asserts it per element
  rather than by scraping page text, which would run one cell into the next.
- The shots must not show a control the app does not have. They were built by reading `RosterView`,
  `EntryView`, `GroupsCanvas`, `Wheel` and `ComposeView`; re-check them when a tool's layout changes.
- **Manual/visual:** the roster row's collapse is a container query, so check it by narrowing the *window*
  (which changes the hero shot) and by comparing the hero against the showcase panel at the same viewport
  (which are different widths). At narrow the row is name over class, then the flag icons in a reserved
  column, with the email gone. The flag icons must line up vertically down the list whether or not the
  student beside them carries one.

**The public contact route** (`POST /public/support/contact`), which is the only unauthenticated write in
the app and is therefore tested as a boundary rather than as a form:

- A submission succeeds with no session and no CSRF token, and returns **204 with no body** — no identifier
  is echoed to an anonymous caller.
- A honeypot submission is **discarded and answered 204**, indistinguishable on the wire from a real one.
- An unparseable email address, an over-length message, an empty message, and any unexpected field
  (a client-supplied `googleSub` above all) are each rejected with `VALIDATION_ERROR`.
- The fourth submission from one IP subnet within the hour is `RATE_LIMITED` and writes nothing.
- There is no read path: `GET` on the same route is a 404.
- A signed-out request **appears in the triage queue** alongside account-backed ones, marked as unverified
  and showing the typed address. The regression this guards is the inner join that would have hidden exactly
  the messages from people who could not sign in.
- The triage view renders no plan-override control on a request with no account behind it.

**The gated-control upgrade entry points**, which DESIGN_SYSTEM said would arrive with the pricing page:

- `PremiumNotice` offers an upgrade on `free` and offers nothing on `trial`, where the feature is live and
  merely badged.
- It renders without an upgrade provider rather than throwing, and shows no button in that case.

- **Manual/visual:** all six public pages at 375px and 768px, in both themes; the theme toggle in the
  marketing header persists across a sign-in; the hero shot is clipped by the band edge so the roster reads
  as continuing below the fold; the logo mark is legible at 16px in a browser tab.

### Step 5a — Onboarding & Managed-Domain Allowlisting

- New users are guided through the onboarding flow: grant permissions, confirm spreadsheet creation, arrive at the Students page. No payment is collected; the 30-day trial starts automatically.
- A first sign-in shows the first-run guide once; a returning user skips onboarding and lands on the Students page directly.
- A consent blocked by a managed domain (`error=access_denied` with `admin_policy_enforced` on the OAuth callback) is detected and named, rather than falling through to a generic validation error. `admin_policy_enforced` is recognised from **either** `error_subtype` or `error_description`, since Google sends it in either depending on the flow.
- The four callback outcomes are distinguishable: `ADMIN_POLICY_BLOCKED`, `CONSENT_DECLINED` (the teacher dismissed the consent screen), `OAUTH_ERROR`, and — still — `VALIDATION_ERROR` for a callback carrying no error and no usable `code`. The error branch must not swallow the malformed-request case it sits in front of.
- A sign-in whose token response lacks `drive.file` or `gmail.send` (a box unticked on Google's granular consent screen) redirects to `SCOPES_MISSING` and writes **no account row and no session**. The screen is retryable and tells the teacher to leave both boxes ticked. Scopes are compared whole, not by substring, and a response with no `scope` field at all is treated as a full grant rather than refusing every sign-in.
- A Gmail refusal during a send is logged once per distinct cause, with the HTTP status, Google's `reason` and `status` codes, a count and the account id. The log line never carries Google's message text or any recipient address, and a code field holding anything other than a plain identifier is dropped.
- The blocked screen offers **no retry**, because retrying cannot succeed. It links to `/for-admins` and to the contact form instead.
- `/for-admins` renders with no session at all, and its data-handling prose survives a failed `GET /public/app-info` — only the client ID falls back, to a contact link rather than an empty field to copy.
- `GET /public/app-info` serves the same scope array the authorization URL is built from, so a scope added to sign-in cannot fail to appear on the page an administrator allowlists from.
- Onboarding completion is server-side: signing in on a second device does not repeat the guide. `POST /auth/onboarding/complete` is idempotent, so re-opening the guide from the account menu leaves the original timestamp alone.
- **Leaving the guide never depends on the write landing.** With the completion call failing, finishing the guide still reaches the roster; the cost of the failure is being offered the guide once more, never being held on it.
- **Completion is recorded on arrival, not by an exit control, and the guide carries no skip link.** Every route off the page therefore skips the guide, including the sidebar: with completion recorded on the way out instead, `RequireOnboarding` would redirect a sidebar click back to `/welcome` and the page would be a trap. Verify that a sidebar tool clicked straight from the guide stays on that tool.
- The tools strip is five buttons, one per sidebar tool, and carries no standing descriptions. It opens on Students, with that synopsis in the single shared line below the strip. Hovering, focusing or clicking another button moves the line to that tool and marks it `aria-pressed`; the selection is **sticky**, so moving the pointer away leaves the last synopsis in place. The buttons deliberately do not navigate — sending a teacher into an empty tool from the page whose job is to get the roster in would work against the two actions above it. Each button also carries its own synopsis as an `aria-describedby` description, since a line that rewrites itself under the pointer is no use without one, and the shared line is hidden from the accessibility tree so it is not announced twice.
- The guide's single "Add Students" action opens the real form: `?add=bulk` opens the add grid, and the parameter is cleared from the URL so the grid does not reopen on reload or on a back navigation. Any other value, including the retired `?add=one`, is ignored and shows the ordinary roster.
- The guide offers no "add a class" action, since classes are created by naming one on a student and no class-creation screen exists.

### Step 5c — Registration Consent

- An account that has not accepted is refused at **every** gated router — students, attendance, grouping,
  settings, support, email, billing — with `403 CONSENT_REQUIRED`. Asserted against the real `buildApp`, not a
  hand-assembled router list, so a new router mounted without the gate fails the suite.
- The exceptions are exactly `/auth/me` (how the client learns consent is needed), `/auth/consent` (how it is
  given), and `/auth/logout` (how a teacher who declines leaves). Gating any of those would lock the account
  out of the only screen that can unlock it.
- Neither agreement can be arrived at by omission: a missing flag, a `false` flag, or an unexpected field is a
  `VALIDATION_ERROR`, and **nothing is recorded** — `/auth/me` still reports `needsConsent: true` afterwards.
- A stale `termsVersion` is refused, so a cached client cannot record acceptance of text the teacher was never
  shown.
- Versioning works in both directions: an account that accepted an earlier version is refused again, and
  re-accepting moves the timestamp forward rather than preserving the original (the opposite of
  `markOnboarded`, and for the opposite reason).
- A live session whose account has been deleted is reported as `UNAUTHORIZED`, not as a consent problem.
- Client: the consent screen **replaces** the app shell rather than covering it, since every request the shell
  would make is refused. Submit stays disabled until both boxes are ticked, and re-closes if one is unticked.
- **A failed write keeps the teacher on the screen**, with a retryable error — the opposite of the first-run
  guide's behaviour, because here only the server can decide and it will keep refusing.
- Both linked documents open in a new tab, so following one does not lose the boxes already ticked.
- The data-responsibility wording appears in full on the screen. It is the authoritative text of the one
  agreement given by reading rather than by reference; editing it requires editing the server's copy and
  bumping the terms version.
- **Manual/visual:** the screen at 375px and 768px in both themes; the checkbox targets are comfortable at
  touch size; the two blocks read as two distinct agreements rather than one paragraph with two boxes.

### Step 6 — Productionization

Ten sub-steps, 6a through 6j, indexed at the head of Step 6 in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Each sub-step with testable behaviour has its own
heading below, in letter order. **6b** has none — it is a decision (hosting provider, plan and region).

### Step 6a — Read-scaling

**The working set:**

- The two clocks are independent, and each is asserted in both directions. An entry read just before every
  idle deadline stays resident; an entry nobody reads is evicted for idleness; an entry read constantly is
  still evicted on the age bound.
- **The idle window must be shorter than the age bound**, asserted directly against the config. Inverting them
  makes idle eviction unreachable dead code, which is invisible in every test that does not advance the clock
  past both — and was in fact the first version of the config.
- A merge from a mutation extends the idle clock but **not** the age clock. Extending age would let a teacher
  editing every few minutes hold a value indefinitely, which is the unbounded staleness the bound exists to
  prevent.
- Capacity eviction is least-recently-used: with the store full, reading the oldest entry and then inserting
  one evicts the second-oldest, not the entry just read. The store never exceeds the cap.
- Keys stay namespaced per user; `invalidatePrefix` drops one teacher's resources and leaves others resident.
- Sweeping removes expired entries and leaves live ones. It is a memory measure only — an expired entry is
  never served regardless, since every read checks both clocks.
- The stats snapshot counts hits, misses, coalesced loads and evictions by reason, and carries no keys or user
  identifiers. `evicted.stale` against `hits` is the figure Step 6d uses to decide whether the age bound can
  be raised.

**The roster warm-up (batched cold reads):**

- **A cold roster page costs one Sheets request, not two**, asserted through the real routes with the call
  the client actually issues (`/students`). The two-read baseline is asserted alongside it, so the
  comparison is a fact in the suite rather than a claim in a comment. It was one-instead-of-three until
  Step 8a removed the `iep` tab from the batch.
- A warm roster page costs zero Sheets requests.
- Only cold tabs are read: with the student list already resident, the warm-up reads nothing at all.
- Concurrent warm-ups coalesce onto one batch, so two callers in the same tick do not each start one.
- One teacher's warm-up neither serves nor blocks another's.
- A failed read leaves nothing pending, so the next attempt issues a real request rather than joining a dead
  flight.
- **The route wiring is asserted at the route, not only in the service.** The service-level tests pass whether
  or not the warm-up is actually called by the endpoints — removing the call broke nothing until the
  route-level test existed, which is how the gap was found.

### Step 6c — The Legal Documents

6c produces documents rather than behaviour. The general rule is that no claim in either document may
contradict the shipped code, and the specific checks are the claims a machine can hold to that:

- **Every OAuth scope the app requests appears in the privacy policy.** Asserted against the same six strings
  `GOOGLE_SCOPES` contains, because this is the comparison Google's OAuth verification performs and the
  first draft failed it: it described three permissions and omitted `openid`, `email` and `profile`. A scope
  added without a policy edit must fail the suite.
- The Google API Services User Data Policy **Limited Use statement is present by name**. Losing it does not
  break the app; it fails a review months later.
- Every subprocessor in `SUBPROCESSORS` is named on the page, and the processing location is stated. Adding a
  service without adding it there makes the policy false rather than incomplete.
- The version and effective date on the page come from the constants a consent row is recorded against, not
  from a literal in the test — the point is that they reach the reader, not that they hold a particular value.
  `DOCUMENT_VERSION` (client) and `CURRENT_TERMS_VERSION` (server) must be equal; they are one edit.
- The technical-logs disclosure and its retention period are present, since the database inventory is
  exhaustive and would otherwise imply that nothing else is recorded.
- **Every cross-reference resolves**, which is structural rather than editorial: numbering is positional and
  `sectionNumber` throws on an unknown anchor, so rendering both documents is what turns a stale reference
  into a caught failure.
- The terms carry the responsibility clause, the liability cap, and the arbitration section scoped to US
  residents with the consumer-rights carve-out intact.
- **Not automatable, and therefore the standing manual check:** each commitment the documents make about
  retention, deletion or revocation has something that performs it. Three do not yet and are 6d's
  (`support_requests` retention, log retention, session revocation); adding a fourth is a bug.

### Step 6d — Hosting Setup

- The deployed app is accessible over HTTPS. HTTP requests redirect to HTTPS.
- Environment variables are set correctly, verified by a health-check endpoint that confirms database
  connectivity without exposing secrets. **Google API reachability is deliberately not part of it:** a
  failing health check restarts the instance, and restarting cannot fix a Google outage, so including it
  would convert someone else's downtime into a restart loop of our own. The check answers 503 with no
  connection details, asserted by a test rather than assumed.
- **CI blocks the deploy on failure, and this is checked rather than assumed.** App Platform's own
  `deploy_on_push` must stay `false`: with it on, the build and the checks run in parallel and a push with
  failing tests deploys anyway, which looks identical to a working gate. Push a deliberately failing test to
  a branch and confirm no deployment is created.
- **Unhandled exceptions reach the operator.** Trigger a deliberate error and confirm the alert arrives.
  Decided against Sentry in 6d: its default capture includes request context and local variables, which for
  this app means student names could leave the server, and the whole product rests on that not happening.
  The alert instead goes through the existing `Mailer` seam and carries route, status and error class only —
  no body, no parameters, no user data — capped and de-duplicated so an error storm is not an inbox storm.
  Assert the payload contains none of the redacted fields, because that is the property that matters.
- **The deployment and the published documents agree before the domain is publicly reachable.** The privacy
  policy states where the database lives and how the token key is held; whichever way those decisions land,
  the text and the deployment are reconciled and then verified against each other, deliberately rather than
  inferred from a successful deploy. (Note the direction: the documents follow the decisions, not the
  reverse — see Design Principles in IMPLEMENTATION_PLAN.md.)
- The outstanding 6c commitments have something performing them: a `support_requests` sweep deletes
  resolved requests 24 months after resolution — measured from a dedicated `resolved_at` that a note edit
  does not reset and that reopening clears — log retention is within the stated 30 days on whatever
  aggregation is actually used, and an operator path exists for session revocation on a compromised account.
- **The working set cannot exhaust the instance.** The budget is a measured byte figure rather than an entry
  count, re-derived with `server/scripts/measure-working-set.mjs` whenever a cached record shape changes.
  Fixtures must be round-tripped through JSON or the measurement is wrong by roughly 60%, because V8
  internalises repeated strings on parse and production reads these rows from a parsed API response.
- Drive push invalidation is proven in production (an external edit in Google Sheets invalidates the working
  set, and a channel renewal is observed rather than assumed) **before** the working set's age bound is
  raised. Raising it first would mean serving stale data with nothing to catch it.

### Step 6k — Attendance as Exceptions

**Done.** Criteria and where they are asserted:

- **Nothing is lost in the migration.** Every existing attendance row survives as either an exception row
  or an inferred present, and every statistic computed before the migration is identical after it. This is
  the test the step turns on, and it is asserted over a fixture with all four statuses
  (`migrationV4ToV5.test.ts`, "leaves every statistic exactly as it was" and "keeps every recorded mark
  readable"). Every `computeStats` case is additionally run through a helper that converts the old dense
  fixture into the stored form, so the expectations are literally the ones written against v4.
- **Present and not-recorded are distinguishable.** A class-day with a marker and no exception rows reads
  as everyone present; a class-day with no marker reads as attendance not taken. Asserted directly, because
  these two are the same absence of data and only the marker separates them.
- **Statistics divide by the right denominator.** Absence rates count only class-days that were actually
  taken, so a teacher who has recorded ten days out of a hundred does not show a 90% attendance rate.
- **A day where every student is present still writes a marker.** The easiest case to miss, and the one
  that silently corrupts the denominator.
- **Editing a student from absent back to present soft-deletes the row rather than rewriting it to `p`**,
  and the day still reads as taken. Soft-deleted, not erased: `deletedAt` (`c08`) is stamped and the row
  stays on the tab, which is how every other resource in this schema deletes and is the only affordable way
  in Sheets, where removing a row means rewriting the tab. Assert on *active* rows, and expect the row to
  still be visible in the spreadsheet with `c07` and `c08` both filled in.
- **The row count actually falls**, asserted by count over a realistic fixture rather than assumed, since
  shrinking the data is the entire justification. Twenty students over five days is ten stored rows against
  the hundred v4 held, and all hundred marks still read back.
- **Migration ordering, as in 6e**: with the write of the new form made to fail, the old rows are untouched;
  with the delete of the old rows made to fail, a retry completes rather than duplicating. The second needs
  the *second* clear the migration issues, not the first, since the enrollments rewrite goes ahead of the
  attendance one — hence `failClearAfter` on the fake environment. The retry test asserts the half-applied
  state exists before retrying, or it would pass without exercising anything.
- **The rewrite converges on content, not just on row count.** Found by the test above: an earlier version
  copied markers through the rewrite instead of rebuilding them, so a retry after a half-applied run
  preserved duplicate markers for good. A duplicated marker is a class-day counted twice.
- **Class-day markers move with an archived class and come back**, asserted in both directions in
  `classArchive.test.ts`, including that a student who was present and so never had a row is restored as
  present rather than as unrecorded. Markers ride the existing course-keyed partition with no code of their
  own, and the archive move's call budget (12) is unchanged, which is the argument for storing them in the
  `attendance` tab rather than a tab of their own.
- **The start-date bound suppresses inference only.** A class-day before the enrollment's `startDate` is
  not counted, but a mark actually recorded on such a day still is. Asserted both ways, because a bound
  that could hide a recorded absence would lose a real record to a bookkeeping field.
- **Markers are not reachable through the API.** `POST`/`PUT` validate against the four student statuses,
  which exclude the marker key, and `PUT /attendance/:id` answers `NOT_FOUND` for a marker id.
- The history heatmap and the attendance summary render identically to before over the same underlying
  data — the read endpoints expand server-side, so no client code changed and the client suite is unchanged.

- **A student added to a class that has already been recorded does not inherit its history.** Their
  enrollment is stamped with the day after the last register, so their `daysRecorded` starts at zero and
  counts from the next one taken; their absence rate is computed over the days they were actually in the
  class rather than diluted by sessions held before they arrived. Asserted per course, so a student joining
  two classes is bounded only in the one that has attendance. A student added to a class with no recorded
  days stays unbounded, which is what keeps the ordinary set-up-then-backfill sequence working.
- **Re-saving a roster does not restamp an existing enrollment.** The start date records when the student
  joined, and adding a second class to the same student is not that.
- **The rule costs one Sheets read, amortised.** Asserted by call count across a burst of adds: the
  attendance working set holds the answer after the first, and nothing on the roster-add path invalidates
  it. A read per student would spend a 60-per-minute per-user budget on a teacher typing in their class.

**Manual pass: run and clean** against the real spreadsheet migrated from v4. Statistics identical to the
pre-migration baseline, History grid and heatmap unchanged, a fully-present register saved and read back,
backdated entry intact, archive round trip clean.

Two things it corrected, both worth carrying into the next migration:

- **"Correcting back to present removes the row" reads as "the row disappears from the sheet", and that is
  wrong.** It is a soft delete: `deletedAt` (`c08`) is stamped and the row stays put with its status intact.
  Check active rows, and expect the row to still be visible in the spreadsheet.
- **Trash the migration's Drive backup once the migration is verified.** Discovery filters on
  `trashed=false`, and if `files.copy` carries the source's `appProperties` then the backup carries the same
  `tn_app` marker that bootstrap discovers by — a later sign-in could bind the app to the copy. Whether Drive
  copies `appProperties` was not established; trashing the backup makes it moot.

### Step 6e — Class Archiving

- **Nothing is lost, in either direction.** Archive a class and unarchive it, and every enrollment,
  attendance row and grouping is byte-identical to before. This is the test the whole feature turns on.
- A student in classes A and B, with A archived: keeps their student row, their B enrollment and all B
  attendance, still appears on the roster, and their A attendance is gone from every view.
- A student whose only class is archived leaves the roster, and returns on unarchive.
- **The read cost actually falls.** Cold attendance reads after archiving a term's classes touch only the
  surviving rows — asserted by row count, since this is the measurable justification for moving rows rather
  than flagging them.
- **Ordering on failure.** With the source rewrite made to fail after a successful archive append, no row is
  lost: the retry finds duplicates and de-duplicates by id. With the append made to fail, the source is
  untouched. Both directions asserted, because getting the order backwards is a data-loss bug that ordinary
  tests would not reveal.
- **The commit record is written last.** With the source rewrite made to fail, the class is still
  unarchived — its `archivedAt` is untouched. Asserted directly, because a stamp written alongside the
  rewrites marks the class moved over a rewrite that failed, and the retry that should repair it then finds
  nothing to do and reports success over a half-moved class.
- The operation is resumable: interrupted partway, a retry completes it rather than restarting or duplicating.
- **The call cost is bounded and does not grow with the class.** A whole move stays inside a budget of a
  dozen Google API calls, asserted by counting them: the reads are one batched call rather than one per tab,
  no write re-reads a header the same read already validated, and the source rewrites are a single batch.
  This is a hard criterion rather than a performance note — Sheets allows 60 reads and 60 writes a minute
  **per user**, which the project-level quota increase does not raise, and an earlier version spending
  around forty calls per move meant a teacher archiving two classes in a minute was rate-limited by their
  own second click.
- **A rate-limited move is not retried as a whole request.** The client sends it once and surfaces the
  failure; retrying belongs at the individual refused Google call, where one retry costs one call rather
  than re-spending every call that had already succeeded.
- **Manual:** archive and restore two classes several times in quick succession against the real Sheet, with
  no error. This is the pass that found the cost problem, which no unit test would have surfaced.
- **Writes are held during the operation** and a concurrent attendance write does not survive into a
  half-rewritten tab. A second archive or unarchive for the same account returns `CONFLICT`.
- Archived classes disappear from every picker — Attendance, Grouping, Name Picker, Email recipients — and
  from attendance statistics and history.
- Duplicate names: two live classes cannot share a name; a live and an archived class can, and are
  distinguishable on the Manage Classes tab by the archived row's creation and archive dates. Two archived
  classes cannot: archiving a class whose name the archive already holds appends the creation year, and the
  selection bar's notice says it was archived under that name rather than restored.
- **Unarchiving into a collision renames rather than refuses**, appending the creation year, and reports the
  rename. A second collision on the renamed form still terminates with a unique name — asserted, because a
  rule that can loop or reject would block a teacher from restoring their own records.
- **Student counts survive a move.** The archive and unarchive responses carry `studentCount` on every class,
  not only the listing endpoint — the page re-renders from the move response, so a missing count is visible
  precisely when the teacher is watching.
- **An emptied live class leaves the Manage Classes tab.** Delete the last student in a class and it is gone from
  the tab as well as from every picker, and its course row is soft-deleted. An archived class with no live
  enrollments is untouched by the same rule.
- **One direction at a time.** Selecting a live class disables the archived checkboxes and the archived
  list's select-all, and vice versa. Clearing the selection releases the lock. The selection bar never shows
  more than one Archive or Restore button, and shows none with nothing selected.
- **Manage Classes** is the second Students tab, at `/students/classes` (`/classes` redirects there), so it
  stays reachable from an empty roster (a teacher who archives every class must still be able to restore
  one). The page header's class filter is not shown on it. Each list's
  header checkbox selects the whole list and reads as indeterminate when part of it is selected; the archived
  list is ordered most recently archived first, with no year headings. After an archive the selection bar reads "Archived N
  classes." with Undo, and after a restore "Restored N classes.".
  Closing or reloading the tab while an archive, restore or rename is running raises the browser's leave
  prompt, and no prompt is raised once it finishes.
- **Renaming a class** (`PATCH /classes/:classId`) rewrites the name on every enrollment, attendance and
  grouping row carrying it, soft-deleted rows included, and on the course row, in a single Sheets write. A
  live class's rename touches only the live tabs and an archived class's only the archive tabs, so a
  same-named class on the other side keeps its rows. A name another class on the same side already has is
  refused with `CONFLICT` and shown on the row, with the edit left open; the current name is a no-op. A
  failed write leaves the class under its old name and id and renameable on retry, which is why the write is
  one call: split in two, `listCourses` would read the half-done state as an emptied class plus a new one.
  The rename holds the account lock. Renaming a live class carries the roster filter and each tool's
  remembered class to the new name. **The roster reloads after every archive, restore and rename**, since
  Roster and Manage Classes are one mounted page: rename the class the roster is filtered to, return to
  Roster, and the filter is on the new name with the old name gone from its options. The filter must survive
  the render in which it already names the new class and the roster has not yet arrived, which is what the
  test holds the reload open to exercise.
- **The class selection is remembered per tool.** Choose a class in Attendance, visit Grouping and the Name
  Picker, return: Attendance is still on it. Changing it in one tool does not change it in another. A reload
  starts at the first class alphabetically, and a remembered class that has since been archived falls back to
  the first rather than showing an empty view. The Email tool is unaffected.
- **Manual/visual:** the Manage Classes tab at 375px, 768px and desktop in both themes; the archive action reads as safe and
  reversible rather than destructive; the progress state is honest about a wait of seconds and is visible
  enough to be read against a list of checkboxes, as is the rename notice; Undo is reachable immediately
  after archiving.

### Step 6f — Account Menu, Deletion, and the Help Documentation

**The account menu:**

- It carries navigation only. Billing is no longer on it whether or not a Stripe customer exists, and
  "Account settings" points at `/account`.
- **"Getting started" appears only while the account has no student**, and disappears once it has one. The
  condition is `hasStudents === false`, explicitly — an older server omitting the field must leave the item
  hidden rather than have `undefined` decide by accident.
- "Help and support" points at `/help`, the hub, not at the contact form.

**The first-student signal**, asserted through the real routes rather than against the store, because where
it is recorded *from* is the design:

- Set by a create and by a bulk add.
- **Set by a roster read that comes back non-empty**, which is the case a migration could not have answered
  and the reason accounts predating the column converge on their next visit.
- Left alone by a roster read that comes back empty.
- **Write-once:** later reads do not move the timestamp forward. Without the `COALESCE` this would record the
  teacher's most recent visit instead of their first student.
- **A failure to write it does not fail the request.** It is bookkeeping for a menu item, and a class list
  that saved correctly must never be reported as failed because an `UPDATE users` afterwards did.

**Signing out everywhere (`DELETE /auth/sessions`):**

- Ends every session on the account, including the calling one, and clears the cookie. Both halves matter:
  the session the teacher is not sitting at is the one they wanted gone, and the one they are sitting at
  must not survive an action labelled "all".
- Refused without a session (401) and without the CSRF header (403).

**Deleting the account (`DELETE /auth/account`):**

- Deletes the row, revokes the Google refresh token, and ends every session. No session may outlive the
  account it authenticates, asserted directly rather than left to `ON DELETE CASCADE`.
- **Proceeds when Google refuses the revocation**, which is the ordinary outcome for an already-dead token.
- Cancels an active subscription first, and **deletes nothing at all when that cancellation fails** — the row
  survives, the sessions survive, and the Google token is not revoked. The error names the condition and
  carries no Stripe internals.
- Skips Stripe entirely for an account that never checked out.
- Refused without a session and without CSRF, and the account still exists afterwards.

**The client's deletion flow:**

- The confirmation dialog is required, and cancelling deletes nothing.
- **The confirm button stays disabled until the word "Delete" is typed**, and the field is cleared when the
  dialog is dismissed, so a reopened dialog does not start already armed. The match is trimmed and
  case-insensitive.
- It **states that the spreadsheet survives**, that the subscription is cancelled immediately, and that the
  action cannot be undone. This is the one misunderstanding that would cost a teacher their year.
- The server's refusal message is shown rather than replaced with a generic one, because it names an action
  only the teacher can take.
- **Both destructive actions leave by full page load, not by route change.** A client-side navigation leaves
  an `AuthProvider` that still believes it is signed in, so the roster it lands on 401s and the teacher gets
  the "your session ended" error screen instead of the marketing home page.

**The Help hub (`/help`):**

- Two groups: the contact form alone, then the data documentation, FAQ, privacy policy and terms under a
  "Reference" heading. The contact row is the only one on the page that starts something, so it must not sit
  in the list of documents.

**The documentation page (`/help/your-data`):**

- Public, and renders with no session at all. Its readers include people who cannot sign in.
- Covers the four things it exists to cover: exporting the data, deleting the data, deleting the account,
  and revoking the app's Google access. This is the Workspace API developer policy requirement, so a rewrite
  must not quietly drop one.
- States that deleting the account leaves the spreadsheet alone, and gives a route for someone who cannot
  sign in.
- **Manual/visual:** both hub pages at 375px and 768px in both themes; the delete row reads as destructive
  without the page as a whole reading as dangerous; the confirmation dialog and its typed-confirmation field
  fit a short screen.

**The marketing header's session probe:**

- A page the app does not link to (landing, pricing) **makes no `/auth/me` call at all**, which is the Step 5
  property this must not cost.
- A page the app does link to offers "Back to the app" once the probe finds a session, and **stays on "Sign
  in" whenever it fails** — no session, offline, server down. Offering a way back into an app the reader
  cannot enter is the worse error.
- The probe never gates rendering: the page and a usable header are there before it resolves.

**The Modal primitive (regression, found here):**

- A text field inside a modal accepts more than one character when the modal's `onClose` is an inline handler
  and the field's state lives in the same component. Focus-on-open must not re-run on re-render.
- The panel is still focused when the modal opens, and Escape still closes it.

### Step 6g — Rebrand to Teachneat

- **No user-visible "Teacher Toolkit" survives.** A grep over `client/src` and `server/src` for the old
  name returns nothing outside comments describing the rename itself. The wordmarks, `index.html`'s
  `<title>`, `appName` in `GET /public/app-info`, the consent gate copy, the legal documents and the public
  pages all read Teachneat.
- **The five Drive constants move together**, asserted as a set rather than individually: the folder name,
  the spreadsheet title, and the three markers (`tn_app`, `TN_APP_MARKER`, `tn_filed`). A mixed pair leaves
  a discovery path reading one name and writing the other, which is the failure this rename can produce.
  `meta.appId` deliberately stays `ttk` — internal, unread by any teacher, and not worth a data migration.
- **Discovery finds the ported spreadsheet rather than creating a third one.** This is the manual check the
  rename turns on: after renaming the constants, sign in (bootstrap creates the new folder and spreadsheet),
  port the tab contents by hand, then sign in again and confirm no new file appears. The header-validation
  invariant is what confirms the port went in correctly, so a mismatched header must fail loudly here.
- Both version constants are bumped together and every account is re-prompted through the consent gate,
  since renaming the service is a substantive change to documents that name it. The existing Step 6c test
  that `DOCUMENT_VERSION` equals `CURRENT_TERMS_VERSION` covers half of this; the re-prompt is asserted by
  an account whose recorded consent names the previous version reporting `needsConsent: true`.
- **Manual/visual:** the logo, whatever 6g decides about it, still renders legibly at 16px in a browser tab
  and is identical in the app top bar, the marketing header and the landing hero, since one component
  serves all three.

### Step 6h — Lifecycle Email

- **One row per (account, message type), enforced by a unique constraint.** A retried sweep, a
  double-triggered sweep, and two concurrent sweeps each send exactly once. This is the criterion the whole
  design turns on: a duplicate welcome is embarrassing, a duplicate trial-ending notice is worse.
- The six messages fire on their stated triggers, and **only** those six exist. There is no broadcast or
  announcement path, which is a CASL limit rather than a scope preference — a test that asserts the message
  catalogue is closed is what keeps a later "just one product update" from being a one-line addition.
- Sends are queued from the triggering event and dispatched by the sweep, never inline. **A provider outage
  does not fail the request that queued the message**, asserted on the signup path specifically.
- **No student PII in any template**, and no message body logged. The templates address the teacher about
  their own account and interpolate nothing from the Sheet.
- Payment failure sends nothing, since Stripe's own dunning covers it.
- The privacy policy names the email provider as a subprocessor before the first live send, and both version
  constants are bumped for it. The existing 6c subprocessor test covers this once `SUBPROCESSORS` is updated.
  **`SUBPROCESSORS` was updated at 6h and the version bump deliberately was not**, batched instead into the
  single `2026-08-19` bump 6j took, so that 6h's new subprocessor and 6j's policy rewrite cost one consent
  re-prompt rather than two. That bump is done and nothing is owed. The criterion was never at risk, being
  tied to the first live send, which cannot happen before the sending domain is verified in Step 8c.

**Manual pass, which the automated tests cannot cover.** The trial scans are SQL against the `users` table
and have no in-memory equivalent, and delivery is a property of the provider rather than of this code. Both
are driven from the two development-only items in the account menu — **"Trial: set to …"**, which walks the
three dates that mean anything (four days out, yesterday, a fresh thirty), and **"Run email sweep"**, which
runs the pass on demand and reports its counts on the label. Both sit beside the plan toggle, behind the
same doubled guard, and do not exist in production:

- With no provider configured, a sweep prints each message to the server console in full. Every template
  should be readable there and free of student data, an unrendered `{{placeholder}}`, or a stray `null`.
- One press of the trial control and one of the sweep queues and sends **trial ending**; the next press of
  each does the same for **trial ended**. Sweeping twice at the same position must not send a second copy,
  which is the unique constraint doing its job.
- An account with an active subscription is skipped by both scans, which is the case a teacher who
  subscribed during their trial would otherwise meet as "your trial has ended" the week after paying.
- With a Resend key configured, the same pass delivers to the operator's own inbox — the only address the
  provider will accept before the domain is verified.
- Locking: with the trial expired, Statistics and the student-detail summary show the *lapsed* wording
  ("Your trial has ended", and the assurance that records and the spreadsheet are intact), not the plain
  premium sentence a never-premium account sees.

### Step 6i — Founding-User Promo and the Summer Pause

- **A paused subscription resolves to `free`.** Stripe holds a paused subscription at `active`, so
  `resolvePlan` reading `subscription_status` alone would keep granting Premium to an account that has
  stopped paying. Assert the paused case directly, in both directions: pausing drops entitlements, resuming
  restores them.
- The webhook handles `customer.subscription.updated` carrying a `pause_collection` change in **both**
  directions and remains the sole writer of subscription state. A pause never writes `plan_override`.
- The pause is offered in the cancellation flow and **nowhere on the pricing page**, which is a pricing
  decision rather than a layout one: advertising it tells every visitor that annual has no advantage.
- Pause bounds are enforced server-side: one to three months, default two, once per twelve months, monthly
  plan only. An annual subscriber is refused a pause and runs to period end as today.
- The promo code is offered on **both** prices. Twelve months of a repeating discount is one free year
  either way: an annual subscription issues a single invoice inside the window, a monthly one issues twelve
  at zero. Note that no Stripe mechanism could restrict a promotion code to one price even if we wanted to —
  `restrictions` covers first-time-transaction and minimum amount, and coupon `applies_to` is per-product
  while both prices sit on one product — so `allow_promotion_codes` is the only lever, and a pricing rule
  should not rest on it.
- **The card is captured at checkout**, so the first post-promo invoice bills by default, and the
  seven-days-before reminder (Step 6h) is sent. The reminder is what makes card-up-front honest rather than
  a trap; a promo redeemed with no reminder queued is a failure, not a warning.
- **The reminder names the price for the interval the subscription is actually on**, read from
  `subscription_interval`, and names no figure at all when the interval is unknown. A wrong figure in a
  message nobody can edit after sending is worse than no figure.
- **A pause is refused while a promo is running**, and the refusal protects the teacher rather than tidying
  the dialog: the discount expires on calendar months rather than on invoices, so pausing does not defer it.
  They would spend free months and the once-a-year allowance to stop being charged an amount already zero.
- **The cancellation dialog does not imply a promo survives cancellation.** Cancelling takes effect at
  `current_period_end`, and a discounted subscription still renews monthly at zero — so cancelling lands on
  the next monthly boundary and the remaining promotional time is lost. Verified against Stripe directly:
  `cancel_at` comes back equal to `current_period_end`, eleven months before the promo ends.
- **`resolvePlan` puts a live subscription ahead of an unexpired trial.** Both grant the same access, so the
  order is invisible to entitlement and decides the label the whole interface renders — and a teacher who
  subscribes during a trial must not still be offered an upgrade.
- **A paused account is offered nothing to buy.** It resolves to `free`, so an upgrade prompt would send a
  teacher who already has a subscription to Checkout and create a second one, orphaning the paused
  subscription where nothing in the app can see it.

**Owed manually, and it cannot be covered by the suite.** The coupon and its promotion code are Stripe
dashboard configuration, not code, so nothing in the repository proves they exist or that they are what the
copy claims. Against the live test-mode account, in order:

0. Start webhook forwarding: `stripe listen --forward-to localhost:3001/api/billing/webhook`. Stripe cannot
   deliver to `localhost`, so without it the account row simply freezes at the last delivered event and
   every subsequent check reads as a bug in the app. The dev plan toggle hides this rather than revealing
   it, because `plan_override` forces entitlement and says nothing about subscription state.
1. Create the coupon — 100% off, `duration: repeating`, `duration_in_months: 12` — and a promotion code for
   it with a redemption cap. No currency: `percent_off` takes none.
2. Run a monthly checkout, apply the code, and confirm the card is captured and the first invoice is zero.
   The card is the point: the first post-promo invoice bills by default, so the default outcome is a paying
   customer.
3. Confirm `promo_ends_at` lands on the account. The webhook payload carries discounts as bare ids, so this
   is the assertion that the expanded re-fetch actually runs — if it silently fails, the reminder never
   queues and nothing else reveals it.
4. Drive a pause through the cancellation dialog and confirm the account drops to `free` while Stripe still
   reports the subscription as `active`, then resume it from the Stripe dashboard and confirm Premium comes
   back. Both directions arrive as `customer.subscription.updated`.
5. Confirm the reminder queues and renders. `promo_ends_at` is a year out, so nothing is due: widen
   `PROMO_REMINDER_LEAD_DAYS` temporarily rather than editing the webhook-owned date in Postgres, run the
   sweep, read the rendered message, then revert the constant **and delete the queued row**. That last step
   is not tidying — the queue is `UNIQUE (account_id, message_type)` for the life of the account, so a row
   left behind means the real reminder never queues and nothing reveals it.

**The whole pass is run and clean**, against a live test-mode promo checkout on 2026-08-17. It found three
faults the suite could not, all now fixed: `resolvePlan` resolved a paying promo redeemer to `trial` so the
app kept offering them an upgrade; a paused account was offered an upgrade button that would have created a
second subscription; and the cancellation dialog implied a promo survives cancellation.

**The cancellation flow's own pass is also run and clean** (Step 6i follow-up). Its criteria, for a re-run:
the cancellation row appears only for an account with a live subscription and not for one that merely has a
Stripe customer; "Continue to cancel" lands on the portal's cancellation page while "Manage billing" lands
on its home page; and the dialog's three buttons fit the panel in order keep, pause, cancel.

### Step 6j — Activation Instrumentation and the Operator Metrics View

**Done, and covered by the automated suites** (`server/src/services/usageStore.test.ts`,
`server/src/routes/metrics.test.ts`, and the picker marker assertion in
`client/src/features/name-picker/NamePickerPage.test.tsx`). The criteria below describe what shipped; two
items in the original draft described designs that were considered and not taken, and are recorded under
Decisions Made in HISTORY rather than left here as untested criteria.

- **The milestone columns hold no student data.** A property of the column set, not of any value: five
  nullable timestamps, no counts of students, no class names, nothing derived from roster content.
- Each milestone is write-once and set from the real route rather than the store: first attendance saved,
  first grouping generated, first email sent, first picker open, plus the existing `onboarded_at` and
  `first_student_at`. A second call must not move the timestamp while the counter still increments.
- **`first_premium_attempt_at` is written at `requirePremium`**, the single choke point every premium gate
  funnels through, and records a refusal rather than a use. It has no counter: counting refusals would
  measure retries, not adoption.
- **Usage counters are monthly totals and nothing finer.** Assert that two uses in one month accumulate,
  that a use in the next month starts a new row, that one account's counts never appear in another's, and
  that the aggregate view reports both a total and a distinct-account count.
- **A failure to record either milestone or counter never fails the request that triggered it.** Both are
  recorded after the teacher's work has already succeeded, and the recorder swallows and logs. Assert with
  a store that rejects.
- **Retention is enforced, not merely stated.** The privacy policy says counters are kept 24 months, so the
  hourly prune not running is the policy being untrue. Assert that `prune` removes what is past the window
  and keeps what is inside it, and that the retention window stays wider than the 12 months the metrics view
  reads — otherwise the view renders a partly-pruned month as a decline that never happened.
- The metrics view is gated on `SUPPORT_ADMIN_GOOGLE_SUBS` alone and answers **404, not 403**, matching the
  support triage posture. Both new endpoints are exercised separately for this.
- **The aggregate metrics response carries no account identifiers**, asserted directly against the
  serialised body: no id, google_sub, email or domain. The privacy policy's description of the view as
  totals depends on this, so it is a test rather than a convention.
- **The per-account activity read returns no secrets and is not a search.** Assert the absence of the
  refresh token, spreadsheet id and email, and note that there is deliberately no listing endpoint and no
  lookup by email: an account that has not written in cannot be browsed.
- **Every recording call site is asserted from its real route**
  (`server/src/routes/instrumentation.test.ts`), not only through the recorder in isolation. The store
  layer is the least likely to break; the wiring is what rots silently, and a dropped call site shows up as
  a permanently-zero column that reads like a product finding rather than a bug. Covered: attendance save,
  grouping generate, email send, the picker marker, and the premium refusal — plus the two negatives that
  matter, that saving a grouping does **not** count (the auto-save fires on every drag) and that an
  ordinary roster read does **not** count as picker use.
- **Tests that build a tool router must inject `memoryActivity`** (`server/src/test/memoryActivity.ts`).
  The routers default their recorder to the Postgres usage store, so a test reaching a call site would
  attempt a real connection — and because the recorder swallows its own failures, invisibly.
- **The window arithmetic is asserted at both ends.** `period >= floor` includes both endpoints, so a
  floor of "12 months ago" spans thirteen buckets. Harmless on a chart and wrong in `prune`, where it kept
  counters for 25 months against a policy promising 24. Both call sites go through `windowStart`.
- **The picker's marker is asserted at the client.** `NamePickerPage` must call the roster read with
  `'picker'`. Dropping it silently zeroes the picker column and nothing else would catch it, because the
  roster still loads and the page still works. Remember when reading that column that it counts opens of
  the tool, not rounds drawn.
- **No third-party analytics and no script on any page**, asserted as an absence: the client bundle loads no
  external origin. This is what keeps the privacy policy's remaining "no analytics" claims true; the one
  claim the step made untrue ("we do not record what you do inside the app") was rewritten in the same pass,
  and both version constants were bumped to `2026-08-19` to cover this step and Step 6h's Resend addition
  together.

### Step 7 — Security Hardening Pass

- **Rate limiting:** hitting any endpoint more than the configured limit within the window returns 429. Test auth endpoints with a stricter threshold.
- **Header audit:** response headers include `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`. `X-Powered-By` is absent.
- **IDOR prevention:** authenticate as User A, attempt to access User B's roster/attendance data by guessing the resource path. All such requests return 403 or 404.
- **No client-supplied Sheet IDs:** grep the codebase for any route or service function that reads a Sheet ID from the request body, query params, or route params. There must be zero matches. The server must always resolve the Sheet ID from the authenticated user's account record.
- **Dependency audit:** `npm audit` returns zero critical or high vulnerabilities.
- **PII sanitization in logs:** trigger an error that includes student data in the input. Inspect the log output and confirm no student names, emails, or IDs appear.
- **Missed-webhook entitlement (decision, then test).** This step owns the open question of whether an account whose `customer.subscription.deleted` never arrives should stay paid indefinitely — today it does, because `resolvePlan` reads `subscription_status` alone and `current_period_end` is mirrored but never consulted. Once the decision is made, the case to test is an account left `active` with a period end in the past: it should resolve however the decision says, and the behaviour should be the same whether the cause was a dropped event or a delayed renewal.

### Internal endpoints (cross-cutting)

Both live in `routes/internal.ts` and each carries its own guard on top of the session gate. The guards
differ deliberately, so both need testing separately.

- `GET /internal/metrics` returns the call-count snapshot for an allowlisted operator, and **404** for a
  signed-in account that is not in `SUPPORT_ADMIN_GOOGLE_SUBS` — it is service telemetry, not teacher-facing
  data. It has no `NODE_ENV` half to its guard, because reading the counters is a production task.
- `POST /internal/dev/plan` returns 404 whenever `NODE_ENV=production` **or** the account is absent from
  `DEV_TOOLS_GOOGLE_SUBS`, so both halves must be exercised independently.
- Neither endpoint answers 403 on refusal, so probing cannot distinguish "exists but forbidden" from
  "does not exist".
- The operator metrics view added in Step 6j takes the same allowlist and the same 404 posture, so a new
  guard is not introduced for it.

---

## Phase 3

Phase 3 steps are TBD per the implementation plan. Testing criteria will be defined when the feature scope is finalized. At minimum, the following areas will need test coverage:

- **File uploads:** type validation (magic bytes, not MIME), size limits, random filename generation, storage in a managed service (not local filesystem), `Content-Disposition: attachment` on download.
- **Content moderation:** submitted content is sanitized before display to other users. HTML/script injection in lesson plan text is neutralized.
- **Subscription credits:** the credit system correctly tracks contributions and applies discounts. Edge cases around partial credits, refunds, and plan changes.

---

## Cross-Cutting Tests (Apply Across All Phases)

These are not tied to a specific step but must pass continuously.

**Input validation**
- Every POST/PUT endpoint rejects payloads that fail schema validation (missing fields, wrong types, over-length strings).
- No endpoint passes raw `req.body` to a service function. Service functions receive only validated, typed objects.

**Error handling**
- API error responses never contain stack traces, file paths, or internal identifiers.
- Google API errors are caught and sanitized before the response is sent to the client.

**Google API quota**
- Repeated identical GET requests within the cache TTL produce only one Google Sheets API call. Verify using a call counter on the mock.
- A per-user API call budget is enforced. Exceeding it returns 429, not a Google quota error.

**Output encoding**
- No use of `dangerouslySetInnerHTML` anywhere in the client codebase. Enforce via a grep-based lint rule in CI.
- Email template variable substitution escapes HTML-special characters.

**Dependency hygiene**
- `npm audit` is part of the CI pipeline. Builds fail on critical or high vulnerabilities.
- No `*` version ranges exist in any `package.json`.

**Theme consistency**
- All color values in the codebase reference design tokens (Tailwind classes), not hardcoded hex values. Enforce via a lint rule or grep check.
- Every page/component renders correctly in both light and dark modes. No elements with unreadable contrast or invisible borders in either mode.
