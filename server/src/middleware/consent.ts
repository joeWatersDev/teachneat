import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { consentIsCurrent } from '../config/legal.js';
import { ApiError } from '../utils/errors.js';
import type { AccountStore } from '../services/accountStore.js';
import { sessionOf } from './session.js';

/**
 * Refuses every request from an account that has not accepted the current terms
 * and the data-responsibility acknowledgement (Phase 2 Step 5c).
 *
 * This is a server-side gate rather than a screen the client chooses to show,
 * and that distinction is the whole point. A client-only prompt is defeated by
 * anyone who calls the API directly, which would leave the app reading and
 * writing a teacher's student data on the strength of a checkbox that was never
 * ticked. Mounted next to requireSession on every non-auth router, so the answer
 * does not depend on each handler remembering to ask.
 *
 * What stays reachable while consent is outstanding, and why:
 *
 * - `/api/auth`, because it is where consent is recorded, where the profile that
 *   says consent is needed is read, and where sign-out lives. A teacher who
 *   declines must be able to leave.
 * - the public routers, which have no account behind them at all.
 * - the Stripe webhook, which authenticates by signature and is Stripe telling
 *   us something about an account, not the account acting.
 *
 * Everything else — the five tools, settings, support, checkout — is refused.
 * Support is deliberately included despite being the natural place to ask a
 * question about the terms: the public contact form at `/contact` is reachable
 * without an account, so nobody is left unable to reach us.
 */
export function requireConsent(store: AccountStore): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    let googleSub: string;
    try {
      googleSub = sessionOf(req).googleSub;
    } catch (e) {
      next(e);
      return;
    }
    store
      .getByGoogleSub(googleSub)
      .then((account) => {
        // A live session whose account has since been deleted is not a consent
        // problem; report it as what it is.
        if (!account) {
          next(new ApiError('UNAUTHORIZED', 'Not signed in.'));
          return;
        }
        if (!consentIsCurrent(account)) {
          next(
            new ApiError(
              'CONSENT_REQUIRED',
              'The terms and the data-responsibility acknowledgement must be accepted before the app can be used.',
            ),
          );
          return;
        }
        next();
      })
      .catch(next);
  };
}
