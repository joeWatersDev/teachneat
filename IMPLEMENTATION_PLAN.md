# Teachneat — Implementation Plan

This document defines product intent: the design principles, cross-cutting practices, and the ordered
step roadmap. It describes what the project is and what each step delivers, not what is finished.
Current status and open questions live in [NEXT_STEPS.md](NEXT_STEPS.md); the chronological work log and
the standing record of decisions made live in [HISTORY.md](HISTORY.md).

## Design Principles

These apply across all phases and should inform every implementation decision.

**User lock-in:** The app's value should be inseparable from the app itself. The Google Sheets it creates on the teacher's Drive are a storage backend, not a standalone product. Sheet data should be structured for machine consumption (encoded keys, opaque column headers, internal IDs) so that the raw spreadsheet is not useful without the Teachneat interface. Every feature should be evaluated through this lens: if a teacher unsubscribes, can they replicate the workflow from the sheets alone? If yes, redesign. The concrete schema is defined in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md).

**Sheets as system of record:** Student data (roster, IEP, attendance, email recipients) lives in the teacher's Google Sheet across all phases. The teacher (and their school or district) is the data controller; we deliberately take on no durable custody of student PII, to minimize our liability and compliance surface. The precise boundary: the server **never durably stores, persists to disk, writes to a database, or logs student PII.** Student PII does transit and is transiently cached in server memory during a request, because the server is the intermediary for every Google API call (this is what keeps access tokens off the client). That transient in-memory processing is permitted, but is kept minimal in scope and duration and is never persisted. Phase 2's database holds only non-PII state: user accounts, OAuth token material, the per-user Sheet ID mapping, subscription status, and short-lived operational counters. This commitment is load-bearing for the product's privacy positioning and must not be revisited casually; any change that would widen the in-memory PII surface (see the Phase 2 in-memory working set) is a deliberate, documented decision, not a default.

**Our own documents are not external constraints, until they are.** The privacy policy, the terms, this plan
and every other document in this repo were written by us and are drafts until real accounts exist. When a
design question is being weighed, the fact that one of our own documents already asserts an answer is **not
evidence for that answer** and must not be cited as a reason to keep it. Work out what is actually best for
the product and then change the document to match. Reasoning of the form "the privacy policy already says
X, so we should do X" is circular, and the paired-version-bump cost that usually accompanies it is close to
zero while there are no accounts to re-prompt. The genuine arguments for a commitment are the ones that
survive without the document: what it protects, what it costs, what a school board's reviewer will ask, and
what we would have to unwind later. **This inverts at first real user.** Once accounts exist, the published
text is a promise to people who relied on it, the re-prompt has a real cost, and quietly weakening a claim
stops being a documentation edit. Until that day, treat every document here as a draft that owes its
justification to the code, not the reverse. See the paired-bump discipline under Step 6c, which describes
how to make a change, not whether one is allowed.

**Competitive moat:** The tool set alone is replicable. Long-term defensibility comes from network effects (see Phase 3). In the short term, the moat is execution quality, UX polish, and the friction of switching away once a teacher's data lives in the system.

**Distribution and trust:** The end-goal distribution channel is a verified listing on the Google Workspace Marketplace. The market is teachers, most of whom sign in with managed Google Workspace for Education accounts, and those domains increasingly block unconfigured third-party OAuth apps that request Gmail or Drive access (the wave that followed Google's August 2023 third-party-app-access changes). A Marketplace listing plus OAuth verification is what makes the app allowlist-able by a school board's administrator. This does not change the business model, which stays B2C: individual teachers register and subscribe directly ($6.99/month or $69.90/year CAD, one paid plan), billed through the app's own Stripe integration, on top of a permanently free tier (see Phase 2 Step 3 for the free-versus-paid feature split). The Marketplace does not process payments and the board is not the buyer. Trust (a board admin allowlisting the app) and billing (a teacher's subscription) are independent, and the no-durable-PII commitment above is the primary asset for passing the board privacy review that gates allowlisting.

---

## Project Structure

The repo is a monorepo with separate `client/` and `server/` directories. This structure should be maintained and extended as follows.

```
Teacher_Toolkit/
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/
│   ├── src/
│   │   ├── api/                # API client functions (one file per resource/domain)
│   │   ├── components/         # Reusable UI components
│   │   │   └── ui/             # Generic primitives (Button, Modal, Input, etc.)
│   │   ├── features/           # Feature modules, one folder per tool
│   │   │   ├── students/       # Combined roster + IEP (single page)
│   │   │   ├── attendance/
│   │   │   ├── grouping/
│   │   │   ├── email/
│   │   │   └── name-picker/
│   │   ├── hooks/              # Shared React hooks
│   │   ├── layouts/            # Page layout shells (sidebar, nav, etc.)
│   │   ├── pages/              # Top-level route components
│   │   ├── types/              # Shared TypeScript types/interfaces
│   │   ├── utils/              # Pure utility functions
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vite.config.ts
│
├── server/                     # Express + TypeScript backend
│   ├── src/
│   │   ├── config/             # Environment, constants, Google API config
│   │   ├── middleware/         # Express middleware (auth, validation, error handling, rate limiting)
│   │   ├── routes/             # Route definitions, one file per resource
│   │   ├── services/           # Business logic (Sheets operations, Gmail, Stripe)
│   │   ├── types/              # Shared TypeScript types/interfaces
│   │   ├── utils/              # Pure utility functions
│   │   └── index.ts
│   └── tsconfig.json
│
├── shared/                     # Code shared between client and server (do not pre-create; see Structure Conventions)
│   └── types/                  # e.g., API request/response contracts
│
├── spreadsheet/                # Original Apps Script reference (read-only archive)
├── IMPLEMENTATION_PLAN.md
└── .gitignore
```

### Structure Conventions

- **Feature folders** (`client/src/features/*`) are the primary organizational unit for tool-specific code. Each feature folder contains its own components, hooks, and types. If a component is only used by one feature, it lives in that feature's folder, not in the shared `components/` directory.
- **One route file per resource** on the server. No monolithic route file. Each file exports a router that `index.ts` mounts.
- **Services encapsulate external APIs.** The route handlers never call Google Sheets or Gmail directly. They call service functions. This keeps routes thin and makes it possible to swap or mock the data layer.
- **`shared/` is optional and minimal.** Only create it if client and server genuinely need the same type definitions. Do not pre-create it. Most of the time, the client and server types will diverge enough that sharing creates more coupling than it saves.
- **No barrel files** (`index.ts` that re-exports everything from a folder). They obscure where things live and create circular dependency problems. Import directly from the source file.

---

## Security Practices

Security is a cross-cutting concern that applies from day one, not something bolted on in Phase 2. The data this app handles (student names, IEP accommodations, attendance records, guardian contact info) is sensitive. A breach could have real consequences for children and families, and would be fatal to the product's credibility.

### Foundational (Apply from Phase 1)

**Server hardening**
- Helmet is already in place. Review its default CSP and tighten it: restrict `script-src`, `connect-src`, `frame-ancestors` to only what the app needs.
- Disable `X-Powered-By` (Helmet does this by default, but verify).
- Set `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options` headers explicitly.

**Input validation**
- Validate and sanitize every input on the server, regardless of whether the client also validates. Use a schema validation library (e.g., Zod) for request bodies, query params, and route params.
- Reject unexpected fields. Do not pass raw request bodies to service functions.
- Enforce maximum lengths on all string inputs. Student names, email templates, IEP notes: everything has a ceiling.

**Output encoding**
- React handles XSS in JSX by default via escaping, but any use of `dangerouslySetInnerHTML` is banned without explicit review.
- Email template rendering must use logic-less string replacement (e.g., `{{studentName}}` replaced via `String.replace`), not a full templating engine like Handlebars or Nunjucks. A templating engine with logic support opens the door to server-side template injection if an attacker controls template content.
- All variable substitutions in email templates must be escaped for the output context (HTML entities for HTML emails, no raw interpolation).

**Secrets management**
- All secrets (Google OAuth client secret, API keys, Stripe keys) live in `.env` files, never in code, never in git.
- `.env` is already in `.gitignore`. Verify `.env.local` and `.env.*.local` patterns are also covered (they are).
- In Phase 1, `.env` on your local machine is sufficient. In Phase 2, use the hosting provider's secret management (encrypted environment variables in DigitalOcean App Platform, decided in Step 6b, not config files on disk). The `TokenCipher` key is the exception and does not live there at all: it moves into Google Cloud KMS at Step 6d, per the OAuth & Token Security section below.

**Dependency hygiene**
- Run `npm audit` regularly. Do not ship known-vulnerable dependencies.
- Pin dependency versions in `package-lock.json` (npm does this by default). Do not use `*` or overly broad version ranges in `package.json`.
- Minimize the dependency surface. Before adding a package, consider whether stdlib or a few lines of code would suffice.
- Use `npm install --ignore-scripts` in CI/CD to block malicious postinstall hooks. Manually review and allowlist any packages that genuinely require postinstall scripts.
- Consider `npm audit signatures` for provenance verification on dependencies.

**Error handling**
- Never leak stack traces, file paths, or internal state in API responses. Catch errors in a centralized error-handling middleware that returns generic messages to the client and logs details server-side.
- Google API errors may contain the teacher's email or Drive file IDs. Sanitize these before logging or returning them.

**Google API quota protection**
- Cache Google Sheets reads on the server so repeated client requests for the same data do not each produce a Sheets API call. Phase 1 shipped this as a flat 30-60 second TTL; Step 6a replaced it with the working set described under Step 6 (idle 2 min, extended on use; age 5 min, never extended).
- Enforce a per-user API call budget on the server. If a single user triggers an unusual volume of Google API calls, throttle them before the app's global quota is affected.
- Monitor quota usage. A spike in API calls may indicate abuse or a bug causing runaway requests.
- **Call-volume instrumentation (add in Phase 1).** Count every outbound Google API call by service, method, and result (ok / 429 / other), and expose a rolling per-minute total. This is the metric that tells us how close aggregate load is to the shared Sheets ceiling (600 reads/min/project after the granted increase, 300 writes/min/project; 60/min/user for each) and whether the Phase 2 scaling work is actually needed or whether the quota increase plus paid overage covers real peak load. The relevant limits and the full scaling analysis are recorded under Decisions Made in [HISTORY.md](HISTORY.md).

### OAuth & Token Security

- Request only the minimum scopes needed: `drive.file` (grants access only to files the app creates, which covers the Drive `appProperties` discovery marker per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) and all Sheets API reads and writes on the app's own spreadsheet) and `gmail.send`. No broad Drive, Sheets or Gmail access. **`spreadsheets` is deliberately not requested**: it was dropped on 2026-09-12 after a live test with the grant revoked showed `drive.file` alone finds, reads, writes and creates the sheet. It reaches every spreadsheet the teacher owns and granted the app nothing it used. `googleAuth.test.ts` pins the exact list.
- **Scope discipline is a hard constraint, not just a minimization preference.** The current data scopes are `gmail.send` (sensitive) and `drive.file` (non-sensitive). Together these require **OAuth App Verification** (brand verification plus a scope-justification review) but **not** the annual third-party security assessment (CASA), which is triggered only by *restricted* scopes such as full `drive` or any Gmail read scope. Never add a restricted scope: it triggers CASA and its recurring audit cost, and it enlarges the data-access surface a board's admin must approve before allowlisting the app. Keeping `gmail.send` (sensitive, not restricted) is what lets email be sent from the teacher's own address without incurring CASA.
- **The app is verified, and the approval covers what the consent screen shows.** Adding a scope, or changing the app name, logo, homepage, privacy policy URL or terms URL in Google Auth Platform, sends the app back through review. A newly added sensitive scope shows teachers the unverified-app warning until it clears. Batch such changes rather than making them one at a time, and treat Phase 3's Classroom scopes as a new submission with its own justification and demo video. The policy must keep enumerating every requested scope and carrying the Limited Use statement whatever else changes in it.
- Store refresh tokens securely. In Phase 1 (single user, local), an encrypted file or env var is acceptable. In Phase 2, tokens must be encrypted at rest in the database, and the encryption key must live in a separate key management service (e.g., GCP KMS, AWS KMS), not in an env var on the same server. If the encryption key is colocated with the encrypted data, the encryption provides no real protection against a server compromise. **Sequencing:** the Phase 2 account-model step (Step 1) encrypts tokens at rest in the DB with AES-256-GCM behind a `TokenCipher` seam whose key is still an env var; the KMS-held key is introduced at the hosting step (Step 6), where the KMS infra is provisioned, by swapping in a KMS-backed `TokenCipher` with no call-site change.
- Access tokens are short-lived and should never be sent to the client. The server acts as the intermediary for all Google API calls.
- Implement token refresh logic with proper error handling: if a refresh token is revoked, prompt the user to re-authenticate rather than failing silently.

### Email Security

