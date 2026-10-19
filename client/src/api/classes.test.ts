import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { archiveClasses, unarchiveClasses } from './classes';

/**
 * The retry policy for class moves, which is a fix rather than a preference.
 *
 * A move is a dozen Google calls at the far end. When one of them is
 * rate-limited the whole request fails, and re-sending it spends every call that
 * had already succeeded a second time — so each attempt pushes the account
 * further past the per-minute ceiling and is likelier to fail than the last. In
 * manual testing that turned one rate-limited unarchive into four consecutive
 * failures over twenty seconds, which the teacher saw as the feature being
 * broken.
 */
describe('class moves and the rate-limit retry', () => {
  const rateLimited = () =>
    new Response(JSON.stringify({ code: 'SHEET_RATE_LIMITED', message: 'Slow down.' }), {
      status: 429,
      headers: { 'Retry-After': '5', 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => rateLimited()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not retry an archive that was rate-limited', async () => {
    await expect(archiveClasses(['c1'])).rejects.toMatchObject({ code: 'SHEET_RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unarchive that was rate-limited', async () => {
    await expect(unarchiveClasses(['c1'])).rejects.toMatchObject({ code: 'SHEET_RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
