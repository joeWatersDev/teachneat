# Teachneat — Google Sheets Schema

The authoritative specification for the spreadsheet each teacher's Drive holds. Every server service function that reads or writes Sheets data must conform to this schema.

This schema is designed around the **lock-in principle** from [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): opaque column codes, internal IDs, and machine-oriented storage so the raw spreadsheet is not useful without the Teachneat interface.

---

## Discovery

The server locates (or creates) the app's spreadsheet for an authenticated user using two signals. Both must be checked; either can recover if the other is lost.

1. **Drive `appProperties`** on the file:
   ```json
   { "tn_app": "v1" }
   ```
   Survives renames. Not visible to the user in the Drive UI.

2. **Signature row** in the `meta` tab: a row where column `c01` (key) equals the literal string `TN_APP_MARKER`. Recovers a file the app created whose `appProperties` marker has been lost. **It does not recover a copy the teacher made by hand**, although a copy carries the marker row: the fallback begins with a Drive `files.list`, and under `drive.file` that listing returns only files the app created, so a hand-made copy is never a candidate. The broader `spreadsheets` scope would not change this, since it does not widen a Drive listing, and a teacher whose only sheet is a hand-made copy gets a fresh spreadsheet on sign-in.

On bootstrap, if neither signal is found, the server creates a fresh spreadsheet with the schema below.

### Location on the teacher's Drive

The spreadsheet lives in a folder named **TEACHNEAT DATA**, not loose at the Drive root.

**Renamed by the Teachneat rebrand (Step 6g), and now shipped.** The folder was `TEACHER TOOLKIT DATA`,
the spreadsheet `Teacher Toolkit Data`, and the markers carried a `ttk_` prefix (`ttk_app`,
`TTK_APP_MARKER`, `ttk_filed`). **That rename was only cheap because there was one account, and it will
not be cheap again.** Because the markers are how bootstrap discovers an
already-created folder and spreadsheet, changing them makes every existing file undiscoverable — after
launch it would need a dual-read fallback and a backfill. With a single account it was a find-and-replace
plus a manual data port by that user. **Treat these five strings as frozen from here.** `config/schema.test.ts`
asserts all five as one object, because the failure mode is a mixed pair rather than a wrong string.

`meta.appId` deliberately kept its `ttk` value: it is written once, read by nothing, and seen by no
teacher, so changing it would only put the freshly seeded value at odds with a hand-ported `meta` tab.

The folder is found (or created) by its own `appProperties` marker, `{ "tn_app": "folder-v1" }`, which is distinct from the spreadsheet's value so each query matches only its own kind of file. Creating and managing the folder needs no additional OAuth scope: `drive.file` covers files the app itself created.

A spreadsheet created before this behavior existed is moved into the folder **once**, and the move is recorded on the file as `{ "tn_filed": "v1" }`. The marker is what makes this a one-time migration rather than a filing preference re-imposed on every sign-in: the `drive.file` scope cannot read the Drive root or any folder the app did not create, so the server has no way to see where a sheet currently sits or whether the teacher moved it there deliberately. Once the marker is set, the file's location is the teacher's to choose. Placement is best-effort throughout — a sheet that cannot be moved still works where it is, and never fails a sign-in.

---

## Conventions

These apply to every tab unless explicitly noted.

**Column codes.** Row 1 of every tab contains opaque codes: `c01`, `c02`, `c03`, … Numbered per tab. No human-readable headers.

**Field names.** The `field` column in each tab table below is the in-memory / API name for that column, in `camelCase`. It is documentation only — it does not appear in the sheet itself. The Sheets service maps `cNN` ↔ `fieldName` internally, and the same `camelCase` names are used in the API contract (see [API_CONTRACT.md](API_CONTRACT.md)).

**Header validation invariant.** Before every read or write, the service layer fetches row 1 and compares it to the expected code list for that tab. If it does not match exactly, the operation is refused and the error surfaces to the user. This prevents silent corruption from schema drift or user tampering.

