import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../hooks/useAuth';
import { RequireOnboarding } from './RequireOnboarding';
import { WelcomePage } from './WelcomePage';
import * as authApi from '../../api/auth';
import type { AuthProfile } from '../../api/auth';

vi.mock('../../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  completeOnboarding: vi.fn(),
}));

function profile(overrides: Partial<AuthProfile> = {}): AuthProfile {
  return {
    email: 'teacher@example.com',
    name: 'Alex Mercer',
    avatarUrl: '',
    billingEnabled: true,
    csrfToken: 'csrf',
    plan: 'trial',
    trialEndsAt: '2026-09-01T00:00:00.000Z',
    needsOnboarding: false,
    ...overrides,
  };
}

/**
 * Stands in for the Students page and reports the URL it was reached at, so the
 * guide's two add paths can be told apart from each other and from a plain skip
 * — the whole point of those buttons is that they land inside a form rather
 * than on the bare roster.
 */
function RosterProbe() {
  const location = useLocation();
  return <div>{`Roster at ${location.pathname}${location.search}`}</div>;
}

/**
 * Mounts the redirect and the guide behind a real AuthProvider, so the profile
 * arrives the way it does in the app — asynchronously, after a render in which
 * there is no profile at all.
 */
function renderApp(p: AuthProfile, at = '/') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider fetchProfile={() => Promise.resolve(p)}>
        <RequireOnboarding>
          <Routes>
            <Route path="/" element={<RosterProbe />} />
            <Route path="/students/roster" element={<RosterProbe />} />
            <Route path="/welcome" element={<WelcomePage />} />
            {/* Not the word "Attendance": the guide lists it as a tool, so a
                bare label would match the guide's own text. */}
            <Route path="/attendance" element={<div>Attendance tool loaded</div>} />
          </Routes>
        </RequireOnboarding>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Block bodies, not concise arrows. A concise arrow here returns the mock