The Gmail API send scope is one of the most dangerous capabilities this app holds. An attacker who can trigger email sends has access to high-credibility phishing (emails come from the teacher's real address) and can cause reputational damage or account suspension.

- **Hard daily send cap of 120 emails per user**, enforced server-side. This limits blast radius if an account or the server is compromised while leaving ample room for legitimate high-volume days (mass notifications, report card season, conference reminders). It was 200 until Step 8a lowered it: 120 still covers a whole timetable contacted in one afternoon, and cuts what a stolen session can send by 40%. The cap is enforced against a Postgres counter claimed before sending — Step 7 moved it off the `emailLog` tab, which the teacher can edit. `MAX_RECIPIENTS_PER_SEND` stays at 200 and deliberately exceeds it: it bounds one request, not a day, and a send larger than the remaining allowance fills the allowance and reports the rest as skipped.
- **Rate limit the email-sending endpoint** more aggressively than other endpoints. Burst sends (e.g., 100 emails in 10 seconds) should be blocked even if the daily cap hasn't been reached.
- **Log all email sends** (recipient, timestamp, template used) for audit purposes. Do not log email body content, as it may contain student PII.
- **Teachers author templates via a rich-text editor, never raw HTML.** The app provides a rich-text editing interface (bold, italic, lists, links, etc.) and controls the HTML output. Teachers have full control over wording and tone, but the app generates the underlying HTML from the rich-text input, which keeps the injection surface closed. Raw HTML input is never accepted.

### Phase 2 Additions

**Authentication & sessions**
- Use secure, HttpOnly, `SameSite=Lax` cookies for session management. No JWTs stored in localStorage (XSS-accessible). **Lax, not Strict**, which this section originally specified: the OAuth callback is a cross-site redirect back into the app and the cookie has to be sent on that navigation, so Strict would break sign-in. The per-session CSRF token below is what carries the protection Strict would have added.
- Implement CSRF protection on all state-changing endpoints.
- **Sessions expire after 14 days idle or 30 days absolute, whichever comes first.** This supersedes an earlier 12-hour idle timeout specified here, which was rejected during Step 2: a 12-hour window signs a teacher out between one school day and the next, and the session is not a bearer of student data, which lives in the teacher's Sheet behind Google's own auth. The reasoning and the test criteria are in [TESTING_PLAN.md](TESTING_PLAN.md) (Step 2).
- **"Remember me" is deferred, not dropped.** The original criterion here was a checkbox at login choosing between a persistent and a browser-session cookie. The sign-in control is a single anchor to the OAuth route rather than a form, so there is nowhere the choice belongs, and asking it of someone who has not yet seen the product is the wrong moment. The cookie is persistent for every session. Revisit if a teacher on a shared classroom machine asks for it, which is the case that would justify the control; a setting inside the app is the more natural home than the sign-in page.
- Explicit logout must revoke the session server-side, not just clear the cookie. A cleared cookie with a still-valid server-side session is exploitable if the cookie value was captured. The logout button should be prominent and easy to reach.

**Authorization**
- Every API endpoint must verify that the authenticated user owns the resource they're requesting. A teacher must not be able to access another teacher's data by guessing IDs (IDOR prevention).
- Every service function accepts a user ID and resolves the sheet ID internally. There must be no code path where a client-supplied identifier reaches the Google API.
- Stripe webhook endpoints must verify the webhook signature before processing any event. The webhook route must use `express.raw()` instead of `express.json()` to preserve the raw request body bytes for signature verification. Express's JSON parser alters the body, which invalidates Stripe's HMAC.

**Rate limiting**
- Apply rate limits per-user on all endpoints, with stricter limits on auth and email-sending routes.
- Rate limit login attempts to prevent credential stuffing (even though login is OAuth-based, the token exchange endpoint should be protected).
- Free accounts do get Google API access (the free tier's whole purpose is to accumulate a real roster and daily attendance), so a paywall is no longer the quota-abuse barrier it was originally written to be. The barrier is instead: per-user rate limits on every endpoint, the free tier's hard 30-emails-per-month cap (the only free-tier feature with an external send cost and an abuse/deliverability blast radius), and the per-user Sheets ceiling of 60 reads/min that Google enforces regardless of plan. Revisit if free-tier abuse is ever observed; a total-student cap on free accounts is the next lever, ahead of paywalling API access.

**Data isolation**
- Each teacher's Google Sheet ID is tied to their account. The server must never accept a sheet ID from the client. It looks up the sheet ID from the user's account record.
- Logs must not contain student PII. If structured logging is used, define a sanitization layer that strips names, emails, and IDs from log output. This sanitization must be tested, not aspirational: write tests that assert log output from known-PII inputs contains no PII.

**HTTPS only**
- TLS everywhere. No HTTP fallback. HSTS header with a long max-age.
- Secure cookie flags require HTTPS, so this is a prerequisite for session security.

### Standing rules from the Step 7 security passes

Five results of the two security passes are rules rather than fixes. Each was learned from a real defect in
this codebase, and each applies to work that has not been written yet. The passes themselves are in
[HISTORY.md](HISTORY.md).

- **Sanitize last, not first, whenever a value is substituted into markup.** `sendEmails` sanitized the
  template and then substituted into it, so both sanitizer passes inspected the `{{token}}` and neither saw
  the value, and a `javascript:` URL reached the sent body through a template's own `<a href="{{goesBy}}">`.
  HTML-escaping covers a value landing in *text*; it does not cover one landing inside an attribute the
  template already opened, and a placeholder-only href saves cleanly because it is a relative URL. Escaping
  and sanitizing are layers rather than alternatives, and the order between them is load bearing in both
  directions. The order is filter, substitute, sanitize.
- **The teacher's spreadsheet is untrusted input on the read path.** Validation on write says nothing about
  what comes back: the sheet is editable by hand, by the teacher and by anyone they have shared it with.
  That is how a `Bcc:` reached the mail headers, and how the daily send cap was resettable by deleting rows.
  Anything read out of the sheet and used for a security decision must be validated at the point of use.
- **No raw control bytes in tracked text files.** Two were found. A NUL made git treat `emailSend.ts` as
  binary, so two security fixes landed with no readable diff in the file that builds mail headers. A `0x08`
  made a CSP assertion match nothing and pass unconditionally, and also failed lint, so CI could not have
  gone green and nothing pending would have deployed. A control byte is invisible in review and turns a test
  into a decoration. All 351 tracked text files were clean as of 2026-08-26; keep them that way.
- **A test that cannot fail is worse than no test.** Confirm every new guard's test fails against the
  pre-fix code before keeping it. The fake Drive ignored the ownership clause entirely, so new discovery
  tests would have stayed green with the guard deleted.
- **A shape change can silently disable a bound.** 6k changed the attendance cache entry from an array to an
  object, `Array.isArray` returned false, and the largest thing in the process was charged the 1 KB floor,
  a 345x undercount with nothing failing. Assert the shapes each resource actually caches, not the generic
  rule, because the generic rule passed throughout.

### Deployment and configuration rules

- **`.do/app.yaml` is not what production runs.** The live App Platform spec is, and CI's deploy step runs
  only `doctl apps create-deployment`, which redeploys the existing spec rather than applying the file. So
  editing that file and pushing changes no configuration while still costing a production restart, because
  `.do/**` is not in ci.yml's `paths-ignore`. Apply configuration by pulling the live spec with
  `doctl apps spec get`, editing that, and applying it; secrets come back as encrypted `EV[1:...]` blobs that
  App Platform accepts verbatim, where `app.yaml`'s `${SECRET}` placeholders would be written literally over
  the real values. `doctl apps spec validate` without an app id validates the spec as a *new* app and rejects
  encrypted values, so it errors on a good spec; use `--schema-only`.
- **Adding a required environment variable is a two-step change and the order matters.**
  `assertProductionConfig` is fatal under `NODE_ENV=production`, so set the variable in DigitalOcean first,
  then deploy the code that requires it. Reversed, the deploy fails; it fails safely, App Platform keeping
  the old instance when the new one fails its health check, but the error lands in the deploy logs and
  nowhere obvious.
- **`TRUST_PROXY_HOPS` is `2`, and it is the first suspect whenever a rate limiter refuses the wrong
  people.** It is a fact about DigitalOcean's infrastructure, so it can go stale with no commit here changing;
  nothing tests it and nothing alerts on it. Too low and the IP-keyed limiters collapse into one bucket; too
  high and callers pick their own bucket, which is the worse failure because it looks like it is working.
  Re-derive it through the operator-gated `GET /api/internal/forwarding`, and **measure twice, once clean and
  once with a forged `X-Forwarded-For`**, because counting header entries gives the right answer on a clean
  request and the wrong one under a forged one. The fixed quantity is how many infrastructure hops append.
- **Enabling a provider seam that was returning null delivers everything that queued while it was null.**
  Configuring `RESEND_API_KEY` on the live app sent a welcome message for every account ever created on
  production, because `createMailer()` had been returning null and the dispatch sweep leaves rows queued
  rather than marked sent or discarded. The claim query has no age cutoff by design, so "turn the integration
  on" and "flush months of backlog" are the same action. The blast radius was one operator inbox this time
  and will not be next time. **Before enabling any disabled outbound integration, count what is pending and
  decide whether it should be sent or abandoned** — the decision is cheap beforehand and unrecallable after.
  The same shape applies to anything else that queues against a seam that can be null.
- **Helmet's headers reach only `/api`.** The document that runs the JavaScript is served by the static
  component and carries the meta-tag CSP in `client/src/config/csp.ts`, which structurally cannot carry
  `frame-ancestors`, HSTS or `nosniff`. Each gap has a working mitigation today; serving the SPA from Express
  is the Phase 3 candidate that closes them.

### Phase 3 Additions

**File upload security**
- Uploaded lesson plans and resources must be validated: file type whitelisting, size limits, virus scanning if feasible.
- Never trust the client-supplied filename or MIME type. Validate file content by reading magic bytes. Generate random filenames server-side.
- Store uploaded files in a managed storage service (e.g., Google Cloud Storage, S3), not on the application server's filesystem.
- Serve uploaded content from a separate domain or with `Content-Disposition: attachment` to prevent stored XSS via uploaded HTML/SVG.

**Content moderation**
- User-submitted content (lesson plans, descriptions) must be sanitized before display to other users.
- Consider a reporting mechanism for inappropriate content.

---

## Implementation Steps

### Phase 1

The order below is designed so each step builds on the previous one and produces something testable. Note: the build order differs from the sidebar navigation order (Students, Attendance, Grouping, Name Picker, Email). Email was built before Grouping and Name Picker because the planned Automated Attendance Communications feature was to depend on it; that feature has since been tabled and moved to Phase 3 as a candidate (see Phase 1 Step 6 below, which is a different step from Phase 2's Step 6, and the Phase 3 entry). Email still appears last in the sidebar because teachers use it less frequently than the classroom tools.

**Step 1 — Google OAuth + Sheets bootstrap**
Set up the OAuth flow. On successful auth, locate the app's dedicated spreadsheet on the user's Drive using the discovery mechanism in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) (Drive `appProperties` plus signature row in the `meta` tab). If not found, create it with the full set of tabs and opaque schema defined there. Confirm read/write works. Implement the header-row validation invariant (refuse any read or write if row 1 does not match the expected column codes for that tab).

**Step 2 — App shell + theme system**
Build the three-zone layout (top bar, sidebar, main content area) as defined in DESIGN_SYSTEM.md. This is the skeleton that every feature renders inside. Includes: the top bar with wordmark and user avatar, the sidebar with navigation items (disabled/placeholder until each tool is built), responsive collapse behavior, and the light/dark mode toggle. Set up the Tailwind theme config with both palettes and persist the user's mode preference in localStorage.

**Step 3 — Students page (roster + IEP)**
The Students page combines the roster and IEP quick reference into a single tool, accessible from the first sidebar item. It uses a list/detail navigation pattern (like Gmail's inbox-to-email flow):

- **Roster list view (default):** all students displayed as rows. Each row shows name, course, student email, and checkmark indicators for active IEP accommodations (Frequent Breaks, Frequent Check-Ins, Note Taking Assistance, Preferential Seating, Additional Time, Alternative Setting, Technology Use). Toolbar has filter (by course, by IEP status, by accommodation type), sort (last name, first name, course), and "+ Add Student."
- **Student detail view:** opened by clicking a row. Shows full student profile in panel order: name/pronouns/"goes by" header, contact info (student + parent/guardian emails), general notes, attendance summary and history heatmap (a placeholder during Step 3, wired up in Step 4), and a read-only IEP panel listing only enabled accommodations with their notes. The IEP panel's own Edit button opens a modal with the accommodation toggles and per-accommodation note fields. Back button returns to the list.

The roster is the data foundation every other feature depends on. Use this step to establish the patterns for feature modules: component structure within `features/students/`, API calls, service layer, error handling. Corresponding Sheets read/write service for both roster and IEP data.

_Step 3 follow-ups._ Beyond the base Step 3 build (roster, detail, single add, IEP toggles), the Students page includes the refinements below:

- **3a — Required-field affordances on the add form.** First name, last name, and course labels get an asterisk. A footnote reads "* indicates a required field." The submit button is disabled until all three required fields are non-empty (trimmed), replacing the current submit-then-server-error behavior.
- **3b — Pronouns dropdown.** Replace the free-text pronouns input with a dropdown: He/Him, She/Her, They/Them, Other. "Other" is stored literally as the string `Other` (no follow-up text field). Existing free-text pronoun values that do not match an option are shown as "Other" in the dropdown; saving the form in that state overwrites the original free-text value with the literal `Other` (accepted data-loss tradeoff). Applies to both the single-add and edit forms.
- **3c — Course existing-or-new combobox.** Replace the plain course text input with a `<datalist>`-backed combobox: a text field that suggests all existing course names and also accepts a brand-new value typed inline. Course remains free text in the schema. Applies to the single-add, edit, and bulk-add forms.
- **3d — Bulk add students.** A "Bulk add" action alongside "Add Student" opens a dedicated **full-width screen** (not the 560px modal). Columns in a horizontal row, in order: First Name, Last Name, Pronouns, Course, Student Email, Parent Email. Pronouns uses the 3b dropdown; Course uses the 3c combobox. A new empty row appears automatically once the current row begins to be populated; the trailing empty row is never submitted. Bulk add accepts a single parent email per student (additional parent emails are added later via the detail screen). Required fields per row are First Name, Last Name, Course.
  - **Submission / partial-failure handling.** There is no server batch endpoint (`POST /students` is single-record), so bulk add issues N create calls. All non-empty rows are validated client-side first (inline per-cell errors; submit blocked until clean). On submit, rows are created individually; rows the server still rejects remain on the grid marked with their error while successfully created rows are removed, and a summary reports how many students were added. This preserves partial success and keeps failed rows on screen for correction rather than dropping them. (A future server-side atomic batch endpoint is a possible API-contract addition but is out of scope for this step.)
- **3e — IEP toggle responsiveness.** Toggling an accommodation currently incurs a chain of sequential Sheets calls (header validation before each read/write, the write, then a post-invalidation refetch), producing a one-to-three-second delay. Fixes: (1) drop the follow-up `listIep` refetch and merge the `IepRecord` already returned by the create/update endpoint into local state; (2) make the toggle optimistic — flip immediately, reconcile on response, roll back on error. Optional server-side win: de-duplicate the header validation so a single update validates row 1 once rather than twice.
- **3f — Roster load responsiveness.** Clicking the Students tab occasionally lags for several seconds. Two root causes: (1) the client has no cache, so every visit re-mounts the page, shows a loading state, and refetches from scratch; (2) the roster issues 1 + N requests because it calls `listIep` once per student for the row badges. The server-side cache (45s TTL, invalidated on every mutation) only protects Google quota; it does nothing for the browser and is frequently cold right after edits. Two-part fix:
  - **Client-side stale-while-revalidate cache.** Hold the roster result in an in-memory store above the router so it survives tab switches. On revisit, render the last known roster immediately (no loading flash) and refetch in the background, updating in place if anything changed. Hand-rolled (module-level store plus a timestamp), no new dependency — adding a data-fetching library would require a `DEPENDENCIES.md` review.
  - **Collapse the N+1 via a new endpoint.** Consume `GET /students/iep-summary` (added to [API_CONTRACT.md](API_CONTRACT.md): returns `{ studentId, enabledAccommodations }[]` for all active students) so the roster makes two parallel requests (`GET /students` + the summary) instead of 1 + N. The student detail view keeps using the full `GET /students/:studentId/iep`. Server: add a `listIepSummary` service that aggregates active enabled IEP rows in a single read, and register its route before `GET /students/:id` so `iep-summary` is not captured as an `:id`. Pairs with 3e's optimistic updates so the tool feels responsive despite the Sheets-backed store.

**Step 4 — Attendance Tracker**
Daily attendance logging and the statistics view. This is more complex than the Students page (date-indexed data, aggregation, threshold calculations) but still self-contained.

- **Class scoping.** Both the entry and statistics views are scoped to a single class at a time through a course dropdown, defaulting to the first course alphabetically. Attendance is per class, so a class is always selected; there is no "All classes" option. Attendance is submitted only for the students currently in scope, which is compatible with the overwrite semantics (students absent from a submission are untouched).
- **Weekends are non-instructional.** Saturdays and Sundays are never school days. Selecting a weekend in the entry view renders every student as a grayed-out, read-only "Excused" row with entry controls disabled and saving blocked; the server also refuses attendance writes for weekend dates as a defensive check. Weekend-dated records never count toward statistics and never break a consecutive-absence streak — a student absent Thursday and Friday and then the following Monday reads as a 3-day streak because the intervening weekend is not a recorded day.
- **Cross-tool navigation.** A student's name in either the entry list or the statistics table links to that student's detail view on the Students page. This makes the student detail route addressable (`/students/:studentId`) rather than only reachable through in-page selection state.
- **Attendance heatmap on the student detail page.** Below the attendance summary, a GitHub-contribution-style heatmap gives an at-a-glance history: columns are weeks and rows are the five school days (Mon–Fri; weekends are omitted). Color-coded present (blue), tardy (yellow), absent (red), excused (dark gray), and a faint fill for days with no recorded attendance. It reads the shared range endpoint and filters client-side, consistent with the summary; the widget is horizontally centered and, when the history overflows, scrolls to the most recent week.

**Step 4a — Students in multiple courses.**
Students can belong to more than one of the teacher's courses (for example the same child in both a
Period 1 and a Period 4 section, or a co-taught student). Course memberships live in a dedicated
`enrollments` tab (one row per `(studentId, course)`); the `students` row holds identity, contact, and
IEP only. Attendance is taken per class and keyed on `(studentId, course, date)` via a denormalized
`attendance.course` column, so a student in two sections holds an independent status in each on the
same day. The roster course filter, grouping, name picker, and statistics all key on enrollment. See
[SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) for the schema; the decision that led here, and the alternatives
weighed, are recorded under Decisions Made in [HISTORY.md](HISTORY.md).

**Step 4b — Attendance History view.**
A third view on the Attendance page, behind the same segmented toggle as Daily Entry and Statistics, showing
the whole class's recorded attendance at once. It answers a question neither existing view does: Daily Entry
shows every student on one day, the student-detail heatmap shows every day for one student, and Statistics
shows totals with the days themselves collapsed away. History is the missing axis, every student against every
day, and it is where a teacher spots a pattern (a class-wide gap on a day attendance was never taken, a
cluster of absences in one week) that per-student and aggregate views hide.

The layout deliberately echoes Daily Entry: the same class scoping, the same one-row-per-student rhythm, the
same student-name link into the detail view. The difference is that each row carries a strip of color-coded
day cells instead of status buttons, and the strip scrolls horizontally into the past.

- **Read-only.** The grid displays; it never writes. Corrections stay in Daily Entry, which already loads a
  past date's records for review and overwrites them on save. This keeps History a pure read with no new
  write path, no optimistic-update or rollback handling, and no way for a stray click on a dense grid to
  change a record.
- **Single class only**, matching Daily Entry and for the same reason: attendance is taken per class, so a
  class is always selected. One row per student, and every cell is unambiguous. This is the point where
  History diverges from Statistics, which offers a row per `(student, course)` enrollment.
- **School days only.** Columns are Mon–Fri. Weekends get no column rather than a gray one, so horizontal
  space is spent only on days that can hold data; a small fixed gap between weeks (in place of a border) keeps
  the week breaks legible. Unrecorded weekdays still get a faint "no record" cell, because a day attendance
  was never taken is information worth showing, not hiding.
- **Trailing window, scrolled to today.** A fixed trailing window of the most recent 26 weeks (the constant
  the student-detail heatmap already uses, roughly a semester), opening scrolled fully right on the most
  recent day; the teacher scrolls left for older days. Leading weeks with no records for the class are
  trimmed, with a floor kept, matching the heatmap's existing behavior. No date controls to learn.
- **Reuse, not reimplementation.** The day classifier and status color mapping that today live in
  `features/students/heatmapDays.ts` are the same logic this view needs. They move to the attendance feature
  (which owns the concept) and the heatmap imports them from there, so the two views cannot drift apart on
  what color an excused day is. `features/students` already imports `../attendance/dates`, so the direction
  of that dependency is established.

No schema change. The one API change is additive: an optional `course` query parameter on
`GET /attendance/range`, mirroring the one `GET /attendance` already has. See [API_CONTRACT.md](API_CONTRACT.md).

**Step 5 — Mass Email Tool**
Integrate the Gmail API. Build the template system, recipient selection, preview, and send flow. This introduces a new external API and an action with real consequences (sending emails), so it needs the preview/confirmation UX. Templates also support bounded conditional blocks: a line can be shown only when a recipient's data matches a fixed metric/operator/literal condition (no expression engine, per the Email Security notes). The initial condition metrics are number of lates, number of unexcused absences, and whether the student has IEP accommodations.

**Step 5a — Academic risk flag (per student, per course)**
Add an "academic risk" boolean stored per student per course, defaulting to false, toggled on the Students detail page on a per-class basis. Because it is scoped per (student, course) rather than per student, it lives on the `enrollments` row (a new column) rather than the `students` row (schemaVersion 3, SHEETS_SCHEMA.md). The Students detail page gains an Academic Risk card with a per-course toggle, and the flag is set through a dedicated `PUT /students/:studentId/at-risk` endpoint (the `Student` object exposes `atRiskCourses` read-only; no client-supplied identifiers reach Google beyond the usual resolution).

This step also adds two warning indicators, on top of the stored flag:

- **Roster warning column.** The Students roster gains a column (like the accommodations column) whose icons flag, per student, (1) at academic risk in any course, and (2) high absences in any course. Each icon has a hover tooltip naming the course(s) it applies to. Fed by `GET /students/risk-summary` (which returns the specific courses).
- **Attendance summary warning.** The student detail attendance-summary pane shows a "High Absences" warning next to the absence-rate value when the (course-scoped) summary crosses the threshold.
- **One high-absence threshold, app-wide.** Over 15% absence rate with at least 5 recorded days. This single definition (`HIGH_ABSENCE_RISK` / `isHighAbsenceRisk`) is used by the roster and summary indicators, the Statistics view flag, and the email "High absences" recipient selection, so they never diverge.

Once stored, the Mass Email Tool's conditional templating (Step 5) gains `atRisk` as a boolean condition metric alongside `hasAccommodations` (done — resolved per `(student, course)` from `Student.atRiskCourses`); the deferred automated-communications feature (now a Phase 3 candidate) may reference it as well.

**Step 5b — Cross-tool communication links**
Two small navigation features that connect the Email tool, the Students page, and the teacher's Gmail.
Both are read-only client-side additions with no new server endpoint and no schema change.

- **Recipient names link to student detail.** In the Email tool's recipient pane, each student name
  links to that student's detail view (`/students/:studentId`), reusing the addressable-route pattern
  the Attendance entry and statistics tables already use.
- **"View communication history" deep link.** The student detail view's contact pane gains a link that
  opens the teacher's Gmail in a new tab with the search bar pre-filled to return every message to or
  from the student's email or any of their guardians' emails. The query is built client-side from
  addresses already loaded on the detail page (Gmail `from:`/`to:`/`cc:` operators over each address,
  OR-combined). The
  link targets the authenticated teacher's mailbox by email via the `authuser` query parameter
  (`/mail/?authuser=<teacherEmail>#search/...`) so it resolves to the right account when several Google
  accounts are signed in. (Gmail's `/mail/u/<n>/` path segment accepts only a numeric index, not an
  email, so the account cannot be selected there.) No student data leaves the
  app: the addresses are the teacher's own contacts, and they sit in the URL fragment (after `#`), which
  the browser never transmits to any server. Slotted after 5a; the two are independent, so the order is
  not load-bearing.

**Step 6 — Automated Attendance Communications (tabled; moved to Phase 3)**
Tabled during Step 6 planning and moved to Phase 3 as a candidate feature. The design decisions reached before tabling are recorded in the Phase 3 entry below. Step numbering is unchanged so existing cross-references stay valid: Grouping remains Step 7, Name Picker Step 8, and Design iteration Step 9. The `attendanceRules` and `emailQueue` tabs already exist in the live schema (pre-provisioned in [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md)); they are left in place, unused, until the feature is built.

**Step 7 — Grouping / Seating Creator**
Grouping algorithm, constraint system (lock together / keep apart), and the UI for configuring and viewing results. This feature is relatively independent of the others, so its position in the order is flexible.

**Step 8 — Random Name Picker**
The animation modes. Card deck and wheel shipped in Phase 1; the marble race was deferred to Phase 3 as a post-launch candidate (see Phase 3 below). This feature is entirely client-side (pulls names from roster, no server interaction beyond fetching the name list), so it can be built whenever there is a working roster.

**Step 9 — Design iteration**
With all features functional, iterate on the overall UX: visual consistency, responsive edge cases, loading/error/empty states. This is not a single step but an ongoing process that can happen in parallel with the feature steps above. DESIGN_SYSTEM.md is the reference for all visual decisions.

### Phase 2

Phase 2 turns a working single-user application into a product other people can pay for and boards can
approve. It is long, so the map comes first. **Status is deliberately absent from this table** and from the
step bodies below: this document says what each step delivers, and
[NEXT_STEPS.md](NEXT_STEPS.md) is the authoritative record of what is finished.

| Step | Delivers |
|---|---|
| 1 | Database and account model. Postgres, multi-user accounts, encrypted refresh tokens |
| 2 | Session management. Server-side sessions, CSRF, route gating |
| 3 | Plan entitlements. `free` / `trial` / `paid`, resolved and enforced server-side |
| 3a | Entitlement presentation fixes. A corrective step on the chrome around the plan affordance |
| 3b | Stripe integration. Checkout, the hosted portal, the signature-verified webhook |
| 4 | Contact and support system. In-app form, storage, allowlist-gated triage |
| 5 | Public surface. Landing page, pricing, FAQ, signed-out contact, legal routes |
| 5a | Onboarding and managed-domain allowlisting. First-run guide, blocked-domain path, `/for-admins` |
| 5c | Registration consent. Two agreements gating the app, enforced server-side and versioned |
| 6 | Productionization. Eleven sub-steps, indexed at the head of Step 6 |
| 7 | Security hardening pass |
| 8 | Email log rolling archive, and re-measuring the working set |
| 8a | Launch scope reduction. IEP behind a flag, entitlements collapsed to full access, email caps re-set |
| 8b | The three conditions coverage is written against. MFA audited, an incident response plan, a tested restore |
| 8c | Launch administration. The non-code work with external lead time |
| 8d | The data-handling claim, corrected. An accuracy audit of how the architecture is described |
| 8e | Board provenance. The board asked at signup, stored, and surfaced in the metrics view |
| 8f | Token path hardening. Rotation exercised, the legacy path retired, the KMS assumption tightened |
| 9 | Marketplace listing and OAuth verification |
| 9a | Ontario board assessment package. The paper a board's privacy review asks for |
| 10 | Launch |

**There is no Step 5b.** The letter was skipped so that Phase 2's sub-steps could not be confused with Phase
1's Step 5b (cross-tool communication links) while both were being referred to in the same conversations.
Nothing is missing.

**Step 1 — Database & account model**
Select and provision a database (e.g., PostgreSQL). Define the user table (Google ID, email, Sheet ID, subscription status, token storage). Migrate the single-user OAuth flow to a multi-user account system.

**Step 2 — Session management**
Implement secure cookie-based sessions. Add CSRF protection. Middleware that gates all tool routes behind an authenticated session.

**Step 3 — Plan entitlements**
Per-feature entitlement gating, with plan state resolved server-side on every request. Billing itself is **Step 3b**; this step is complete and testable without it, because plan state is a property of the account record and Stripe is only one of the things that can write it. Splitting them keeps a step of pure application logic away from Stripe's account setup, webhook plumbing, and signature verification. The model is B2C: each teacher subscribes individually ($6.99/month or $69.90/year CAD, one paid plan, no middle tier). The Google Workspace Marketplace does not process payments, so all billing runs through Stripe regardless of how the app was distributed or allowlisted.

**Three account states**, resolved server-side from the account record on every request: `free`, `trial`, and `paid`. `trial` and `paid` have identical entitlements; they differ only in how the UI labels premium features (see below) and in what happens when the trial ends. Downgrade is never a lockout — an expired trial or a cancelled/lapsed subscription drops the account to `free`, which keeps working indefinitely. Nothing is deleted and no data is withheld: the teacher's data lives in their own Google Sheet on their own Drive, and saying so plainly is part of the product's positioning.

**Free tier**
- Full roster: add, edit, bulk add, contacts, notes, delete.
- Full IEP accommodation tracking. Deliberately free: charging teachers for the tool that helps them deliver legally mandated accommodations to students with disabilities is a reputational liability that outweighs the revenue, and it deepens the roster, which is the switching cost.
- Attendance daily entry. This is the daily-habit loop and the data-accumulation engine; gating it would leave the free tier with no reason to be opened twice.
- Name Picker: both shipped modes (card deck, wheel), at default styling.
- Grouping: random generation only, at default styling.
- Mass Email, capped at **30 sends per calendar month** (roughly one mass email to one class). Enough that every free user encounters the tool and discovers its value whenever their need actually arises, which for many teachers is the midterm reporting cycle rather than the first month of use. Small enough to be useless for spam. Enforced server-side alongside the hard daily cap; the lower of the two applies. **A free account's quota indicator shows the monthly allowance, not the daily one** — a teacher should see the limit that actually binds them, and "12 of 30 this month" is the number a free user needs, while "188 remaining today" is misleading when 30 a month is the real ceiling.

**The free monthly counter lives in Postgres, not the teacher's Sheet.** The hard daily cap originally counted `emailLog` rows, which was fine for a limit that exists to protect the teacher's own Gmail reputation (Step 7 moved it to Postgres too). A paywall cannot be enforced from a spreadsheet the teacher can edit, so the monthly count is a per-user integer in our database — a plain count with no PII, well inside the durable-storage boundary. `emailLog` remains the audit record; the counter is the enforcement point. This is also cheaper: no Sheets read to total a month on every send.

**Paid (and trial)**
- Attendance statistics and the student-detail attendance summary. Entry is the teacher's effort; analysis is the payoff, and the gap between the two is the product's most natural upgrade moment. **The History view and the student-detail heatmap are free**, alongside daily entry: both show the record of what was taken rather than anything computed from it, and a teacher checking what they already recorded is still inside the daily-entry loop rather than reaching for analysis. The premium line is the computation — totals, absence rate, streaks, flags — not looking back at the raw record.
- **A configurable high-absence threshold.** The flag itself is computed for every plan; choosing where it sits is premium. Free accounts get the default (an absence rate over 15% across at least 5 recorded days) and cannot change it. This is the natural premium shape for the feature: the teacher who wants a threshold matched to their board's attendance policy is the teacher already invested enough to pay, and the setting only means anything once statistics are visible.
- **Where the flags surface stays free.** The roster's warning icons and the email templates' `atRisk` / `lateCount` conditions keep working on `free`. At-risk is a flag the teacher sets by hand, not analysis the app performs, and the email conditions belong to a tool the free tier already has. Gating the icons would quietly degrade two free tools and make the roster least informative for exactly the accounts most likely to upgrade. The line is therefore **the analysis views are premium, the indicators are not**.
- Mass Email above the 30/month free cap, up to the hard daily cap.
- Grouping constraints (keep together / keep apart).
- All display and styling options: Grouping's Display options modal (font, group header colour, mark group leader) and the Name Picker's Display options modal (per-mode font, wheel colour schemes, card back designs). The Marble Race mode, if built (Phase 3), is premium-only in its entirety.

**Legibility is never gated.** The line between free and premium styling is decoration versus readability. Grouping's Scale control and fullscreen toggle, the Name Picker's Size control, fullscreen, and sound toggle, and the app-wide light/dark theme all stay free — they are how a teacher makes the projection readable from the back of the room, which is an accessibility concern, not a cosmetic one. Only the Display options modals are premium.

**Trial: 30 days**, full entitlements, starting at account creation. No credit card up front. Shorter rather than longer is deliberate: a trial can be extended for an individual account with one database update and can never be clawed back, so extensions are handled case-by-case as a goodwill lever. The free email allowance, not trial length, is what carries a teacher's exposure to the Email tool past the trial window and into the reporting cycle where it proves itself.

**Enforcement.** Entitlements are resolved and enforced **server-side** on every gated endpoint; the client's rendering of lock state is presentation only and is never the security boundary. The one exception is the display/styling options, which are purely cosmetic client-side preferences stored in localStorage — a client-side check is proportionate there, and bypassing it gains an attacker nothing.

**Plan resolution order.** `plan_override` (nullable) first, then a **live subscription** (one Stripe reports as active and whose collection is not paused), then an unexpired `trial_ends_at`, then `free`. The subscription is checked before the trial, which is invisible to entitlement — `trial` and `paid` grant identical access — but decides the label the entire interface renders from: with the trial first, a teacher who subscribed during their trial resolved to `trial` and went on being offered an upgrade they had already bought. The pause is folded into the subscription test rather than standing as a clause ahead of the trial, so that pausing cannot cost a teacher trial time they still have. The override column exists so that plan can be set directly — by the development toggle below now, and as the comp-account mechanism for support later (Step 4) — **without writing the Stripe-managed fields**. Keeping `subscription_status` and the billing period as Stripe's alone means the webhook (Step 3b) can never disagree with what the app believes, which is the failure mode that costs an afternoon to unpick.

**Development-only plan toggle.** A menu item under the account name, beside Sign out, cycling the account through `free` → `trial` → `paid`. It exists because the bulk of this step's manual testing is *presentation*, and seeing a control move between states without leaving the page is far faster than a database script and a reload.

Its guard is deliberately doubled: the endpoint requires the session's `google_sub` to appear in a `DEV_TOOLS_GOOGLE_SUBS` env allowlist **and** refuses when `NODE_ENV === 'production'`. Either check alone is weaker than it looks — an allowlist alone turns a typo or a copied `.env` into a live entitlement endpoint on a paid product, and an environment check alone lets anyone reaching a dev deployment grant themselves premium. Together the endpoint effectively does not exist in production. `GET /auth/me` returns a `devTools` flag so the client knows whether to render the item, but that flag is a rendering hint and never the permission; the server re-checks on every call.

It cycles three states rather than toggling premium/free because `trial` is not a synonym for `paid` in the UI — a premium control on `trial` is simultaneously live and badged, the only state where that combination occurs and therefore the one most likely to be built wrong. A two-way toggle would leave it untested.

This is a hidden endpoint that mutates entitlements, in a codebase headed for OAuth verification and possibly a board security review. Being dev-only and env-gated makes it defensible; it is recorded here so it is a deliberate decision rather than a discovery.

**Step 3a — Entitlement presentation fixes**
A short corrective step between Step 3 and billing, fixing two defects found in manual testing of the entitlement affordance. Both appear **only on the Attendance page and only on a `free` account**: the top bar's account avatar is shifted partly offscreen, and the sidebar's star legend is pushed below the viewport. Neither affects enforcement, which is server-side and unaffected — these are layout defects, and the displaced top bar and sidebar are symptoms of the document overflowing its viewport rather than faults in those components.

The cause is almost certainly the Statistics segment's tooltip, which exists only when the account is not premium and is the only tooltip a `SegmentedControl` carries anywhere in the app — accounting exactly for "free only" and "Attendance page only". It is absolutely positioned, 224px wide, and centred on a trigger at the right end of the page header, and nothing in the layout clips it, so it widens the document. Full reasoning, the fix, and the regression tests that hold it are recorded in [HISTORY.md](HISTORY.md) under this step; the testable half is in [TESTING_PLAN.md](TESTING_PLAN.md) (Step 3a).

Sequenced before Step 3b deliberately: the account menu is where the plan toggle lives now and where the upgrade entry point lands in 3b, so the chrome around it should be correct before more is built on it. The step also extends the Step 9 responsive audit to the top bar and sidebar chrome, which it never covered — the audit checked the five tools at 375px and 768px but not the app frame itself, which is why this reached manual testing. Sub-numbered rather than inserted as a new step so the numbering after it is unchanged, the same convention as 4a/4b and 5a/5b in Phase 1.

**Step 3b — Stripe integration**
Checkout and webhook handling, writing the subscription fields that Step 3's plan resolution already reads. Stripe Checkout Session creation, the webhook route (raw body, signature verified), and the subscription lifecycle: activation moves an account to `paid`, cancellation lets it run to the end of the billing period and then drops it to `free` with nothing deleted and the spreadsheet mapping untouched. Sub-numbered rather than inserted as a new Step 4 so the steps after it keep their numbers, matching how 4a/4b and 5a/5b were handled in Phase 1.

**Stripe rather than a merchant-of-record service** (Paddle, Polar, Lemon Squeezy), settled by research before the step began — full reasoning and the figures under Decisions Made in [HISTORY.md](HISTORY.md) ("Billing provider"). The short form: at our price points ($6.99/month, $69.90/year CAD) an MoR costs 12.2% of a monthly charge against Stripe's 7.9%, and the tax compliance an MoR exists to absorb barely applies to a business whose customers are Canadian and whose revenue sits under the CA$30,000 small-supplier threshold for its whole early life. Stripe now sells merchant-of-record as a feature of itself (Stripe Managed Payments), so moving to that model later is a configuration change rather than a re-integration, which is what makes starting self-MoR safe.

Four consequences for this step's build. **The annual plan is the prominent, default-selected option at checkout**, but on retention grounds rather than fee grounds. Annual is fee-cheaper (4.0% against monthly's 7.9%, since the fixed 30¢ is paid once rather than twelve times), yet a monthly subscriber who stays a full year nets $77.26 against an annual subscriber's $67.08 — the ~16.7% annual discount outweighs the 3.9-point fee saving, so annual only wins if the average subscriber churns before ~10.4 months. For a teacher product interrupted by summer that is likely, which is what carries the recommendation; see HISTORY ("Billing provider") for the full figures. **This conclusion has since been superseded by Step 6i**, which introduces a summer pause: once a monthly subscriber can skip two months, annual nets more than a fully retained monthly subscriber and the 10.4-month threshold no longer applies. Annual stays the prominent, default-selected option; the reason changed. Revisit again once real retention data exists. **Stripe Tax is deliberately not integrated yet**; there is nothing to collect below the registration threshold, and Tax Basic goes in at registration time. **Verify the 0.7% Stripe Billing fee against the real account** when it exists — it is charged on top of the 2.9% + CA$0.30 processing rate, is easy to miss when modelling margin, and is a fifth of the effective cost on the annual plan. **Cancellation and card updates go through Stripe's hosted billing portal**, not an in-app flow: it is far less code, and it covers invoices, receipts, and payment-method changes that would otherwise each need building. The in-app surface is therefore one "Manage billing" link that creates a portal session and redirects. Accepted trade-off: the teacher leaves the product to cancel, which is the standard pattern and not worth a bespoke flow at this stage.

**Step 4 — Contact / support system**
In-app form that submits to a server endpoint, submissions stored in the database, and an admin view for reading and triaging requests. Three scoping decisions, settled before the build and recorded under Decisions Made in [HISTORY.md](HISTORY.md) ("Support system scope"):

- **Submission is signed-in only.** The account is the identity, so the form collects only what the teacher can tell us that the account record does not already hold — category, subject, message. This keeps the step free of an anonymous write endpoint, a captcha, and email-address validation. The public, signed-out contact route belongs to Step 5's landing page.
- **Triage is an in-app route behind an operator allowlist** (`SUPPORT_ADMIN_GOOGLE_SUBS`), reusing the session wiring and shared components. It answers **404, not 403**, to a caller who is not allowlisted, the same posture as the development plan toggle — but unlike that toggle its guard has **no `NODE_ENV` half**, because support triage is a production task. The allowlist is therefore the whole guard, and an empty allowlist grants nobody anything.
- **No email notification on a new submission.** Sending one would require the submitting teacher's own Gmail token, which is the wrong identity; an app-owned transactional sender is a Step 6 (hosting) decision and a dependency to review. The triage view is the read path until then.

**The PII note that this step owns.** The free-text message is the only field in the entire server schema where a teacher could put student information into our database. The form states plainly that student names must not be included, neither the subject nor the body is ever logged, and the migration records this as the field a retention policy has to address. Comps are granted through the existing `plan_override` column, so support never writes a Stripe-managed field.

**Step 5 — Public surface**
Split from onboarding during scoping — the original Step 5 covered a marketing surface, a legal surface, an onboarding flow, and the board-allowlisting path, which is more than one reviewable step. Sub-numbered as 5 and 5a rather than renumbered, the same convention as 3a/3b and Phase 1's 4a/4b.

This step is everything a signed-out visitor sees. A landing page and a pricing page that states the free-versus-paid split up front so no teacher discovers a paywall at a bad moment; a signed-out contact route (deliberately deferred from Step 4, because the landing page is where the people who cannot sign in actually are); and placeholder routes for the privacy policy and terms of service, which the footer links, a board privacy review asks for by URL, and OAuth verification (Step 9) requires on the production domain.

**The routing change is the structural part.** Until this step, an unauthenticated visitor was redirected straight to Google, because the app had no page of its own to show them. That is now wrong twice over: it gives a first-time visitor a consent screen they did not ask for, and it strands a teacher on a blocked domain at a Google error page with nowhere to go. `AuthGate` therefore renders the landing page instead when one is supplied, and the public routes sit outside `AuthProvider` entirely so they cost no `/auth/me` round trip.

**Legal content is deliberately not written here.** It turns on facts the codebase does not hold — the operating entity, its jurisdiction, retention and deletion commitments, and the wording of a DPA a board would sign — and getting it wrong is legal exposure rather than a bug. The placeholder pages state what the shipped architecture already makes true and say plainly that they are not yet a policy.

**Step 5a — Onboarding & managed-domain allowlisting**
Onboarding flow for new users: sign in with Google, grant permissions, create spreadsheet, start the 30-day trial, and a short first-run guide, since an empty roster is the least informative first screen the app can show. **Every new account is provisioned a spreadsheet immediately, including free accounts** — provisioning is cheap and getting the roster in is the free tier's entire purpose. No payment is collected at onboarding; the trial starts automatically and the account falls back to free when it ends.

Because most teachers are on managed Google Workspace for Education domains that block unconfigured OAuth apps, this step also handles the allowlisting gate: detect the blocked-consent case and guide the teacher to request that their board admin allowlist/trust the app (surfacing Google's built-in request-access flow where the domain enables it), and supply the collateral that makes admin approval fast — a plain-language data-handling summary and a signable DPA template, leaning on the no-durable-PII design. Individual teachers use the normal per-user consent flow (unblocked once the app is allowlisted), so no admin-delegated or silent-consent flow is required, and the account model stays per-teacher (optionally recording the teacher's Workspace domain for support and to track which boards have allowlisted the app).

A concrete prerequisite this step owns: the OAuth callback currently parses only `code` and `state`, so Google's `error=access_denied` with `admin_policy_enforced` — which is exactly the blocked-consent signal — falls through to a generic validation error. Detecting and naming that case is where the allowlisting path starts.

**As built, the signable DPA template was deliberately not written.** A DPA is a procurement artifact, and this product is not sold through procurement: the teacher pays, the board approves no purchase, and the only thing needed from the board is an allowlist entry. The collateral shipped is the factual data-handling summary at `/for-admins` — a description of the shipped architecture rather than a commitment — with a DPA offered on request through the contact form. Contract wording was held alongside the privacy policy and terms while the operating entity, its jurisdiction and the retention commitments were undecided; 6c settled all three and discharged that hold, so a DPA is now writeable rather than blocked. It is still not written, on the procurement grounds above, and the first real request from a board will say what the wording has to cover better than a guess would. See NEXT_STEPS.md.

**Step 5c — Registration consent**
Two agreements a teacher must accept before the app will serve them anything: the terms and privacy policy,
and — as a separate checkbox — an acknowledgement that student information stored in their own Google account
remains their responsibility, including compliance with the privacy laws, records regulations, and board or
district policies that apply to them.

The enforcement point is server-side (`requireConsent`, mounted with `requireSession` and `requireCsrf` on
every non-auth router), not a screen the client chooses to show, because a client-side prompt is defeated by
calling the API directly. Consent is recorded as a **version** rather than a bare timestamp, so a future
revision of the terms re-prompts every existing account with a one-line change; existing accounts were
deliberately **not** backfilled, since writing a timestamp that says they agreed would fabricate the record
the step exists to create.

**The terms half is provisional until the legal hold clears.** `/terms` and `/privacy` still serve placeholder
text, so a checkbox referring to them carries little weight. The data-responsibility acknowledgement does not
share that weakness — its full wording is on the screen, agreed by reading rather than by reference — and is
effective as shipped. The version field is what makes the real documents landing later a clean re-consent
rather than a migration problem.

**Step 6 — Productionization**

**Read this first: Step 6 is a container, not a step.** It began as one step covering read-scaling, hosting
and the legal documents, was split into four when the dependencies between those were worked out, and has
since absorbed six more sub-steps that were sub-numbered rather than inserted so that Steps 7, 8 and 9 would
keep their numbers and every reference to them in [HISTORY.md](HISTORY.md) and
[NEXT_STEPS.md](NEXT_STEPS.md) would stay valid. That was the right trade each time and it is why the
heading is now a generic one: what these eleven sub-steps have in common is only that each stands between a
working Phase 2 application and a launchable product.

**The index. Each entry has its own section below, in letter order.**

| Sub-step | Delivers |
|---|---|
| 6a | Read-scaling architecture. The working set, batched cold reads, the multi-instance decision |
| 6b | Hosting provider, plan and region, decided before anything is bought |
| 6c | The privacy policy and terms of service |
| 6d | Hosting setup. DNS, TLS, CI/CD, monitoring, the KMS swap, the Postgres migration |
| 6e | Class archiving |
| 6f | Account menu rework, account deletion, and the help documentation |
| 6g | Rebrand to Teachneat |
| 6h | Lifecycle email and the trial-to-free moment |
| 6i | Founding-user promo and the summer pause |
| 6j | Activation instrumentation and the operator metrics view |
| 6k | Attendance stored as exceptions rather than a row per student per day |

**The build order is not letter order, and the order is a decision rather than a suggestion.** Two hard
constraints set it. Product work that needs no production domain comes first, because a domain that is
reachable is a domain that is accruing obligations. And **6d must not make the domain publicly reachable
until the deployment matches the two facts the 6c privacy policy already states** (Toronto database, key in
a separate key management service), which is the single hardest ordering constraint in Phase 2.

The remaining sequence, across the whole of Phase 2 rather than only within Step 6:

**6g → 6h → 6i → 6j → 6d → 6k → 7 → 8 → 8c → 9** (Step 6 is complete: 6a through 6k are all done; the sequence resumes at 7)

6g led because a rename is cheap before 6d configures the OAuth consent screen and Step 9
files a listing against a reviewed brand name. 6h, 6i and 6j are product work with no hosting dependency,
and batching them ahead of 6d means one consent re-prompt rather than several. In the event 6i changed no
legal document at all — a coupon and a pause are billing arrangements, and the policy describes what data is
held and by whom — so the outstanding bump was 6h's Resend subprocessor plus what 6j added, and **6j took
both in one, as `2026-08-19`**. 6d then deploys. 8c, which owns the business administration, is the last gate before Step 9.

**8c's domain purchase is the one item that routinely runs out of sequence**, and it is worth naming rather
than rediscovering. 6d has nothing to configure without it and 6h has nowhere to put its SPF and DKIM
records, so the purchase is pulled forward to whenever 6d starts while the rest of 8c stays put. Buying a
domain is not what "get the product finished before the business administration" was protecting against;
registering a business and briefing a lawyer are. Nothing else in 8c moves, and in particular **making the
domain publicly reachable stays in 8c**, behind the deployment constraint above. Until then, 6h's templates
and queue are built and tested against the email provider's sandbox and only the cutover waits.

**The sub-step sections below are deliberately short.** Every one of them is built, so what each *delivers*
is now a fact rather than a plan, and the fact lives in the spec that owns it: the sheet in
[SHEETS_SCHEMA.md](SHEETS_SCHEMA.md), the endpoints in [API_CONTRACT.md](API_CONTRACT.md), the interface in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), the criteria in [TESTING_PLAN.md](TESTING_PLAN.md), and the full
build narrative of each in [HISTORY.md](HISTORY.md). What is kept here is only the reasoning that still
constrains future work, and the parts of each sub-step that were deferred rather than done.

