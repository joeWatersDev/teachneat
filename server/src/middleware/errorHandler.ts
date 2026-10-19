import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { isReauthRequiredError } from '../services/googleAuth.js';
import { isQuotaError } from '../utils/googleErrors.js';
import { reportServerError, routeLabel, topFrame } from '../services/operatorAlerts.js';

/**
 * Mails the operator (Step 6d). Only the two 5xx branches below call it: a 4xx
 * is the client being told no, which is ordinary and not worth waking anyone
 * for, and a 429 from Google is transient by definition.
 *
 * Everything passed is derived rather than copied — the router's mount path,
 * the status, the error's class, the top stack frame. Nothing from the body,
 * the query, the params or the session goes anywhere near it.
 */
function alert(req: Request, status: number, err: unknown): void {
  reportServerError({
    method: req.method,
    route: routeLabel(req.baseUrl, req.path),
    status,
    errorClass: (err as Error)?.constructor?.name ?? typeof err,
    origin: topFrame(err),
  });
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      fieldErrors[issue.path.join('.') || '_'] = issue.message;
    }
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      fieldErrors,
    });
    return;
  }

  if (isApiError(err)) {
    res.status(err.status).json({ code: err.code, message: err.message, ...(err.details ?? {}) });
    return;
  }

  if (isReauthRequiredError(err)) {
    res.status(401).json({
      code: 'REAUTH_REQUIRED',
      message: 'Your Google session has expired. Please sign in again.',
    });
    return;
  }

  // Google API quota / rate-limit exhaustion (RESOURCE_EXHAUSTED / HTTP 429).
  // Surface a clean, retryable 429 instead of an opaque 500 so the client can
  // back off and retry rather than spinning. Logged at warn (transient, no PII).
  if (isQuotaError(err)) {
    logger.warn({ path: req.path }, 'Google API quota exhausted');
    res.setHeader('Retry-After', '5');
    res.status(429).json({
      code: 'SHEET_RATE_LIMITED',
      message: 'Google is briefly rate-limiting requests. Please wait a moment and try again.',
    });
    return;
  }

  const e = err as { code?: number | string; status?: number; message?: string };
  if (typeof e?.code === 'number' || typeof e?.status === 'number') {
    const status = (typeof e.code === 'number' ? e.code : e.status) ?? 503;
    if (status >= 500) {
      logger.error({ status, path: req.path }, 'Upstream error');
      alert(req, 503, err);
      res.status(503).json({
        code: 'SHEET_UNAVAILABLE',
        message: 'A required Google service is currently unavailable. Please try again.',
      });
      return;
    }
  }

  logger.error({ err: (err as Error)?.message, path: req.path }, 'Unhandled error');
  alert(req, 500, err);
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
};
