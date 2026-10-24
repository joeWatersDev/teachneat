# Teachneat — Project Instructions

## What This Project Is

**The product is named Teachneat.** It was called "Teacher Toolkit" through Phase 1 and most of Phase 2;
Phase 2 Step 6g executed the rename and it is done. The working directory, the git repo, the session and
OAuth-state cookie names, the `ttk.` localStorage keys, the `ttk-` CSS class prefix and `meta.appId`
deliberately keep the old string — all internal, none user-facing, and none worth the churn. **The five
Drive identifiers are now frozen** (`TEACHNEAT DATA`, `Teachneat Data`, `tn_app`, `TN_APP_MARKER`,
`tn_filed`): they are how bootstrap discovers an existing folder and spreadsheet, so changing them again
would need a dual-read fallback and a backfill rather than a find-and-replace.

A SaaS web app that provides classroom management tools for teachers. Student data is stored in a Google
Sheet on the teacher's own Google Drive, so **no durable copy of student PII exists on our servers and none
is written to the database, the logs or the backups.** State it that way and not as "never touches our
servers", which is false and was the wording here until Phase 2 Step 8d: every read and write transits the
server because the server is what holds the token and calls the Google APIs, the working set holds a
teacher's roster in process memory under the two clocks in `server/src/config/cache.ts`, and email
personalisation substitutes student names server-side. The durable-copy claim is both accurate and the
strongest thing about the product; the absolute one fails the first technical review it meets.

The business model is B2C: individual teachers register and subscribe directly ($6.99/month or $69.90/year CAD, one paid plan) through the app's own billing, on top of a permanently free tier. Free accounts get the roster, attendance entry, the Name Picker, basic grouping, and 30 emails per month; Premium accounts add attendance statistics, the student-detail attendance summary, email above the free cap (to the standing daily limit), grouping constraints, and all display/styling options. The paid tier is called **Premium** in all user-facing copy, and the free tier a **free account**; the plan values in the API and database stay `free` / `trial` / `paid`. New accounts start on a 30-day full-access trial and fall back to free rather than being locked out. The split and its rationale are specified in IMPLEMENTATION_PLAN.md (Phase 2 Step 3); entitlements are enforced server-side.

**Phase 2 Step 8a is done, and it suspends all of that for the first school year.** The launch is Ontario
only and free to every account, with no money changing hands. The preceding paragraph describes what the
product returns to, not what it currently does: **read Step 8a before writing anything that assumes a paid
tier, a trial countdown or an upgrade affordance exists.**

**Two removals, and the difference between them is load-bearing.** Billing, the plan split and the trial are
switched off behind `BILLING_ENABLED` (default false) and restore by setting it — no code was deleted, and
`resolveEffectivePlan` in `server/src/services/plan.ts` is the single point the whole collapse acts through.
**The IEP surface is deleted permanently and does not restore.** The legal requirements and the risk that
attach to special education records are not worth the feature at any point on the roadmap. The `iep` tab
remains in the sheet schema and bootstrap still creates it, so no migration was needed, but nothing reads or
writes it; anything that starts to is reintroducing the feature and reopening the decision. The end-goal distribution channel is a verified Google Workspace Marketplace listing. Its market is teachers, most of whom sign in with managed Google Workspace for Education accounts, and those domains increasingly block unconfigured third-party OAuth apps that request Gmail or Drive access. A Marketplace listing plus OAuth verification is what lets a school board's admin allowlist the app so their teachers can use it. The Marketplace does not process payments and the board is not the buyer; the listing is for legitimacy and allowlisting, not sales. Trust (a board admin allowlisting the app) and billing (a teacher's subscription) are independent.

## Planning Documents

Six planning documents define the project. Read all six before writing code.

- **IMPLEMENTATION_PLAN.md** — phases, step ordering, project structure, security practices, design principles (lock-in principle, sheets-as-system-of-record commitment)
- **DESIGN_SYSTEM.md** — visual language, layout, color palettes (dark + light), component specs, Students page list/detail pattern, interaction patterns, responsive breakpoints
- **TESTING_PLAN.md** — test criteria for every feature, organized by implementation step
- **SHEETS_SCHEMA.md** — authoritative spec for the teacher's Google Sheet: tabs, column codes, ID format, discovery mechanism, header validation invariant
- **API_CONTRACT.md** — authoritative spec for the HTTP API: endpoints, request/response shapes, error codes, validation rules
- **DEPENDENCIES.md** — authoritative dependency allowlist. It began as the Phase 1 list and now carries the Phase 2 additions too. Anything not listed requires explicit review before being added.