**Internal IDs.** ULID (26-character Crockford base32). Lexicographically sortable by creation time. No collision risk across distributed generation.

**Timestamps.** ISO 8601 in UTC with trailing `Z`, e.g., `2026-04-21T14:30:00Z`. No Sheets-native date values (they break if a user reformats the cell).

**Dates (no time component).** `YYYY-MM-DD` strings.

**Booleans.** The literal strings `TRUE` and `FALSE`.

**Soft delete.** Every entity tab has a `deletedAt` column (nullable timestamp), with three exceptions: `meta` (key/value store), `emailLog` (append-only audit trail), and `emailQueue` (rows are retained permanently as the once-per-(rule, student) dedupe record; terminal states are expressed via `statusKey`). Null means the row is active. On read, the service filters out non-null `deletedAt` rows by default. Hard deletion is never used during normal operation.

**Foreign keys.** Enforced app-side, not by Sheets. FK columns store the referenced row's `id`.

**Nullability.** Marked explicitly per column below. Unless marked nullable, a column must contain a non-empty value.

**Multi-value fields.** Pipe-delimited strings (`|`) where noted. No nested JSON in cells.

---

## Tabs

### `meta`

Key/value store for app-level configuration and the schema marker. Two columns only.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | key | string | no | unique |
| c02 | value | string | no | |

Required keys (present from bootstrap):

| key | example value | purpose |
|---|---|---|
| `schemaVersion` | `4` | integer as string; drives migrations |
| `appId` | `ttk` | constant; **deliberately not renamed by Step 6g** — it is an internal value no teacher reads, and changing it would be a data migration for no gain, the same reasoning that leaves environment variable and database column names alone |
| `createdAt` | `2026-04-21T14:30:00Z` | spreadsheet bootstrap time |

Optional keys (added when set):

| key | purpose |
|---|---|
| `prefTheme` | `dark` or `light` |
| `prefDefaultCourse` | default course filter for roster view |