**Step 6a — Read-scaling architecture**

The working set, batched cold reads, and the multi-instance decision. The binding constraint is the shared
Google Sheets read ceiling per Cloud project, **600/min after a granted quota increase**, which every user
draws from at once; correlated peaks such as a staffroom taking attendance at the top of the same period are
the risk, not average load. Full analysis under Decisions Made in [HISTORY.md](HISTORY.md).

What still constrains later work:

- **The working set is RAM only and stays that way.** Nothing is persisted and the Sheet remains the sole
  durable copy. This is a quantitative widening of a transient surface the app already had, not a new store.
- **Writes stay write-through.** Write-behind is out of scope unless write quota is measured to be a
  problem, which is unlikely: writes are lower-volume, batched, and email is capped at 200/user/day.
- **Multi-instance: sticky sessions if we scale out, never a shared cache, single instance to begin with.**
  Decided on the PII boundary rather than on performance, because a shared cache would put student data in a
  datastore we operate. Stickiness is an optimisation, not a correctness requirement: sessions live in
  Postgres, so a request landing on the wrong instance re-hydrates at the cost of one Sheets read.
- **Drive push invalidation (`files.watch`) is deferred and still unbuilt.** It is what would let the working
  set hold a long TTL without serving stale data, so **the TTL must not be lengthened until it is proven in
  production**. Channel renewal is the part that fails silently if written and never exercised.
