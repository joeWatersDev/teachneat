import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthGate, AuthProvider, useAuth } from './useAuth';
import { apiClient } from '../api/client';
import type { AuthProfile } from '../api/auth';

const profile: AuthProfile = {
  email: 'teacher@example.com',
  name: 'Jane Doe',
  avatarUrl: '',
  billingEnabled: true,
  csrfToken: 'csrf-test-token',
          plan: 'paid' as const,
};

/**
 * Drives a real tool request that the server rejects as unauthenticated, which
 * is how a dead session actually reaches the app — not by a test-only hook.
 */
async function toolRequestReturns401(): Promise<void> {
  const unauthorized = () =>
    new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Not signed in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized()));
  await act(async () => {
    await apiClient.get('/students').catch(() => undefined);
  });
  vi.unstubAllGlobals();
}

describe('AuthGate', () => {
  it('renders children when authenticated', async () => {
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={() => {}}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());
  });

  it('auto-redirects when /auth/me returns 401', async () => {
    const redirectTo = vi.fn();
    render(
      <AuthProvider
        fetchProfile={() =>
          Promise.reject({ code: 'UNAUTHORIZED', message: 'no', status: 401 })
        }
        redirectTo={redirectTo}
      >
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith('/api/auth/google'));
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('replaces the app with one signed-out screen when the session ends mid-use', async () => {
    const redirectTo = vi.fn();
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={redirectTo}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());

    // Any tool's request 401s: the app, not the tool, handles it.
    await toolRequestReturns401();

    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument());
    // The shell is gone, so no stale account menu or half-working tool remains.
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
    // And it waits for the teacher rather than bouncing them to Google.
    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('destroys the stale session so a reload is not sent back here', async () => {
    /**
     * The loop this closes: `/auth/me` reads only our own session row, so an
     * account whose Google token has died gets 200 there and 401 from the first
     * tool request, every reload, forever. Ending the session server-side makes
     * the next `/auth/me` a 401, which is the landing page.
     */
    const calls: string[] = [];
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={() => {}}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());

    const unauthorized = () =>
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Not signed in.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        // The logout itself succeeds; everything else is the dead session.
        if (url.endsWith('/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(unauthorized());
      }),
    );
    await act(async () => {
      await apiClient.get('/students').catch(() => undefined);
    });
    await screen.findByText(/not signed in/i);
    await waitFor(() => expect(calls.filter((u) => u.endsWith('/auth/logout'))).toHaveLength(1));
    // This session only. Signing the teacher out of their other devices is not
    // something a dead token on this one justifies.
    expect(calls.some((u) => u.endsWith('/auth/sessions'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('offers a way out other than signing in again', async () => {
    // The screen was a dead end: one button, no header, no footer, and no route
    // to the public pages. A teacher whose board has since blocked the app had
    // nothing here but a button that would fail.
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={() => {}}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());
    await toolRequestReturns401();

    await screen.findByText(/not signed in/i);
    // A full load rather than a client-side navigation: this component is what
    // renders at `/`, so a Link there would re-render this same screen.
    expect(screen.getByRole('link', { name: /back to the home page/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('starts the OAuth flow from the signed-out screen', async () => {
    const redirectTo = vi.fn();
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={redirectTo}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());
    await toolRequestReturns401();

    await screen.findByRole('button', { name: /sign in/i });
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(redirectTo).toHaveBeenCalledWith('/api/auth/google');
  });

  it('renders the landing page instead of redirecting when one is supplied', async () => {
    // The Step 5 change. Bouncing a first-time visitor to Google gives them a
    // consent screen they did not ask for, and gives a teacher on a board that
    // has blocked the app a Google error page and no way forward.
    const redirectTo = vi.fn();
    render(
      <AuthProvider
        fetchProfile={() => Promise.reject({ code: 'UNAUTHORIZED', message: 'no', status: 401 })}
        redirectTo={redirectTo}
      >
        <AuthGate signedOut={<div>landing</div>}>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('landing')).toBeInTheDocument());
    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('still shows the session-ended screen rather than the landing page mid-use', async () => {
    // The two signed-out states stay distinct: someone who was working and lost
    // their session wants a way back in, not marketing copy.
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={() => {}}>
        <AuthGate signedOut={<div>landing</div>}>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('protected')).toBeInTheDocument());
    await toolRequestReturns401();

    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument());
    expect(screen.queryByText('landing')).not.toBeInTheDocument();
  });

  it('lands a deliberate sign-out on the home page, not the session-ended screen', async () => {
    // Signing out on purpose is not the same as losing a session mid-task: the
    // teacher chose to leave, so they get the public home page rather than an
    // error telling them something went wrong.
    const redirectTo = vi.fn();
    function SignOutButton() {
      const { signOut } = useAuth();
      return (
        <button type="button" onClick={() => void signOut()}>
          sign out
        </button>
      );
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    render(
      <AuthProvider fetchProfile={() => Promise.resolve(profile)} redirectTo={redirectTo}>
        <AuthGate signedOut={<div>landing</div>}>
          <SignOutButton />
        </AuthGate>
      </AuthProvider>,
    );
    await screen.findByRole('button', { name: 'sign out' });
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(screen.getByText('landing')).toBeInTheDocument());
    expect(screen.queryByText(/not signed in/i)).not.toBeInTheDocument();
    // And it does not bounce straight back to Google, which — with consent
    // already granted — would sign them in again and make Sign out look broken.
    expect(redirectTo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows a loading state during initial fetch', () => {
    render(
      <AuthProvider fetchProfile={() => new Promise(() => {})} redirectTo={() => {}}>
        <AuthGate>
          <div>protected</div>
        </AuthGate>
      </AuthProvider>,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });
});