The signature marker referenced in the Discovery section lives as a distinguished row in this tab: `{ key: "TN_APP_MARKER", value: "<schemaVersion>" }`. It is always written as the first data row (row 2) on bootstrap, but discovery scans the `key` column rather than relying on position. The marker key string `TN_APP_MARKER` is a literal sentinel value, not a field name (it was `TTK_APP_MARKER` before the Step 6g rebrand; see Location on the teacher's Drive). Any migration that bumps `schemaVersion` must update the marker row's value in the same migration so the two never diverge.

---

### `students`

Roster and profile. One row per student. A student's course memberships live in the `enrollments`
tab, not here — the same student can belong to more than one course (see [enrollments](#enrollments)).

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | firstName | string | no | |
| c03 | lastName | string | no | |
| c04 | goesBy | string | yes | |
| c05 | pronouns | string | yes | |
| c06 | studentEmail | string | yes | |
| c07 | parentEmails | string | yes | pipe-delimited list |
| c08 | notes | string | yes | free text |
| c09 | createdAt | timestamp | no | |
| c10 | updatedAt | timestamp | no | equals `createdAt` on insert |
| c11 | deletedAt | timestamp | yes | null = active |

---

### `enrollments`

Join between `students` and the teacher's courses. One row per (student, course). A student in two
of the teacher's sections has two active enrollment rows; identity and contact stay on the
single `students` row. This is the source of truth for a student's classes (added in schemaVersion 2;
before then, a single `students.course` column held one course per student).

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | studentId | ULID | no | FK → `students.c01` |
| c03 | course | string | no | |
| c04 | createdAt | timestamp | no | |
| c05 | deletedAt | timestamp | yes | null = active |
| c06 | atRisk | boolean | no | `TRUE`/`FALSE`; per-class academic-risk flag, default `FALSE` (added in schemaVersion 3) |
| c07 | startDate | date | yes | `YYYY-MM-DD`; the date the student joined this class (added in schemaVersion 5) |

**`startDate` bounds attendance inference.** Present is inferred from the absence of a row, so without
it a student who joined in November would read as present on every class-day since September and their
absence rate would be computed against a denominator covering weeks before they arrived. Empty means
unbounded. **`createdAt` is deliberately not used as a fallback** — it is when the row was written, not
when the student joined, and the two come apart whenever a teacher sets up a roster and then enters the
previous week's attendance. The clamp only ever suppresses an *inferred* present: a recorded mark on a
date before the start still counts, because it is something the teacher said.

**It is stamped automatically when the enrollment is created**, at the day after the course's last
recorded class-day, or left empty when the course has never been recorded. That is the same rule the
v4→v5 migration applies to a student who had no rows, so the system carries one definition rather than
two, and it is derived from the data rather than from a clock — "today" would need the teacher's
timezone, which the server does not have, and an off-by-one there drops a real day from the register
they are about to take. An existing enrollment is never restamped: re-saving a roster is not the student
rejoining.

**App-enforced uniqueness.** Among rows with `deletedAt` null, the pair `(studentId, course)` must
be unique. Deleting a student cascades a soft delete to their enrollment rows.

The per-class `atRisk` flag is toggled on the student detail page. It surfaces as a roster warning
indicator and (planned) as an `atRisk` email condition metric; the roster also shows a computed
high-absence warning (over 15% absence rate with at least 5 recorded days) that is not stored.

---

### `courses`

The teacher's classes as records rather than as repeated strings (added in schemaVersion 4, for class
archiving). Before this tab, a class existed **only** as text on enrollment rows: the set of classes was
derived by collecting distinct `enrollments.course` values, which meant a class could not be archived,
renamed, or told apart from another class with the same name, and a class with no remaining students simply
ceased to exist.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | name | string | no | max 60 chars, matching the enrollment course string |
| c03 | createdAt | timestamp | no | first time the class was seen |
| c04 | archivedAt | timestamp | yes | null = live; non-null = archived |
| c05 | deletedAt | timestamp | yes | null = active |

**`name` remains the join key, not `id`.** Enrollment and attendance rows continue to carry the course
*name*, exactly as they do now. This tab is metadata beside those rows rather than a replacement for the
string on them, which is what keeps the change additive: no existing row is rewritten, and the migration
runner handles it with no per-bump code.

**Lazy creation.** A course name found on an enrollment with no matching row here reads as **live**, and a
row is created for it on next write. Existing accounts therefore work untouched, and no backfill can lose a
class.

**Lazy removal, in the same pass and live rows only.** A live row whose name is on no live enrollment is
soft-deleted. A class exists only by having students in it — there is no create-a-class form — so an emptied
live row is the remains of a deleted class, and every other tool already stops listing it. Archived rows are
exempt: having no live enrollments is what being archived means.

**App-enforced uniqueness among live classes.** Among rows with `deletedAt` null and `archivedAt` null,
`name` must be unique. Duplicate names are permitted *across time* — an archived "Period A Science" and a
live one may coexist — but not among live classes, because two live classes with the same name are
indistinguishable in every picker in the app, to the teacher as much as to the code. Archived classes are
kept unique among themselves too, by the archive move and by renaming, since archive rows carry nothing but
the name to say which class they belong to.

**Renaming** rewrites `name` here and the course string on every row of that class's side (live tabs for a
live class, archive tabs for an archived one), in one write. See `PATCH /classes/:classId` in
[API_CONTRACT.md](API_CONTRACT.md) for why it must be one.

---

### Archive tabs

Class archiving moves rows out of the live tabs into siblings: `enrollmentsArchive`,
`attendanceArchive`, `groupingsArchive`, and `studentsArchive`. **Each has exactly the same columns as the
tab it shadows**, so a row moves without transformation and moves back the same way.

They are **pure cold storage**: nothing in the app reads them except the unarchive operation, the student
counts on the Manage Classes tab, and renaming an archived class. No tool
queries them, nothing unions across them, and archived attendance is not visible anywhere in the UI until
its class is unarchived. This is what keeps the rest of the app unaware that archiving exists.

