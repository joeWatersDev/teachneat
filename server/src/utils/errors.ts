export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PREMIUM_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'DAILY_EMAIL_CAP'
  | 'MONTHLY_EMAIL_CAP'
  | 'EMAIL_RATE_LIMIT'
  | 'RATE_LIMITED'
  | 'SHEET_RATE_LIMITED'
  | 'SHEET_HEADER_MISMATCH'
  | 'SHEET_UNAVAILABLE'
  | 'GMAIL_UNAVAILABLE'
  | 'REAUTH_REQUIRED'
  | 'INTERNAL_ERROR';

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  REAUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  PREMIUM_REQUIRED: 403,
  CONSENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DAILY_EMAIL_CAP: 429,
  MONTHLY_EMAIL_CAP: 429,
  EMAIL_RATE_LIMIT: 429,
  RATE_LIMITED: 429,
  SHEET_RATE_LIMITED: 429,
  SHEET_HEADER_MISMATCH: 500,
  SHEET_UNAVAILABLE: 503,
  GMAIL_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
    this.name = 'ApiError';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
