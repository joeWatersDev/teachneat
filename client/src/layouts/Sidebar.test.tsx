import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NAV_ITEMS } from './navConfig';
import { WithEntitlements } from '../test/entitlements';
import type { Plan } from '../api/auth';

function renderAt(
  path: string,
  open = true,
  plan: Plan = 'paid',
  trialEndsAt: string | null = null,
  billingEnabled = true,
) {
  return render(
    <WithEntitlements billingEnabled={billingEnabled} plan={plan} trialEndsAt={trialEndsAt}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar open={open} onDismiss={() => {}} />
      </MemoryRouter>
    </WithEntitlements>,
  );
}

function desktopNav() {
  return screen.getByRole('navigation', { name: 'Primary' });
}

describe('Sidebar', () => {
  it('renders all five tools in fixed order', () => {
    renderAt('/');
    const links = desktopNav().querySelectorAll('a');
    const labels = Array.from(links).map((a) => a.getAttribute('aria-label'));
    expect(labels).toEqual(NAV_ITEMS.map((i) => i.label));
  });

  it('marks the matching route as active', () => {
    renderAt('/attendance');
    const link = within(desktopNav()).getByLabelText('Attendance');
    expect(link.className).toContain('text-primary');
  });

  it('keeps Students active on each of its tabs and on a student', () => {
    for (const path of ['/students/roster', '/students/classes', '/students/01H']) {
      const { unmount } = renderAt(path);
      const link = within(desktopNav()).getByLabelText('Students');
      expect(link.className).toContain('text-primary');
      unmount();
    }
  });

  it('also renders a mobile drawer with the same nav', () => {
    renderAt('/');
    const mobileNav = screen.getByRole('navigation', { name: 'Primary (mobile)' });
    expect(within(mobileNav).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
  });
});

/**
 * The footer is where the star marker is defined. It is the only place the
 * meaning is spelled out, so every other appearance can stay icon-only.
 */
describe('the sidebar plan footer', () => {
  it('names the plan and explains the star on free', () => {
    renderAt('/', true, 'free');
    const nav = desktopNav();
    expect(within(nav).getByText('Free account')).toBeInTheDocument();
    // Rendered twice: the wide sentence and the collapsed star's tooltip.
    expect(within(nav).getAllByText('Premium feature').length).toBeGreaterThan(0);
    expect(
      within(nav).getByRole('button', { name: 'Star marks: Premium feature' }),
    ).toBeInTheDocument();
  });

  it('says the starred features are included while on trial', () => {
    renderAt('/', true, 'trial');
    const nav = desktopNav();
    expect(within(nav).getByText(/Free trial/)).toBeInTheDocument();
    expect(within(nav).getAllByText('Included until your trial ends').length).toBeGreaterThan(0);
  });

  // Touch devices are most of what collapses the sidebar, and they have no
  // hover, so the collapsed legend has to be reachable by tap.
  it('toggles the collapsed legend when its star is tapped', async () => {
    const user = userEvent.setup();
    renderAt('/', true, 'free');
    const star = within(desktopNav()).getByRole('button', {
      name: 'Star marks: Premium feature',
    });
    expect(star).toHaveAttribute('aria-expanded', 'false');

    await user.click(star);
    expect(star).toHaveAttribute('aria-expanded', 'true');

    await user.click(star);
    expect(star).toHaveAttribute('aria-expanded', 'false');
  });

  // Nothing is starred on paid, so there is nothing to explain — and nothing
  // left to sell, so the footer carries the mark alone.
  it('shows the Premium mark alone on paid', () => {
    renderAt('/', true, 'paid');
    const nav = desktopNav();
    expect(within(nav).getByText('Premium')).toBeInTheDocument();
    expect(within(nav).queryByText(/feature|trial ends/)).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: /Star marks/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: /Upgrade/ })).not.toBeInTheDocument();
    // Still marked when the sidebar is collapsed to icons, where the word does
    // not fit but the mark should not simply vanish.
    expect(within(nav).getByRole('img', { name: 'Premium account' })).toBeInTheDocument();
  });

  // The countdown is the useful fact on a trial: "how long have I got left".
  it('counts down the days remaining on trial', () => {
    const in12Days = new Date(Date.now() + 12 * 86_400_000).toISOString();
    renderAt('/', true, 'trial', in12Days);
    expect(within(desktopNav()).getByText('12 days left')).toBeInTheDocument();
  });

  it('says “1 day left” rather than “1 days left” on the last day', () => {
    const tomorrow = new Date(Date.now() + 1 * 86_400_000).toISOString();
    renderAt('/', true, 'trial', tomorrow);
    expect(within(desktopNav()).getByText('1 day left')).toBeInTheDocument();
  });

  // An expired trial that has not yet been re-resolved must not render a
  // negative countdown.
  it('floors the countdown at zero rather than going negative', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    renderAt('/', true, 'trial', yesterday);
    expect(within(desktopNav()).getByText('0 days left')).toBeInTheDocument();
  });
});

describe('the sidebar upgrade link', () => {
  it('offers the upgrade on free and on trial', () => {
    for (const plan of ['free', 'trial'] as const) {
      const { unmount } = renderAt('/', true, plan);
      expect(
        within(desktopNav()).getByRole('button', { name: 'Upgrade to Premium' }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('omits it on paid, where there is nothing to upgrade to', () => {
    renderAt('/', true, 'paid');
    expect(
      within(desktopNav()).queryByRole('button', { name: /Upgrade/ }),
    ).not.toBeInTheDocument();
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a). The footer states the plan,
 * counts down a trial, explains the star and offers the upgrade — four
 * statements about a boundary that does not exist while billing is off. The
 * whole block goes rather than emptying out, because an empty bordered block
 * is a rule drawn across the sidebar with nothing under it.
 */
describe('the sidebar plan footer with billing switched off', () => {
  const trialEndsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

  it('renders no footer at all, on any plan', () => {
    for (const plan of ['free', 'trial', 'paid'] as const) {
      const { unmount } = renderAt('/', true, plan, trialEndsAt, false);
      const nav = desktopNav();
      expect(within(nav).queryByRole('button', { name: /Upgrade/ })).not.toBeInTheDocument();
      expect(within(nav).queryByText(/Free account|Free trial|Premium/)).not.toBeInTheDocument();
      expect(within(nav).queryByText(/days left/)).not.toBeInTheDocument();
      expect(within(nav).queryByText('Premium feature')).not.toBeInTheDocument();
      unmount();
    }
  });
});