Same spreadsheet, not a second file — another Drive object would mean more sharing, permissions and account
state to keep in sync, and would break the one-file explanation of where a teacher's data lives.

---

### `iep` — retained, and read by nothing

**Phase 2 Step 8a removed the IEP surface from the product permanently.** The risk that attaches to
special education records is not worth the feature at any point on the roadmap, so this is a deletion
rather than a dormant flag: no server service, route or client component reads or writes this tab, and
none is coming back.

**The tab definition stays, and bootstrap goes on creating it.** Removing it would mean a
`schemaVersion` bump and a non-additive migration decision about tabs already carrying a teacher's
rows. Leaving it costs one unused tab per sheet and preserves what a teacher already wrote, on their
own Drive, where we are not in a position to orphan it. A sheet created after 8a is byte-identical to
one created before it.

Two consequences worth knowing. Deleting a student no longer cascades into this tab, so rows for a
student deleted after 8a stay `active`; that is inert, because nothing reads them. And `AccommodationKey`
survives in `server/src/config/schema.ts` for no reason other than keeping the stored rows
interpretable.

**Do not build against this tab.** Anything that reads it is reintroducing the feature.

The shape below is what the existing rows hold.

Child of `students`. One row per (student, accommodation) pair.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | studentId | ULID | no | FK → `students.c01` |
| c03 | accommodationKey | enum | no | see codes below |
| c04 | enabled | boolean | no | |
| c05 | notes | string | yes | per-accommodation free text |
| c06 | updatedAt | timestamp | no | |
| c07 | deletedAt | timestamp | yes | null = active |

**Accommodation keys** (Phase 1 fixed set):

| code | label |
|---|---|
| `fb` | Frequent Breaks |
| `fci` | Frequent Check-Ins |
| `nta` | Note Taking Assistance |
| `ps` | Preferential Seating |
| `at` | Additional Time |
| `as` | Alternative Setting |
| `tu` | Technology Use |

**App-enforced uniqueness**, as it was enforced while the feature existed: among rows with `deletedAt` null, the pair `(studentId, accommodationKey)` was unique. Nothing enforces it now, because nothing writes here.

---

### `attendance`

**Exceptions only, from schemaVersion 5.** A student who was present has no row. The tab holds the
non-present marks plus one **class-day marker** per (course, date) recording that the register was
taken. Attendance is taken per class, so a student in two of the teacher's sections has an independent
status in each on the same day.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | studentId | ULID | no | FK → `students.c01`; **empty on a class-day marker** |
| c03 | date | date | no | `YYYY-MM-DD` |
| c04 | statusKey | enum | no | `a` / `t` / `e` on an exception row, `d` on a class-day marker |
| c05 | notes | string | yes | |
| c06 | createdAt | timestamp | no | |
| c07 | updatedAt | timestamp | no | |
| c08 | deletedAt | timestamp | yes | null = active |
| c09 | course | string | no | the enrolled course this record is for (added in schemaVersion 2) |

**Status keys:** `a` absent, `t` tardy, `e` excused, `d` class-day marker. `p` (present) is still the
API and UI value but is **never stored**: it is inferred from a marked class-day with no exception row.

**The marker is load-bearing, not bookkeeping.** Without it, "everyone was present" and "nobody
recorded this class" are the same absence of data, and attendance statistics divide by the wrong
denominator. A save writes one even when every student is present, in the same append call as the
exceptions so the two cannot diverge. Readers treat a class-day as *a marker **or** any exception on
that date*, so a marker lost to a partial write cannot hide a recorded absence.

**Markers are ordinary rows carrying a course**, which is why class archiving moves them with the rest
of the class without any code of its own, and why the archive move's call budget is unchanged.

**App-enforced uniqueness.** Among rows with `deletedAt` null, the tuple `(studentId, course, date)`
must be unique for exception rows, and `(course, date)` for markers. `course` is denormalized here
(rather than an `enrollmentId` FK) because the rest of the app keys on course-name strings and course
rename is not a feature.

**Weekdays only.** `date` is always a weekday. Weekends are non-instructional, so the app never writes weekend rows and ignores any weekend-dated row when aggregating statistics.

