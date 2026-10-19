/** Google's machine-readable codes are short identifiers; anything else is not one. */
const CODE_TOKEN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function codeToken(value: unknown): string | undefined {
  return typeof value === 'string' && CODE_TOKEN.test(value) ? value : undefined;
}

export interface GoogleErrorSummary {
  /** HTTP status, when the client surfaced one. */
  status?: number;
  /** The first `errors[].reason`, e.g. `insufficientPermissions`, `invalidArgument`. */
  reason?: string;
  /** The `error.status` enum, e.g. `PERMISSION_DENIED`, or an OAuth error such as `invalid_grant`. */
  googleStatus?: string;
}

/**
 * The parts of a Google API error that are safe to log: the HTTP status and
 * Google's enum-style codes, and never the message text.
 *
 * The message is left out because it is where Google quotes the request back. A
 * refused Gmail send can name the recipient address, and a Sheets error can quote
 * a cell, so logging `err.message` from these calls would put student data in the
 * logs. Every string field is also checked against a plain identifier pattern
 * before it is kept, so a field that turns out to carry free text is dropped
 * rather than trusted.
 */
export function summarizeGoogleError(err: unknown): GoogleErrorSummary {
  const e = err as {
    code?: number | string;
    status?: number;
    errors?: Array<{ reason?: string }>;
    response?: {
      status?: number;
      data?: { error?: string | { status?: string; errors?: Array<{ reason?: string }> } };
    };
  };
  const summary: GoogleErrorSummary = {};
  const status = typeof e?.code === 'number' ? e.code : (e?.status ?? e?.response?.status);
  if (typeof status === 'number') summary.status = status;
  const dataError = e?.response?.data?.error;
  const reason = codeToken(
    e?.errors?.[0]?.reason ?? (typeof dataError === 'object' ? dataError?.errors?.[0]?.reason : undefined),
  );
  if (reason) summary.reason = reason;
  const googleStatus = codeToken(typeof dataError === 'object' ? dataError?.status : dataError);
  if (googleStatus) summary.googleStatus = googleStatus;
  return summary;
}

/**
 * Detects a Google API quota / rate-limit error across the shapes the client
 * surfaces it in: a numeric 429 status, a `reason` of *RateLimitExceeded /
 * quotaExceeded, or the RESOURCE_EXHAUSTED message text. Kept deliberately broad
 * because the googleapis client does not expose a single stable field for it.
 *
 * Shared by the error handler (to map upstream 429s to SHEET_RATE_LIMITED) and
 * the API-call metrics recorder (to tag a call's result as `429`).
 */
export function isQuotaError(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string }>;
    response?: { status?: number; data?: { error?: { status?: string; message?: string } } };
  };
  const numericStatus =
    typeof e?.code === 'number' ? e.code : (e?.status ?? e?.response?.status);
  if (numericStatus === 429) return true;
  const reasons = (e?.errors ?? []).map((x) => x?.reason ?? '').join(' ');
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reasons)) return true;
  const text = [
    e?.message,
    e?.response?.data?.error?.message,
    e?.response?.data?.error?.status,
  ]
    .filter(Boolean)
    .join(' ');
  return /resource has been exhausted|RESOURCE_EXHAUSTED|rate limit|quota/i.test(text);
}