- **Cold hydration via Drive export is deferred, and should be reconsidered rather than resumed.** Batched
  cold reads already took the worst realistic burst to one read, so the remaining benefit is moving that read
  off the Sheets bucket, which matters only well beyond the current ceiling. It costs an xlsx-parse
  dependency and the options are poor: `exceljs` is 21 MB and nine dependencies for a read-only need, and the
  SheetJS route distributes outside the npm registry, which is a bad trade for a product whose trust story is
  a Workspace admin approving it.
- **Attendance is deliberately excluded from the batched roster read**, because folding it in would make
  opening the roster pay for data it does not use, and it is the tab most often invalidated by writes.
- **The pressure valve** is the granted quota increase plus paid overage, with project sharding across Cloud
  projects as a documented last resort carrying policy caveats.

**Step 6b — Hosting provider and plan**

Provider, plan tier, region and the managed-Postgres arrangement, decided jointly and explicitly before
anything was bought, because it is a recurring cost, it is painful to migrate away from once real accounts
exist, and it determines two facts Step 6c has to state. **Settled: DigitalOcean App Platform and Managed
Postgres in Toronto (`tor1`), with Google Cloud KMS holding the refresh-token key**, and the operator
identity for every provider account being the developer Workspace account rather than a personal address,
because moving a Cloud project between owners later ranges from tedious to impossible. **Region was decided
first and eliminated most of the field: Canada.** Full reasoning and the rejected alternatives under
Decisions Made in [HISTORY.md](HISTORY.md).

**Step 6c — The privacy policy and terms of service**

Written after 6b and before the domain was publicly reachable, that window being deliberate and narrow: a
live production domain carrying placeholder legal text is the only configuration in this plan where the risk
is real rather than theoretical. Both documents are live at `/privacy` and `/terms`. Two rules survive the
step and bind everything after it:

- **The documents are written against the code, and stay that way by being re-read against it.** A
  consistency pass on the first draft found four claims the implementation did not support, one of them the
  scope list naming three permissions where `GOOGLE_SCOPES` requests six, which is exactly the discrepancy
  Google's OAuth verification checks. **Treat a change to scopes, tables, logging, retention, subprocessors
  or session handling as a change to these documents**, and bump `CURRENT_TERMS_VERSION` and
  `DOCUMENT_VERSION` together when it is substantive. The testable half is in
  [TESTING_PLAN.md](TESTING_PLAN.md) under Step 6c.
- **A commitment in a legal document is a scheduled job, not a sentence.** Anything the text promises about
  retention, deletion or revocation needs something that performs it. Writing a fourth such promise without
  building it is the failure mode; softening the wording is the legitimate alternative, and both beat a
  commitment nothing honours.

**Step 6d — Hosting setup**

DNS, TLS, environment configuration, CI/CD, monitoring, log sanitization, the swap of the `TokenCipher` key
into Google Cloud KMS, and the migration off the local Postgres. Done; the deployment narrative and the
faults it surfaced are in [HISTORY.md](HISTORY.md). Three things it established that outlive it:

- **`TokenCipher` stays synchronous.** A refresh token is decrypted on every account read, so a KMS round
  trip per operation would put a network call on the request path. KMS unwraps the data key **once at boot**
  and the cipher runs from memory, which is also what makes the privacy policy's sentence about the key true:
  the deployment holds only a wrapped blob, inert without KMS access.
- **The hard ordering constraint, now discharged.** The domain could not become publicly reachable until the
  deployment matched the two facts 6c already stated, a Toronto database and a key in a separate key
  management service. It does. The constraint is recorded because the same shape recurs whenever a document
  describes an end state.
- **`instance_count` is 1 deliberately**, so every deploy is a brief outage and a cold working set. Not
  fixable at one instance, and written down rather than rediscovered.

The domain purchase belongs to Step 8c rather than here, and was pulled forward because DNS and TLS have
nothing to point at otherwise. Two of 6c's commitments were discharged here (`support_requests` retention,
and session revocation, which shipped in 6f); **log retention remains open** and is tracked in
[NEXT_STEPS.md](NEXT_STEPS.md).

**Step 6e — Class archiving**

At the end of each semester most teachers turn over their entire class list, and nothing let them clear it.
A `courses` tab makes a class a record for the first time (schemaVersion 4, additive). The design decisions
that still constrain anything touching archived data:

- **Rows move to sibling archive tabs rather than being flagged.** An archived flag fixes clutter and leaves
  the read cost exactly where it was, because the rows are still read and then discarded.
- **Safety, given that Sheets has no transactions:** append to the archive, verify, then rewrite the source.
  The call budget is a design constraint rather than an optimisation, Sheets allowing 60 reads and 60 writes
  a minute per user.
- **Synchronous, not backgrounded**, and it holds the account's other writes, because a background rewrite
  could silently overwrite an attendance row entered during it.
- **Unarchive is a full inverse migration**, and a name collision on unarchive is **renamed rather than
  refused**. Duplicate class names are allowed across time and forbidden among live classes.
- **Archived data is invisible to every tool until restored.** No tool reads the archive tabs.

**Step 6f — Account menu rework, account deletion, and the help documentation**

The account menu carries navigation only; billing, "Log out of all sessions" and "Delete account" moved to
`/account`, and "Help and support" leads to a hub at `/help` rather than straight to the contact form.
`/help/your-data` is the public help documentation Google's Workspace API developer policy requires. Two
rules survive it:

- **Deletion order is load-bearing.** Cancel the Stripe subscription first and abort everything if that
  fails, then revoke the Google refresh token, the sessions, and the row. The teacher's spreadsheet is never
  touched.
- **"Getting started" is offered only until the account's first student** (`users.first_student_at`, set by a
  create or by a non-empty roster read), rather than permanently.

**Step 6g — Rebrand to Teachneat**

Placed early because a rename is cheap before 6d configures the OAuth consent screen and Step 9 files a
listing against a reviewed brand name. Done: the name sweep, the five Drive identifiers, a paired version
bump, the marketing copy pass, and the brand assets. **[design/brand/README.md](design/brand/README.md) is
authoritative for geometry, sizes and file names**, and the assets are generated by
[generate.py](design/brand/generate.py) so the SVGs and rasters cannot drift. **The five Drive identifiers
are now frozen**, because they are how bootstrap discovers an existing folder and spreadsheet, so changing
them again would need a dual-read fallback and a backfill rather than a find-and-replace.

**Step 6h — Lifecycle email and the trial-to-free moment**

Six transactional messages queued in Postgres on `UNIQUE (account_id, message_type)` and dispatched by a
sweep rather than sent inline, through Resend's HTTP API behind a `Mailer` seam with no SDK. Two constraints
that bind any future message:

- **The catalogue is closed, and the limit is legal rather than stylistic.** A seventh, non-transactional
  message would be a CASL commercial electronic message needing consent machinery that does not exist. The
  catalogue is closed by a test rather than by discipline.
- **The queue row is keyed on `users.id` with no foreign key**, because the deletion confirmation has to
  outlive the account it confirms.

**Step 6i — Founding-user promo and the summer pause**

A 100%-off repeating Stripe coupon behind a promotion code, and a `pause_collection` summer pause
(`behavior: void`, one to three months, once every twelve months, monthly only) offered inside an in-app
cancellation flow and deliberately nowhere on the pricing page, because at list prices a paused monthly
subscriber pays exactly the annual price and advertising that removes annual's reason to exist. **Prices
stay at $6.99 / $69.90.** Three rules survive it:

- **A paused subscription resolves to `free`**, read as a flag rather than a date, Stripe holding one at
  `active`. This is `resolvePlan`'s only exception to trusting Stripe's status.
- **The webhook stays the sole writer of subscription state.** `pause_started_at` is the one pause field the
  app writes, because Stripe clears `pause_collection` on resume and the once-a-year rule needs a record that
  outlives the pause.
- **"Has billing", "is on the paid plan" and "has a subscription" are three different questions.** The Stripe
  customer id and the subscription id both survive a cancellation, and a `plan_override` comp resolves to
  `paid` with no subscription at all, so `hasLiveSubscription` is the shared test for the third.

**Step 6j — Activation instrumentation and the operator metrics view**

Write-once milestone timestamps on `users`, a monthly per-tool usage counter table pruned to 24 months, and
an aggregate metrics page at `/admin/metrics` behind the existing operator allowlist with the same
404-not-403 posture, because data nobody looks at is data nobody collects and a metrics table reachable only
from a `psql` shell will not be opened during a school year. **Still no third-party analytics and no script
on any page.** One asymmetry to remember when reading the numbers: the Name Picker has no server endpoints,
so its column **counts opens of the tool rather than rounds drawn**, carried in the API as
`pickerCountsPageOpens` and labelled by every display.

**Step 6k — Attendance stored as exceptions rather than a row per student per day**

Store only the exceptions (absent, late, excused) and infer present, with a class-day marker recording that
attendance was taken. schemaVersion 5, the first non-additive migration and so the first entry the registry
in `migrations.ts` has ever carried. It took a full timetable from roughly 27,000 rows a year to about 1,890
exceptions plus 900 markers, and **it shrinks the data rather than the copy of it**, so the Sheets read, the
row growth and the cold load all improved together. Four things still constrain anything touching attendance:

- **The marker is load-bearing, not bookkeeping.** If it is missing or wrong, a perfect attendance record
  becomes indistinguishable from a class nobody recorded, and the statistics silently divide by the wrong
  denominator.
- **Markers are sentinel rows in the `attendance` tab** (`statusKey` = `d`, empty `studentId`), not a tab of
  their own, so a save writes the marker and its exceptions in one append and class archiving moves them with
  no code of its own. They are split off at `loadSnapshot`, the single place attendance rows are parsed, so
  no marker ever exists as an `AttendanceRecord` and none can reach the client.
- **A class-day is a marker OR any exception on that date.** Readers take the union, so a marker lost to a
  partial write cannot hide a recorded absence.
- **`enrollments.startDate` bounds the inference, and `createdAt` must never be its fallback.** `createdAt`
  is when the row was written, so a teacher who sets up a roster today and enters last week's attendance
  would have the whole backfill clamped away. A new enrollment is stamped automatically at the day after the
  course's last recorded class-day, derived from the data rather than from the clock because the server has
  no teacher timezone, and empty when the course has never been recorded so that set-up-then-backfill keeps
  working. **The bound suppresses inferred presents only, never a recorded mark.**

**Step 7 — Security hardening pass**

Rate limiting, a header audit, penetration testing, a dependency audit, an authorization review of every
endpoint, and verification of data isolation between users. It also owned one question carried from Step 3b,
**whether a missed Stripe webhook should be able to leave an account paid indefinitely**, resolved as
periodic reconciliation against the Stripe API rather than a `current_period_end` backstop: the backstop
addresses only the stuck-paid direction and cuts off a teacher whose renewal event is merely in flight, while
reconciliation answers that direction and the inverse one 6i's follow-up added, where a missed `created`
leaves a paying teacher unable to cancel or pause. The sweep uses the webhook's own mapper and writer, so the
two cannot disagree about what a subscription means, and is bounded by batch size so its Stripe calls do not
grow with the paying user count.

Shipped across two independent passes. The findings and what each pass found clean are in
[HISTORY.md](HISTORY.md); the standing rules the step produced are in Security Practices above.

**Step 8 — Re-measuring the working set, and settling the email log archive**

Two capacity questions asked once, from a measurement rather than a remembered figure, and answered. What
each concluded is in [HISTORY.md](HISTORY.md); the two constants the first one moved are documented in
`server/src/config/cache.ts`.

- **The working set, re-measured against the current schema.** `server/scripts/measure-working-set.mjs` was
  still building v4-shaped fixtures, so the 8.0 MB per teacher this project had been carrying described a
  schema that no longer exists. Updated and re-run, it is **0.43 MB per teacher**, which settles
  `instance_count: 1` at launch. `ESTIMATED_BYTES_PER_ROW` moved from 400 to 200 to match.
- **The `emailLog` rolling archive, which was the step's other half, is not built.** It was scoped against
  two readers — the daily-cap scan and an audit view — and neither exists: Step 7 moved the cap to a
  Postgres counter, and the audit view was never built, leaving the tab written by one call site and read by
  nothing in the app. The remaining bound is the spreadsheet's own cell ceiling, which the arithmetic in
  HISTORY puts about nine years out for a teacher sending at the then-200/day cap every school day (further
  still since Step 8a lowered it to 120). Moved to
  Phase 3 as a candidate with a stated trigger rather than kept as unbuilt scope here.

The methodology note from 6d still holds and is now in the script's own header: fixtures must be
round-tripped through JSON, because V8 internalises repeated strings on parse and building them directly
overstates the result by about 60%. Step 8 added a second one — the batch has to be salted per teacher, or
that same internalisation shares strings between teachers who would not share them.

