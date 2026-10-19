import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from './TopBar';
import { ThemeProvider } from '../hooks/useTheme';
import { AuthProvider } from '../hooks/useAuth';
import * as authApi from '../api/auth';
import { WithEntitlements } from '../test/entitlements';
import type { AuthProfile } from '../api/auth';

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  cyclePlan: vi.fn(),
  setTrialEnd: vi.fn(),
  runLifecycleSweep: vi.fn(),
  logout: vi.fn(),
}));

function renderTopBar(overrides: Partial<AuthProfile> = {}) {
  return render(
    <ThemeProvider>
      <AuthProvider
        fetchProfile={() =>
          Promise.resolve({
            email: 't@e.com',
            name: 'Teacher',
            avatarUrl: '',
            billingEnabled: true,
            csrfToken: 'csrf-test-token',
            plan: 'paid' as const,
            ...overrides,
          })
        }
        redirectTo={() => {}}
      >
        <MemoryRouter>
          {/* Supplies the upgrade context the account menu reads. The menu's own
              upgrade item keys off the profile's plan, not this one. */}
          <WithEntitlements>
            <TopBar onToggleSidebar={() => {}} />
          </WithEntitlements>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('TopBar', () => {
  it('renders the wordmark', () => {
    renderTopBar();
    // The wordmark splits the name across two spans to carry the weight change
    // at the join, so it is matched by its halves rather than as one string.
    expect(screen.getByText('Teach')).toBeInTheDocument();
    expect(screen.getByText('neat')).toBeInTheDocument();
  });

  it('toggles the theme via the mode button', async () => {
    const user = userEvent.setup();
    renderTopBar();
    expect(document.documentElement).not.toHaveClass('dark');
    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('opens the account menu and shows email + sign out', async () => {
    const user = userEvent.setup();
    renderTopBar();
    // Wait for AuthProvider to resolve and the menu button to be enabled
    const trigger = await screen.findByRole('button', { name: /account menu/i });
    await user.click(trigger);
    expect(await screen.findByText('t@e.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });
});

/**
 * The development-only plan toggle. It renders only when `GET /auth/me` reports
 * `devTools`, is styled as an ordinary menu item so it is never mistaken for
 * product UI, and does not exist in production's reachable API — the flag here
 * is a rendering hint, and the endpoint re-checks its guards regardless.
 */
describe('the development-only plan toggle', () => {
  // A block body: a concise arrow returns the mock, and vitest calls a function
  // returned from a hook as its teardown, which invokes the mock once per test.
  beforeEach(() => {
    vi.mocked(authApi.cyclePlan).mockReset();
  });

  it('is absent when the server does not report devTools', async () => {
    const user = userEvent.setup();
    renderTopBar();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: /^Plan:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('names the current plan, whether it is forced, and what is next', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'trial', planOverride: 'trial' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Plan: trial (forced) — switch to paid' }),
    ).toBeInTheDocument();
  });

  /**
   * The label has to distinguish a forced plan from the account's real one. With
   * a subscription behind an unexpired trial, a forced `trial` and no override
   * resolve to the same plan, so a label derived from the plan alone would say
   * the same thing in two states that behave differently.
   */
  it('distinguishes no override from a forced plan that resolves the same way', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'trial', planOverride: null });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Plan: trial (real) — switch to free' }),
    ).toBeInTheDocument();
  });

  // The cleared position is what makes the toggle reversible, so it must be
  // reachable from the last forced state.
  it('offers a return to the real plan after paid', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'paid', planOverride: 'paid' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Plan: paid (forced) — switch to real plan' }),
    ).toBeInTheDocument();
  });

  it('cycles the plan through the endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.cyclePlan).mockResolvedValue({ plan: 'free', override: 'free' });
    renderTopBar({ devTools: true, plan: 'free' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Plan:/ }));
    expect(authApi.cyclePlan).toHaveBeenCalledTimes(1);
  });
});

/**
 * The two lifecycle-email controls (Step 6h). They exist because the path this
 * step was built for takes thirty days to reach otherwise.
 */