**`ops/` is not a planning document.** It holds the operational records handed to third parties: the
incident response plan, the administrative account register, and the backup and restore procedure with its
test record. Write them for an insurer, a board or a lawyer: no phases, steps or references to the
documents above, no commentary, and remediation items only as the operator has decided and dated them.
Internal questions about them go to NEXT_STEPS.

When these documents conflict with each other, flag the conflict rather than guessing which one is correct.

**Updating NEXT_STEPS.md at the end of a step: follow the procedure in its own "Maintaining this document"
section, and do not skip it because the edit looks small.** Completed work is described once, in HISTORY.md.
NEXT_STEPS keeps only what changes what someone does next, so a step that ships **replaces** the Most
Recently Completed section rather than appending to it, and **deletes** the obligations and open questions it
discharged rather than annotating them "resolved". That document reached 969 lines by ignoring this one
harmless-looking paragraph at a time.

**These documents are ours and they are drafts.** Until real accounts exist, the fact that one of them
already asserts an answer is not evidence for that answer, and must never be used as a reason to keep it.
That includes the privacy policy and the terms: they were written by us, nothing is published, and the
"paired version bump and consent re-prompt" cost of changing them re-prompts nobody. Decide what is
actually best for the product, then change the document to match. See "Our own documents are not external
constraints" under Design Principles in IMPLEMENTATION_PLAN.md for the full rule and for when it inverts.

## Tech Stack

