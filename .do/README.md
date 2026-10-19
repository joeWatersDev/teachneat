# Deployment secrets and provisioning order

`app.yaml` in this directory is the App Platform spec. Every value it writes as
`${NAME}` is set once in the App Platform console (or with `doctl apps update`)
and is never committed. This file is the list of them, plus the order the
provisioning steps have to happen in.

`DATABASE_URL` is not in the list: it is bound to `${db.DATABASE_URL}` in the
spec, so App Platform supplies it from the managed cluster and no password is
ever copied by hand.

## App Platform variables

| Variable | Encrypted | Where it comes from |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | Google Cloud console, OAuth client (same client as development) |
| `GOOGLE_CLIENT_SECRET` | yes | Same OAuth client |
| `SESSION_SECRET` | yes | `openssl rand -hex 32`, generated fresh for production |
| `TOKEN_KMS_KEY_NAME` | no | Full KMS resource name, `projects/…/cryptoKeys/…` |
| `TOKEN_KMS_CREDENTIALS` | yes | Service-account JSON, on one line |
| `TOKEN_KEY_WRAPPED` | yes | Base64 KMS ciphertext of the 32-byte data key |
| `TOKEN_ENCRYPTION_KEY` | yes | The legacy secret; kept until no pre-cutover rows remain |
| `STRIPE_SECRET_KEY` | yes | Stripe dashboard; stays test-mode — 8a makes billing dormant |
| `STRIPE_WEBHOOK_SECRET` | yes | Issued by the dashboard endpoint, not by `stripe listen` |
| `STRIPE_PRICE_MONTHLY` | no | Price id, mode-specific |
| `STRIPE_PRICE_ANNUAL` | no | Price id, mode-specific |
| `RESEND_API_KEY` | yes | Set 2026-08-28; sending domain verified in DNS |
| `LIFECYCLE_EMAIL_FROM` | no | Set alongside the key above; use `Teachneat <address>` for a display name |
| `LIFECYCLE_REPLY_TO` | no | Where replies go when `from` is not a receiving mailbox; omitted if empty |
| `OPERATOR_ALERT_EMAIL` | yes | Operator address, never a teacher-facing one |
| `SUPPORT_ADMIN_GOOGLE_SUBS` | yes | Comma-separated Google `sub` values |

`DEV_TOOLS_GOOGLE_SUBS` is deliberately absent from the spec. Its guard is the
allowlist *and* a non-production check; leaving it unset keeps both halves false
rather than one.

### The KMS variables go in on the first deploy

`assertProductionConfig` in `server/src/config/env.ts` requires
`TOKEN_KMS_KEY_NAME` and `TOKEN_KEY_WRAPPED` whenever `NODE_ENV=production`, and
boot calls it before the app is built. A production deploy without them throws at
startup, never answers the health check, and rolls back. They are also the
best-tested values in the list, having been exercised against the real keyring
before any of this was deployed, so they are not the risky part of a first
deploy.

### Two consequences of an empty `RESEND_API_KEY`

`createMailer()` returns `null` in production when no provider is configured
rather than falling back to the console driver. That disables lifecycle email —
messages stay queued and a later deploy with a key delivers them — and it also
disables **operator error alerting**, which shares the same seam. Setting
`OPERATOR_ALERT_EMAIL` does nothing on its own until a provider exists.

## GitHub repository secrets

The deploy job in `.github/workflows/ci.yml` needs two, on the `production`
environment:

| Secret | Where it comes from |
| --- | --- |
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API token, write scope |
| `DO_APP_ID` | Printed by `doctl apps create`, or the console URL |

## Provisioning order

Each step depends on the one above it.

1. **DigitalOcean account**, billing added.
2. **`doctl`** installed and authenticated locally.
3. **Google OAuth client**: add `https://teachneat.com/api/auth/google/callback`
   as an authorized redirect URI and `https://teachneat.com` as an origin. The
   existing localhost entries stay, so development keeps working.
4. **Create the app**: `doctl apps create --spec .do/app.yaml`. This creates the
   managed Postgres cluster with it. The first deploy fails until the variables
   above are set, which is expected.
5. **Set the variables**, all of them, including KMS.
6. **DNS at Cloudflare**: a CNAME at the apex pointing at the App Platform
   hostname, **DNS-only, grey cloud**. Note that this does not keep Cloudflare
   out of the request path: DigitalOcean fronts App Platform with Cloudflare
   themselves, so teacher traffic is terminated there either way, as
   DigitalOcean's subprocessor. The grey cloud keeps Cloudflare from becoming
   *our* subprocessor, which would add a name to `SUBPROCESSORS` and cost a
   paired version bump and a consent re-prompt. `teachneat.app` is the one
   proxied name, with no origin behind it, serving only a 301.
7. **Redeploy** and confirm `/api/health` answers 200 — it probes Postgres, so a
   200 means the database is reachable and not merely that the process is up.
8. **GitHub secrets**, then push to `main` and confirm CI gates and deploys.
9. **Stripe webhook endpoint** for the deployed URL; take its signing secret,
   which is not the one `stripe listen` prints.
10. **Uptime alert policies** in the DO console.

## Things this app does not have

- **No staging environment.** Every deploy goes to production.
- **A deploy is a brief outage and a cold working set**, because
  `instance_count` is 1 and the read-side cache is per-instance by design.
- **Backups are taken and have never been restored.** Managed Postgres does the
  first half only.
