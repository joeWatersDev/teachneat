process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
  process.exit(1);
});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { globalRateLimitKey } from './utils/rateLimitKey.js';
import { env, assertProductionConfig, assertEnvironmentIsCoherent } from './config/env.js';
import { logger } from './config/logger.js';
import { BUILD_INFO } from './config/buildInfo.js';
import { buildAuthRouter } from './routes/auth.js';
import { buildBootstrapRouter } from './routes/bootstrap.js';
import { buildStudentsRouter } from './routes/students.js';
import { buildAttendanceRouter } from './routes/attendance.js';
import { buildEmailRouter } from './routes/email.js';
import { buildGroupingRouter } from './routes/grouping.js';
import { buildSettingsRouter } from './routes/settings.js';
import { buildInternalRouter } from './routes/internal.js';
import { buildSupportRouter } from './routes/support.js';
import { buildClassesRouter } from './routes/classes.js';
import { buildPublicSupportRouter } from './routes/publicSupport.js';
import { buildPublicInfoRouter } from './routes/publicInfo.js';
import { buildBillingRouter, buildStripeWebhookRouter } from './routes/billing.js';
import { assertPricesMatch } from './services/billing.js';
import { isBillingConfigured, RECONCILE_INTERVAL_MS } from './config/billing.js';
import { reconcileSubscriptions } from './services/subscriptionReconcile.js';
import { sweepCache } from './services/cache.js';
import { createPgUsageStore } from './services/usageStore.js';
import { SWEEP_INTERVAL_MS } from './config/cache.js';
import { LIFECYCLE_SWEEP_INTERVAL_MS } from './config/lifecycleEmail.js';
import { createPgLifecycleEmailStore, dispatchLifecycleEmails } from './services/lifecycleEmail.js';
import { createMailer } from './services/mailer.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireSession } from './middleware/session.js';
import { requireCsrf } from './middleware/csrf.js';
import { requireConsent } from './middleware/consent.js';
import { rejectWhileLocked } from './services/accountLock.js';
import { createPgAccountStore, type AccountStore } from './services/accountStore.js';
import { initTokenCipher } from './services/tokenKey.js';
import { createPgSupportStore } from './services/supportStore.js';
import { initOperatorAlerts, reportServerError, topFrame } from './services/operatorAlerts.js';
import { createPgSessionStore, type SessionStore } from './services/sessionStore.js';
import { getPool } from './db/pool.js';
import { runMigrations } from './db/runMigrations.js';

