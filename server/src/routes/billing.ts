import { Router, raw } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import Stripe from 'stripe';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sessionOf } from '../middleware/session.js';
import { loadAccount } from '../middleware/entitlements.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import {
  addMonths,
  createCheckoutSession,
  createPortalSession,
  ensureCustomer,
  fetchSubscription,
  handleStripeEvent,
  hasLiveSubscription,
  isOnInterval,
  pauseCollection,
  promoIsActive,
  stripeClient,
} from '../services/billing.js';
import {
  isBillingConfigured,
  PAUSE_COOLDOWN_MONTHS,
  PAUSE_DEFAULT_MONTHS,
  PAUSE_ELIGIBLE_INTERVAL,
  PAUSE_MAX_MONTHS,
  PAUSE_MIN_MONTHS,
} from '../config/billing.js';
import {
  createPgLifecycleEmailStore,
  type LifecycleEmailStore,
} from '../services/lifecycleEmail.js';
// The same date format the lifecycle emails use, so a date a teacher reads in a
// refusal and a date they read in a message are not written two ways.
import { formatMessageDate } from '../services/lifecycleTemplates.js';
import { ApiError } from '../utils/errors.js';

const checkoutSchema = z
  .object({ interval: z.enum(['monthly', 'annual']) })
  .strict();

/**
 * Which portal page to open on. Omitted for the ordinary "Manage billing"
 * errand; `cancel` deep-links into the portal's cancellation flow, which is
 * what makes the account page's two billing buttons lead to different places.
 */
const portalSchema = z.object({ flow: z.enum(['cancel']).optional() }).strict();

/**
 * The pause request. `months` is optional and defaults to two, so the dialog's
 * default and the endpoint's default are one value rather than two that can
 * drift. The bounds are enforced here as well as offered in the UI because this
 * endpoint is reachable directly, and an unbounded pause is a free
 * subscription.
 */
const pauseSchema = z
  .object({
    months: z.number().int().min(PAUSE_MIN_MONTHS).max(PAUSE_MAX_MONTHS).optional(),
  })
  .strict();

/** Where Stripe sends the teacher back to. Same-origin by construction. */
function returnUrls() {
  const base = env.clientOrigin.replace(/\/$/, '');
  return {
    success: `${base}/?billing=success`,
    cancel: `${base}/?billing=cancelled`,
    portal: `${base}/`,
  };
}

/**
 * Billing endpoints that require an authenticated teacher. The webhook is
 * **not** here — it is mounted separately in index.ts, because it is
 * authenticated by Stripe's signature rather than by a session and needs the
 * raw request body. See {@link buildStripeWebhookRouter}.
 */
