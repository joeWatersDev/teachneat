import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../hooks/useAuth';
import { ConsentGate } from './ConsentGate';
import * as authApi from '../../api/auth';
import type { AuthProfile } from '../../api/auth';

vi.mock('../../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  acceptConsent: vi.fn(),
  logout: vi.fn(),
}));

const VERSION = 'v-test-1';

function profile(overrides: Partial<AuthProfile> = {}): AuthProfile {
  return {
    email: 'teacher@example.com',
    name: 'Alex Mercer',
    avatarUrl: '',
    billingEnabled: true,
    csrfToken: 'csrf',
    plan: 'trial',
    needsConsent: false,
    termsVersion: VERSION,
    ...overrides,
  };
}

/**
 * Mounts the gate behind a real AuthProvider so the profile arrives the way it
 * does in the app. `fetchProfile` is a function rather than a fixed value so a
 * test can change what the second call returns, which is how the gate learns
 * that consent has been recorded.
 */
function renderGate(fetchProfile: () => Promise<AuthProfile>) {
  return render(
    <MemoryRouter>
      <AuthProvider fetchProfile={fetchProfile}>
        <ConsentGate>
          <div>The app shell</div>
        </ConsentGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Block bodies, not concise arrows: a concise arrow returns the mock function,
// and vitest reads a function returned from a hook as a teardown callback and
// calls it.
beforeEach(() => {
  vi.mocked(authApi.acceptConsent).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ConsentGate', () => {
  it('renders the app for an account that has already accepted', async () => {
    renderGate(() => Promise.resolve(profile()));
    expect(await screen.findByText('The app shell')).toBeInTheDocument();
  });

  it('replaces the app entirely when consent is outstanding', async () => {
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
    // Not merely covered — the shell must not render at all, because every
    // request it would make comes back CONSENT_REQUIRED.
    expect(screen.queryByText('The app shell')).not.toBeInTheDocument();
  });

  it('will not submit until both boxes are ticked', async () => {
    const user = userEvent.setup();
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    await screen.findByRole('heading', { name: 'Before you start' });

    const submit = screen.getByRole('button', { name: 'Agree and continue' });
    const [termsBox, responsibilityBox] = screen.getAllByRole('checkbox');
    expect(submit).toBeDisabled();

    await user.click(termsBox);
    expect(submit).toBeDisabled();

    await user.click(responsibilityBox);
    expect(submit).toBeEnabled();

    // And ticking one back off closes it again — the button tracks the boxes
    // rather than latching open on the first time both were true.
    await user.click(termsBox);
    expect(submit).toBeDisabled();
  });

  it('sends the version it was shown, and reveals the app once the profile agrees', async () => {
    const user = userEvent.setup();
    let consented = false;
    renderGate(() => Promise.resolve(profile({ needsConsent: !consented })));
    await screen.findByRole('heading', { name: 'Before you start' });

    vi.mocked(authApi.acceptConsent).mockImplementation(() => {
      consented = true;
      return Promise.resolve();
    });

    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Agree and continue' }));

    expect(authApi.acceptConsent).toHaveBeenCalledWith(VERSION);
    expect(await screen.findByText('The app shell')).toBeInTheDocument();
  });

  /**
   * The opposite of how the first-run guide handles a failed write, and
   * deliberately so. There the local answer was the true one; here only the
   * server can decide, and it will keep refusing — so letting the teacher
   * through on a failure would drop them into an app where nothing works.
   */
  it('keeps the teacher on the screen when the write fails', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.acceptConsent).mockRejectedValue(new Error('offline'));
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    await screen.findByRole('heading', { name: 'Before you start' });

    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Agree and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.queryByText('The app shell')).not.toBeInTheDocument();
    // And it is retryable rather than stuck in a loading state.
    expect(screen.getByRole('button', { name: 'Agree and continue' })).toBeEnabled();
  });

  it('offers signing out as the way to decline', async () => {
    const user = userEvent.setup();
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    await screen.findByRole('heading', { name: 'Before you start' });

    await user.click(screen.getByRole('button', { name: 'Sign out instead' }));
    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalled();
    });
  });

  it('links both agreements without navigating away from the ticked boxes', async () => {
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    await screen.findByRole('heading', { name: 'Before you start' });

    for (const name of ['Terms of Service', 'Privacy Policy']) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('target', '_blank');
    }
  });

  // The one agreement whose text is on the page rather than behind a link,
  // which makes acceptance of it a materially stronger record than acceptance
  // of the linked documents beside it. If this wording is edited the server's
  // copy and the terms version must move with it.
  it('states the data-responsibility acknowledgement in full', async () => {
    renderGate(() => Promise.resolve(profile({ needsConsent: true })));
    await screen.findByRole('heading', { name: 'Before you start' });
    expect(
      screen.getByText(/complying with the privacy laws, records regulations, and school board/i),
    ).toBeInTheDocument();
  });
});