describe('the development-only lifecycle email controls', () => {
  beforeEach(() => {
    vi.mocked(authApi.setTrialEnd).mockResolvedValue({
      trialEndsAt: new Date().toISOString(),
      plan: 'trial',
    });
    vi.mocked(authApi.runLifecycleSweep).mockResolvedValue({ queued: 1, sent: 1, failed: 0 });
  });

  it('are absent for an ordinary account, like every other dev tool', async () => {
    const user = userEvent.setup();
    renderTopBar({ plan: 'paid' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: /^Trial:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /email sweep/i })).not.toBeInTheDocument();
  });

  /**
   * The label names the position the next press moves to, matching the plan
   * toggle beside it, and advances so the three states are reachable in order.
   */
  it('walk the trial through the three positions that matter', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'trial' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    await user.click(await screen.findByRole('menuitem', { name: /ending in 4 days/ }));
    expect(authApi.setTrialEnd).toHaveBeenCalledWith(4);

    await user.click(await screen.findByRole('menuitem', { name: /ended yesterday/ }));
    expect(authApi.setTrialEnd).toHaveBeenCalledWith(-1);

    await user.click(await screen.findByRole('menuitem', { name: /a fresh 30 days/ }));
    expect(authApi.setTrialEnd).toHaveBeenCalledWith(30);
  });

  it('runs the sweep and reports the pass', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'trial' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Run email sweep/ }));
    expect(authApi.runLifecycleSweep).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('menuitem', { name: /1 queued, 1 sent/ })).toBeInTheDocument();
  });

  it('says so rather than going quiet when the sweep fails', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.runLifecycleSweep).mockRejectedValue(new Error('no mailer'));
    renderTopBar({ devTools: true, plan: 'trial' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Run email sweep/ }));
    expect(await screen.findByRole('menuitem', { name: /failed/ })).toBeInTheDocument();
  });
});

describe('the billing entry points in the account menu', () => {
  // The account menu is somewhere a teacher goes deliberately, so unlike a gated
  // control it can offer the upgrade on `trial` without interrupting anyone who
  // still has access.
  it('offers the upgrade on free and on trial', async () => {
    for (const plan of ['free', 'trial'] as const) {
      const user = userEvent.setup();
      const { unmount } = renderTopBar({ plan });
      await user.click(screen.getByRole('button', { name: 'Account menu' }));
      expect(
        await screen.findByRole('menuitem', { name: /Upgrade to Premium/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('does not offer the upgrade on paid', async () => {
    const user = userEvent.setup();
    renderTopBar({ plan: 'paid' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: /Upgrade/ })).not.toBeInTheDocument();
  });

  // Billing left the menu in Step 6f. It is on the Account settings page with
  // the other things done to an account, including the two destructive ones a
  // dropdown is the wrong container for.
  it('no longer carries billing, whether or not a Stripe customer exists', async () => {
    const user = userEvent.setup();
    renderTopBar({ plan: 'free', hasBilling: true });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Account settings' })).toHaveAttribute(
      'href',
      '/account',
    );
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a). Every entry above is about
 * money, and with billing off none of them describes anything a teacher can do.
 * The dev plan and trial toggles go with them — their endpoints answer 404 on
 * the same terms as the allowlist refusal — while the lifecycle sweep stays,
 * because the welcome and deletion messages it drains have nothing to do with
 * a plan.
 */
describe('the account menu with billing switched off', () => {
  it('offers no upgrade, on any plan', async () => {
    for (const plan of ['free', 'trial', 'paid'] as const) {
      const user = userEvent.setup();
      const { unmount } = renderTopBar({ plan, billingEnabled: false });
      await user.click(screen.getByRole('button', { name: 'Account menu' }));
      await screen.findByRole('menuitem', { name: 'Sign out' });
      expect(screen.queryByRole('menuitem', { name: /Upgrade/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('hides the plan and trial dev toggles but keeps the lifecycle sweep', async () => {
    const user = userEvent.setup();
    renderTopBar({ devTools: true, plan: 'trial', billingEnabled: false });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: /^Plan:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Trial:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /lifecycle|sweep/i })).toBeInTheDocument();
  });
});

describe('the Getting started entry', () => {
  // The rule the step asked for: a first-week affordance that stops being
  // offered once it has been outgrown.
  it('is offered while the account has no students', async () => {
    renderTopBar({ hasStudents: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Getting started' })).toHaveAttribute(
      'href',
      '/welcome',
    );
  });

  it('is gone once the account has one', async () => {
    renderTopBar({ hasStudents: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  // hasStudents is optional on the profile, and an older server would omit it.
  // Hiding the item on `undefined` would silently remove a teacher's way back
  // to the guide, so the check is explicitly against `false`.
  it('stays hidden rather than guessing when the server says nothing', async () => {
    renderTopBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: 'Getting started' })).not.toBeInTheDocument();
  });
});

describe('TopBar support entries', () => {
  // The gear was a placeholder that never had a destination: the one
  // server-applied setting lives contextually on the Attendance page, display
  // options live in their tools' own modals, and everything account-shaped is in
  // this menu. A control that does nothing is worse than no control.
  it('has no settings control', async () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  // Points at the hub rather than straight at the contact form (Step 6f), so a
  // question that the documentation answers does not have to become a ticket.
  it('offers help and support to every account', async () => {
    renderTopBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Help and support' })).toHaveAttribute(
      'href',
      '/help',
    );
  });

  it('hides support triage unless the account is an operator', async () => {
    renderTopBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: 'Support triage' })).not.toBeInTheDocument();
  });

  it('shows support triage for an operator account', async () => {
    renderTopBar({ supportAdmin: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Support triage' })).toHaveAttribute(
      'href',
      '/admin/support',
    );
  });
});