**The ordering of Step 8's sub-steps was reworked once, and the rationale is the sequence itself.** The
original order ran the administration first and the scope reduction third. That was backwards on two counts.
The scope reduction decides what the product *is*, and the administration describes the product to a lawyer,
an underwriter, a Google reviewer and a board, so doing it first meant describing something about to change.
And the insurance application asks three security questions this project could not answer, which is a thing
to fix before the conversation rather than during it. So: **8a settles the product, 8b answers the security
questions, and 8c then carries all four external conversations with something true to say.** 8d is done. The
one item that still starts immediately regardless is the Ontario business name registration, which has pure
lead time and no dependency on anything above it.


**Step 8a — Launch scope reduction** — done

Three removals that shared one cause. The launch shape is **Ontario only, free to every account, and no
money changing hands in the first school year**, which is what makes the legal surface something one person
with a full-time job can actually carry.

**Two of the three are switched off and one is deleted, and the difference is deliberate.** Billing and the
plan split are expected back, so nothing about them was removed; the IEP surface is not, so nothing about it
was kept.

- **IEP removed permanently.** Special education status and accommodations are the field class that drove
  the largest ed-tech privacy penalties on record, and they are the difference between a teacher holding a
  roster and a teacher holding special education records in an unapproved third-party system. The legal
  requirements and the risk are not worth the feature at any point on the roadmap, so this is a deletion
  rather than a build flag: `services/iep.ts` and its suite, the five routes, the roster and detail reads,
  the send path's accommodation lookup, the `hasAccommodations` condition metric, the client's editor,
  catalogue, filter, row tags and detail card, and every mention across the marketing pages, the FAQ, the
  help pages and both legal documents. Nothing is skipped pending a return.

  **The `iep` tab stays in the sheet schema and bootstrap keeps creating it.** Removing it would need a
  `schemaVersion` bump and a non-additive migration decision about tabs already holding a teacher's rows;
  leaving it costs one unused tab per sheet and preserves what a teacher already wrote, on their own Drive,
  where we are not in a position to orphan it. Nothing reads or writes it, a comment on the tab says so, and
  SHEETS_SCHEMA.md carries the same warning. Two consequences are recorded rather than fixed: deleting a
  student no longer cascades into the tab, and a saved email template carrying a `hasAccommodations`
  condition has that block dropped at send time (the grammar fails closed) and fails validation on its next
  save.

  **The terms name no category of student information at all.** An earlier draft of this step kept the
  consent warranty's caution about accommodation and health-related information; that was defensible as a
  caution and wrong as a signal, because naming a category in the one clause governing what a teacher may
  record reads as confirmation that the Service is a place to record it. The warranty is general instead,
  and adds an acknowledgement that the Service is a general classroom tool represented as suitable for no
  particular category of information and for no regulated purpose.

- **Entitlements collapsed to full access, behind `BILLING_ENABLED`.** It defaults to false, so no
  DigitalOcean configuration change was needed to deploy it and the "set the variable before the code that
  reads it" ordering trap does not apply; setting it true restores Step 3's product. `resolvePlan` is
  untouched, with its logic, its reasoning and its tests intact. `resolveEffectivePlan` sits beside it and
  returns `paid` for everybody while the flag is off, and it is the **single point the whole reduction acts
  through**: `requirePremium`, `isPremium`, `effectiveHighAbsence`, the grouping constraints flag and the
  email monthly cap all read their answer from there, so none needed an edit and none can disagree.
  `requirePremium` short-circuits before its body rather than merely passing, so no `premiumAttempt`
  milestone is recorded against a wall nobody can meet.

  **The flag is a function reading `process.env`, not a field on the `env` object**, which resolves once at
  import. Production behaviour is identical; what it buys is a suite that exercises both states. That
  matters more than it sounds: the entire premium boundary now ships dormant, and code that ships dormant is
  code that comes back broken. The suites describing the paid product declare `withBillingEnabled()` and
  keep describing it; the launch behaviour is asserted beside them.

  The client learns it from a `billingEnabled` field on the `/me` profile rather than inferring it from
  `plan === 'paid'` — a comped account is also `paid` and should still see that Premium exists. The profile
  **withholds** every field describing a trial or subscription rather than sending falsy values the client
  would have to know to ignore. Every affordance goes: markers, the sidebar plan footer (the block and its
  border, not just its contents), the account menu's upgrade item and its plan and trial dev toggles, the
  account page's badge and billing rows, and the upgrade modal, which is no longer mounted. The eight gated
  surfaces needed no edit at all, because they render through `PremiumControl` and `PremiumNotice`.

  The two trial lifecycle messages are dormant and their copy was corrected anyway — "free plan" to "free
  account", `trial_ending` now names Premium, and both stop listing IEP information — because copy nobody
  reads while dormant is copy that goes out unread on the day the flag flips back. The four scheduled scans
  do not run; the guard is in `dispatchLifecycleEmails` rather than in the pg store, so it holds for any
  store and is testable, and the drain of already-queued messages is untouched.

- **Email caps.** `FREE_MONTHLY_EMAIL_CAP` of 30 stops applying as a consequence of the effective plan
  rather than by a second mechanism, and stays in `config/plan.ts` marked dormant. **`EMAIL_DAILY_CAP` was
  lowered from 200 to 120** in the same step: it is the only brake on a compromised account, and 120 still
  covers a whole timetable contacted in one afternoon while cutting a stolen session's blast radius by 40%.
  `MAX_RECIPIENTS_PER_SEND` stays at 200 and now deliberately exceeds it — it bounds one request rather than
  a day, and a send larger than the remaining allowance fills the allowance and skips the rest with a reason.

**The pricing page and the legal documents.** The pricing page lost its figures, its tiers and its
comparison table, and on 2026-09-11 it lost its audience: **the whole subject of cost is now gated out of
the marketing surface behind `client/src/config/publicBilling.ts`.** 8a kept the page routed on the
reasoning that answering "what does this cost" with a 404 reads worse to a Google reviewer and a board
administrator than answering it plainly. That reasoning is superseded, and by the objection rather than by
the answer: every piece of that copy named a paid plan, a payment card, a trial or a premium tier in order
to deny it, which raises the question for a reader who did not have it. `/pricing` redirects to the landing
page rather than 404ing, so the old link still lands somewhere sensible; the component and its tests are
kept intact, because the copy is what the flag is holding back. **Whoever sets the flag rewrites the page
first** — what it currently says is that there is no paid plan. Gated with it: the Pricing nav and footer
entries, the showcase's "included with every account" note and its "What that means" link, the FAQ's "See
pricing" link, the billing line in the data documentation, and the welcome page's Premium card, which gates
on the account's `billingEnabled` instead, being inside the app.

**Three pieces of cost copy were kept, on the user's decision the same day, and the line they draw is
where the reader is.** The landing page's three points beside the closing call to action ("No credit card",
"Free while in early access", "Leave any time and keep your data"), the FAQ's "What does it cost?", and the
`/for-admins` bullet saying no payment is taken and no payment processor is involved. Each answers a
question its reader already has at the point they are reading — a teacher at the button, a teacher who went
looking for the answer, a board privacy officer asking who touches the data — rather than raising one. What
is gated is the copy that volunteered the subject to someone who had not asked, which is the same
distinction the gate started from and a different answer about who counts as asking. With the pricing page
gone, the FAQ entry is now the only place the product answers what it costs, so it is load-bearing rather
than redundant. **The legal documents are deliberately not gated.** The
terms' payment section still says the Service is provided at no charge and makes the renewal, cancellation,
refund, price-change and failed-payment provisions inoperative until a paid plan is offered and accepted,
keeping its section id so every cross-reference still resolves, and the privacy policy still describes the
plan and billing fields the database holds. Both are disclosure rather than pitch, and a reader is worse
served by their absence.

**The Ontario scope is stated in eligibility and enforced nowhere, permanently.** No signup check, no country
field, no geolocation, and this step commits 8e to none either. The reasoning is that US state
vendor-facing statutes attach to us from the data we hold rather than from where we advertise, so the
sentence buys no immunity; what it buys is a term of the contract giving a clean basis to close an
out-of-province account, evidence that the service was not offered into that jurisdiction, and an answer for
the lawyer, the underwriter and the first board, each of whom asks who may use this.

**Stripe was removed as a subprocessor**, and from the terms' dependency list and the `/for-admins` bullet,
because it receives nothing while checkout is not offered and a list read by a privacy officer asking who
touches the data should not name a party that touches none. Removing it costs no approval in either
direction: Google's OAuth verification keys on scopes, branding and the policy's URL rather than its
contents, and a board's allowlisting keys on the OAuth client id and its scopes. **That is process knowledge
with a shelf life and is on 8c's list to confirm**, not a finding. The verbatim entry and the reasoning sit
in `legalMeta.ts` for whoever restores it.

**The consent version bumped to `2026-08-31`** and re-prompts, which 8d deferred to here.

**One consequence is recorded rather than fixed.** `accountStore` still writes `trial_ends_at` at signup, so
accounts created during the free year will carry a long-expired trial on the day billing returns and would
resolve straight to `free`. What those accounts should get on restoration is a decision for the step that
restores billing, not one to guess at now. It is in NEXT_STEPS as an open question.

**Step 8b — The three conditions coverage is written against** — done

Multi-factor authentication on administrative accounts, a written incident response plan, and a restore that
has actually been performed. Underwriters commonly make all three *conditions* of a tech E&O and cyber
policy, and none of them exists today: the plan is unwritten, the backups have never been read back, and the
administrative surface has never been audited. They are gathered here, ahead of the insurance conversation
in 8c, because a broker asks these on the application form rather than at binding, and because each is owed
to more than one reader — 9a's board package needs the incident response plan, PIPEDA's accountability
principle expects it, and 8f's revocation runbook is a section of it rather than a separate document.

- **MFA on every administrative account, audited rather than assumed.** Six surfaces hold something that
  matters: the Google account owning the Cloud project and the KMS key, DigitalOcean, Cloudflare (DNS, and
  therefore control of both mail and the domain), Stripe, Resend, and GitHub — GitHub because a push to
  `main` deploys production. Record which second factor each one uses, and prefer a hardware key or an
  authenticator app to SMS, which is the factor a SIM swap defeats and the one an underwriter discounts. The
  deliverable is a written list, because the question is asked in writing.
- **A written incident response plan.** Short and specific: what counts as an incident, who is notified and
  in what order, the reporting obligation under PIPEDA's real-risk-of-significant-harm test and the timeline
  it imposes, how affected teachers and their boards are told, and what is preserved before anything is
  repaired. It must name a single operator as every role rather than implying a team, because a plan that
  assumes people who do not exist is useless on the day it is needed. Token compromise is its most likely
  concrete scenario, so leave that section stubbed with its intent and let 8f's revocation runbook fill it.
- **A restore that has actually been performed.** Managed Postgres takes the backups and nobody has ever
  read one back. Restore to a scratch database, confirm the row counts, confirm a stored token still
  decrypts under the current key ring — which means the scratch environment needs KMS access, and finding
  that out is part of the point — and **record the elapsed time**, because "how long until you are back" is
  asked by both the insurer and a board and cannot be answered from a dashboard. A restore is also the only
  way to learn that what is being backed up is not what you need.

Cheap, entirely within our own control, and it unblocks a conversation with weeks of lead time. That
combination is the argument for doing it before 8c rather than discovering it inside 8c.

**Delivered 2026-09-11.** The three documents are in `ops/`: the Administrative Account Register, the
Incident Response Plan, and the Database Backup and Restore Procedure with its first test record, plus
`server/scripts/check-restore.ts`. They are written for third-party readers and must stay that way: no
reference to this plan or its step numbers, no commentary, and remediation items only as decided and dated.
Their review dates are in their headers.


**Step 8c — Launch administration**

The non-code work that stands between a finished application and a teacher signing in. Placed here
deliberately: it is business and administrative rather than product, and the preference is to finish the
site's features and functionality before turning to it. It is gathered into one step so that none of it is
discovered late, because **every item on this list has external lead time and none of it can be compressed by
working harder on it.** Most of it should be started in parallel rather than worked in sequence.

- **Buy the production domain. Expect to do this one out of sequence**, at whatever point 6d starts, and
  leave the rest of this step where it is. 6d has nothing to configure without it and 6h has nowhere to put
  its SPF and DKIM records; it also gates the brand verification below. Buying a domain is not the kind of
  business administration this step is deferring.
- **Register the Ontario business name. Done on 2026-10-09**, as TEACHNEAT, BIN 1001774483, NAICS 5112
  (software publishers). Settled in 6b as a sole proprietorship. Filed through
  ServiceOntario as a Business Name Registration for a sole proprietorship, renewable every five years. It
  gates the operator's legal name and postal address in the privacy policy and terms, which is the fourth of
  the gaps 6c left open and the only one waiting on paperwork rather than on code. **There is now a third
  place that address lands**: the lifecycle email footer, which omits the line entirely while
  `OPERATOR_POSTAL_ADDRESS` is empty. **The registered address and the published address are two different
  addresses, decided on 2026-09-24.** The registration requires a physical street address for the
  principal place of business and rejects a post office box, and it goes on the public record, searchable
  for a fee; the operator's home address goes there. The address published in the two documents and the
  email footer is a Canada Post box, which CASL's identification requirement accepts as a mailing address
  and which keeps the home address out of every document a reader actually sees. Renting the box is the
  lead time on top of the filing. An address change must be filed as an amended registration within 15
  days. **Do not incorporate
  yet.** A corporation cuts off contract claims and not claims founded on the operator's own negligence,
  which is the realistic claim for this product, so it buys little at present cost. The triggers that would
  change that answer are a signed agreement with a school board, a first employee, or an insurer requiring
  it.
- **Bind insurance before the first account that is not the operator's own.** This is the measure that
  actually answers a breach, and it is the single highest-value item in this step. Three coverages, asked
  for by name: **technology errors and omissions**, **cyber liability** (both first-party breach response,
  meaning forensics, notification and extortion, and third-party privacy liability), and **commercial
  general liability**, which is the least necessary for a business with no premises and no employees but is
  usually cheap inside a package. Ask for **$1M per claim and $2M aggregate** as the market baseline, and
  price **$2M/$2M** as well. The reason originally given for the higher limit was special-category student
  information, and that came from IEP; since 8a the data is rosters, attendance and parent contact details,
  which is still student personal information but not special-category. Whether $2M is worth its premium is
  a question to put to the broker rather than an answer to carry over.
  Expect roughly **CAD $500 to $3,000 a year** for a bundled tech E&O and cyber policy at this revenue
  scale, with a deductible in the $1,000 to $5,000 range. Canadian brokers writing micro technology risks
  include Zensurance, Foxquilt and ProLink; a referral from the lawyer is the better first call.
  Underwriters commonly make multi-factor authentication on administrative accounts, a written incident
  response plan and tested backups *conditions* of coverage. **8b exists to have all three answered before
  this conversation opens**, which is the one change the re-ordering made to this bullet: the earlier
  version treated discovering the conditions during procurement as the point, on the reasoning that
  discovery is what forces the work. That is true of conditions nobody has thought of, and these three were
  written down here months ago, so the discovery had already happened and only the work was outstanding.
- **Book the lawyer.** No lawyer has read either legal document, and the product handles information
  adjacent to student records. The hour also covers the business-name registration, the broker referral
  above, and whether the Ontario authority question needs anything more than an answer in writing. **The
  agenda changes once 8a lands**: with no charge to a teacher and no paid tier, the consumer-protection,
  refund and auto-renewal questions largely fall away, which is a reason to sequence the meeting after that
  step rather than before it. This has lead time and should be booked before it is needed.
- **Make the domain publicly reachable.** Distinct from buying it, and subject to the one hard ordering
  constraint in 6d: the privacy policy states that the database is in Toronto and the token key is held in a
  separate key management service, so **the domain must not become publicly reachable until the deployment
  matches those two sentences**, or the sentences change first.
- **Submit OAuth verification. Approved on 2026-09-24.** Submitted against five scopes (`openid`, `email`,
  `profile`, `drive.file`, `gmail.send`), with the justification in `ops/SCOPE_JUSTIFICATION.md` and a demo
  video recorded against the surface that survives 8a. New users no longer meet the unverified-app
  interstitial and the 100-user cap no longer applies. **The justification is the same document 9a owes a
  board**; it is written once and kept in `ops/`. What the approval constrains from here on is under OAuth &
  Token Security.
- **Verify the sending domain with Resend. Done on 2026-08-27, out of sequence.** What makes lifecycle email and error alerting real rather than
  inert, since `createMailer()` returns null in production with no key and 6d's alerting shares that seam.
  Neither `RESEND_API_KEY` nor `LIFECYCLE_EMAIL_FROM` is checked by `assertProductionConfig`, so this is a
  plain configuration change with no deploy-ordering hazard.
- **Finish the lifecycle sender's identity.** **The two console values were set on 2026-09-11 and only the
  postal line is left.** `LIFECYCLE_EMAIL_FROM` is `Teachneat <support@teachneat.com>` so the sender reads
  as the product rather than as a bare mailbox, and `LIFECYCLE_REPLY_TO` is `support@teachneat.com`, routed
  to a real inbox through Cloudflare Email Routing and tested by sending to it: the Resend payload carries
  `reply_to` when that variable is non-empty and omits the field when it is not, so a reply to a message
  inviting one now reaches a person rather than bouncing. Email Routing is receive-only, so replies from
  the operator come from a personal address rather than from `support@`. **What remains waits on the
  business-name bullet above**: `OPERATOR_POSTAL_ADDRESS` in `config/lifecycleEmail.ts` is an empty string
  in code rather than an env var, so the footer omits the address line entirely and closing the gap is a
  source edit and a deploy rather than a console change. **That line is a CASL identification requirement
  and not presentation.** CASL exempts the six messages from consent and from carrying an unsubscribe
  mechanism because each is tied to an account the teacher opened, but the identification requirements in
  s.6(2) are separate and the exemption does not lift them, and a mailing address is one of the items they
  enumerate. It is harmless while the only account is the operator's and it is a defect the day Step 10
  adds a real recipient, which makes the registration a launch blocker rather than paperwork. **The privacy
  policy enumerates the six messages but describes neither the footer nor the address**, so when the
  address exists the contact section should carry it, along with a named individual accountable for privacy
  enquiries, which PIPEDA's accountability principle expects and which lands in the same paragraph.

**Step 8d — The data-handling claim, corrected**

An accuracy pass over one sentence the project tells itself, scoped deliberately small because an audit
found the user-facing documents already correct and the internal ones wrong. The privacy policy already
says that "while you are working, a short-lived copy sits in our server's memory", and `/for-admins`
already says student data "passes through the server in memory while a request is served, because the
server is what calls the Google APIs". Those are right and need no change.

What is wrong is the framing they were derived from. `CLAUDE.md` states that student PII "never touches our
servers", and a comment in `ProductShots.tsx` states that "student data never reaches us". Neither is true:
every read and write transits the server, the working set holds a teacher's roster in process memory under
the two clocks in `config/cache.ts`, and email personalisation substitutes student names server-side. The
accurate claim, which is still the strongest thing about the product, is that **no durable copy of student
information exists on our servers, and none is written to the database, the logs or the backups.**

