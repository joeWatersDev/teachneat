import { Router } from 'express';
import { z } from 'zod';
import { snapshotMetrics } from '../services/apiMetrics.js';
import { dispatchLifecycleEmails } from '../services/lifecycleEmail.js';
import { createMailer } from '../services/mailer.js';
import { snapshotCacheStats } from '../services/cache.js';
import { billingEnabled, devToolsEnabledFor, env } from '../config/env.js';
import { sessionOf } from '../middleware/session.js';
import { requireOperator } from '../middleware/operator.js';
import { loadAccount } from '../middleware/entitlements.js';
import {
  createPgAccountStore,
  type AccountStore,
  type PlanOverride,
} from '../services/accountStore.js';
import { resolvePlan, type Plan } from '../services/plan.js';
import { ApiError } from '../utils/errors.js';

/**
 * no override → free → trial → paid → no override …
 *
 * Four positions. Three forced states, because a premium control on `trial` is
 * simultaneously live and badged — the only state with that combination, and so
 * the one most likely to be built wrong — plus a cleared position, without which
 * the first use of this endpoint would pin the account permanently and silently
 * mask a real Stripe subscription, `plan_override` outranking subscription state
 * by design.
 *
 * **The cycle steps on the override, not on the resolved plan.** Stepping on the
 * resolved plan looks equivalent and is not: an account with an unexpired trial
 * *and* an active subscription resolves to `trial` the moment the override
 * clears, whose successor is `paid`, whose successor is clear again — an
 * inescapable two-state loop that never reaches `free`, with the cleared
 * position indistinguishable from a forced `trial`. Exactly the state a
 * developer testing billing ends up in. Stepping on the stored value visits all
 * four positions regardless of what the account's real plan happens to be.
 */
const OVERRIDE_CYCLE: readonly (PlanOverride | null)[] = [null, 'free', 'trial', 'paid'];

function nextOverride(current: PlanOverride | null): PlanOverride | null {
  const i = OVERRIDE_CYCLE.indexOf(current);
  // An unrecognised stored value restarts the cycle rather than getting stuck.
  return OVERRIDE_CYCLE[(i + 1) % OVERRIDE_CYCLE.length] ?? null;
}

/**
 * Internal, operator-facing endpoints. Not part of the public API contract and
 * not consumed by the client UI. Every router mounts behind an authenticated
 * session, and each endpoint here adds its own guard on top of that: the
 * metrics read takes the operator allowlist, the plan toggle takes the
 * development-only pair (allowlist *and* non-production). Neither is reachable
 * by an ordinary signed-in teacher.
 */
