import { Router } from 'express';
import { authorizedClientForRefreshToken } from '../services/googleAuth.js';
import { buildGoogleClients } from '../services/sheetsClient.js';
import { getBootstrapStatus } from '../services/bootstrap.js';
import { sessionOf } from '../middleware/session.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import { ApiError } from '../utils/errors.js';

export function buildBootstrapRouter(store: AccountStore = createPgAccountStore()): Router {
  const router = Router();

  router.get('/status', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const account = await store.getByGoogleSub(session.googleSub);
      if (!account) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
      const auth = authorizedClientForRefreshToken(account.refreshToken);
      const { sheets } = buildGoogleClients(auth);
      const status = await getBootstrapStatus(sheets, account.spreadsheetId);
      res.json(status);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
