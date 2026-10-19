import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PremiumBadge, PremiumControl, PremiumNotice } from './Premium';
import { EntitlementsProvider } from '../../hooks/useEntitlements';
import { Button } from './Button';
import { WithEntitlements } from '../../test/entitlements';
import type { LapsedFrom, Plan } from '../../api/auth';

/** The control under test: a premium button following the affordance rules. */
function GatedButton() {
  return (
    <PremiumControl explanation="Grouping constraints are part of Premium.">
      {({ locked, describedBy }) => (
        <Button
          disabled={locked}
          aria-disabled={locked || undefined}
          aria-describedby={describedBy}
        >
          Constraints
          <PremiumBadge />
        </Button>
      )}
    </PremiumControl>
  );
}

const renderAs = (plan: Plan) =>
  render(
    <WithEntitlements plan={plan}>
      <GatedButton />
    </WithEntitlements>,
  );

describe('premium feature affordance', () => {
  // A paying user should never see a premium marker in the product.
  it('shows no marker at all on paid', () => {
    renderAs('paid');
    expect(screen.queryByRole('img', { name: 'Premium feature' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Constraints/ })).toBeEnabled();
  });

  // The important case: marked *and* usable, so trial expiry is an expected
  // transition rather than a betrayal.
  it('marks the control on trial but leaves it usable', () => {
    renderAs('trial');
    expect(screen.getByRole('img', { name: 'Premium feature' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Constraints/ })).toBeEnabled();
  });

  // The star is unlabelled to the eye (the sidebar legend explains it once),
  // but never to a screen reader, which has no legend to consult.
  it('marks and disables the control on free, with an accessible explanation', () => {
    renderAs('free');
    expect(screen.getByRole('img', { name: 'Premium feature' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Constraints/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Grouping constraints are part of Premium.',
    );
  });
});

/**
 * The gated-control upgrade entry point (Step 5). Its rule differs from the
 * account menu's and the sidebar footer's, which is the whole reason it is
 * worth testing rather than assuming.
 */
describe('PremiumNotice', () => {
  const renderNotice = (plan: Plan) =>
    render(
      <WithEntitlements plan={plan}>
        <PremiumNotice feature="Attendance statistics" plural />
      </WithEntitlements>,
    );

  it('offers an upgrade on free, where the feature is unavailable and upgrading is the useful action', () => {
    renderNotice('free');
    expect(screen.getByRole('button', { name: /upgrade to premium/i })).toBeInTheDocument();
  });

  it('offers nothing on trial, where the feature is live and merely badged', () => {
    // Prompting here would interrupt someone who already has access in order to
    // sell them what they have.
    renderNotice('trial');
    expect(screen.queryByRole('button', { name: /upgrade to premium/i })).not.toBeInTheDocument();
  });

  it('renders without an upgrade provider rather than throwing', () => {
    // A presentational primitive must not require billing to be mounted; the
    // button is simply absent, so it never implies a checkout it cannot start.
    expect(() =>
      render(
        <EntitlementsProvider
          billingEnabled
          plan="free"
          trialEndsAt={null}
          fetchSettings={() => new Promise(() => {})}
        >
          <PremiumNotice feature="Attendance statistics" plural />
        </EntitlementsProvider>,
      ),
    ).not.toThrow();
    expect(screen.queryByRole('button', { name: /upgrade to premium/i })).not.toBeInTheDocument();
  });
});

/**
 * The trial-to-free moment (Phase 2 Step 6h). Every lapsed account reaches the
 * same locked control; only the words differ, and the difference is the point.
 */
describe('a lapsed account', () => {
  const renderLapsed = (lapsedFrom: LapsedFrom | null) =>
    render(
      <WithEntitlements plan="free" lapsedFrom={lapsedFrom}>
        <PremiumNotice feature="Attendance statistics" plural />
      </WithEntitlements>,
    );

  it('is told what happened, in the past tense', () => {
    renderLapsed('trial');
    expect(screen.getByText(/your trial has ended/i)).toBeInTheDocument();
  });

  /**
   * The mislabel this replaced: a teacher who paid for a year and then cancelled
   * was told their *trial* had ended, having last had one thirteen months
   * earlier. Both populations had an expired trial on their record, which is why
   * a single flag could not tell them apart.
   */
  it('names the subscription, not the trial, when a subscription ended', () => {
    renderLapsed('subscription');
    expect(screen.getByText(/your subscription has ended/i)).toBeInTheDocument();
    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
  });

  /**
   * A pause is not a loss: the teacher chose it and it has an end date. Saying
   * the subscription "has ended" would contradict the notice on their own
   * account page, and nothing here should be sold to them.
   */
  it('describes a pause as temporary rather than as an ending', () => {
    renderLapsed('paused');
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.queryByText(/has ended/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/part of Premium/i)).not.toBeInTheDocument();
  });

  /**
   * The fact a teacher who has entered a month of attendance actually needs.
   * Without it they will assume the records went with the statistics.
   */
  it('is told its records and spreadsheet are intact', () => {
    for (const from of ['trial', 'subscription', 'paused'] as LapsedFrom[]) {
      const { unmount } = renderLapsed(from);
      expect(screen.getByText(/records are all still here/i)).toBeInTheDocument();
      expect(screen.getByText(/spreadsheet has not been touched/i)).toBeInTheDocument();
      unmount();
    }
  });

  it('is invited to get Premium back rather than to upgrade', () => {
    renderLapsed('trial');
    expect(screen.getByRole('button', { name: /get premium back/i })).toBeInTheDocument();
  });

  /**
   * A paused account already has a subscription, so an upgrade button here would
   * send a paying teacher to Checkout and create a second one — leaving the
   * paused subscription orphaned, and billing again when it resumes, with the
   * app pointing at the wrong id.
   */
  it('offers a paused account nothing to buy', () => {
    renderLapsed('paused');
    expect(screen.queryByRole('button', { name: /premium/i })).not.toBeInTheDocument();
  });

  it('leaves an account that never had premium with the plain invitation', () => {
    renderLapsed(null);
    expect(screen.getByText(/is a premium feature|are a premium feature/i)).toBeInTheDocument();
    // Reassurance about deleted data would only confuse someone who has lost
    // nothing.
    expect(screen.queryByText(/records are all still here/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to premium/i })).toBeInTheDocument();
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a). Everything above describes the
 * premium boundary, which is dormant: with billing off there is nothing to
 * mark, nothing to lock, and nothing to sell, so the affordance has to be
 * absent rather than merely permissive. A star with no legend behind it and no
 * upgrade path beyond it is a symbol that means nothing.
 *
 * Asserted on the same component the block above uses, so the two cannot drift
 * into describing different controls.
 */
describe('the premium affordance with billing switched off', () => {
  const renderLaunch = (plan: Plan) =>
    render(
      <WithEntitlements billingEnabled={false} plan={plan}>
        <GatedButton />
      </WithEntitlements>,
    );

  it('shows no marker and no lock, even on free', () => {
    renderLaunch('free');
    expect(screen.queryByRole('img', { name: 'Premium feature' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Constraints/ })).toBeEnabled();
  });

  it('offers no explanation, because there is no boundary to explain', () => {
    renderLaunch('free');
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/part of Premium/)).not.toBeInTheDocument();
  });

  it('renders no upgrade prompt on a notice that would otherwise carry one', () => {
    render(
      <WithEntitlements billingEnabled={false} plan="free">
        <PremiumNotice feature="Attendance statistics" plural />
      </WithEntitlements>,
    );
    expect(screen.queryByRole('button', { name: /Upgrade to Premium/ })).not.toBeInTheDocument();
  });
});

/**
 * The tooltip's stacking order, which is not a detail: hovering the disabled
 * Statistics segment on a free account while the Attendance History grid was
 * open drew the explanation underneath the grid, so the one control that had to
 * say why it was locked said it out of sight.
 *
 * The cause is that the History grid and the Statistics table pin header cells
 * at `z-[25]` and are not their own stacking context, so those cells and the
 * bubble compete directly. Asserted as a number rather than by rendering the
 * two together, because jsdom computes no stacking at all — the invariant is
 * arithmetic on the class, and it is the arithmetic that broke.
 */
describe('tooltip stacking order', () => {
  const STICKY_TABLE_HEADER_Z = 25;
  const DRAWER_OVERLAY_Z = 30;

  it('sits above the sticky table headers and below the mobile drawer overlay', () => {
    render(
      <WithEntitlements plan="free">
        <GatedButton />
      </WithEntitlements>,
    );
    const bubble = screen.getByRole('tooltip', { hidden: true });
    const z = /z-\[(\d+)\]/.exec(bubble.className);
    expect(z).not.toBeNull();
    const value = Number(z![1]);
    expect(value).toBeGreaterThan(STICKY_TABLE_HEADER_Z);
    expect(value).toBeLessThan(DRAWER_OVERLAY_Z);
  });
});
