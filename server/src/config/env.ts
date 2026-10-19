import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export const env = {
  port: Number.parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  clientOrigin: optional('CLIENT_ORIGIN', 'http://localhost:5173'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: optional('GOOGLE_REDIRECT_URI', 'http://localhost:3001/api/auth/google/callback'),
  },
  session: {
    secret: process.env.SESSION_SECRET ?? '',
    cookieName: optional('SESSION_COOKIE', 'ttk_session'),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
    /**
     * PEM for the CA that signed the database server's certificate. Required
     * against DigitalOcean Managed Postgres, whose CA is not in Node's trust
     * store; `pg` reads `sslmode=require` as `verify-full`, so the connection
     * fails without it. Empty locally, where Postgres is a native install with
     * no TLS. Accepts a PEM whose line breaks are written as literal backslash-n
     * sequences, since a genuinely multi-line value survives an environment
     * variable badly.
     */
    caCert: (process.env.DATABASE_CA_CERT ?? '').replace(/\\n/g, '\n'),
  },
  /**
   * Refresh-token encryption at rest. `key` is the development path (a shared
   * secret in the environment). The other four are the production path added in
   * Step 6d: KMS holds the key, the deployment holds only `wrappedKey`, which is
   * inert without KMS access. `key` is kept alongside them so rows written
   * before the cutover stay readable; it can be dropped once none remain.
   *
   * `kmsCredentials` empty means Application Default Credentials, which is the
   * right answer anywhere the platform supplies an identity and the wrong one on
   * DigitalOcean, which does not — so there it holds service-account JSON.
   */
  tokenCipher: {
    key: process.env.TOKEN_ENCRYPTION_KEY ?? '',
    keyId: optional('TOKEN_KEY_ID', 'k1'),
    kmsKeyName: process.env.TOKEN_KMS_KEY_NAME ?? '',
    kmsCredentials: process.env.TOKEN_KMS_CREDENTIALS ?? '',
    wrappedKey: process.env.TOKEN_KEY_WRAPPED ?? '',
  },
  /**
   * Phase 2 Step 6d. Budget for the read-side working set, in megabytes. Here
   * rather than derived from the instance so that resizing the instance is a
   * config change; see MAX_CACHE_BYTES for what the number was measured against.
   */
  cacheMaxMb: Number.parseInt(optional('CACHE_MAX_MB', '256'), 10),
  /**
   * Phase 2 Step 3b. Only the secret key and the webhook signing secret are
   * secrets; the price ids are public identifiers, kept here because test-mode
   * and live-mode ids differ and hardcoding one guarantees a wrong-mode bug.
   *
   * There is deliberately no publishable key: checkout is Stripe-hosted, so the
   * browser never calls Stripe directly and nothing in the client needs one.
   *
   * `webhookSecret` differs per environment in a way that catches people out —
   * the Stripe CLI's `stripe listen` prints its own signing secret for local
   * forwarding, which is not the one a dashboard-created endpoint issues.
   */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    priceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? '',
    priceAnnual: process.env.STRIPE_PRICE_ANNUAL ?? '',
  },
  /**
   * Phase 2 Step 6h. The transactional sender's key and the address lifecycle
   * mail comes from. Both empty until the provider account exists; empty is a
   * supported state, not a misconfiguration, and outside production it selects
   * the console driver so the templates stay reviewable.
   *
   * `from` is deliberately configured rather than derived from the domain. That
   * began as a necessity, since `onboarding@resend.dev` was the only working
   * value before the sending domain was verified in DNS; it stays configured
   * now that `teachneat.com` is verified, because the address that sends is a
   * deployment decision rather than a property of the domain. Production sends
   * from an address that also receives, so a reply to a trial notice reaches a
   * person.
   */
  lifecycleEmail: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.LIFECYCLE_EMAIL_FROM ?? '',
    /**
     * Where a reply goes, when it should not go to the from address.
     *
     * Optional, and omitted from the payload when empty, so it carries no
     * deploy-ordering hazard. It exists because the from address is chosen for
     * deliverability and the reply address for reaching a person, and those are
     * not always the same string: a teacher who answers a trial notice is
     * making the likeliest first contact anyone makes with this product, and
     * whether it reaches someone should not depend on the sender having been
     * set to a mailbox that receives.
     */
    replyTo: process.env.LIFECYCLE_REPLY_TO ?? '',
  },
  /**
   * Phase 2 Step 6d. Where unhandled server errors are mailed. Empty disables
   * the alert without disabling the log, which is the correct state before the
   * domain exists rather than a misconfiguration.
   *
   * Not a teacher-facing address and never mixed with one: this is the operator,
   * and the messages are about the server rather than about an account.
   */
  operatorAlertEmail: process.env.OPERATOR_ALERT_EMAIL ?? '',
  /**
   * Google subs allowed to reach the development-only plan toggle. Half of that
   * endpoint's guard — the other half is the non-production check — because an
   * allowlist alone would turn a copied `.env` into a live entitlement endpoint,
   * and an environment check alone would let anyone on a dev deployment grant
   * themselves premium.
   */
  devToolsGoogleSubs: (process.env.DEV_TOOLS_GOOGLE_SUBS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  /**
   * Google subs allowed to read and triage support requests. Unlike the dev
   * tools allowlist above, this one has **no** environment half to its guard,
   * because unlike the plan toggle it is meant to work in production — support
   * triage is a real operator task. The allowlist is therefore the whole guard,
   * which is why the endpoints answer 404 rather than 403 and why an empty
   * allowlist grants nobody anything.
   */
  supportAdminGoogleSubs: (process.env.SUPPORT_ADMIN_GOOGLE_SUBS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  /**
   * How many proxies sit in front of this process, for Express's `trust proxy`.
   *
   * Express defaults it to `false`, which makes `req.ip` the socket peer. Behind
   * App Platform that peer is DigitalOcean's ingress, identical for every
   * request, so any rate limiter keyed on `req.ip` degrades from per-client to
   * one shared bucket for all traffic. Two of ours did: the global 600/minute
   * limiter, and the 3/hour on the public contact form — which is the route a
   * teacher whose board has blocked the OAuth app has to reach us by, so one
   * abuser could deny it to exactly the people it exists for.
   *
   * **This is a count of hops, and it must be measured rather than guessed.**
   * Set it too low and `req.ip` stays a proxy address, which is the bug above.
   * Set it too high and Express walks past the real entry into client-supplied
   * `X-Forwarded-For` text, letting a caller choose their own rate-limit bucket
   * — a worse failure, because it looks like it is working. The chain is not
   * obvious a priori: DigitalOcean fronts App Platform with Cloudflare
   * themselves, so there is more than one hop and the number is theirs to
   * change, not ours to assume.
   *
   * `GET /api/internal/forwarding` reports the live chain for whoever calls it,
   * which is how the value is established. Until it is set, the default of 0
   * keeps the present behaviour: over-restrictive, and never spoofable.
   */
  trustProxyHops: Number.parseInt(optional('TRUST_PROXY_HOPS', '0'), 10) || 0,
} as const;

/**
 * Whether the product charges anybody (Phase 2 Step 8a).
 *
 * The first school year launches Ontario-only and free to every account, so the
 * plan split, the trial, the premium boundary and Stripe checkout are all
 * switched off rather than deleted. Nothing about billing is removed from the
 * codebase: with this false, every account resolves to full entitlement
 * (`resolveEffectivePlan`), the gating middleware is a pass-through
 * (`requirePremium`), the four billing-shaped lifecycle scans do not run, and
 * the client is told to render no upgrade affordance anywhere. Setting
 * `BILLING_ENABLED=true` restores the product described in
 * IMPLEMENTATION_PLAN.md Phase 2 Step 3.
 *
 * **Defaults to off**, deliberately. A required variable has to be set in
 * DigitalOcean before the code that reads it deploys, or the boot fails; a flag
 * that defaults to the launch behaviour has no such ordering. The day a paid
 * plan returns, set the variable first and deploy after.
 *
 * A function reading `process.env` on each call rather than a field on `env`,
 * which is resolved once at import. The value cannot change under a running
 * process either way, so production behaviour is identical; what this buys is a
 * test suite that can exercise both states, which matters because the whole
 * premium boundary is code that ships dormant and must still be proven to work
 * on the day it is turned back on.
 */
export function billingEnabled(): boolean {
  return (process.env.BILLING_ENABLED ?? 'false') === 'true';
}

/** Whether this session may read and triage support requests. */
export function isSupportAdmin(googleSub: string): boolean {
  return env.supportAdminGoogleSubs.includes(googleSub);
}

/** Whether this session may use the development-only plan toggle. Both guards, always together. */
export function devToolsEnabledFor(googleSub: string): boolean {
  return env.nodeEnv !== 'production' && env.devToolsGoogleSubs.includes(googleSub);
}

/**
 * Refuses to start when the deployment looks like production but `NODE_ENV`
 * does not say so.
 *
 * `nodeEnv` defaults to `development`, and a surprising amount hangs off it: the
 * session cookie's `Secure` flag, whether the KMS-held token key is required,
 * whether the development plan toggle can exist at all. One unset variable
 * silently relaxes all three at once, and every one of them fails *open* — the
 * app keeps working, so nothing draws attention to it. A teacher's session
 * cookie travelling without `Secure` is the worst of them, because it is a
 * direct path to somebody else's roster.
 *
 * Flipping the default the other way was the obvious fix and is the wrong one:
 * `npm run dev` sets no `NODE_ENV`, so defaulting to production would make the
 * ordinary development path demand a KMS key. Instead this looks at a signal
 * that cannot be true by accident.
 *
 * `CLIENT_ORIGIN` is that signal. Locally it is `http://localhost:5173`; in a
 * real deployment it is the app's own https domain, and there is no development
 * workflow where it is an https host that is not localhost. Deliberately *not*
 * `DATABASE_URL`: connecting a laptop to the managed database is a real thing to
 * do while developing, so that one has a plausible false positive and this does
 * not.
 *
 * Fatal in every environment, unlike {@link assertProductionConfig}, which is
 * fatal only in production and warns elsewhere so that a half-configured laptop
 * can still be inspected. There is nothing to inspect here — the app would run,
 * serve real teachers, and be wrong about it.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * Whether this origin is one real teachers could reach: https, and not a local
 * host. Split out from the assertion so it can be tested against the awkward
 * cases directly, `env` being read once at import and not straightforward to
 * vary from a test.
 */
export function isPublicOrigin(clientOrigin: string): boolean {
  let origin: URL;
  try {
    origin = new URL(clientOrigin);
  } catch {
    // Not a URL at all. assertProductionConfig is the right place to complain
    // about a malformed value; guessing here would turn a typo into a refusal
    // to boot.
    return false;
  }
  return origin.protocol === 'https:' && !LOCAL_HOSTS.has(origin.hostname);
}

export function assertEnvironmentIsCoherent(
  nodeEnv: string = env.nodeEnv,
  clientOrigin: string = env.clientOrigin,
): void {
  if (nodeEnv === 'production') return;
  if (!isPublicOrigin(clientOrigin)) return;
  throw new Error(
    `CLIENT_ORIGIN is ${clientOrigin}, which is a public deployment, but NODE_ENV is ` +
      `"${nodeEnv}". Refusing to start: the session cookie would be sent without Secure ` +
      `and the KMS-held token key would not be required. Set NODE_ENV=production.`,
  );
}

export function assertProductionConfig(): void {
  required('GOOGLE_CLIENT_ID');
  required('GOOGLE_CLIENT_SECRET');
  required('SESSION_SECRET');
  required('TOKEN_ENCRYPTION_KEY');
  required('DATABASE_URL');
  // The privacy policy states that the token key is held in a separate key
  // management service. In production that sentence is a configuration
  // requirement, not a preference, so its absence is a boot-time failure.
  if (env.nodeEnv === 'production') {
    required('TOKEN_KMS_KEY_NAME');
    required('TOKEN_KEY_WRAPPED');
    // Without the CA the pool cannot verify the managed database's certificate
    // and every query fails. Better a named boot failure than a TLS error from
    // the migration runner.
    required('DATABASE_CA_CERT');
  }
}