---

### `emailTemplates`

Teacher-authored templates. Body is HTML output from the app's rich-text editor (raw HTML input is never accepted).

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | name | string | no | |
| c03 | subject | string | no | |
| c04 | bodyHtml | string | no | editor-generated HTML |
| c05 | placeholdersUsed | string | yes | pipe-delimited `{{tokens}}` referenced |
| c06 | createdAt | timestamp | no | |
| c07 | updatedAt | timestamp | no | |
| c08 | deletedAt | timestamp | yes | null = active |

---

### `emailLog`

Audit trail and daily-cap enforcement source. Per security spec, email body content is **never** stored.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | templateId | ULID | yes | FK; null for one-off sends |
| c03 | recipientAddress | string | no | |
| c04 | recipientStudentId | ULID | yes | FK; null for non-student sends |
| c05 | sentAt | timestamp | no | |
| c06 | statusKey | enum | no | `sent` / `failed` |
| c07 | errorCode | string | yes | generic codes only, no provider details |

**Daily cap check.** Count rows where `statusKey = 'sent'` AND `sentAt >= <today_utc_start>`. The server caches the resulting _integer count only_ with a short TTL. Log rows themselves are never cached on the server (they may contain recipient PII).

Phase 2 plan: rolling archive once history exceeds a threshold. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 2.

---

### `attendanceRules`

Threshold configurations for automated attendance communications. The feature was tabled and moved to
Phase 3 as a candidate (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)), but this tab is retained
in the live schema (created at bootstrap since v1, currently unused). The shape below is **provisional** and
predates both the tabling and the 2026-09-09 lever expansion. Before the feature is built: absence rules
will be scoped per course, `ruleTypeKey` needs a value for cumulative absences, and a recurring-cadence
rule needs a period rather than the `threshold`/`windowDays` pair.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | ruleTypeKey | enum | no | `absencesInWindow`, `consecutiveAbsences`, `tardyCount`, … (no value yet for cumulative absences or a recurring cadence) |
| c03 | threshold | integer | no | |
| c04 | windowDays | integer | yes | null for rule types that don't use a window |
| c05 | templateId | ULID | no | FK → `emailTemplates.c01` |
| c06 | enabled | boolean | no | |
| c07 | createdAt | timestamp | no | |
| c08 | updatedAt | timestamp | no | |
| c09 | deletedAt | timestamp | yes | null = active |

---

### `emailQueue`

Auto-generated sends awaiting teacher review. Deferred with `attendanceRules` (Phase 3 candidate) but
retained in the live schema, unused. Provisional shape: a course dimension (per-course absence scope) and
a period dimension (recurring-cadence rules re-queue the same `(ruleId, studentId)` each period) will both
be added before the feature is built.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | ruleId | ULID | no | FK → `attendanceRules.c01` |
| c03 | studentId | ULID | no | FK → `students.c01` |
| c04 | triggeredAt | timestamp | no | |
| c05 | statusKey | enum | no | `pending` / `approved` / `rejected` / `sent` |
| c06 | reviewedAt | timestamp | yes | set when teacher acts |
| c07 | sentLogId | ULID | yes | FK → `emailLog.c01`; set once `statusKey = sent` |

**App-enforced uniqueness.** At most one row per `(ruleId, studentId)` pair, regardless of `statusKey`. Rule evaluation never re-queues a student who already has a row for that rule — Phase 1 has no repeat option, and queue rows are retained permanently as the dedupe record. **This constraint does not survive the 2026-09-09 lever expansion**: a recurring-cadence rule is defined by re-queueing the same pair each period, so the key becomes closer to `(ruleId, studentId, course, periodKey)`, and permanent retention of pending rows needs an expiry answer alongside it.

In Phase 1, approving an item transitions `statusKey` directly from `pending` to `sent`; the `approved` value is reserved for a future asynchronous send path.

---

### `groupingConstraints`

