# Teachneat — Dependency Allowlist

Authoritative list of approved packages. It began as the Phase 1 allowlist and now also carries the Phase 2 additions (`pg`, `stripe`). Anything not on this list requires explicit review before being added. Prefer stdlib or a few lines of code over a new dependency.

## Client

| Package | Purpose |
|---|---|
| `react` | UI framework |
| `react-dom` | DOM renderer |
| `react-router-dom` | Client-side routing |
| `lucide-react` | Sidebar and toolbar icons |
| `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` | Rich-text editor for email templates (Step 5). StarterKit is narrowed to the sanitizer allowlist (bold, italic, bullet/ordered lists, links; headings/blockquote/code/strike/hr disabled). Output HTML is sanitized server-side via `sanitize-html`. Installed at v3. |
| `@tiptap/extension-link` | Link support. In StarterKit v3 the Link extension is bundled and configured via `StarterKit.configure({ link: … })`, so it is not registered separately. `@tiptap/extension-mention` was **not** installed: placeholders are inserted as literal `{{token}}` text via a menu rather than mention chips (simpler, no extra dependency). Additional first-party `@tiptap/extension-*` packages may be added without re-review when needed for the email template editor. |
| `tailwindcss` | Styling |
| `@tailwindcss/postcss` | PostCSS plugin for Tailwind v4 (replaces the v3 `tailwindcss` postcss plugin). |

## Server

| Package | Purpose |
|---|---|
| `express` | HTTP framework |
| `cors` | CORS middleware |
| `helmet` | Security headers |
| `dotenv` | Env var loading |
| `googleapis` | Google Sheets API, OAuth, Gmail API |
| `zod` | Request validation |
| `ulid` | ID generation per [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md) |
| `express-rate-limit` | Rate limiting (aggressive on `/email/send`, lighter on other endpoints) per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |
| `pino` | Structured server logging. Never log email body content or student PII. |
| `pg` | PostgreSQL driver for the Phase 2 account model (users table: identity, Sheet ID mapping, subscription status, encrypted refresh token). Accessed via raw SQL through a thin account repository; migrations are an ordered in-code list applied at boot. Chosen over an ORM (Prisma/Drizzle) to keep the dependency surface minimal for a small schema. Holds no student PII. |
| `stripe` | Official Stripe server SDK, added at Phase 2 Step 3b. Webhook signature verification (`webhooks.constructEvent`) and Checkout / billing-portal session creation, none of which is reasonable to hand-roll. Server-only — checkout and the portal are hosted, so the client never talks to Stripe and `@stripe/stripe-js` is not needed. |
| `sanitize-html` | Server-side sanitization of rich-text editor output before email send. Configure a strict tag allowlist matching exactly what the email editor is configured to produce (`p, strong, em, ul, ol, li, br`, plus `a` from `extension-link` with `href` as its only allowed attribute and `rel="noopener noreferrer"` enforced). Disable any StarterKit nodes not on the allowlist (headings, blockquote, code) so teachers can never author content the sanitizer would strip. Any tags outside the allowlist are stripped. Satisfies the test in [TESTING_PLAN.md](TESTING_PLAN.md) that rejects raw HTML not produced by the rich-text editor. |

## Dev / Test

