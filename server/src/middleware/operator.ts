import type { RequestHandler } from 'express';
import { isSupportAdmin } from '../config/env.js';
import { sessionOf } from './session.js';
import { ApiError } from '../utils/errors.js';

/**
 * The operator gate: one allowlist (`SUPPORT_ADMIN_GOOGLE_SUBS`) for every
 * endpoint that exists for whoever runs the service rather than for a teacher.
 *
 * It answers **404, not 403**, for the same reason the development plan toggle
 * does: a 403 confirms the endpoint exists to anyone probing for it, and to
 * everyone who is not an operator the honest answer is that it does not. An
 * empty allowlist therefore grants nobody anything, which is also the default.
 *
 * Unlike `devToolsEnabledFor`, this has no `NODE_ENV` half. That is deliberate
 * and is the whole distinction between the two guards: a live entitlement
 * toggle has no business existing in production, while reading the support
 * queue or the Google API call counters is exactly a production task. The
 * allowlist is the entire guard, so it has to be the whole guard on purpose.
 */
export const requireOperator: RequestHandler = (req, _res, next) => {
  if (!isSupportAdmin(sessionOf(req).googleSub)) {
    next(new ApiError('NOT_FOUND', 'Not found.'));
    return;
  }
  next();
};