export function buildApp(
  store: AccountStore = createPgAccountStore(),
  sessions: SessionStore = createPgSessionStore(),
) {
  const app = express();
  app.disable('x-powered-by');
  // How far back to read X-Forwarded-For when deciding who is calling. See
  // env.trustProxyHops for why this is a measured number and why erring low is
  // the safe direction: too low over-restricts, too high lets a caller pick
  // their own rate-limit identity.
  app.set('trust proxy', env.trustProxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          // Wildcarded for the same reason the document policy is: Google's
          // `picture` claim is not guaranteed to be on lh3, and a pinned
          // subdomain leaves a broken avatar with no obvious cause. See
          // client/src/config/csp.ts, which is the policy that actually governs
          // the rendered page; this one covers API responses.
          imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    }),
  );
  // The Stripe webhook is mounted BEFORE express.json() on purpose: signature
  // verification hashes the exact bytes Stripe sent, and a body that has been
  // parsed and reserialized cannot be verified. It authenticates by signature
  // rather than by session, so it sits outside the `gated` block below too.
  app.use('/api/billing/webhook', buildStripeWebhookRouter(store));

  app.use(express.json({ limit: '1mb' }));

  // Keyed per session where there is one, per IP subnet otherwise. The default
  // key is `req.ip`, which behind App Platform's proxy is the proxy for every
  // caller until TRUST_PROXY_HOPS is set, collapsing the whole app into one
  // bucket; see globalRateLimitKey for why the signed cookie is the right thing
  // to key on this early in the chain.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: globalRateLimitKey,
    }),
  );

  // Health check (Step 6d). Touches Postgres rather than answering `ok`
  // unconditionally: the app cannot serve a single authenticated request
  // without it, so a check that does not reach it reports healthy through the
  // one outage that matters.
  //
  // The tradeoff is deliberate. App Platform restarts an instance that fails
  // this, and restarting does not fix a database that is genuinely down — the
  // pool reconnects on its own without help. What a restart does fix is the
  // case this is really aimed at, a pool left permanently broken while the
  // database is fine. The spec's `failure_threshold: 3` at a 30s period means
  // 90 seconds of sustained failure before that happens, which is long enough
  // that a brief blip does not cycle the instance.
  //
  // The timeout matters as much as the query: without it a hung connection
  // hangs the health check instead of failing it, and a check that never
  // answers is indistinguishable from one that answers slowly.
  // It also carries the build stamp (`startedAt`), so "did the deploy land?" is
  // one curl rather than a trip through CI history and the DigitalOcean API: a
  // process that started before you pushed is not running your code. See
  // config/buildInfo.ts for why that is safe to serve publicly, and for why the
  // commit hash is not here. The DigitalOcean Uptime check keys on the status
  // code, so adding fields here does not affect it.
  app.get('/api/health', (_req, res) => {
    void (async () => {
      try {
        const probe = getPool().query('SELECT 1');
        await Promise.race([
          probe,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('health check timed out')), 3_000).unref(),
          ),
        ]);
        res.json({ status: 'ok', ...BUILD_INFO });
      } catch (err) {
        // Logged, but never returned: an error response is public and this one
        // would carry connection details.
        logger.error({ err: (err as Error).message }, 'Health check failed');
        // The build stamp rides the degraded response too. "Which run of the
        // app is failing" is exactly the question during an incident, and it is
        // the one moment the console is least pleasant to go and ask.
        res.status(503).json({ status: 'degraded', ...BUILD_INFO });
      }
    })();
  });

  // Auth owns its own session handling (it is where sessions are created and
  // destroyed). Every other router mounts behind the session gate, then the
  // CSRF check, so no tool endpoint can be reached anonymously or cross-site.
  app.use('/api/auth', buildAuthRouter(store, sessions));

  // The landing page's contact form (Step 5). Mounted outside `gated` on
  // purpose and namespaced under /public so that "unauthenticated" is visible
  // in the path rather than inferred from the mount order: a teacher whose
  // board has blocked the OAuth app cannot sign in, and they are exactly who
  // this route is for. It is the only unauthenticated write in the app; the
  // router's own comment carries what that costs and how it is paid for.
  app.use('/api/public/support', buildPublicSupportRouter());

  // The board-admin page's source of truth (Step 5a). Read-only, no session, no
  // user data — the OAuth client id and scope list an admin needs to allowlist
  // the app, served from the same config the sign-in flow uses so the page
  // cannot drift from what Google is actually asked for.
  app.use('/api/public/app-info', buildPublicInfoRouter());

  // Session, then CSRF, then consent — in that order, because each answers a
  // question the next one assumes: who is this, is the request genuine, and have
  // they agreed to the terms yet (Step 5c). Consent is last so a cross-site
  // forgery is still reported as CSRF rather than as a consent prompt.
  const gated = [requireSession(sessions), requireCsrf, requireConsent(store)];
  // Tool routers additionally refuse *writes* while a class archive is running
  // for that account (Step 6e). The archive rewrites whole tabs, so a write
  // landing mid-rewrite is read by nobody and then overwritten — silent loss in
  // the one operation where it matters most. Reads are unaffected; the classes
  // router itself is excluded, since it is what takes the lock.
  const gatedTool = [...gated, rejectWhileLocked];
  app.use('/api/bootstrap', gatedTool, buildBootstrapRouter(store));
  app.use('/api/students', gatedTool, buildStudentsRouter(store));
  app.use('/api/attendance', gatedTool, buildAttendanceRouter(store));
  app.use('/api/email', gatedTool, buildEmailRouter(store));
  app.use('/api/grouping', gatedTool, buildGroupingRouter(store));
  app.use('/api/settings', gatedTool, buildSettingsRouter(store));
  app.use('/api/internal', gated, buildInternalRouter(store));
  app.use('/api/support', gatedTool, buildSupportRouter(store));
  app.use('/api/classes', gated, buildClassesRouter(store));
  // Checkout and portal are session-gated like any other tool route; only the
  // webhook above is not.
  app.use('/api/billing', gated, buildBillingRouter(store));

  app.use(errorHandler);
  return app;
}