- Correct `CLAUDE.md` and the `ProductShots.tsx` comment to the durable-copy formulation.
- Tighten the one user-facing line that overstates: the privacy policy's administrators section opens with
  "the vendor holds no student records", which is defensible on a reading of "holds" as durable custody but
  is the sentence a technical reviewer will test first. Say no durable copy, and let the sentence that
  follows carry the Google-account point it already makes.
- Add a test asserting the durable-copy phrasing in the same way the client suite already holds the scope
  enumeration and the Limited Use statement, so the imprecise version cannot come back.

Placed first among the code steps because it costs an hour, because the operator's speaking notes derive
from `CLAUDE.md` rather than from the policy, and because 9a packages this claim for someone whose job is
to find the gap in it. It does **not** gate the OAuth submission in 8c, since the policy the reviewer reads
is already accurate.

**Step 8e — Board provenance**

The board asked at signup, stored, and surfaced in the metrics view. Two purposes, and the second is the
one that pays for the step.

- **It supplies the means to comply rather than extracting a promise.** The current terms have the teacher
  warrant that they are authorised to use a tool of their own choosing. That warranty does not move
  statutory duties, the board and the parents are not parties to it, and an indemnity against someone
  paying nothing is worth nothing. What is defensible is asking which board the teacher is at, recording
  the answer, and telling them plainly that boards commonly require approval before a third-party tool
  holds student information. A recorded answer and a clear statement is a materially different posture from
  a tick-box warranty.
- **It tells you which board to approach first.** A free-text board name on the account, aggregated in the
  6j operator metrics view, turns the first board conversation from a guess into the board where the users
  already are. That is the whole reason to collect it now rather than later.

Scope: a nullable column and its migration, a field in the 5c registration flow with an explicit note that
the answer is not verified, an optional acknowledgement of whether the teacher believes their board permits
self-selected tools, a board distribution panel in the metrics view, and additions to the privacy policy's
account-data list and to the existing export and deletion paths. Board name is account data rather than
student data, so it sits inside the existing accountability split without complicating it.

**Step 8f — Token path hardening**

The chain that leads to the worst case runs through this component and no other: a compromise that yields
usable refresh tokens yields read access to every connected teacher's sheet at once. What exists is already
good: AES-256-GCM with a per-record IV and auth tag, a key ring whose payloads name the key that wrote
them, and a data key unwrapped from Cloud KMS once at boot so the deployment holds only an inert wrapped
blob. This step closes the gaps around it, in descending order of value.

- **Tighten the KMS assumption, which is the one the whole design rests on.** `TOKEN_KMS_CREDENTIALS`
  carries service-account JSON in the deployment configuration, and that credential is exactly what turns
  the wrapped blob back into a key. The separation is therefore only as strong as one env var sitting
  beside the blob it protects. At minimum, narrow that service account to `cryptoKeyVersions.useToDecrypt`
  on that single key and nothing else, and put its rotation on a calendar. Establish whether App Platform
  can supply an OIDC identity that Workload Identity Federation would accept, which would remove the
  long-lived credential altogether; record the answer either way, because "we looked and it cannot" is a
  finding a board reviewer and an insurer will both ask for. **8b's restore test (2026-09-11) found two
  things to settle here.** The KMS credential and wrapped key in the operator's `server/.env` decrypt
  production's tokens, so the production key's decrypt capability sits on a desktop as well as in the
  deployment. And the key lives in a Cloud project named `teacher-toolkit-dev`, so development work and
  the production key share one project and one IAM policy. Decide whether the desktop keeps a production
  credential at all, and whether the key moves to a project named and scoped for production.
- **Exercise a rotation end to end, once, before launch.** The ring supports rotation and nothing has ever
  performed one. Generate `k2`, wrap it, add it to the ring, flip `activeId`, confirm rows written under
  `k1` still decrypt, then retire `k1`. A rotation path that is written and never run is the thing that
  fails on the day it is needed.
- **Write the re-encryption backfill the rotation implies.** Rotation only protects new writes without one.
  A one-shot job that reads, decrypts under the naming key and re-encrypts under the active key is small,
  and its absence makes the previous item cosmetic.
- **Retire the legacy path.** `createAesGcmCipher` derives its key from a single unsalted SHA-256 of an env
  string, and exists only so rows predating the keyed format stay readable. Assert that no stored token
  lacks the `v2:` prefix, then drop `TOKEN_ENCRYPTION_KEY` from production and make its absence a
  production configuration error.
- **Make the silent fallback loud in production.** `getTokenCipher()` falls back to the env-secret cipher
  when `initTokenCipher()` has not run. That is a supported path for tests and tools and a serious footgun
  in production, where a swallowed boot failure would silently encrypt under a weak key. Have the fallback
  throw when the process is running in production.
- **Alarm on decrypt failures.** A spike is the signal that a key is wrong, a row is corrupt, or something
  worse. `operatorAlerts` is the seam, and it has delivered mail since the Resend key was set on
  2026-08-27, so this needs only the trigger and not the channel.
- **Write the revocation runbook and rehearse it.** If tokens are believed compromised, the response is to
  revoke every refresh token at Google and force re-consent. That has to be a written, exercised procedure
  rather than an idea, and it is one of the documents both the insurer and the board review will ask to
  see. It lands in section 8.1 of `ops/INCIDENT_RESPONSE.md`, which already states the intended procedure
  and says it is unrehearsed; the rehearsal replaces that sentence with its date and result, written in
  that document's third-party voice.
- **Record the one residual risk deliberately.** The unwrapped key lives in process memory for the process
  lifetime, which is the correct trade against a KMS round trip on every account read. What follows from it
  is that a heap dump is a key disclosure: no inspector in production, no core dumps, and nothing that
  serialises the cipher into an error report.

**Step 9 — Google Workspace Marketplace listing & OAuth verification**
The end-goal distribution channel and the mechanism that makes the app usable on managed Google Workspace for Education domains (see the "Distribution and trust" design principle). Two parts:

- **OAuth App Verification. Done on 2026-09-24, out of sequence, as part of 8c.** For the one sensitive scope (`gmail.send`; `drive.file` is non-sensitive): brand verification, written scope justification, a demo video, and a compliant privacy policy, terms of service, and homepage on a verified production domain. Because the app uses no restricted scopes, this does **not** require the annual CASA security assessment — keep it that way (see Security Practices, scope discipline). **Two things the reviewer compares directly against the app**, both already satisfied by Step 6c and both easy to break later: the policy must enumerate *every* requested scope, including the three sign-in identity scopes and not only the two data ones, and it must carry the Limited Use statement verbatim. A test in the client suite holds the first; the second is asserted by name.
- **Marketplace listing** via the Marketplace SDK (name, icons, screenshots, support and privacy URLs), configured to allow individual-user installation so a teacher can install and authorize themselves once their board has allowlisted the app. Pairs with the Step 5a admin collateral that a board admin needs in order to approve allowlisting, which as built is the factual data-handling summary at `/for-admins` **and not a DPA template**: a DPA is a procurement artifact and this product is not sold through procurement, so one is offered on request through the contact form rather than published. See Step 5a.

Depends on Step 6 (the verified production domain and the public privacy policy/ToS live there). This step changes no product feature or data model; it is a production-footprint, verification, and listing layer over the existing web app. It gates real-world availability on managed domains, so although it is numbered last, its verification prerequisites (privacy policy, domain, consent-screen config) should be set up alongside hosting rather than deferred.

**Step 9a — Ontario board assessment package**

The paper a board's privacy review asks for, assembled before it is requested rather than during the
meeting. Step 9's listing makes the app installable and `/for-admins` answers the first ten minutes; this
step is the depth behind that page, and it is what turns a board conversation from a request into a
submission.

The timing is the argument for doing it now. Ontario boards are operating under new obligations that make
this the cheapest such conversation available for the next several years: they must hold an inventory of
every piece of software in use and of the personal information disclosed to each provider, they must run
privacy impact assessments to a standard set under the amended MFIPPA, and they must give written notice to
a parent, or directly to a student aged sixteen or over, whenever student personal information is disclosed
to a third-party application. **Asking to be added to a list a board is already compiling is a materially
easier ask than arriving later as an exception to a finished one.** Confirm the regulation, its citation
and its dates with the lawyer in 8c before relying on the detail; the shape of the obligation is what
matters here.

What the package contains:

- **The four documents a review asks for, which are owed anyway.** A subprocessor list, a breach response
  procedure, a retention schedule, and a written justification for each OAuth scope. PIPEDA's
  accountability principle expects the same set, so this is not additional work, and the revocation runbook
  from 8f slots in as part of the second.
- **A completed vendor privacy questionnaire held as a source of truth.** Every board uses its own form, so
  the deliverable is one document you transcribe from rather than a form you fill in repeatedly. The IPC's
  privacy impact assessment guide is the reference for what it must answer.
- **A one-page data flow diagram**: what leaves the browser, what the server touches and for how long, what
  reaches the sheet, what is in the database, and where each of the four subprocessors sits.
- **A pre-written notice paragraph the board can paste**, naming the application and the vendor, stating
  the specific personal information disclosed and the purpose, and leaving the legal authority for the
  board to complete. That paragraph is the exact thing the new parent-notice obligation requires a board to
  produce, and supplying it is cheap, differentiating, and unlikely to come from a larger vendor.
- **A decision on the data processing agreement.** Step 9 records the current position as "available on
  request" and deliberately not published. Settle here whether that survives contact with a board's privacy
  office or whether a short agreement should be commissioned, and get a fixed-fee quote if so. The clauses
  most likely to be disproportionate for a sole operator are audit rights, breach notification deadlines
  and insurance minimums.

Depends on 8d for the wording, 8a for the feature surface being described accurately, and 8f for the
security answers. Its natural output is the first board approach, which is Phase 3 work.

**Step 10 — Launch**

The first cohort of real accounts, bounded on three axes that were previously unbounded.

**Ontario only.** Not because Ontario is the most permissive jurisdiction, because it is not, but because
one legal jurisdiction is what a single operator with a full-time job can carry, and it is the only market
where the board conversation in 9a can be held in person. Selling into the United States imports three
separately enforceable state regimes that attach to the vendor directly regardless of any district
agreement, foreign sales tax, state auto-renewal statutes and a second currency, in exchange for a market
that cannot be serviced. Revisit once there is an Ontario board reference to point at.

**Free, with no charge to a teacher.** Settled in 8a. It removes the consumer-protection, refund,
auto-renewal and GST/HST surface from the first year entirely, and it converts the purpose of the launch
from revenue to evidence.

**Not teachers on a managed Workspace domain that already operates an OAuth allowlist**, who cannot sign in
until an admin adds the app. That remains the Phase 3 conversation, now supported by 9a. The target is the
group whose board uses Google Workspace but has not configured third-party app blocking. That an allowlist
is not yet the default posture is an assumption worth testing early rather than betting the launch on.

Everything else must be finished first: the Marketplace listing and OAuth verification (Step 9); the
business name, the legal review and **the insurance bound** (Step 8c); the reduced feature surface (8a);
and the board question in the signup flow (8e). The insurance is the one item on that list with no
workaround, because the exposure it answers is a breach and the operator is personally liable for it. The
board question is on the list because launching without it means a cohort whose provenance cannot be
reconstructed later, and provenance is what 9a is built from.

**What the launch is measuring.** The product has never been used by a teacher who is not the operator, and
that is a larger risk to the business than anything in the legal analysis. The first cohort exists to
answer whether the tool is wanted, which boards the users cluster in, and which tools they actually open.
Twenty to thirty accounts across a handful of named boards is enough for all three.

**A distribution plan is the open piece.** The Marketplace listing makes the app installable; it does not
make anyone look for it. The shape of the plan is deliberately left to a discussion held once the rest of
Phase 2 is closed. What 8a settles is that the acquisition mechanism is no longer a free tier sitting
beneath a paid one, so the founding-user framing built in 6i needs rethinking rather than reusing.

### Phase 3

Steps TBD once Phase 2 is complete and the MAU threshold decision is made. At a minimum: file upload infrastructure, resource browsing/search, quality review pipeline, subscription credit system, gmail integration with per/student communication aggregation.

The entries below are in two groups. **Committed** entries will be built and are the first Phase 3 work;
what remains open about them is how, not whether. **Candidates** are adopted ideas without a commitment,
each waiting on a trigger, a decision or evidence of demand.

#### Committed

**Google Classroom roster import (committed, high priority).** A teacher imports classes and students from
Google Classroom into their Sheet instead of typing the roster. Adopted on 2026-09-13 after an investigation
of what the Classroom API offers. Typing a roster is the largest piece of setup a new teacher faces, and
most of the market already has that roster in Classroom.

Decisions reached at adoption, to be honoured when it is built:

- **Import, not sync.** The import runs when the teacher asks for it, and a later "refresh from Classroom"
  shows what changed and applies only what the teacher accepts. Continuous sync was rejected because it
  needs Classroom push notifications and a background process using the teacher's stored refresh token
  with no session present, which is the pattern rejected for attendance automation on 2026-09-10 for the
  same reasons: the privacy policy's description of the working set as a copy held while the teacher is
  working, and Step 8f's threat model, which does not cover unattended token use.
- **Read-only, and only these scopes:** `classroom.courses.readonly` (the classes the teacher teaches),
  `classroom.rosters.readonly` (their students) and `classroom.profile.emails` (student email addresses),
  with `classroom.guardianlinks.students.readonly` for guardian emails as described below. None is on
  Google's restricted scope list, so they add OAuth App Verification scope review and no CASA assessment.
  Posting to Classroom (for example, groups as an announcement) and Classroom add-ons were both considered
  and rejected: posting needs a write scope that puts content in front of students for little value, and
  add-ons require a Teaching and Learning or Education Plus licence that most teachers will not have.
- **The scopes are requested incrementally, at the moment the teacher starts an import**, not at sign-in.
  Sign-in and its consent screen stay as they are, and a teacher who does not use Classroom never sees the
  request. The partial-grant refusal at sign-in (commit `f3da3fd`) checks for the base scopes and must keep
  treating the Classroom scopes as optional, and the import must handle a declined or partial Classroom
  grant with its own message.
- **Guardian emails are imported when available and never relied on.** They fill `students.parentEmails`,
  which the Email tool needs. They exist only where the board has guardian access switched on and the
  guardians were invited, which is common for K–12 but unmeasured for Ontario, so an import that finds no
  guardians is a normal result and says so.
- **Imported data lands in the Sheet exactly as typed data does.** Nothing new is stored on the server, and
  the durable-copy statement is unchanged.

What changes elsewhere when it ships:

- **`ops/SCOPE_JUSTIFICATION.md` section 6 states that Teachneat does not access Google Classroom data**, and
  the privacy policy's description of Google data accessed will need the same change. Both are rewritten in
  the same change that adds the scopes.
- **Verification is reopened.** The Step 8c submission goes in with the current scopes, and adding the
  Classroom scopes after approval is a second scope review. That was accepted rather than holding the
  submission for a Phase 3 feature.
- **A board can block this independently of approving Teachneat,** through the Admin console setting "Users
  can authorize apps to access their Google Classroom data". The import needs a specific message for that
  refusal, and `/for-admins` should name the setting.

Design questions to settle before building:

- **Matching students already in the Sheet.** Match on student email first. A student entered by hand
  without an email, or with a different one, will not match, so the import needs a review step that shows
  proposed new students and likely duplicates by name before writing anything.
- **Which Classroom classes, and under what name.** The teacher picks which classes to import; archived
  Classroom courses are excluded by default. Classroom's name and section fields together can exceed the
  60-character limit on `courses.name`, and an imported name can collide with an existing class, live or
  archived, so the class name needs to be editable in the review step. Remember that the name is the join
  key across enrollments, attendance and grouping.
- **`startDate` on imported enrollments.** An enrollment created in a class that already has recorded
  attendance is stamped with the day after its last class-day. That is correct for a student who joined
  late and wrong for one the teacher simply had not typed in yet, and an import into an existing class
  produces the second case often. Decide whether the review step asks, or whether an import into a class
  with recorded days leaves the stamp empty.
- **Removals on refresh.** A student who has left the Classroom course is offered for removal from the class
  and never removed automatically, since removal cascades to the enrollment and the teacher may be keeping
  the record deliberately.
- **What Classroom does not carry.** Preferred names and pronouns are not in Classroom, and Classroom's
  names are account names. The import should not overwrite a `goesBy` or `pronouns` value the teacher set,
  and a refresh should not overwrite a first or last name the teacher corrected.
- **Co-taught courses.** `courses.list` with `teacherId=me` returns courses the teacher co-teaches as well
  as owns. Confirm whether both should be offered.

**Board allowlisting (Phase 3, targeted at January 2027).** Opening the managed-domain conversation with a
named administrator at a specific board, starting with the operator's own. `/for-admins` exists for exactly
this and cannot start it: a teacher on a domain that blocks unconfigured third-party OAuth apps cannot sign
in at all until an admin adds the app in the Admin console, and that request enters an IT queue whose
timeline is not ours.

Moved out of Step 8c deliberately rather than for time. The meeting is worth more once the app is verified,
listed, legally reviewed and carrying real users, because every one of those is something the admin will ask
about and none of them can be promised credibly in advance. **Target the term-2 boundary, roughly January
2027**, which is when a board's own calendar makes a new tool plausible; a request landing mid-term competes
with the term it interrupts. Treat the date the admin gives as the real launch date for that cohort, not the
date the request is made.

#### Candidates

**Early-access product metrics (candidate; first among the candidates to schedule).** Extending Step 6j's
instrumentation so the free Ontario year produces the evidence the paid tier will later be designed from.
Adopted as a candidate on 2026-09-17.

**What Step 6j already answers, and the three properties of it that constrain anything added here.** Eight
write-once activation milestones on `users`, monthly per-tool counters in `usage_counters` retained for 24
months, and an operator view over both. Counts are per calendar month and therefore cannot be ordered into a
sequence, which is what lets the privacy policy tell a school board that a teacher's working day cannot be
reconstructed from them. Completed actions are counted rather than requests. The picker counts opens rather
than draws, because by the Step 8 decision it has no endpoints of its own. All three are decisions with
stated reasons rather than a first cut; see Step 6j in [HISTORY.md](HISTORY.md).

**Three gaps, of which the first is why this is worth scheduling early.**

- **The premium-attempt signal is inert for the whole free year.** `requirePremium` returns before its body
  when `BILLING_ENABLED` is false, deliberately, so that no milestone is recorded against a wall no teacher
  can meet. The consequence is that `first_premium_attempt_at` will be null on every account created this
  year: the one instrument aimed at whether the free/paid line sits in the right place records nothing
  during the only period in which that line is being decided.
- **Counters are per tool, not per feature.** Four numbers cannot say whether grouping constraints, the
  attendance statistics views, the configurable high-absence threshold or the display options carry the
  value, and those are exactly what Step 3 designates premium.
- **Nothing measures acquisition.** The public pages hold no instrumentation, so the path from a landing
  page to a completed sign-in and consent is unmeasured.

