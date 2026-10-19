/**
 * Tiny fetch wrapper that always sends credentials so the session cookie
 * is included, and returns parsed JSON or throws a typed error.
 *
 * State-changing requests also carry the session's CSRF token. The token comes
 * from GET /auth/me, which the auth provider calls on load, so it is in hand
 * before any mutation can be issued; a request rejected as stale refreshes it
 * once and retries, which covers the case where the session was replaced in
 * another tab.
 */

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  status: number;
}

const API_BASE = '/api';

// Google's per-minute Sheets quota can briefly reject a request. Rather than
// let that surface as an error (or an endless spinner), retry a few times with
// short exponential backoff. Bounded so a genuine outage still fails promptly.
//
// The server also retries the individual Google call that was refused, which is
// the better place for it; this remains for the case where a whole request is
// rejected. See `retryOnRateLimit` for the requests that must opt out.
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = [400, 900, 1800];
/** Cap on how long a server-supplied Retry-After may hold a request. */
const MAX_RETRY_AFTER_MS = 5000;

export interface RequestOptions {
  /**
   * Whether a 429 should be retried automatically. Default true.
   *
   * Set false for a request that is expensive at the far end. Re-sending one
   * costs everything it already did before being refused, so retrying it spends
   * more of the exhausted quota on each attempt and makes the next attempt
   * likelier to fail than the last — which is precisely how a rate-limited class
   * archive used to fail four times in a row instead of once.
   */
  retryOnRateLimit?: boolean;
}

/** The server's Retry-After in ms, capped, or null when it did not set one. */
function retryAfterMs(res: Response): number | null {
  const seconds = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * Notified whenever the server rejects a request as unauthenticated. Without
 * this, each tool discovers a dead session independently and renders it in its
 * own error style; with it, the app has one place that knows the session ended
 * and one way of presenting that.
 */
type AuthLostListener = () => void;
const authLostListeners = new Set<AuthLostListener>();

export function onAuthLost(listener: AuthLostListener): () => void {
  authLostListeners.add(listener);
  return () => authLostListeners.delete(listener);
}

function notifyAuthLost(): void {
  for (const listener of authLostListeners) listener();
}

const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfToken: string | null = null;

/** Records the CSRF token for this session. Called with the /auth/me response. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Re-reads the token from the session. Returns false if there is no session. */
async function refreshCsrfToken(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { csrfToken?: string };
  csrfToken = body.csrfToken ?? null;
  return csrfToken !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
  attempt = 0,
  csrfRetried = false,
): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!SAFE_METHODS.has(method) && csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const err = body as Partial<ApiError>;
    // A 429 from Google's quota means the request never took effect, so retrying
    // is safe for any method. Cap the wait so we never approach the old hang.
    if (
      err.code === 'SHEET_RATE_LIMITED' &&
      opts.retryOnRateLimit !== false &&
      attempt < MAX_RATE_LIMIT_RETRIES
    ) {
      const jitter = Math.random() * 200;
      await sleep(retryAfterMs(res) ?? RATE_LIMIT_BACKOFF_MS[attempt] + jitter);
      return request<T>(path, init, opts, attempt + 1, csrfRetried);
    }
    // A stale token means the session was replaced (a re-sign-in, or another
    // tab). Fetch the current one and replay the request exactly once.
    if (err.code === 'CSRF_INVALID' && !csrfRetried && (await refreshCsrfToken())) {
      return request<T>(path, init, opts, attempt, true);
    }
    // The session is gone (signed out elsewhere, expired, revoked). Tell the
    // app once, centrally, rather than leaving each caller to interpret a 401.
    if (res.status === 401 || err.code === 'REAUTH_REQUIRED') {
      csrfToken = null;
      notifyAuthLost();
    }
    const error: ApiError = {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'Unexpected error',
      fieldErrors: err.fieldErrors,
      status: res.status,
    };
    throw error;
  }
  return body as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(
      path,
      { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) },
      opts,
    ),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'code' in e && 'status' in e;
}