// function itself, and vitest reads a function returned from a hook as a
// teardown callback and calls it — which invokes the mock an extra time per
// test and leaves its rejection unhandled.
beforeEach(() => {
  vi.mocked(authApi.completeOnboarding).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('the first-run redirect', () => {
  it('sends a brand-new account to the guide', async () => {
    renderApp(profile({ needsOnboarding: true }));
    expect(await screen.findByText(/Welcome, Alex/)).toBeInTheDocument();
  });

  it('leaves an established account where it was', async () => {
    renderApp(profile());
    expect(await screen.findByText(/^Roster at/)).toBeInTheDocument();
  });

  // A deep link into a tool is still a new account arriving with nothing to
  // show, so the guide wins — but only once, and without leaving the tool URL
  // in history to bounce off on the back button.
  it('redirects a deep link into a tool as well', async () => {
    renderApp(profile({ needsOnboarding: true }), '/attendance');
    expect(await screen.findByText(/Welcome, Alex/)).toBeInTheDocument();
    expect(screen.queryByText('Attendance tool loaded')).not.toBeInTheDocument();
  });

  /**
   * The guide stays reachable from the account menu after it is finished, so
   * the redirect must be a nudge toward the page and never a gate on it.
   */
  it('lets an onboarded account reopen the guide', async () => {
    renderApp(profile(), '/welcome');
    expect(await screen.findByText(/Welcome, Alex/)).toBeInTheDocument();
  });
});

describe('the first-run guide', () => {
  /**
   * The correction that prompted the rewrite: there is no add-class flow. A
   * class exists because a student names one, so an action promising otherwise
   * sends the teacher looking for a screen that does not exist.
   */
  it('never offers to add a class', async () => {
    renderApp(profile({ needsOnboarding: true }));
    await screen.findByRole('heading', { name: /add your students/i });
    expect(screen.queryByRole('button', { name: /add.*class/i })).not.toBeInTheDocument();
  });

  it('leads with the one action rather than with an explanation', async () => {
    renderApp(profile({ needsOnboarding: true }));
    const headings = await screen.findAllByRole('heading');
    // After the "Welcome" title, the first thing on the page is the action.
    expect(headings[1]).toHaveTextContent(/add your students/i);
  });

  it('says nothing about Premium or plans while billing is dormant', async () => {
    // The launch is free to every account, so there is no tier to announce and
    // the pricing page it linked to is gated. The card is kept for the day
    // billing comes back, which is what the profile flag decides.
    renderApp(profile({ needsOnboarding: true, billingEnabled: false }));
    expect(await screen.findByRole('heading', { name: /add your students/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /compare the plans/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/premium|unlocked/i);
  });

  it('names what is unlocked, until when, and where to compare the plans', async () => {
    renderApp(profile({ needsOnboarding: true }));
    // "Premium", not "everything": it is the word the rest of the app uses for
    // what the trial is holding open, so it is the word that has to appear here
    // for the later transition to mean anything.
    expect(await screen.findByRole('heading', { name: /premium is unlocked until/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /compare the plans/i })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('opens on Students, and shows another tool once it is hovered', async () => {
    renderApp(profile({ needsOnboarding: true }));
    // By role, not by text: each chip renders its label twice, over an
    // aria-hidden bold copy that holds the width steady across the selection.
    for (const tool of ['Students', 'Attendance', 'Grouping', 'Name Picker', 'Email']) {
      expect(await screen.findByRole('button', { name: tool })).toBeInTheDocument();
    }

    // Asserted against the one visible line rather than against the document,
    // because the per-button screen-reader descriptions are always present by
    // design and would answer a document-wide query at every point here.
    const line = await screen.findByText(/the class list itself/i, { selector: 'p' });
    expect(screen.getByRole('button', { name: 'Students' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.hover(screen.getByRole('button', { name: 'Name Picker' }));
    await waitFor(() => expect(line).toHaveTextContent(/fun ways to pick a student at random/i));
  });

  /**
   * The selection is sticky. A line that emptied on mouse-out would make
   * reading a synopsis a race against the pointer.
   */
  it('keeps the last tool shown after the pointer leaves the strip', async () => {
    renderApp(profile({ needsOnboarding: true }));
    const email = await screen.findByRole('button', { name: 'Email' });
    // `selector: 'p'` picks the shared line rather than the always-present
    // screen-reader description carrying the same sentence.
    const line = screen.getByText(/the class list itself/i, { selector: 'p' });

    await userEvent.hover(email);
    await waitFor(() => expect(line).toHaveTextContent(/mass emails/i));

    await userEvent.unhover(email);
    expect(line).toHaveTextContent(/mass emails/i);
    expect(email).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Students' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  /**
   * The chips pick a description; they do not navigate. Sending a teacher into
   * an empty tool from the page whose job is to get the roster in would work
   * against the two buttons above the strip.
   */
  it('does not link the tool chips to the tools', async () => {
    renderApp(profile({ needsOnboarding: true }));
    await screen.findByRole('button', { name: 'Students' });
    for (const tool of ['Students', 'Attendance', 'Grouping', 'Name Picker', 'Email']) {
      expect(screen.queryByRole('link', { name: tool })).not.toBeInTheDocument();
    }
  });

  /**
   * The screen-reader half of the same thing. A line that rewrites itself on
   * hover is no use without a pointer, so each chip carries its own synopsis as
   * a description and the shared line is hidden from the accessibility tree.
   */
  it('gives every tool its synopsis as an accessible description', async () => {
    renderApp(profile({ needsOnboarding: true }));
    const chip = await screen.findByRole('button', { name: 'Grouping' });
    const describedBy = chip.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/keep together or apart/i);
  });

  it('sends the teacher straight into the add form, not to the bare roster', async () => {
    renderApp(profile({ needsOnboarding: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Students' }));
    await waitFor(() => expect(authApi.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Roster at /students/roster?add=bulk')).toBeInTheDocument();
  });

  /**
   * "Skip for now" is gone, and this is the test that has to hold for its
   * removal to be safe. Completion is recorded on arrival rather than by an
   * exit button, so navigating away by any route works; recorded on the way out
   * instead, `RequireOnboarding` would redirect a sidebar click straight back
   * here and the page would be a trap with no skip link on it.
   */
  it('records completion on arrival, so any way off the page is the skip', async () => {
    renderApp(profile({ needsOnboarding: true }));
    await screen.findByRole('heading', { name: /add your students/i });
    await waitFor(() => expect(authApi.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
  });

  /**
   * A teacher must never be stuck on the welcome page because a bookkeeping
   * write failed. The worst acceptable outcome is seeing the guide once more.
   */
  it('still moves on when recording completion fails', async () => {
    vi.mocked(authApi.completeOnboarding).mockRejectedValue(new Error('offline'));
    renderApp(profile({ needsOnboarding: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Students' }));
    expect(await screen.findByText('Roster at /students/roster?add=bulk')).toBeInTheDocument();
  });
});