**The free year is a natural experiment that does not repeat.** Every premium-designated feature is unlocked
for every account with no price in the way, so what teachers do with those features this year measures which
ones they want, uncontaminated by the gate. After billing returns, the same measurement is contaminated by
it. Data not collected in the free year cannot be recovered afterwards, so this candidate's value decays
with delay while the others' do not, and a subset of it may belong before Step 10 rather than in Phase 3 at
all. That subset is an open question in [NEXT_STEPS.md](NEXT_STEPS.md).

Decisions reached at adoption, to be honoured if it is built:

- **In-house, extending the existing shape. No third-party analytics product, hosted or self-hosted.** The
  reasons are substantive rather than a wish to preserve the privacy policy's current wording, which is ours
  to change. A client SDK from Mixpanel, Amplitude, PostHog, Heap or GA4 puts a third-party script on pages
  that render student names, and the autocapture modes several of them enable by default record DOM text and
  form values, which would send student PII to a processor; that is disqualifying on its own. Any hosted
  option also adds a subprocessor, in most cases a United States one, to a product whose stated position is
  a Canadian database and no durable copy of student data, which is a real cost at a board's privacy review
  and at OAuth verification rather than a documentation cost. Self-hosting PostHog, Matomo or Umami avoids
  the subprocessor and replaces it with a second service to patch, back up, and carry in
  `ops/ADMIN_ACCOUNTS.md` and the restore procedure, which is disproportionate for a solo operation with one
  app and one database. What the third-party tools genuinely buy is ad-hoc exploration of events already
  captured, and that is the capability Step 6j declined on purpose.
- **The monthly-count ceiling stands.** New measurements are counters keyed by period in the
  `usage_counters` shape, not an event stream. The accepted cost is that a question not asked in advance
  cannot be asked of the past, since a counter defined in January starts in January. Accept that rather than
  buying fidelity with the claim the board-facing posture rests on.
- **If event-level fidelity is ever wanted, it is an opt-in panel and never the default.** A small number of
  teachers who explicitly consent to detailed usage logging in exchange for early access, with its own
  retention and its own deletion path, keeps high-fidelity research available without changing what is true
  of every other account. Reaching for it before the counters have been read would be the wrong order.
- **Retention and time-to-activation need no new collection at all.** `users.created_at`, the milestone
  timestamps and `usage_counters.account_id` already support signup-cohort retention by month and the median
  time from signup to first student and to first saved attendance. Those are queries and a view rather than
  instrumentation, and they are the cheapest part of this candidate.
- **`workspace_domain` is already stored**, which makes per-board concentration readable and is a direct
  input to the board allowlisting conversation targeted at January 2027. Reported as counts per domain it
  stays inside the totals-only posture the metrics view holds to.
- **At launch scale, interviews outrank dashboards.** A first cohort in the dozens or low hundreds cannot
  support inference from a funnel step that differs by five accounts. The questionnaire and interview
  material in `surveys/` is the precedent, and the first year should follow its weighting: the counters say
  where to look and a conversation says why.
- **Any new counter is a change to the privacy policy.** The policy names the exact list of milestones and
  describes the usage counter as a count per tool, so a feature-level counter makes the current wording
  incomplete rather than merely unmentioned. It carries the paired `DOCUMENT_VERSION` /
  `CURRENT_TERMS_VERSION` bump and the consent re-prompt, which is an argument for defining the whole set in
  one change rather than adding counters one at a time.

Design questions to settle before building:

- **Which features get a counter, and whether they extend `UsageTool` or sit in a second table.** The union
  is part of the `usage_counters` primary key and its four members double as milestone names through
  `MILESTONE_FOR_TOOL`, so extending it couples a feature series to the tool series. A sibling table keyed
  `(account_id, feature, period)` keeps them independent at the cost of a second read path.
- **What replaces the premium-attempt signal while billing is off.** Counting use of the premium-designated
  features is the substitute proposed above, and it answers a different question from the one the milestone
  answered: what teachers reach for, rather than what they are refused.
- **Whether the email allowance is measured against the free cap.** Accounts send under the 120/day cap this
  year with no monthly limit applied, so the distribution of monthly sends per account directly answers
  whether 30 a month would bind or be irrelevant, and it needs no new counter if the existing monthly count
  is read per account rather than only in aggregate.
- **Whether the public pages are instrumented at all, and if so server-side only.** Counting requests to the
  public routes in process, with no cookie, no script and no address stored, is the only form compatible
  with the rest of this entry. Decide whether the acquisition question is worth even that.
- **What the operator view becomes.** Cohort retention is a grid rather than a list, and the existing page
  is three tables; a fourth and a fifth are not obviously the right shape.
- **A guardrail against collecting out of curiosity.** Each counter is adopted with the decision it is meant
  to inform written beside it, and one that cannot name a decision does not ship.

**The United States, and the standard agreement that opens it (Phase 3 candidate; not scheduled).**

The market is closed by Step 8a, and the entry route is worth recording now so that reopening it is a
decision rather than a rediscovery.

**What closed it.** New York's Education Law § 2-d, California's SOPIPA and AB 1584, and the Texas student
data provisions place obligations on the **vendor** — contract terms that must be offered, a published data
security plan, breach notification on a statutory clock, in New York a parents' bill of rights. They attach
because you hold student data originating from that state's schools, not because you signed anything with a
district and not because you advertised there. One teacher signing up is enough to put a solo operator in
scope. Ontario has no equivalent vendor-facing statute; the duties there run to the board and the teacher.

**The route in is the Student Data Privacy Consortium's National Data Privacy Agreement (NDPA).** It is a
standard vendor contract form: a lead district in a state signs it once with the vendor, and other districts
in that state adopt the executed agreement from a shared registry rather than each negotiating its own
terms. That is what makes the US addressable for a one-person operation at all — the alternative is a
bespoke DPA per district, which does not scale past the first one. Signing it is a commitment, not a
formality: it is where the statutory obligations above become contractual ones with a named counterparty.

Two adjacent programmes are worth naming as **complements rather than substitutes**, because they are
sometimes mistaken for the same thing: **1EdTech TrustEd Apps**, a vendor privacy certification some
districts use as a screening filter, and **iKeepSafe**, which issues FERPA and California-specific badges.
Neither is a contract and neither discharges a statutory duty; both are signals that shorten a district's
review.

**None of this is verified.** It is written from general knowledge with a cutoff, in an area where the
programmes, the form and the statutes all change. Treat it as a pointer for the Step 8c legal review to
confirm before any of it is relied on, and specifically confirm whether the NDPA's current form is
compatible with the durable-copy architecture, since it presumes a vendor that stores student records.

**The prerequisite is not a document.** It is the three conditions in 8b, a reviewed set of legal documents,
and an incident response plan that a district's counsel would accept — all of which the Ontario launch
produces anyway. Reopening the US is therefore a decision about appetite for the vendor-statute exposure,
not a body of work that has to be started early.

**Automated Attendance Communications (candidate).** A rules engine that checks attendance data against configurable thresholds and queues parent emails for teacher review, connecting the Attendance tracker and the Email tool. Tabled during Phase 1 planning (worth building, but not yet a committed Phase 1 deliverable). The decisions below were reached before tabling except where a later date is given, and all of them are to be honored if it is built:

- **Interface lives in the Email tool, as its own tab** (Compose / Templates / Automation), not in the Attendance tool. This supersedes the original Phase 1 plan, which placed the rules config and review queue inside Attendance.
- **The pending-review indicator is a badge on the Email sidebar item**, showing the count of queued communications awaiting review. This supersedes the earlier "badge on the Attendance sidebar item" decision. It moves with the interface and stays consistent with the "no top-bar notifications icon" decision. Note: in Phase 1 terms there is no unattended send — every queued item is teacher-approved and dispatched synchronously through the same `sendEmails` path (same daily cap, burst limit, and `emailLog` audit logging) — so the badge is a review-queue count, not a background-send alert.
- **No per-student automation marker on the Attendance page** for the first cut. If added later it should be a distinct marker (workflow state: queued / sent), kept visually separate from the high-absences flag (a statistical standing condition), because a rule threshold is not the high-absence definition and conflating them would mislead.
- **Levers in the first cut (expanded 2026-09-09; supersedes the earlier absences-only scope).** Five rule types, of which the first four are *threshold* rules and the fifth is different in kind:
  - **Cumulative absences** in a course, the original first-cut lever.
  - **Absences in a rolling window**: N absences within the last M days (`absencesInWindow` with `windowDays`).
  - **Consecutive absences**: N in a row (`consecutiveAbsences`).
  - **Lates**, cumulative and within a rolling window (`tardyCount`). The signal already exists, since the Email tool's conditional templating resolves `lateCount` per `(student, course)`; a late rule reads the same value against a threshold.
  - **Recurring cadence**: a periodic message, for example a Friday summary to the parents of any student with attendance activity that week, rather than a threshold crossing.

  Three of the five need no enum change, since `attendanceRules.ruleTypeKey` already reserves `absencesInWindow`, `consecutiveAbsences` and `tardyCount`. Two do: cumulative absences has no enum value (every reserved name is qualified), and a cadence rule is configured by a period rather than a threshold, so `threshold` and `windowDays` do not describe it. Settle both when the tab's provisional shape is revisited. The duration-based "at risk for an extended period" lever named in the original entry stays deferred; it is a different kind of signal again, derived from a standing statistical condition rather than from attendance events.
- **Threshold rules and cadence rules differ in what starts them, and that difference drives the rest of the design.** A threshold rule is evaluated because attendance data changed, so the teacher who just marked the register is present, and the queued item follows directly from an action they took. A cadence rule becomes due because the clock advanced, and nothing the teacher did produced it. Both are subject to everything below about approval, but the cadence case is the one that strains it.
- **A due cadence rule is evaluated on the teacher's next visit, not by a background job (decided 2026-09-10).** Evaluating on a schedule would mean the server reading a teacher's roster and attendance with their stored refresh token while no session exists. Nothing does that today. It would make the privacy policy's description of the working set, a copy held "while you are working", untrue, and it would add a use of stored tokens that Step 8f's threat model does not cover. It also gains nothing: every send waits for the teacher, and the Email sidebar badge is only visible inside the app, so a batch computed overnight is seen no earlier than one computed when the teacher next signs in. The rule records the last period it produced a batch for, and the first authenticated request after a period closes evaluates it. The default to confirm when building: a teacher absent for three periods is offered one batch, for the most recent period, rather than three, which is also where the staleness question below starts.
- **Every send stays teacher-approved and synchronous. Re-examined on 2026-09-09 when the cadence lever was added, and it stands.** Approval dispatches through the same `sendEmails` path as the Compose tab, under the same daily cap (120 since Step 8a, not the 200 in force when this candidate was written), the same burst limiter, and the same `emailLog` audit row. There is no unattended send and no background dispatch: a scheduled lever adds a scheduled *evaluation*, not a scheduled send. The reasoning is the Gmail scope discipline recorded above. Because `gmail.send` sends from the teacher's real address, anything that can trigger a send is the app's highest-value target, and a teacher pressing a button on every outbound batch is what bounds the blast radius of a rule-evaluation bug to something a human sees before it leaves. The `statusKey` enum reserves `approved` for an asynchronous send path; reserving it is not a plan to build it.
- **Open, to settle before building: what approval looks like when a rule produces a batch.** Per-item approve and reject suits a threshold rule that queues one student at a time and suits a weekly cadence rule badly, because that rule can produce thirty items at once, and thirty button presses is not review. It is an obstacle that trains the teacher to click through. The shape to evaluate first: the rule pre-composes the batch and presents it as a single reviewable unit in the Compose tab, showing the recipient list and the resolved message, with one press to send. That keeps the human judgement the decision above requires while making the amount of work proportionate to the batch rather than to its length. Questions it raises, none of them settled: whether the batch is presented in Compose or in the Automation tab; whether the Email sidebar badge counts batches or items; whether a batch larger than the remaining daily allowance is blocked, split across days, or partially sent; and whether a single recipient can be dropped before the batch goes, which is an edit, and the queue design as specified has no edit.
- **The dedupe key needs a period dimension as well as the course one.** The existing constraint is at most one `emailQueue` row per `(rule, student)` in any status, retained permanently as the dedupe record. A cadence rule contradicts that by definition, since it is meant to produce a row for the same `(rule, student)` every period. The key becomes closer to `(rule, student, course, periodKey)`, with `periodKey` constant for threshold rules and carrying the period identifier for cadence ones. Settle it alongside the per-course change below rather than separately, because both rewrite the same uniqueness constraint.
- **Pending items need a staleness answer once cadence rules exist.** Retaining queue rows permanently is harmless when a rule fires at most once per student. A weekly rule left unreviewed accumulates a row per student per week indefinitely, and an old pending item carries a premise that has expired: a "three absences" message queued in November and approved in March is wrong in a way the teacher approving it may not notice. Decide expiry for pending items, and whether an expired item is hidden, deleted, or shown as stale, before building rather than after.
- **Absence counts are scoped per course**, matching every other attendance-derived signal in the app (`atRisk`, high-absences, and the email tool's `lateCount`/`unexcusedAbsences` all resolve per `(student, course)`). A rule is evaluated once per course a student is enrolled in, so the queue dedupe key and the `emailQueue` row need a course dimension (a schema change to add it — cheap as a clean reset while pre-launch). Aggregate-across-courses counting was rejected as ambiguous about which class the email concerns.
- Existing groundwork already in the codebase and specs: the `attendanceRules` and `emailQueue` tabs (SHEETS_SCHEMA.md, live in v3), the Attendance Rules / Attendance Queue endpoints (API_CONTRACT.md), and the once-per-`(rule, student)` dedupe / approve-sends-synchronously behavior. These are provisional and predate both the tabling and the 2026-09-09 lever expansion; revisit them before building, notably the per-course scope, the dedupe key's period dimension, and the two missing enum values above.

**Name Picker — Marble Race mode (candidate; premium-only if built).** A third **Style** option in the Random Name Picker (Step 8), alongside Card deck and Wheel, deferred out of Phase 1 to a post-launch stretch goal. Unlike Card deck and Wheel, which are free-tier modes, the Marble Race is **premium-only in its entirety** — the Style option itself is gated, not just its display options (see Phase 2 Step 3). It is the most expensive mode to build and the most visually distinctive, which makes it a better paid differentiator than a free one. Marbles labelled with each eligible student (initials for legibility) race down a course, and the winner is revealed at the finish. Its defining property, which sets it apart from the other two modes: **the physics is mostly realistic, so the outcome is non-deterministic — the simulation itself decides who wins; the winner is not pre-chosen by `pickRandom`.** The card-deck and wheel modes pick up front with `pickRandom` and animate only to *reveal* that pick; the marble race cannot, so fairness must instead be engineered into the sim through **symmetric, randomized initial conditions** (equal starting geometry per marble plus small independent random perturbations to launch position/velocity/force) that give every marble an equal expected chance to win, validated empirically over many simulated runs rather than proven from a uniform draw. It must still honor the rest of the picker contract: class scoping, the `spinToken` "animate only on a real draw" guard, the deferred "Remove selected students" behaviour, the `selected` caption, click-to-draw with mid-run lockout, the Size/fullscreen projection controls, a per-mode font, and a default sound effect. `prefers-reduced-motion` for this mode resolves to a winner without the visible race (likely a single fair `pickRandom` draw as the fallback, since there is no meaningful still frame of a race). Open choices to settle during build: a 2D physics engine (DEPENDENCIES.md review) vs. a hand-rolled deterministic-given-seed solver; how marbles are themed in Display options (a marble-specific colour/skin, paralleling wheel colours / card backs); and graceful handling of large rosters (40+ marbles) and tiny ones (1–2). The fairness architecture is recorded under Decisions Made in [HISTORY.md](HISTORY.md) ("Marble race fairness").

**Email log rolling archive (candidate).** Rows in a teacher's `emailLog` older than a configurable
retention window moved to a sibling `emailLogArchive` tab, leaving the active tab bounded. Scoped in Phase 2
Step 8 and moved here by that step's own measurement rather than deferred for time: the two readers it was
meant to keep fast do not exist, and the spreadsheet cell ceiling it would eventually protect is roughly nine
years out at the then-200/day send cap, and further since Step 8a lowered it to 120. **The trigger to build it, should one arrive, is a reader rather than
a row count** — an in-app audit or send-history view over `emailLog` would make the tab's size matter for the
first time, and that feature should carry the archive as part of its own scope. A teacher approaching the
cell ceiling is the other trigger and is the less likely one. The arithmetic and the assumptions behind both
numbers are in [HISTORY.md](HISTORY.md) under Decisions Made.

**Substitute-Ready Snapshot (candidate).** One action that generates a printable, shareable packet for a substitute teacher covering a class. Surfaced from work explored in an earlier session and adopted as a Phase 3 candidate; not scheduled.

The packet draws on data the app already holds, which is the point of the feature — it asks the teacher for almost nothing new and gets more useful the longer the account has been in use. Contents in the first cut: the class's **current grouping** (from Step 7's one-active-grouping-per-class model, which is already exactly "the seating as it stands"); the **roster** with preferred names and pronouns so a stranger addresses students correctly; **flagged students**, meaning the accommodations and notes a substitute genuinely needs rather than the full IEP record; a small teacher-authored **routines** field; and a **blank attendance sheet** matching the class list, since a substitute usually cannot record attendance in the app.

Why it fits the product. It reinforces both north-star goals — reducing administrative overhead and consolidating tools — by replacing the scramble a teacher does while ill, which is precisely when the app's value is easiest to feel. It also serves the lock-in principle honestly: the packet is hard to reproduce from the raw spreadsheets, not because the data is withheld but because the assembly is the work.

