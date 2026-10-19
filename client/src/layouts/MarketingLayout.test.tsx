import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketingLayout } from './MarketingLayout';
import { ThemeProvider } from '../hooks/useTheme';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  getMe: vi.fn(),
}));

/**
 * The header's sign-in control (Phase 2 Step 6f).
 *
 * These pages render outside `AuthProvider` by design, so the header cannot know
 * about a session on its own. The pages the app links to ask; the pages a
 * stranger arrives at first do not, which is what keeps Step 5's promise that a
 * visitor deciding whether to sign up pays for no round trip.
 */
function renderLayout(probeSession: boolean) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <MarketingLayout probeSession={probeSession}>
          <p>page</p>
        </MarketingLayout>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the marketing header', () => {
  it('never asks about a session on a page the app does not link to', async () => {
    renderLayout(false);
    expect(authApi.getMe).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('offers a way back once it finds a session', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue({
      email: 't@e.com',
      name: 'Teacher',
      avatarUrl: '',
      billingEnabled: true,
      csrfToken: 'csrf',
      plan: 'paid',
    });
    renderLayout(true);

    const back = await screen.findByRole('link', { name: 'Back to the app' });
    expect(back).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  // Offering a way back into an app the reader cannot enter is the worse error,
  // so every failure — no session, offline, server down — keeps "Sign in".
  it('stays on Sign in when the probe fails', async () => {
    vi.mocked(authApi.getMe).mockRejectedValue({ code: 'UNAUTHORIZED', status: 401 });
    renderLayout(true);

    await waitFor(() => expect(authApi.getMe).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to the app' })).not.toBeInTheDocument();
  });

  // The probe must not gate the page. A reader whose network is slow, or who is
  // signed out, gets the content immediately either way.
  it('renders the page without waiting on the probe', () => {
    vi.mocked(authApi.getMe).mockReturnValue(new Promise(() => {}));
    renderLayout(true);
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