| Package | Purpose |
|---|---|
| `typescript` | Type checking |
| `vite` | Client dev server and bundler |
| `@vitejs/plugin-react` | React support for Vite |
| `nodemon`, `tsx` | Server dev runtime. (`ts-node`'s ESM loader silently exits under Node 22 + NodeNext; `tsx` is used instead, and `ts-node` has been uninstalled.) |
| `postcss`, `autoprefixer` | Required by the Tailwind v4 build pipeline; installed with it rather than chosen separately. |
| `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` | The lint config's own dependencies. Listed for completeness — they ship no runtime code. |
| `vitest` | Unit tests |
| `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` | Component tests and user-interaction simulation |
| `jsdom` | DOM environment for Vitest component tests |
| `supertest` | Server endpoint tests |
| `playwright` | E2E tests per [TESTING_PLAN.md](TESTING_PLAN.md). **Approved but not yet installed** — the responsive and viewport criteria it would cover are currently verified by hand. |
| `@types/*` | Type definitions for the runtime packages above |
| `eslint`, `prettier` | Linting and formatting. `eslint` is installed; `prettier` is approved but not installed. |

## Explicitly Deferred

These are not approved for Phase 1. Re-evaluate if a concrete need appears.

- **Matter.js** — only relevant to the marble-race stretch goal. Decide when/if that feature is prioritized.
- **Date/time library** (`dayjs`, `date-fns`, `luxon`) — use stdlib `Date` and `Intl` for attendance dates and UTC-day boundaries. Add a library only if stdlib proves insufficient.
- **HTML escape library** (`escape-html`, etc.) — inline a small escape function for email placeholder substitution per CLAUDE.md. Adding a package for ~5 lines of code is not justified.
- **Cookie / session middleware** (`cookie-parser`, `express-session`, etc.) — still declined after Phase 2 Step 2 shipped sessions. The cookie is parsed and signed in ~20 lines and the session state lives in Postgres, so a middleware package would add a dependency without removing any code.
- **CSRF protection** (`csrf-csrf`, `csurf` is deprecated) — likewise declined. Step 2's per-session token in `X-CSRF-Token`, compared with `timingSafeEqual`, needs no package.
- **ORM** (`prisma`, `drizzle-orm`, etc.) — considered and declined for the Phase 2 account model. The raw `pg` driver (now approved, listed above) with hand-written SQL keeps the dependency surface minimal for a small schema.
- **Error tracking** (`@sentry/node`, `@sentry/react`) — Phase 2 hosting step (6d).
- **Transactional email provider SDK** (`resend`, `postmark`) — reviewed at Step 6h and **not added**. Resend is the provider, chosen on deliverability reputation and on a free tier that covers development and early launch, but its send API is a single authenticated POST, which `services/mailer.ts` makes over the platform `fetch` in a few lines. An SDK would add a dependency and pin the provider's types across the codebase to save nothing; the seam that already exists for swapping providers is the interface, not the package. Resend is still a **new subprocessor**, so it is named in the privacy policy regardless of whether a package was installed.
- **xlsx parsing** (`exceljs`, `xlsx`/SheetJS) — only needed by the Drive-export cold hydration deferred in Step 6a, which was reconsidered and not built. `exceljs` is 21 MB and nine dependencies for a read-only need, and SheetJS now distributes outside the npm registry, which is a poor trade for a product whose trust story is a Workspace admin approving it.
- **JWT library** — sessions are cookie-based per CLAUDE.md; no JWTs.
- **State management library** (`redux`, `zustand`, `jotai`) — React state and React Router data APIs are sufficient for Phase 1. Re-evaluate if a concrete need appears.
- **Form library** (`react-hook-form`, `formik`) — defer until form complexity warrants it.
- **HTTP client** (`axios`, `ky`) — use the platform `fetch`. No package needed.

## Adding a Dependency

Before adding any package not listed above:

1. Confirm the need cannot be met by stdlib or a small inline implementation.
2. Confirm the package is actively maintained, has no known critical vulnerabilities, and its license is compatible with a commercial SaaS product.
3. Update this document with the package name, purpose, and which doc or feature drove the addition.

## CI and deployment tooling

Not runtime dependencies and not in either `package.json`, but they run with credentials and belong under
the same review rule.

| Action | Purpose |
|---|---|
| `actions/checkout`, `actions/setup-node` | Standard GitHub-maintained workflow steps |
| `digitalocean/action-doctl` | Installs `doctl` so the workflow can create a deployment after the checks pass. Holds a token that can deploy production, so it is worth pinning to a commit SHA rather than a tag. |

**Google Cloud KMS needs no package.** `googleapis`, already listed above, carries the Cloud KMS v1 client
and `google-auth-library`, so the Step 6d key handling added no dependency.