export function buildInternalRouter(store: AccountStore = createPgAccountStore()): Router {
  const router = Router();

  /**
   * Rolling per-minute count of outbound Google API calls, by method and result.
   * The gauge for how close aggregate load is to the shared Sheets quota
   * ceiling.
   *
   * Operator-gated. It carries no student PII, but it is service telemetry
   * written for whoever runs the app, not for a teacher, and until this guard
   * went on it was readable by any signed-in account in production — which also
   * made this file's "not reachable in production" framing untrue of one of its
   * two endpoints. The allowlist has no environment half, deliberately: reading
   * the counters is a production task, unlike the toggle below.
   */
  router.get('/metrics', requireOperator, (_req, res) => {
    // The working-set counters ride along with the API counters because they
    // answer two halves of one question: how many Sheets reads we are making,
    // and how many we are avoiding. The figure Step 6d acts on is
    // `workingSet.evicted.stale` against `workingSet.hits` — the share of
    // reloads the working set is not absorbing, and so the size of the prize
    // for Drive push invalidation. Counts only; no keys and no user
    // identifiers, so it stays as free of PII as the API counters beside it.
    res.json({ ...snapshotMetrics(), workingSet: snapshotCacheStats() });
  });

  /**
   * What the proxy chain in front of this process actually looks like.
   *
   * `trust proxy` is a hop count and cannot be reasoned out from here: the
   * request passes through DigitalOcean's ingress, and DigitalOcean fronts App
   * Platform with Cloudflare themselves, so the depth is theirs and can change.
   * Guessing it wrong is worse than leaving it: too high, and Express reads
   * `req.ip` out of client-supplied `X-Forwarded-For` text, which hands every
   * caller the ability to choose their own rate-limit bucket. So it is measured,
   * and this is what measures it.
   *
   * Kept afterwards rather than deleted, because the question comes back. It is
   * the first thing to look at when a limiter is refusing the wrong people, and
   * it is how to notice that a platform change moved the chain.
   *
   * Operator-gated, and it reports only the caller's own request: the addresses
   * are the operator's own network path, and nothing here reads any account.
   * `remoteAddress` is the socket peer, `forwardedFor` the raw header, `ips` the
   * chain as Express parses it under the current setting, and `ip` the address
   * every rate limiter would key on. Setting `TRUST_PROXY_HOPS` so that `ip`
   * equals the address the request was genuinely made from is the whole task.
   */
  router.get('/forwarding', requireOperator, (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      remoteAddress: req.socket.remoteAddress ?? null,
      trustProxyHops: env.trustProxyHops,
    });
  });

  /**
   * Development-only plan toggle, behind the account menu. It exists because
   * most of the entitlement work is *presentation*, and watching a control
   * change state without leaving the page beats a database script and a reload.
   *
   * It writes `plan_override` and nothing else, so the Stripe-managed
   * subscription fields stay Stripe's alone (Step 3b) and app state can never
   * disagree with billing state. It answers 404 rather than 403 on refusal: a
   * 403 would confirm the endpoint exists to anyone probing, and in production
   * the honest answer is that it does not. `GET /auth/me`'s `devTools` flag is a
   * rendering hint only — the guard is re-checked here on every call.
   */
  router.post('/dev/plan', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      // Step 8a: with billing off there is no plan to toggle and no trial to
      // move, so both toggles answer 404 on the same terms as the allowlist
      // refusal rather than writing state nothing reads.
      if (!billingEnabled() || !devToolsEnabledFor(session.googleSub)) {
        throw new ApiError('NOT_FOUND', 'Not found.');
      }
      const account = await loadAccount(req, store);
      const override = nextOverride(account.planOverride);
      await store.setPlanOverride(session.googleSub, override);
      // Report the plan that now applies, which after clearing is whatever the
      // subscription and trial actually say rather than what was asked for.
      const plan = resolvePlan({ ...account, planOverride: override });
      res.json({ plan, override });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Development-only: moves this account's trial end date (Step 6h).
   *
   * The trial-expiry path is the most valuable thing this step touches and the
   * least observable — proving it otherwise means waiting thirty days, or
   * editing the database by hand and hoping the query was right. `days` is
   * relative and may be negative, so "four days from now" queues the warning
   * and "yesterday" queues the ended notice on the next sweep.
   *
   * Same doubled guard and same 404-on-refusal as the plan toggle above, for
   * the same reason: this writes entitlement-bearing state, and an allowlist
   * that travelled in a copied `.env` would otherwise be the only thing
   * standing between a production deployment and a free trial on demand.
   */
  const trialSchema = z.object({ days: z.number().int().min(-365).max(365) }).strict();

  router.post('/dev/trial', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      // Step 8a: with billing off there is no plan to toggle and no trial to
      // move, so both toggles answer 404 on the same terms as the allowlist
      // refusal rather than writing state nothing reads.
      if (!billingEnabled() || !devToolsEnabledFor(session.googleSub)) {
        throw new ApiError('NOT_FOUND', 'Not found.');
      }
      const parsed = trialSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR', 'days must be a whole number.');
      const endsAt = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();
      await store.setTrialEndsAt(session.googleSub, endsAt);
      const account = await loadAccount(req, store);
      res.json({ trialEndsAt: endsAt, plan: resolvePlan({ ...account, trialEndsAt: endsAt }) });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Development-only: runs the lifecycle email sweep immediately (Step 6h).
   *
   * The sweep runs on a quarter-hour timer, which is right in production and
   * useless when reading a template you have just edited. It returns the pass's
   * counts — queued, sent, failed — and nothing about who was written to.
   *
   * It sends through whatever mailer this deployment has, which outside
   * production is the console driver, so the ordinary use of this endpoint
   * prints the message to the server's terminal rather than delivering it.
   */
  router.post('/dev/lifecycle', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      if (!devToolsEnabledFor(session.googleSub)) {
        throw new ApiError('NOT_FOUND', 'Not found.');
      }
      const mailer = createMailer();
      if (!mailer) throw new ApiError('INTERNAL_ERROR', 'No mailer configured.');
      res.json(await dispatchLifecycleEmails(mailer));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