- **Client:** React 19, Vite, TypeScript, Tailwind CSS
- **Server:** Express 5, TypeScript, Helmet, CORS, dotenv
- **Data storage:** Google Sheets API (on teacher's Drive)
- **Email:** Gmail API (send scope only)
- **Auth:** Google OAuth (server-side flow)
- **Payments (Phase 2):** Stripe

## Project Structure

Monorepo with `client/` and `server/` directories. No root package.json.

```
client/src/
  api/           — API client functions (one file per resource)
  components/    — Reusable UI components
    ui/          — Generic primitives (Button, Modal, Input, etc.)
  features/      — Feature modules (one folder per tool)
    students/    — Roster, student detail, and the page's tabs
    classes/     — Manage Classes (archive, restore, rename), the second Students tab
    attendance/
    grouping/
    email/
    name-picker/
  hooks/         — Shared React hooks
  layouts/       — Page layout shells (sidebar, top bar, content area)
  pages/         — Top-level route components
  types/         — Shared TypeScript types/interfaces
  utils/         — Pure utility functions

server/src/
  config/        — Environment, constants, Google API config
  middleware/    — Express middleware (auth, validation, error handling)
  routes/        — Route definitions (one file per resource)
  services/      — Business logic (Sheets operations, Gmail)
  types/         — Shared TypeScript types/interfaces
  utils/         — Pure utility functions
```

## Coding Conventions

### Structure Rules
- **Feature folders are the primary unit.** If a component, hook, or type is only used by one feature, it lives in that feature's folder, not in the shared directories.
- **One route file per resource** on the server. Each file exports a router that `index.ts` mounts.
- **Services encapsulate external APIs.** Route handlers never call Google Sheets or Gmail directly. They call service functions.
- **No barrel files** (`index.ts` that re-exports). Import directly from the source file.
- **No `shared/` directory** unless client and server genuinely need the same type definitions. Do not pre-create it.

### Code Quality
- **No `dangerouslySetInnerHTML`** anywhere in the client. No exceptions without explicit review.
- **Validate all inputs on the server** with Zod. Reject unexpected fields. Enforce max lengths on all strings.
- **No raw `req.body` passed to service functions.** Service functions receive only validated, typed objects.
- **Route handlers must be thin.** Business logic lives in services.
- **Error responses never leak internals** (no stack traces, file paths, Google API error details, or student PII in responses or logs).

### Security (Apply from Day One)
- All secrets in `.env`, never in code, never in git.
- Google API access tokens never sent to the client. Server is the intermediary.
- Email templates use logic-less `{{placeholder}}` string replacement, not a templating engine.
- All placeholder substitutions are HTML-escaped.
- Hard daily email send cap of 120 per user, enforced server-side (`EMAIL_DAILY_CAP`).
- No client-supplied Sheet IDs. The server resolves the Sheet ID from the authenticated user's account.

### Style
- Use Tailwind design tokens from DESIGN_SYSTEM.md. No hardcoded hex colors.
- Light mode is the default. Both modes must work. Use Tailwind `dark:` variants.
- System font stack, no custom fonts.
- No all-caps text. No emoji in the UI.
- All icon-only buttons must have `aria-label` attributes.

## What NOT to Do

- Do not add dependencies without justification. Prefer stdlib or a few lines of code over a package.
- Do not build Phase 2 features (database, sessions, Stripe, multi-user auth) during Phase 1.
- Do not create documentation files (README, guides) unless explicitly asked.
- Do not use JWTs for session management. Phase 2 uses cookie-based sessions.
- Do not add a restricted OAuth scope (e.g., full `drive`, any Gmail read scope). The current data scopes (`gmail.send`, sensitive; `drive.file`, non-sensitive) need only OAuth App Verification; `spreadsheets` was dropped on 2026-09-12 because `drive.file` already covers the app's own sheet, and must not come back; a restricted scope triggers the annual third-party security assessment (CASA), recurring cost, and a larger data-access surface for boards to approve. See IMPLEMENTATION_PLAN.md (OAuth & Token Security).
- Do not store any student data on the server. All student data lives in Google Sheets on the teacher's Drive.
- Do not design the Google Sheets schema with human-readable column headers. The schema must be opaque (encoded keys, internal IDs) per the lock-in design principle in IMPLEMENTATION_PLAN.md.

## Verification

- Do not run browser/preview verification for visual or cosmetic changes — the user visually reviews all work and gives follow-up feedback. Rely on typecheck, unit tests, and build. Use the browser only when the user asks, or for a non-visual correctness check that isn't practically unit-testable, and ask first.

## Git Workflow

- **Never push to `main` without the user's explicit consent, asked for at the time.** A push to `main`
  deploys production, and the whole pipeline (pre-push hook, CI, deploy) takes several minutes that
  interrupt a working session. Committing needs no such permission — commit freely as work completes, and
  let pushes accumulate until the user says to send them. Consent is per-push and does not carry over: a
  previous "yes" is not a standing one. This overrides any instruction below that reads as "push when the
  session's work is tested".
- **Do not block on the CI run after pushing.** Report the run link and move on; waiting on
  `gh run watch` adds minutes to the session for information nobody needed yet. Wait only when the user
  asks for the outcome before continuing. The workflow cancels superseded in-progress runs (`concurrency`
  in ci.yml), so a quick follow-up push supersedes rather than queues.
- **But do check the last run's outcome** — `gh run list --limit 1` — at the start of a session and before
  saying anything is deployed or live. Not watching is not the same as not looking, and conflating the two
  already cost an incident: a deploy failed, the run stayed red unnoticed, and the symptom surfaced later
  as a shipped fix missing from production. The check costs one second.
- **Confirm what production is actually running with `curl -s https://teachneat.com/api/health`**, which
  returns the process start time: a process that started before you pushed is not running your code. Never
  infer "it deployed" from a green run alone. For the exact commit, the deployment record carries
  `source_commit_hash` (`doctl apps get-deployment <app> <deployment>`); the endpoint deliberately does not,
  because the buildpack leaves no `.git` to read it from and the field only ever said `unknown` in
  production.
- Commit directly on `main`. Do not create a feature branch for routine work unless explicitly asked.
- **A push to `main` deploys production** once CI's two check jobs pass, so batch commits and push when a
  session's work is tested. **Commit directly on `main` for all work, including changes touching auth,
  sessions or billing.** An earlier revision required a branch and pull request for those; that rule is
  withdrawn, because a pull request with no reviewer buys ceremony rather than review, and the `pre-push`
  hook already runs CI's checks locally before anything can deploy. Reserve a branch for work that must sit
  unpushed while something else ships. Rollback is not symmetric once a migration has run, so forward-fixing
  is usually safer than rolling back, which makes **a migration the one change worth pausing over before
  pushing** rather than the one change needing its own process.
- A `pre-push` hook in `.githooks/` runs the same checks CI runs (about two minutes) and blocks the push on
  failure; it skips docs-only pushes, mirroring the workflow's `paths-ignore`. It needs one-time setup per
  clone: `git config core.hooksPath .githooks`. Bypass a single push with `git push --no-verify`.
- Standard commit hygiene applies: meaningful messages, no committing secrets, no force-pushing.

## Running the Project

- **Client:** `cd client && npm run dev` (Vite dev server)
- **Server:** `cd server && npm run dev` (nodemon with `tsx`)
- **Build client:** `cd client && npm run build`
- **Build server:** `cd server && npm run build`
- **Python:** use `py` (Windows Launcher), not `python3`

## Current State

**This section is a pointer, not a record.** [NEXT_STEPS.md](NEXT_STEPS.md) is the authoritative record of
what is finished and what is next, and [HISTORY.md](HISTORY.md) is the only place completed work is
described. Keep what follows to facts that change how the very next edit is written; anything longer belongs
in one of those two files. This paragraph was once 21,000 characters of restated history, loaded into every
session before the user had typed anything.

**The project was sunset on 2026-10-18 and production was taken down on 2026-10-23.** The app, the database,
the Google Cloud project (with its OAuth client and KMS key) and the GitHub repository are deleted, so nothing
below about deploying, pushing or checking production applies until a relaunch rebuilds it. The full history
is kept in a private archive. The portfolio record is in `portfolio/`.

**Phase 1 is complete.** All five tools ship: Students, Attendance, Grouping, Name Picker and
Email, plus sub-steps 4a, 4b, 5a, 5b and the Step 9 design pass.

**Phase 2 is complete through Step 8, plus 8a, 8b and 8d.** That covers the account model and Postgres,
server-side sessions and CSRF, plan entitlements, Stripe billing, the support system, the public marketing
surface, registration consent, all eleven sub-steps of Step 6 (productionization), two independent security
passes, the capacity measurement that settled `instance_count: 1`, the data-handling wording correction, the
scope reduction to a free Ontario launch without IEP, and the three conditions an insurer writes coverage
against. **The remaining order is 8c → 8e → 8f → 9 → 9a → 10**: launch administration (8c), the board
question at signup (8e), and token path hardening (8f).

**Step 8's sub-steps were renumbered on 2026-08-28 and the old numbers are not aliases.** Old 8a is now 8c,
old 8b is now 8d, old 8c is now 8a, and old 8d and 8e became 8e and 8f; 8b is new. Anything written before
that date uses the old numbering, including commit messages and a comment in `legalMeta.ts` that this repo
has since updated. When an older reference to a Step 8 sub-step turns up, map it rather than trusting it.

**The app ran in production** at `https://teachneat.com` from 2026-08-24 to 2026-10-23, on DigitalOcean App
Platform with Managed Postgres in `tor1`, the token data key unwrapped from Google Cloud KMS at boot, and
lifecycle email and error alerting through Resend. All of that infrastructure is deleted; a relaunch
provisions it again and repeats Google's OAuth verification.

**Schema.** The current `schemaVersion` is **6** (`server/src/config/schema.ts`). A migration runner brings
an existing sheet up to date on bootstrap: additive column and tab reconciliation with no per-bump code,
plus a version-gated registry (`server/src/services/migrations.ts`) for non-additive changes, then a
`schemaVersion` restamp. Additive bumps no longer require deleting the spreadsheet. v4→v5 (attendance as
exceptions) is the only non-additive migration so far; v5→v6 is a pure data transform.

**Before writing code, read the standing rules rather than reconstructing them.** Security Practices in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) carries the deployment and configuration rules and the
five rules the security passes produced; the Git Workflow section above carries the push, CI and deploy
rules. Both are short and both encode incidents that already happened once.