Persistent constraints for the grouping tool (Phase 1 Step 7).

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | |
| c02 | constraintTypeKey | enum | no | `together` / `apart` |
| c03 | studentIds | string | no | pipe-delimited ULIDs |
| c04 | notes | string | yes | |
| c05 | createdAt | timestamp | no | |
| c06 | updatedAt | timestamp | no | |
| c07 | deletedAt | timestamp | yes | null = active |

---

### `groupings`

The **current** grouping for each course (Phase 1 Step 7). One row per group; rows sharing a
`groupingId` form one grouping. Each course keeps at most **one** active grouping — it is auto-saved on
every change (generate, drag-move a student, renumber groups) and overwrites the prior one (the previous
active rows for that course are soft-deleted, the new arrangement appended). Opening the grouping page or
switching class restores that course's saved grouping. There is no multi-grouping history. Spreadsheets
bootstrapped before Step 7 gain this tab through the bootstrap's missing-tab reconciliation.

| code | field | type | nullable | notes |
|---|---|---|---|---|
| c01 | id | ULID | no | unique per row |
| c02 | groupingId | ULID | no | shared by all rows of one grouping |
| c03 | groupIndex | integer | no | zero-based position within the grouping (drives the Group number) |
| c04 | studentIds | string | yes | pipe-delimited ULIDs; may be empty for an empty group |
| c05 | groupSize | integer | yes | size parameter used; null if generated by group count |
| c06 | groupCount | integer | yes | count parameter used; null if generated by group size |
| c07 | savedAt | timestamp | no | identical on every row of a grouping |
| c08 | deletedAt | timestamp | yes | null = active |
| c09 | course | string | no | the course this grouping belongs to (added when Step 7 shipped) |

**Exactly one live arrangement per class, and rows are reused rather than replaced.** Saving overwrites
the course's existing rows in place: the first `min(old, new)` groups take over the rows the previous
arrangement used, further groups reuse rows this course had soft-deleted before appending new ones, and
surplus rows are soft-deleted. So the tab settles at each course's high-water mark of group count.

This matters more here than anywhere else in the schema because **auto-save fires on every interaction** —
generate, drag-move, reorder — not on an explicit save. The original implementation soft-deleted and
appended a fresh set each time, which turned ordinary use into unbounded growth: a class of 30 in groups
of 4 writes 8 rows per save, and one planning session is easily ten saves and eighty rows, seventy-two of
them dead. A term across several classes reached thousands, and `listCurrentGroupings` reads the whole tab
before filtering, so every cold load paid for all of it. schemaVersion 6 cleared what had accumulated.

Only the course being saved is touched. Rewriting the whole tab would bound growth too and was rejected:
it turns a concurrent save for a *different* class from last-write-wins on a row into last-write-wins on
the tab.

`groupSize`, `groupCount`, `savedAt`, and `course` are denormalized across the rows of a grouping. The
API treats the grouping (`groupingId`) as the resource, keyed by `course`; exactly one of `groupSize` /
`groupCount` is non-null per grouping, matching the parameter used at generation time (a manually edited
arrangement keeps whichever parameter last generated it). See [API_CONTRACT.md](API_CONTRACT.md). The
`course` column is additive, so it reconciles into existing sheets with no version bump.

---

## Schema Versioning

`meta.schemaVersion` is an integer (stored as string) incremented on every breaking change. The server reads it on every session start and, on discovering an existing sheet, brings it up to the current schema before any other operation. Column removal is done by bumping the version and ignoring the old column; the column is not deleted in place.

The bootstrap does this in two layers ([bootstrap.ts](../server/src/services/bootstrap.ts) `reconcileSchema`, [migrations.ts](../server/src/services/migrations.ts) `runMigrations`):

- **Additive reconciliation (Layer A).** Missing tabs are added, and any tab whose header is a *prefix* of the current schema (new trailing columns were appended) is extended in place by rewriting row 1. Because new columns are always appended and are nullable/defaulted, existing data rows need no backfill — a blank cell reads as the column's default. This is generic (schema-driven), so a purely additive bump needs no per-version code.
- **Version-gated registry (Layer B).** An ordered list of `{from, to, migrate}` steps for non-additive changes (renames, removals, data transforms), applied from the sheet's stored version toward the code target and stamping the version after each, with a best-effort Drive backup copy before the first step. Each step operates on raw cell values, since the typed helpers assume the current schema.