export function buildBillingRouter(
  store: AccountStore = createPgAccountStore(),
  emails: LifecycleEmailStore = createPgLifecycleEmailStore(),
): Router {
  const router = Router();

  /**
   * Starts checkout. Returns a URL for the client to send the browser to; the
   * card is entered on Stripe's page, never here.
   *
   * Note what this does *not* do: it never writes plan or subscription state.
   * A teacher who completes checkout becomes `paid` when the webhook says so,
   * not when they land back on the success URL — which they can reach by typing
   * it.
   */
  router.post('/checkout', async (req, res, next) => {
    try {
      // Validation first, configuration second: a malformed request is
      // malformed whether or not Stripe is set up, and checking config first
      // would make the response depend on the environment rather than the input.
      const { interval } = checkoutSchema.parse(req.body);
      if (!isBillingConfigured()) {
        throw new ApiError('INTERNAL_ERROR', 'Billing is not configured.');
      }
      const account = await loadAccount(req, store);
      const customerId = await ensureCustomer(store, account);
      const urls = returnUrls();
      const url = await createCheckoutSession(customerId, interval, urls);
      if (!url) throw new ApiError('INTERNAL_ERROR', 'Could not start checkout.');
      res.json({ url });
    } catch (e) {
      next(e);
    }
  });

  /**
   * A billing-portal session: cancellation, card updates, invoices, receipts.
   * Chosen over an in-app flow because each of those would otherwise need
   * building, and Stripe already hosts all of them.
   */
  router.post('/portal', async (req, res, next) => {
    try {
      const { flow } = portalSchema.parse(req.body ?? {});
      const account = await loadAccount(req, store);
      if (!account.stripeCustomerId) {
        // Nothing to manage: this account has never checked out. Checked before
        // the configuration guard because it is a fact about the account, not
        // about the environment.
        throw new ApiError('NOT_FOUND', 'No billing account exists yet.');
      }
      if (!isBillingConfigured()) {
        throw new ApiError('INTERNAL_ERROR', 'Billing is not configured.');
      }
      // The cancellation entry point asks for the portal's cancel flow. Falls
      // back to the portal home unless there is a **live** subscription to
      // point it at, which is a stricter test than a non-null id: the id is
      // never cleared, so every account that has ever cancelled still carries
      // one, and handing a terminated subscription to `flow_data` makes Stripe
      // reject the whole request. That failure reaches the teacher as "Billing
      // could not be opened", on a portal that would have opened perfectly.
      const url = await createPortalSession(
        account.stripeCustomerId,
        returnUrls().portal,
        flow === 'cancel' && hasLiveSubscription(account)
          ? (account.stripeSubscriptionId ?? undefined)
          : undefined,
      );
      res.json({ url });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Pauses billing for one to three months (Step 6i).
   *
   * Offered inside the in-app cancellation flow and nowhere else — not on the
   * pricing page — and that is a pricing decision rather than a layout one. At
   * list prices a monthly subscriber who pauses for two months pays exactly the
   * annual price, so advertising the pause tells every visitor that annual has
   * no advantage. Told only to the teacher already leaving, it is a reason to
   * stay; told to everyone, it is a discount.
   *
   * Every refusal below is a 409 rather than a 400: each describes an account
   * that is in the wrong state for this, not a request that was malformed.
   */
  router.post('/pause', async (req, res, next) => {
    try {
      const { months = PAUSE_DEFAULT_MONTHS } = pauseSchema.parse(req.body);
      const account = await loadAccount(req, store);
      if (!account.stripeSubscriptionId) {
        throw new ApiError('NOT_FOUND', 'No subscription to pause.');
      }
      if (!isBillingConfigured()) {
        throw new ApiError('INTERNAL_ERROR', 'Billing is not configured.');
      }
      if (account.collectionPaused) {
        throw new ApiError('CONFLICT', 'This subscription is already paused.');
      }

      const now = new Date();
      // Refused while a promo covers the subscription, and the refusal saves the
      // teacher from a bad trade rather than merely tidying the dialog: the
      // discount expires on calendar months rather than on invoices, so pausing
      // does not defer it. They would spend two free months and their
      // once-a-year pause allowance to stop being charged an amount that is
      // already zero. The message names the date so the answer is actionable.
      if (account.promoEndsAt && promoIsActive(account, now)) {
        throw new ApiError(
          'CONFLICT',
          `Your subscription is already free until ${formatMessageDate(account.promoEndsAt)}, so there is nothing to pause.`,
        );
      }
      // Checked against our own pause_started_at, which outlives the pause it
      // records — Stripe clears pause_collection on resume, so the rule cannot
      // be read from Stripe's state.
      if (
        account.pauseStartedAt &&
        new Date(account.pauseStartedAt) > addMonths(now, -PAUSE_COOLDOWN_MONTHS)
      ) {
        throw new ApiError(
          'CONFLICT',
          `A subscription can be paused once every ${PAUSE_COOLDOWN_MONTHS} months.`,
        );
      }

      const sub = await fetchSubscription(account.stripeSubscriptionId);
      if (!isOnInterval(sub, PAUSE_ELIGIBLE_INTERVAL)) {
        // An annual subscriber's September renewal already falls outside the
        // summer, which is that plan's whole advantage; they cancel to period
        // end as before.
        throw new ApiError('CONFLICT', 'Only monthly subscriptions can be paused.');
      }

      const resumesAt = addMonths(now, months);
      await pauseCollection(account.stripeSubscriptionId, resumesAt);
      await store.markPauseStarted(account.googleSub, now.toISOString());
      // The reminder is queued per (account, type) and unique for the life of
      // the account, so a second pause a year later would be silently skipped
      // by the row left from the first. Clearing it here is what lets the scan
      // queue a fresh one.
      await emails.clearMessage(account.id, 'pause_resuming');

      // The plan is deliberately not returned: the webhook is the sole writer
      // of subscription state, so the account is not paused until Stripe says
      // so. The client refetches rather than being told.
      res.json({ resumesAt: resumesAt.toISOString(), months });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/**
 * The Stripe webhook, mounted on its own so it can bypass `express.json()`.
 *
 * Two constraints make this route unlike every other one in the app:
 *
 * 1. **Raw body.** Signature verification hashes the exact bytes Stripe sent, so
 *    a parsed-and-reserialized body cannot be verified. `express.raw()` here and
 *    a mount ahead of the global JSON parser are both required.
 * 2. **No session, no CSRF.** Stripe is not a browser and carries no cookie. The
 *    signature *is* the authentication, which is why an unverifiable request
 *    must be rejected before its contents are looked at — this endpoint is
 *    publicly reachable, and without the check anyone could declare an account
 *    paid.
 */
export function buildStripeWebhookRouter(
  store: AccountStore = createPgAccountStore(),
): Router {
  const router = Router();

  /**
   * The one limiter the global one does not cover, because this router is
   * mounted ahead of it so the raw body survives.
   *
   * What it bounds is the cost of a *rejected* request. Verification is an HMAC
   * over the body, so an unauthenticated caller can make the server hash up to
   * 100kB per request for as long as they care to, and nothing else on this
   * route stands between them and that. The limit is deliberately far above any
   * real traffic: the app subscribes to three subscription events, one account's
   * whole billing lifetime produces a handful, and Stripe's own retries are
   * spread over hours. A number this generous will not throttle a legitimate
   * burst, and still turns an unmetered flood into a metered one.
   *
   * Keyed on the caller's IP subnet, which behind the platform's proxy means
   * every caller shares one bucket until `TRUST_PROXY_HOPS` is set; that makes
   * the limit coarser than it looks and is another reason not to set it low.
   * Stripe publishes its sending addresses, but pinning to them would fail
   * closed on a list change, and the signature is what authenticates anyway.
   */
  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') ?? 'anon',
    handler: (_req, res) => {
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests.' });
    },
  });

  router.post('/', webhookLimiter, raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!env.stripe.webhookSecret || typeof signature !== 'string') {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing signature.' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.stripe.webhookSecret,
      );
    } catch (err) {
      // Never log the body or the signature — an unverified payload is
      // attacker-controlled, and logging it would be the injection surface.
      logger.warn({ err: (err as Error).message }, 'Rejected a Stripe webhook: bad signature');
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid signature.' });
      return;
    }

    try {
      const result = await handleStripeEvent(event, store);
      logger.info({ eventType: event.type, outcome: result.outcome }, 'Stripe webhook handled');
      res.json({ received: true });
    } catch (err) {
      // A 500 tells Stripe to retry, which is what we want for a transient
      // database failure: the event is not lost, it arrives again.
      logger.error(
        { eventType: event.type, err: (err as Error).message },
        'Stripe webhook handling failed; Stripe will retry',
      );
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Handler failed.' });
    }
  });

  return router;
}
