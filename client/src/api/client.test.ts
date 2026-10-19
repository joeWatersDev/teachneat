import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiClient, setCsrfToken } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerOf(call: unknown[], name: string): string | undefined {
  const init = call[1] as RequestInit;
  return (init.headers as Record<string, string>)[name];
}

describe('api client CSRF handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('token-1');
  });

  afterEach(() => {
    setCsrfToken(null);
    vi.unstubAllGlobals();
  });

  it('sends the token on a state-changing request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.post('/students', { firstName: 'A' });
    expect(headerOf(fetchMock.mock.calls[0], 'X-CSRF-Token')).toBe('token-1');
  });

  it('omits the token on a read', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await apiClient.get('/students');
    expect(headerOf(fetchMock.mock.calls[0], 'X-CSRF-Token')).toBeUndefined();
  });

  it('refreshes a stale token and replays the request once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'stale' }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'token-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(apiClient.post('/students', { firstName: 'A' })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/me');
    expect(headerOf(fetchMock.mock.calls[2], 'X-CSRF-Token')).toBe('token-2');
  });

  it('surfaces the error rather than looping when the refresh also fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'stale' }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'token-2' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'stale' }, 403));

    await expect(apiClient.post('/students', {})).rejects.toMatchObject({
      code: 'CSRF_INVALID',
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