if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('index.ts') === false) {
  // ts-node ESM loader runs this file with index.ts in argv[1]; we start the server below in both cases.
}

const startServer = process.env.VITEST !== 'true';
if (startServer) {
  // Before everything, and deliberately not inside the try below: a deployment
  // that looks public while NODE_ENV says otherwise must not start at all, where
  // the missing-variable check below is allowed to warn and carry on.
  try {
    assertEnvironmentIsCoherent();
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Refusing to start');
    process.exit(1);
  }
  try {
    assertProductionConfig();
  } catch (e) {
    // Fatal in production, a warning everywhere else. The warning exists so a
    // half-configured laptop can still boot and be inspected, which is a real
    // convenience while developing and an outright hazard in production: the
    // variables this checks are the session secret, the OAuth credentials and
    // the token key, so a production process that starts without them serves
    // real teachers in a state where sign-in cannot work and the failure shows
    // up as a broken deployment rather than as the missing variable it is.
    // App Platform surfaces a refusal to boot immediately; it does not surface
    // a warning in a log nobody is reading.
    if (env.nodeEnv === 'production') {
      logger.error({ err: (e as Error).message }, 'Refusing to start');
      process.exit(1);
    }
    logger.warn(
      { err: (e as Error).message },
      'Required env vars missing. Server will start but auth will fail until configured.',
    );
  }
  void (async () => {
    // Before buildApp, not after: every route builder defaults to an account
    // store, and the store captures the cipher at construction. Resolving the
    // key afterwards would leave the routes holding the development cipher.
    // Unlike the env-var check above this is fatal, because a KMS failure means
    // no refresh token in the database can be read.
    try {
      await initTokenCipher();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        'Could not resolve the token encryption key',
      );
      process.exit(1);
    }
    const app = buildApp();
    await runMigrations(getPool())
    .then(() => {
      app.listen(env.port, () => {
        logger.info(`Server is running on port ${env.port}`);
      });
      // Expired sessions are already rejected on read; this only keeps the
      // table from growing without bound.
      const sessions = createPgSessionStore();
      const sweep = () => {
        sessions
          .deleteExpired()
          .catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'Session sweep failed'),
          );
      };
      sweep();
      setInterval(sweep, 60 * 60 * 1000).unref();

      // Usage-counter retention (Step 6j). Unlike the session sweep above, this
      // one is not housekeeping: the privacy policy states that these counts are
      // kept for 24 months and then deleted, so the sweep not running is the
      // policy being untrue rather than a table growing. It shares the hourly
      // interval because the window is measured in months and the exact hour a
      // month's counters fall out of it does not matter.
      const usage = createPgUsageStore();
      const usageSweep = () => {
        usage
          .prune()
          .then((removed) => {
            if (removed > 0) logger.info({ removed }, 'Usage counters pruned');
          })
          .catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'Usage counter sweep failed'),
          );
      };
      usageSweep();
      setInterval(usageSweep, 60 * 60 * 1000).unref();

      // Support-request retention (Step 6d), and the same kind of obligation as
      // the usage sweep above rather than the session one: the privacy policy
      // states that a resolved request is kept for up to 24 months, so this
      // sweep not running makes that sentence false. Hourly for the same
      // reason — the window is months, so the hour it fires does not matter.
      const support = createPgSupportStore();
      const supportSweep = () => {
        support
          .prune()
          .then((removed) => {
            if (removed > 0) logger.info({ removed }, 'Resolved support requests pruned');
          })
          .catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'Support retention sweep failed'),
          );
      };
      supportSweep();
      setInterval(supportSweep, 60 * 60 * 1000).unref();

      // Lifecycle-message rows of deleted accounts, the same kind of obligation:
      // each holds the teacher's name and email, and the privacy policy says
      // account information is gone within 30 days of closure.
      const lifecycleRows = createPgLifecycleEmailStore();
      const lifecycleSweep = () => {
        lifecycleRows
          .pruneOrphaned()
          .then((removed) => {
            if (removed > 0) logger.info({ removed }, 'Lifecycle rows of deleted accounts pruned');
          })
          .catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'Lifecycle retention sweep failed'),
          );
      };
      lifecycleSweep();
      setInterval(lifecycleSweep, 60 * 60 * 1000).unref();

      // The read-side working set (Step 6a). Purely a memory measure: an expired
      // entry is never served regardless, because every read checks both clocks.
      // Without the sweep, a teacher who stops working leaves their data
      // resident until something reads the key again — which, for someone who
      // has gone home, is never.
      setInterval(() => {
        const removed = sweepCache();
        if (removed > 0) logger.debug({ removed }, 'Working set swept');
      }, SWEEP_INTERVAL_MS).unref();

      // Lifecycle email (Step 6h), beside the session sweep for the same
      // reason: these messages have no request behind them. The trial-ending
      // notice fires five days before a date, when nobody is signed in.
      //
      // A null mailer means production with no provider configured, which is a
      // refusal rather than a fallback — see createMailer. Nothing is marked
      // sent in that state, so the queue simply waits for a deploy that has a
      // key, and no teacher's trial expires with the warning discarded.
      const mailer = createMailer();

      // Operator alerting (Step 6d) shares the lifecycle sender rather than
      // owning one: it is the same provider, the same domain and the same
      // decision about who we send mail through.
      initOperatorAlerts(mailer);

      // Errors that never reach the Express handler because no request was in
      // flight — a failing sweep, a socket error, a bug in a callback. These are
      // the ones most likely to go unnoticed, since nobody is watching a
      // response for them.
      //
      // Neither handler exits the process. An unhandled rejection is usually a
      // single broken path rather than a corrupt process, and taking a
      // single-instance app down would turn one teacher's failed request into
      // everyone's outage.
      process.on('unhandledRejection', (reason: unknown) => {
        logger.error({ err: (reason as Error)?.message }, 'Unhandled rejection');
        reportServerError({
          method: 'PROCESS',
          route: 'unhandledRejection',
          status: 500,
          errorClass: (reason as Error)?.constructor?.name ?? typeof reason,
          origin: topFrame(reason),
        });
      });
      process.on('uncaughtException', (err: Error) => {
        logger.error({ err: err.message }, 'Uncaught exception');
        reportServerError({
          method: 'PROCESS',
          route: 'uncaughtException',
          status: 500,
          errorClass: err.constructor?.name ?? 'Error',
          origin: topFrame(err),
        });
      });

      if (mailer) {
        const mailSweep = () => {
          dispatchLifecycleEmails(mailer).catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'Lifecycle email sweep failed'),
          );
        };
        mailSweep();
        setInterval(mailSweep, LIFECYCLE_SWEEP_INTERVAL_MS).unref();
      }

      // A Stripe Price's amount can be edited in the dashboard without its id
      // changing, so nothing else would notice the app advertising one number
      // while Stripe charges another. Logs a loud error rather than refusing to
      // boot: a pricing discrepancy should not take the app down for the
      // teachers who are not buying anything.
      // Subscription reconciliation (Step 7), beside the other sweeps and for a
      // reason none of them share: this one exists because a *push* can fail.
      // Stripe retries a webhook for about three days and then stops, and paid
      // entitlement is resolved from the mirrored status alone, so an event we
      // never receive is permanent in both directions — an account left paid
      // after cancelling, or a paying teacher the app thinks has no
      // subscription and so will not let cancel or pause.
      //
      // It uses the webhook's own mapper and writer, so it is not a second
      // opinion about what a subscription means. It is the same conclusion,
      // reached by asking instead of waiting.
      if (isBillingConfigured()) {
        const reconcileSweep = () => {
          reconcileSubscriptions()
            .then((r) => {
              if (r.corrected > 0 || r.failed > 0) {
                logger.info({ ...r }, 'Subscription reconciliation');
              }
            })
            .catch((err: unknown) =>
              logger.warn(
                { err: (err as Error).message },
                'Subscription reconciliation sweep failed',
              ),
            );
        };
        reconcileSweep();
        setInterval(reconcileSweep, RECONCILE_INTERVAL_MS).unref();
      }

      if (isBillingConfigured()) {
        void assertPricesMatch();
      } else {
        logger.warn('Stripe is not configured; billing endpoints will refuse requests.');
      }
    })
    .catch((err) => {
      logger.error({ err: (err as Error).message }, 'Database migration failed at startup');
      process.exit(1);
    });
  })();
}
