import { Router } from 'express';
import { env } from '../config/env.js';
import { GOOGLE_SCOPES } from '../services/googleAuth.js';

/**
 * The facts a school board's Workspace admin needs in order to allowlist this
 * app (Phase 2 Step 5a), served to the public `/for-admins` page.
 *
 * Why an endpoint at all, for two values that never change at runtime: both are
 * configuration, and the page's entire purpose is to be correct. A client-side
 * copy of the OAuth client id is a second place for it to live, and the failure
 * mode of the two disagreeing is an admin pasting an id that allowlists nothing
 * and a teacher still locked out — a bug that would surface as a support ticket
 * from someone who cannot sign in to file one. The scope list is served from
 * `GOOGLE_SCOPES` for the same reason: the page tells an admin exactly what the
 * app will ask for, so it has to be the same array the authorization URL is
 * built from, not a transcription of it.
 *
 * Nothing here is secret. The OAuth client id is public by construction — it
 * appears in the query string of every consent redirect — and the scopes appear
 * on the consent screen itself. There is no account, no session and no read of
 * any user's data, which is why this sits outside the session gate.
 */
export function buildPublicInfoRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      appName: 'Teachneat',
      // Empty when the server is unconfigured. The page renders a plain "ask us
      // for it" line rather than an empty code block, so a misconfigured
      // deployment cannot show an admin a blank field to paste.
      oauthClientId: env.google.clientId,
      scopes: GOOGLE_SCOPES,
    });
  });

  return router;
}
