import type { Request, RequestHandler } from 'express';
import { ApiError } from '../utils/errors.js';
import type { Account, AccountStore } from '../services/accountStore.js';
import { isPremium, resolveEffectivePlan, type Plan } from '../services/plan.js';
import { sessionOf } from './session.js';
import { billingEnabled } from '../config/env.js';

/**
 * Entitlement gating. Plan state is resolved from the account record on every
 * request and enforced here, on the endpoint — the client's rendering of lock
 * state is presentation and is never the security boundary.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Memoized account load for this request (see loadAccount). */
    accountPromise?: Promise<Account>;
  }
}

/**
 * The authenticated account, loaded at most once per request. Both the
 * entitlement gate and the Sheets context need it, and a gated endpoint would
 * otherwise read the same row from Postgres twice on every call.
 */
export function loadAccount(req: Request, store: AccountStore): Promise<Account> {
  if (!req.accountPromise) {
    const session = sessionOf(req);
    req.accountPromise = store.getByGoogleSub(session.googleSub).then((account) => {
      if (!account) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
      return account;
    });
  }
  return req.accountPromise;
}

/** The account and its resolved plan for this request. */
export async function planOf(
  req: Request,
  store: AccountStore,
): Promise<{ account: Account; plan: Plan }> {
  const account = await loadAccount(req, store);
  return { account, plan: resolveEffectivePlan(account) };
}

/**
 * Rejects a `free` account with 403 PREMIUM_REQUIRED. The message names the
 * feature in plain language and carries no upsell copy — the client decides how
 * to present the upgrade path.
 */
export function requirePremium(store: AccountStore, feature: string): RequestHandler {
  // Step 8a. With billing off every account is entitled, so this is not merely
  // a gate that always passes: it must not run at all. Going through the body
  // below would load the account for a decision with one answer, and would
  // record a premiumAttempt milestone against a wall no teacher can meet,
  // corrupting the one signal that says whether the split is placed right.
  if (!billingEnabled()) return (_req, _res, next) => next();
  return (req, _res, next) => {
    planOf(req, store)
      .then(async ({ plan }) => {
        if (!isPremium(plan)) {
          // The Step 6j premium-attempt milestone, recorded at the one place
          // every premium gate already funnels through rather than at each
          // gated feature. It records that a free account met a wall, which is
          // the signal that says whether the split is placed right.
          //
          // Write-once in the store, so the hot path after the first hit is an
          // UPDATE that matches no row, and swallowed on failure: this request
          // is already ending in a 403, and instrumentation must not be able to
          // turn a refusal the client knows how to render into a 500 it does
          // not.
          await store
            .markMilestone(sessionOf(req).googleSub, 'premiumAttempt')
            .catch(() => undefined);
          next(new ApiError('PREMIUM_REQUIRED', `${feature} is part of Premium.`));
          return;
        }
        next();
      })
      .catch(next);
  };
}