Design questions to settle before building, none of which need answering now:
- **The PII boundary is the hard constraint.** Generating a document containing student names, pronouns, and accommodation notes must not put that content into durable server storage or logs. The likely shape is **client-side rendering to print** (the browser's own print-to-PDF), which keeps generation inside the transient in-memory surface the app already has. A server-rendered PDF would need explicit review against the Sheets-as-system-of-record commitment, and "shareable" must not come to mean "stored on our infrastructure."
- **Which notes are substitute-appropriate.** IEP accommodations are legally sensitive and a substitute needs the subset that affects the day, not the record. This likely needs an explicit per-accommodation or per-note "include for substitutes" marker rather than a heuristic, which is a schema question.
- **Free or premium.** It leans on IEP data, which is deliberately free (see Phase 2 Step 3), but it is an assembly feature rather than an analysis one, so the existing free/paid line does not decide it.
- Whether the packet is per-class or per-day across every class a teacher holds.

**Notes (candidate).** A sixth tool for the teacher's own freeform notes and checklists, tagged for filtering.
Adopted as a Phase 3 candidate on 2026-09-13 from testing feedback; not scheduled.

Decisions reached when it was adopted, to be honoured if it is built:

- **Notes are standalone.** A note has no link to a class or a student, and tags are the only organisation.
  The student record keeps exactly one notes field (`students.notes`), and a second place where notes about a
  student could live would split that record and raise questions the tool does not need: what happens to a
  linked note when a student is deleted or a class archived, and whether the student detail view shows it.
  A teacher who wants class-scoped notes can tag them with the class name.
- **Each note is either text or a checklist**, convertible in both directions. Text to checklist makes each
  non-empty line an item. Checklist to text makes each item a line and discards checked state, so that
  direction confirms first when any item is checked. Mixed blocks within one note were rejected as an editor
  and an ordering problem out of proportion to the value.
- **Tags are free-typed, with existing tags suggested as the teacher types.** There is no tag entity and no
  management screen. A tag exists while at least one live note carries it.

What the constraints already settle:

- **Notes are student data and live in the Sheet.** The tool does not link notes to students, but teachers
  will write student names into them regardless, so every rule that applies to the roster applies here: no
  durable server copy, no note content in logs or error reports, and the working set the only in-memory
  copy. Nothing about this needs a new OAuth scope, since `drive.file` covers the app's own sheet.
- **The schema forbids nested JSON in cells, so checklist items get their own tab.** The likely shape is a
  `notes` tab (id, type key, title, body for text notes, pipe-delimited tags, created, updated, deleted) and a
  `noteItems` tab (id, note id, position, text, checked, deleted). Both are additive, so the migration runner
  provisions them on bootstrap with no per-bump code. Tag names cannot contain `|`, and are compared
  case-insensitively so that `Report cards` and `report cards` are one tag.
- **Body and item text are plain text.** No Markdown and no HTML rendering, which keeps the tool clear of
  `dangerouslySetInnerHTML` and of any sanitiser dependency. Line breaks are preserved.
- **String limits are set well below the Sheets cell ceiling** of 50,000 characters and enforced in Zod, so
  a note can never fail at write time on size.

Design questions to settle before building:

- **Write granularity.** Ticking a checklist item is the most frequent write in the tool and should update
  one row, not rewrite the note's items. Reordering items is the case that tempts a rewrite of every
  position; decide between rewriting the one note's items under a lock and sparse positions that let one
  move touch one row.
- **Tag filter semantics.** Whether selecting two tags shows notes carrying both or either. Either is the
  safer default for a small collection; both becomes useful as it grows.
- **Renaming or merging a tag.** Free-typed tags make a rename a rewrite of every note carrying it. Decide
  whether the first cut offers rename at all, or whether editing tags one note at a time is enough.
- **Search.** Whether the first cut searches note text as well as filtering by tag. Search over the working
  set is cheap client-side; the question is only scope.
- **Ordering and pinning.** Most recently updated first is the obvious default; whether a teacher can pin a
  note above that order is a small schema column worth deciding before the tab is created rather than after.
- **Sidebar position.** The existing order puts classroom tools before Email because Email is used least.
  Notes is not a classroom-facing tool either, so it likely sits beside Email rather than among the others.
- **Free or Premium, once billing returns.** Moot while Step 8a holds. It is a core organisational tool
  rather than an analysis or styling one, which by the existing line in Phase 2 Step 3 leans free.

**Mark Calculator (candidate).** A tool that computes each student's current mark in a class from
assessments the teacher enters by hand or pulls from Google Classroom. Adopted as a Phase 3 candidate on
2026-09-24; not scheduled.

Scope as proposed:

- **Assessments and marks are entered manually or imported from Classroom.** A manual assessment has a
  title, a maximum score and a date, and the teacher enters each student's score against it.
- **Three weighting modes, chosen per class:**
  - **By points**, where each assessment weighs in proportion to its maximum score, so a 50-mark test counts
    five times a 10-mark quiz.
  - **Per-assessment weights**, set individually by the teacher.
  - **Categories** (for example assignment, test, quiz), each given a total weight, with assessments
    weighted by points or equally within their category.

What the constraints already settle:

- **Marks are student data and live in the Sheet.** No durable server copy and no mark values in logs or
  error reports, exactly as for attendance. The likely shape is three additive tabs: assessments (id, course,
  title, category, maximum score, weight, date, deleted), marks (assessment id, student id, score, a status
  for missing or exempt, updated) and categories (course, name, weight). The migration runner provisions them
  on bootstrap with no per-bump code. Row volume is modest: 30 students, 40 assessments and six classes is
  about 7,200 mark rows a year.
- **The Classroom import depends on the committed Classroom roster import** and should not be built before
  it. Grades need a further scope, `classroom.coursework.students.readonly`, to read submissions and their
  assigned grades. It is believed to be sensitive rather than restricted, like the roster scopes, but that
  must be confirmed before committing, because a restricted scope would bring the CASA assessment this
  project has so far avoided. It is requested incrementally at the moment of a grade import, it is a
  further scope review after verification, and `ops/SCOPE_JUSTIFICATION.md` and the privacy policy change
  with it.
- **Import, not sync**, for the same reasons recorded against the roster import: a refresh shows what
  changed and applies what the teacher accepts, and nothing reads Classroom without a session present.

Design questions to settle before building:

- **What the tool claims its number is.** Ontario's Growing Success policy asks teachers to determine a
  grade by professional judgement, giving weight to the most consistent and more recent evidence, and
  splits grades 9 to 12 into 70% term work and 30% final evaluation. A calculated average is an input to
  that judgement rather than the report card mark, and the tool's wording should say so. Whether the 70/30
  split is a built-in preset, and whether categories should default to the achievement chart categories
  (Knowledge and Understanding, Thinking, Communication, Application) rather than assessment types, are
  worth deciding with a teacher before the category model is fixed. Both points are from general knowledge
  and should be checked against the current policy.
- **Mapping Classroom's own gradebook.** Classroom courses carry a grade calculation setting (total points
  or weighted categories) and per-assignment grade categories. If the API exposes them as expected, an
  import can adopt the class's existing weighting instead of asking the teacher to recreate it. Confirm what
  the API returns before designing the manual category editor around it.
- **Missing, late and exempt work.** Whether a missing score counts as zero or is excluded, and whether an
  exempt student's weight redistributes within the category or across the whole mark.
- **Categories with no marks yet.** Early in a term a category may have no assessments. Renormalising over
  the categories that do have marks is the usual answer and should be explicit in the UI.
- **Whether marks appear elsewhere.** The student detail view, and the Email tool's conditional templating,
  are both natural readers of a current mark. Each is a separate decision with its own PII and wording
  implications.
- **Free or Premium, once billing returns.** Moot while Step 8a holds.

**Leaderboard (candidate; deliberately open-ended).** A student-facing tool, projected in class like the
Name Picker and the Grouping display, where the teacher awards points to students and a leaderboard shows the
standings. Adopted as a Phase 3 candidate on 2026-09-24 as an idea rather than a design; not scheduled.

What is known about it:

- **It is a display tool first**, so it follows the picker's precedent: visual polish matters, it needs the
  Size and fullscreen projection controls, and it is a natural home for Premium display options (themes,
  fonts, animations when standings change) once billing returns.
- **Points are student data and live in the Sheet.** A ledger of awards (student, course, amount, optional
  reason, date) rather than a stored running total is the likely shape, because it gives undo, history and
  reset-by-period without extra machinery. It is an additive tab.
- **Names on screen follow the picker's rules**, using the preferred name rather than the legal one.

Design questions to settle before building:

- **Ranking students in front of their class.** A projected leaderboard also projects its bottom rows, and
  a student who is last every week is shown that way to their peers. Options include showing only the top
  few, showing points without rank, and team standings instead of individual ones. This is the question most
  likely to decide whether a teacher is comfortable using the tool at all, and it is worth asking teachers
  before building.
- **Teams.** Whether points can go to a group as well as a student, and whether teams reuse the class's
  active grouping from the Grouping tool.
- **Periods and resets.** Whether standings run for a week, a unit or a term, and whether a reset archives
  the ledger or deletes it.
- **Awarding points quickly.** The teacher awards points mid-lesson, so the input needs to be one or two
  clicks per student, likely from the projected view itself without exposing anything a student should not
  see.
- **Negative points.** Whether the teacher can deduct, which changes the tool from a reward system into a
  behaviour tracker, with a different tone in front of students.

**Customisable sidebar (candidate).** The teacher reorders the tools in the sidebar by dragging, and hides a
tool by right-clicking it. Hidden tools collect in a collapsible folder at the bottom of the tool list,
closed by default, which expands to show them when clicked. Adopted as a Phase 3 candidate on 2026-09-24;
not scheduled.

This reverses a standing decision: DESIGN_SYSTEM.md fixes the sidebar order, and `client/src/layouts/navConfig.ts`
says so in a comment. Both change when it is built. The case for it strengthens with each tool added, since
Notes, the Mark Calculator and the Leaderboard would take the list from five items to eight, and a teacher
who never uses one of them should be able to put it out of the way.

Design questions to settle before building:

- **Where the preference is stored.** Theme and the picker and grouping display settings are per-device
  `localStorage` keys today. Sidebar order is closer to an account setting, and a teacher who uses a school
  machine and a home laptop would expect it to follow them. It is not student data, so a column on `users`
  is permitted and would need a migration; `localStorage` needs none. Account-level storage is the
  stronger default.
- **Touch and keyboard.** Right-click and drag have no direct equivalent in the mobile drawer or for a
  keyboard user. Every action needs a non-pointer path, such as a menu button on each item with Move up,
  Move down and Hide, which also serves long-press on touch. Drag alone would fail the accessibility
  standard the rest of the app holds.
- **The collapsed tablet rail.** At tablet widths the sidebar is an icon rail with no labels. Decide how the
  hidden-tools folder appears there, and whether reordering is offered in that state at all.
- **Hiding the current tool, and hiding everything.** Whether a tool can be hidden while it is open, and
  whether at least one tool must remain visible.
- **What else respects the order.** Hiding is a sidebar preference and not a permission: a direct link to a
  hidden tool still opens it. Any list of tools added later (a home page, a command palette) should follow
  the teacher's order or deliberately not.
- **New tools.** Where a tool shipped after a teacher has customised the order appears: appended to the end
  of the visible list is the simplest answer that does not bury it.

The four candidates that follow were adopted on 2026-10-18, when the project was sunset, so that the ideas
outlive the deployment. None is scheduled.

**Grouping: present students only (candidate).** A toggle in the Grouping configuration panel that limits
the eligible students to those marked present in the selected class today. Groups made at the start of a
lesson currently include absent students, and the teacher removes them by hand after generating.

What the schema already settles: since schemaVersion 5 "present" is never stored. It is inferred from a
class-day marker for (course, today) with no exception row for the student, so the toggle reads the same
attendance data the entry view writes and adds nothing to the sheet.

Design questions to settle before building:

- **Attendance not yet taken today.** With no class-day marker there is no way to tell present from
  unrecorded. The toggle should be disabled with a short explanation and a link to the entry view, rather
  than treating every student as present or every student as absent.
- **Which statuses count as present.** Tardy almost certainly does, since the student is in the room.
  Excused is an absence and almost certainly does not. A late arrival who was marked absent and later
  corrected is handled by the entry view's own edit path, so the toggle reads whatever is current.
- **Constraints that name an absent student.** A "keep together" pair with one member absent should apply
  to the member who is present, and a "keep apart" pair with one member absent is simply satisfied. Neither
  should surface as a constraint conflict.
- **Whether the toggle persists.** A per-class preference remembered between sessions suits a teacher who
  always groups after taking attendance. The saved grouping itself should record nothing about it.
- **The Name Picker** has the same need and the same answer, and a shared eligibility helper would serve
  both.

**Grouping: drag to open space makes a new group (candidate).** Dragging a student out of a group and
releasing it over the canvas background, rather than over another group, creates a new group containing
that student. Today a drop anywhere except a group card does nothing and the student returns to where it
started.

Implementation notes and the questions they raise:

- **The drop target is the canvas container.** `GroupsCanvas.tsx` handles drops only on group cards
  (`handleDrop(i)`). A background drop handler appends `{ studentIds: [id] }` after removing the student
  from its source group, and `moveStudent`'s rule of dropping a group left empty still applies. Dragging the
  only member of a group into open space is then a no-op in effect and should not reorder anything.
- **The drop has to be visible before release.** Group cards show an accent border while targeted; the
  background needs an equivalent cue, such as a dashed "New group" placeholder that appears while a drag is
  in progress, which also tells the teacher the behaviour exists.
- **A non-pointer path.** Whatever keyboard or menu route moves a student between groups needs "New group"
  as one of its destinations, for the same accessibility reason given for the customisable sidebar.
- **Placement and numbering.** The new group goes at the end of the list and takes the next number. The
  marked group leader and display options apply to it as to any other group.

**PowerSchool integration (candidate).** Import classes, students and contact details from PowerSchool,
the student information system many boards run, and write the attendance a teacher takes in Teachneat back
to PowerSchool so it is entered once.

This is a different kind of feature from the Google Classroom import, and the difference decides whether it
is ever built:

- **Access is granted by a district, never by a teacher.** PowerSchool's API is reached through a plugin
  that the board's PowerSchool administrator installs, which issues credentials for the whole district.
  There is no per-teacher consent flow comparable to Google OAuth. The feature therefore needs a signed
  agreement with each board, which makes it a B2B sale even though the product is sold to individual
  teachers, and it cannot exist before the board relationship that Phase 3's allowlisting conversation is
  meant to open.
- **District-wide credentials change the server's position.** The server would hold a credential that can
  read every student in the board, not just one teacher's roster, and the durable-copy statement and Step
  8f's threat model would both have to be rewritten around it. Boards have had specific reason to examine
  third-party access to PowerSchool since the vendor disclosed a breach of its own customer data in
  January 2025.
- **Writing attendance is writing the official record.** Attendance in the SIS is what the board reports
  from, so a sync writes legally significant data. It needs a write scope, conflict rules for a record
  changed in both places, and a clear statement of which system is authoritative; the read-only import is
  a much smaller first piece.
- **Which SIS.** The discovery research found teachers exporting email lists from Aspen, not PowerSchool,
  so the target boards' system has to be confirmed before any design. CSV import (below) delivers most of
  the import half for any SIS without an agreement, and should be built first.

**Roster import from a CSV file (candidate).** The teacher uploads a CSV file, maps its columns to student
and class fields, reviews the result and imports it. Every SIS and spreadsheet can export a CSV, so this is
the cheapest route to removing manual roster entry for teachers whose rosters are not in Google Classroom.

Decisions that follow from existing commitments:

- **Parse in the browser.** The file is read and parsed client-side and only the confirmed rows are sent,
  through the same validated create path that typed students use, so the server sees nothing it would not
  see from typing and the file itself is never uploaded or stored.
- **Share the review step with the Classroom import.** Matching on student email, flagging likely
  duplicates by name, choosing or naming the target class and the `startDate` question are the same
  problems, and one review step should serve both imports.

Design questions to settle before building:

- **Column mapping.** Exports name their columns inconsistently. Offer a mapping step with guesses from
  common header names, remember the mapping per device, and let the teacher ignore columns.
- **Encoding and format.** Excel on Windows writes UTF-8 with a byte-order mark or Windows-1252, quoted
  fields contain commas and line breaks, and some exports use semicolons. Whether that justifies a parser
  dependency or a short hand-written parser with tests is a DEPENDENCIES.md review.
- **Names in one column.** Many exports carry "Last, First" in a single field, which needs a split rule the
  teacher can confirm in the review step.
- **Limits.** A maximum file size and row count, and a clear message for rows that fail validation, which
  are skipped and listed rather than failing the whole import.

**Serve the SPA from Express (candidate).** Retire the App Platform static-site component and have the
Express service serve the built client alongside the API. Adopted as a candidate on 2026-08-26, out of the
second security pass; not scheduled, and deliberately after launch.

Why it is worth doing. Helmet sets a strong header set and it only ever reaches `/api` responses, because
the page that actually runs the JavaScript is served by a different component. Measured against production
on 2026-08-26: a response from `/api/health` carries `strict-transport-security`, `x-content-type-options`,
`frame-ancestors 'none'` and `x-frame-options`, and the response for `/` carries none of them. App Platform
offers no way to close that gap, a `headers` block on an ingress rule being rejected by the spec schema, so
the Content Security Policy was moved into the document as a `<meta>` tag instead (see
`client/src/config/csp.ts`). That covers most of it and structurally cannot cover three things: a meta
policy ignores `frame-ancestors`, and HSTS and `nosniff` are headers with no in-document equivalent at all.
One origin serving everything is also simply the arrangement the rest of the app already assumes, and it
would delete the meta-tag workaround rather than adding a second mechanism beside it.

Why it is a candidate rather than a step. Each missing header has something real standing in its place.
`SameSite=Lax` on the session cookie means a cross-site frame gets no cookie and the app renders signed
out, so there is no authenticated victim for UI redress to work against. The domain is https throughout and
the document policy sets `upgrade-insecure-requests`. Nothing user-supplied is served as a file, and the
static host declares correct content types. So the residual risk is real but small, and it is not worth
buying down with a deployment change made in a hurry.

What it costs, measured rather than assumed. The static files live in object storage in `nyc3` but are
served from Cloudflare's Toronto edge with `s-maxage=86400`, and a probe returned `cf-cache-status: HIT`.
Today the page costs the Node container no CPU, no bandwidth and no connection. Served from Express, it
comes from the single `apps-s-1vcpu-1gb` instance in `tor1` instead. First load is about 162 kB gzipped
(main bundle 152 kB, CSS 9 kB, HTML 1 kB), with the email tool a separate 141 kB gzipped chunk fetched only
when opened; Vite emits content-hashed filenames, so `immutable, max-age=31536000` on `/assets` is safe and
a returning teacher re-fetches almost nothing. That makes it mostly a first-visit cost, and a first-visit
cost that lands hardest on a teacher far from Toronto.

The open question to settle before committing: whether DigitalOcean's own Cloudflare layer edge-caches a
response from the *service* component the way it caches one from the static component. The `s-maxage` above
is set by the static site. If service responses are not cached, every asset request reaches the container
rather than one per edge per day, which changes both the latency answer and the bandwidth answer. Measure
this first; it is cheap to measure and expensive to guess.

The largest cost is the build, not the code. `express.static` with cache headers is small. The two
components have separate `source_dir`s (`server` and `client`) with separate builds, so the server
component has no `client/dist` to serve. Fixing that means either moving `source_dir` to the repo root and
building both, which collides with the no-root-`package.json` rule in this document, or a build command
that reaches across directories; either changes buildpack detection and the CI path filters. There is also
a specific footgun: `catchall_document: index.html` has to become an Express fallback route, and a naive
`app.get('*', ...)` would start answering mistyped `/api` paths with HTML where they currently return a
JSON 404 that the client's error handling depends on. That needs explicit ordering and a test.

The rejected alternative is Cloudflare's orange cloud plus a Transform Rule, which produces the same headers
with no code change at all. It was rejected because it puts *our* Cloudflare account in the request path and
makes them our subprocessor, which is a privacy-policy change and a paired version bump. Note that
DigitalOcean already fronts App Platform with their own Cloudflare, so the grey-cloud record is about the
contract rather than about the packets (see the Cloudflare correction in [HISTORY.md](HISTORY.md), Step 6d). Three headers is not
worth permanently adding a company to the privacy policy when the option above needs no vendor at all.

Do this when the deployment is being touched for another reason, or if `instance_count` ever rises above one
and the static component stops being the thing keeping load off a single process.

---

Decisions already made, with their rationale, are recorded under Decisions Made in
[HISTORY.md](HISTORY.md). The open questions that remain are tracked in
[NEXT_STEPS.md](NEXT_STEPS.md).