Bootstrap runs Layer B, then Layer A, then restamps `meta.schemaVersion` to the code target. A header that diverges from the schema in an existing position (not a clean prefix) with no registered migration fails closed with `SHEET_HEADER_MISMATCH`.

**Current version: `6`** (`SCHEMA_VERSION` in [server/src/config/schema.ts](../server/src/config/schema.ts)).
Schema version 2 introduced the `enrollments` tab (multiple courses per student), added
`attendance.c09 course` to key attendance per class, and removed the single `students.course` column.
Schema version 3 added `enrollments.c06 atRisk`, the per-class academic-risk flag. Both landed pre-launch
via clean reset (delete the sheet, let bootstrap recreate it), before the migration runner existed.
Schema version 4 (class archiving, Phase 2 Step 6e) added the `courses` tab and the four archive tabs; it
is purely additive, so it was the first bump the runner above applied on its own, with no per-version code
and no reset.
Schema version 5 (attendance as exceptions, Phase 2 Step 6k) is the **first non-additive bump and so the
first entry in Layer B's registry** ([migrationV4ToV5.ts](../server/src/services/migrationV4ToV5.ts)). It
rewrites `attendance` into exceptions plus class-day markers and adds `enrollments.c07 startDate`,
backfilling it from each student's earliest recorded day. See the section at the end of this document.
Schema version 6 (also Step 6k follow-up) is a pure data transform with no column change: it drops the
soft-deleted rows from `groupings` and `groupingsArchive` that the old auto-save left behind. See the
`groupings` section.

## Known Extension Points

- **New features / tabs**: append tabs freely. Unknown tabs are ignored by older clients.
- **New columns**: append as `cNN`. Older clients that don't know about the new column ignore it on read.

## What This Schema Does Not Do

- **No transactional guarantees.** Google Sheets has no transactions. A single teacher on two devices can race; the consequence is last-write-wins on a single row, which is recoverable and low-stakes for the intended use case.
- **No server-side copy of student data.** All student, attendance, and email-recipient data lives in the teacher's sheet. The server holds only non-PII state (OAuth tokens, the daily-send counter, and the per-user Sheet ID mapping in Phase 2).

---

## schemaVersion 5 (Step 6k) — done

`attendance` holds only exceptions (absent, tardy, excused) plus a class-day marker per (course, date),
with *present* inferred from the absence of a row; `enrollments` gained `startDate`. Both are specified
in their sections above.

Roughly 27,000 rows a year becomes roughly 1,890 exceptions plus 900 markers, on a 93% present rate.
It shrinks the data rather than a copy of it, so the Sheets read, the row growth and the cold load all
improve together.

**Non-additive**, so it shipped through the version-gated registry in
`server/src/services/migrations.ts` (`migrationV4ToV5.ts`) rather than the additive reconciler, and it
was sequenced before launch deliberately: the migration was cheapest while the only spreadsheets in
existence were ours. Full rationale in IMPLEMENTATION_PLAN.md (Step 6k), criteria in TESTING_PLAN.md.

**Migration ordering**, which is the safety argument: append the new markers (purely additive, so a
failure loses nothing), then backfill `enrollments.startDate` (fills empty cells only), then rewrite
`attendance` to drop the present rows (the only destructive step, and last). The rewrite is a
**normalising projection rather than a copy** — it rebuilds one marker per class-day — which is what
lets a retry after a half-applied run converge instead of faithfully preserving duplicate markers.

**The `startDate` backfill is part of the migration and has two halves**, because "no rows" meant two
things under v4. A student with rows started no later than their earliest one. A student with no rows
in a course that has recorded days was never in a register that was taken, and is started the day after
the last recorded one, which preserves their `daysRecorded: 0` exactly.
