import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountSettingsPage } from './AccountSettingsPage';
import { ThemeProvider } from '../../hooks/useTheme';
import { AuthProvider } from '../../hooks/useAuth';
import { WithEntitlements } from '../../test/entitlements';
import * as authApi from '../../api/auth';
import * as billingApi from '../../api/billing';
import type { AuthProfile } from '../../api/auth';
import type { ApiError } from '../../api/client';

vi.mock('../../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  revokeAllSessions: vi.fn(),
  deleteAccount: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../api/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  createPortalSession: vi.fn(),
  pauseSubscription: vi.fn(),
}));

/**
 * Both destructive actions leave by full page load rather than by route change,
 * because a client-side navigation keeps an AuthProvider alive that still thinks
 * it is signed in — landing the teacher on the "your session ended" error screen
 * instead of the marketing home page. Injected because jsdom has no navigation.
 */
const redirectTo = vi.fn();

function renderPage(overrides: Partial<AuthProfile> = {}) {
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
          <WithEntitlements>
            <AccountSettingsPage redirectTo={redirectTo} />
          </WithEntitlements>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.open = vi.fn();
});

describe('AccountSettingsPage', () => {
  it('opens the Stripe portal in a new tab for an account with billing', async () => {
    vi.mocked(billingApi.createPortalSession).mockResolvedValue({ url: 'https://portal.test/x' });
    renderPage({ hasBilling: true });
    await userEvent.click(await screen.findByRole('button', { name: /Manage billing/ }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        'https://portal.test/x',
        '_blank',
        'noopener,noreferrer',
      ),
    );
  });

  // No Stripe customer means no portal to open, so the row offers the thing
  // that would create one rather than a control that fails.
  it('offers the upgrade instead when no billing exists', async () => {
    renderPage({ hasBilling: false });
    expect(await screen.findByRole('button', { name: /Upgrade to Premium/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage billing/ })).not.toBeInTheDocument();
  });

  // An account that has paid before and stopped keeps its Stripe customer, so it
  // has billing to manage *and* nothing to be billed for. Both rows belong.
  it('offers the upgrade above billing for a lapsed account that still has a customer', async () => {
    renderPage({ hasBilling: true, plan: 'free' });
    await screen.findByRole('button', { name: /Manage billing/ });
    // Above, not merely present: the decision comes before the administration.
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.findIndex((t) => t.startsWith('Upgrade to Premium'))).toBe(0);
    expect(labels.findIndex((t) => t.startsWith('Manage billing'))).toBe(1);
  });

  it('offers the upgrade on a trial, which is what a trial is for', async () => {
    renderPage({ hasBilling: false, plan: 'trial' });
    await screen.findByText('t@e.com');
    expect(screen.getByRole('button', { name: /Upgrade to Premium/ })).toBeInTheDocument();
  });

  // Not tone. A paused subscription still exists, so Checkout would create a
  // second one and the teacher would be billed twice while the app showed one.
  it('offers no upgrade while the subscription is paused', async () => {
    renderPage({ hasBilling: true, plan: 'free', paused: true });
    await screen.findByRole('button', { name: /Manage billing/ });
    expect(screen.queryByRole('button', { name: /Upgrade to Premium/ })).not.toBeInTheDocument();
  });

  it('signs out everywhere and leaves for the public page', async () => {
    vi.mocked(authApi.revokeAllSessions).mockResolvedValue();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Log out of all sessions/ }));
    await waitFor(() => expect(authApi.revokeAllSessions).toHaveBeenCalled());
    // A real navigation, not a route change: this browser's session is one of
    // the ones just ended, and a client-side move would land on the app shell
    // with a stale provider and show the session-ended error screen.
    expect(redirectTo).toHaveBeenCalledWith('/');
  });

  describe('deleting the account', () => {
    it('asks first, and deletes nothing until confirmed', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      expect(await screen.findByRole('dialog', { name: /Delete your account\?/ })).toBeInTheDocument();
      expect(authApi.deleteAccount).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(authApi.deleteAccount).not.toHaveBeenCalled();
    });

    // The misunderstanding that would cost a teacher their year, so the dialog
    // leads with it rather than mentioning it.
    it('says plainly that the spreadsheet survives', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/student data is not deleted/i);
      expect(dialog).toHaveTextContent(/own Drive/i);
      expect(dialog).toHaveTextContent(/cancelled immediately/i);
    });

    // The typed phrase is the friction that separates a deliberate deletion
    // from a misclick, so it gates the button rather than merely warning.
    it('keeps the confirm button disabled until the word is typed', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
      expect(confirm).toBeDisabled();

      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), 'Delet');
      expect(confirm).toBeDisabled();

      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), 'e');
      expect(confirm).toBeEnabled();
      expect(authApi.deleteAccount).not.toHaveBeenCalled();
    });

    // Deliberate is what the phrase is testing for, and someone who typed the
    // word was deliberate. Refusing it for a lowercase d only breeds resentment.
    it('accepts the word case-insensitively and with stray whitespace', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), '  delete ');
      expect(within(dialog).getByRole('button', { name: 'Delete account' })).toBeEnabled();
    });

    it('forgets what was typed if the dialog is dismissed and reopened', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      let dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), 'Delete');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByLabelText(/type delete to confirm/i)).toHaveValue('');
      expect(within(dialog).getByRole('button', { name: 'Delete account' })).toBeDisabled();
    });

    it('deletes on confirmation and leaves for the public page', async () => {
      vi.mocked(authApi.deleteAccount).mockResolvedValue();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), 'Delete');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
      await waitFor(() => expect(authApi.deleteAccount).toHaveBeenCalled());
      expect(redirectTo).toHaveBeenCalledWith('/');
    });

    // The server's message names a failure only the teacher can clear — a
    // subscription Stripe would not cancel — so it is shown rather than
    // replaced with a generic apology.
    it('surfaces the server’s reason when deletion is refused', async () => {
      const refusal: ApiError = {
        code: 'INTERNAL_ERROR',
        message: 'Your subscription could not be cancelled, so nothing was deleted.',
        status: 500,
      };
      vi.mocked(authApi.deleteAccount).mockRejectedValue(refusal);
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/type delete to confirm/i), 'Delete');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/subscription could not be cancelled/i);
      expect(redirectTo).not.toHaveBeenCalled();
    });
  });
  /**
   * The cancellation flow and the summer pause (Step 6i).
   *
   * The placement is the design decision the tests here are really pinning: the
   * pause is offered to a teacher who is already leaving, and nowhere a visitor
   * or a contented subscriber would meet it.
   */
  describe('cancellation and the summer pause', () => {
    it('offers cancelling to an account with a live subscription', async () => {
      renderPage({ hasBilling: true, canCancel: true });
      expect(await screen.findByRole('button', { name: /Cancel subscription/ })).toBeVisible();
    });

    // The bug this pins: hasBilling only means a Stripe customer exists, and
    // both that id and the subscription id survive a cancellation. Gating on it
    // offered a cancellation for a subscription Stripe had already ended, and
    // Stripe refuses to open a cancel flow for one — which reached the teacher
    // as "Billing could not be opened", on a portal that would have opened.
    it('offers no cancellation to an account whose subscription has already ended', async () => {
      renderPage({ hasBilling: true, canCancel: false });
      await screen.findByRole('button', { name: /Manage billing/ });
      expect(screen.queryByRole('button', { name: /Cancel subscription/ })).toBeNull();
    });

    it('offers nothing to cancel on a free account', async () => {
      renderPage({ hasBilling: false, canCancel: false, plan: 'free' });
      await screen.findByRole('button', { name: /Upgrade to Premium/ });
      expect(screen.queryByRole('button', { name: /Cancel subscription/ })).toBeNull();
    });

    // Manage billing goes straight to Stripe. A teacher who came for an invoice
    // must not be handed a retention offer on the way.
    it('does not offer the pause from the Manage billing row', async () => {
      vi.mocked(billingApi.createPortalSession).mockResolvedValue({ url: 'https://portal.test/x' });
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Manage billing/ }));
      await waitFor(() => expect(billingApi.createPortalSession).toHaveBeenCalled());
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('pauses for the chosen number of months', async () => {
      vi.mocked(billingApi.pauseSubscription).mockResolvedValue({
        resumesAt: '2026-09-01T00:00:00.000Z',
        months: 3,
      });
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.selectOptions(within(dialog).getByLabelText(/pause for/i), '3');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Pause instead' }));
      await waitFor(() => expect(billingApi.pauseSubscription).toHaveBeenCalledWith(3));
    });

    it('defaults to two months', async () => {
      vi.mocked(billingApi.pauseSubscription).mockResolvedValue({
        resumesAt: '2026-09-01T00:00:00.000Z',
        months: 2,
      });
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Pause instead' }));
      await waitFor(() => expect(billingApi.pauseSubscription).toHaveBeenCalledWith(2));
    });

    // Least to most consequential, left to right, matching the delete dialog
    // and the account rows. Worth pinning: the footer is three buttons wide and
    // an added action is the kind of change that lands wherever it is typed.
    it('orders the actions keep, pause, cancel', async () => {
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      const labels = within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim())
        .filter((t) => t && t !== 'Close');
      expect(labels).toEqual(['Keep my subscription', 'Pause instead', 'Continue to cancel']);
    });

    // A retention offer that makes leaving harder is a dark pattern. Cancelling
    // outright stays one click away inside the same dialog.
    it('still leads to Stripe’s cancellation from the same dialog', async () => {
      vi.mocked(billingApi.createPortalSession).mockResolvedValue({ url: 'https://portal.test/x' });
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Continue to cancel' }));
      // Deep-linked into the portal's cancellation page. Without the argument
      // this button lands exactly where Manage billing does, and a teacher who
      // has already said they want to cancel has to find the control again.
      await waitFor(() => expect(billingApi.createPortalSession).toHaveBeenCalledWith('cancel'));
    });

    // The counterpart, and the reason it is a separate test: ActionList hands
    // its onClick to the button, so passing openPortal directly would have
    // React supply the click event as the flow argument.
    it('opens the portal home from Manage billing, with no cancel flow', async () => {
      vi.mocked(billingApi.createPortalSession).mockResolvedValue({ url: 'https://portal.test/x' });
      renderPage({ hasBilling: true });
      await userEvent.click(await screen.findByRole('button', { name: /Manage billing/ }));
      await waitFor(() => expect(billingApi.createPortalSession).toHaveBeenCalledWith(undefined));
    });

    // An annual subscriber, or one who paused this year already. The dialog is
    // still the cancellation flow; it simply has no offer to make.
    it('omits the pause when the account is not eligible', async () => {
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: false });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: 'Pause instead' })).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Continue to cancel' })).toBeVisible();
    });

    // Each refusal names a condition the teacher can act on, so the server's
    // wording is shown rather than a generic apology.
    it('surfaces the server’s reason when a pause is refused', async () => {
      const refusal: ApiError = {
        code: 'CONFLICT',
        message: 'Only monthly subscriptions can be paused.',
        status: 409,
      };
      vi.mocked(billingApi.pauseSubscription).mockRejectedValue(refusal);
      renderPage({ hasBilling: true, canCancel: true, pauseAvailable: true });
      await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Pause instead' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/only monthly subscriptions/i);
    });

    // Without this the page reads as a free account with a billing row and no
    // explanation, and a teacher who chose the pause would think they had been
    // cancelled.
    it('says so, with the resume date, while paused', async () => {
      renderPage({ hasBilling: true, canCancel: true, paused: true, pauseResumesAt: '2026-09-01T12:00:00.000Z' });
      expect(await screen.findByText(/subscription is paused/i)).toHaveTextContent(
        /September 1, 2026/,
      );
    });

    it('offers no cancellation while already paused', async () => {
      renderPage({ hasBilling: true, canCancel: true, paused: true });
      await screen.findByText(/subscription is paused/i);
      expect(screen.queryByRole('button', { name: /Cancel subscription/ })).toBeNull();
    });
  });
});

/**
 * The badges under the email address. Two separate questions: what access the
 * account has, and what is about to change about it.
 */
describe('the account badges', () => {
  it('shows the Premium mark on a paid account and no free label', async () => {
    renderPage({ plan: 'paid', hasBilling: true });
    expect(await screen.findByText('Premium')).toBeInTheDocument();
    expect(screen.queryByText('Free account')).not.toBeInTheDocument();
  });

  it('shows the free label on a free account and no Premium mark', async () => {
    renderPage({ plan: 'free', hasBilling: true });
    expect(await screen.findByText('Free account')).toBeInTheDocument();
    expect(screen.queryByText('Premium')).not.toBeInTheDocument();
  });

  /**
   * A trial reads as Premium, because `trial` and `paid` are
   * entitlement-identical and a trialling teacher does have Premium access. The
   * date badge beside it is what keeps that from reading as permanent.
   */
  it('marks a trial as Premium and states when it ends', async () => {
    renderPage({ plan: 'trial', trialEndsAt: '2026-09-13T00:00:00.000Z', hasBilling: true });
    expect(await screen.findByText('Premium')).toBeInTheDocument();
    expect(screen.getByText(/Trial ends .*2026/)).toBeInTheDocument();
  });

  it('states when a founding-user promo stops covering the subscription', async () => {
    renderPage({ plan: 'paid', promoEndsAt: '2027-08-17T00:00:00.000Z', hasBilling: true });
    expect(await screen.findByText(/Free promo pricing until .*2027/)).toBeInTheDocument();
  });

  /**
   * The common case for a founding-user promo, since it is aimed at new signups:
   * a promo redeemed while a trial is still running. Both dates are true and only
   * the promo's is operative — the account rolls from `trial` to `paid` at trial
   * end with no change in access and no charge — so announcing a transition that
   * does not happen is worse than saying nothing about it.
   */
  it('states only the promo date when a trial is also running', async () => {
    renderPage({
      plan: 'trial',
      trialEndsAt: '2026-09-13T00:00:00.000Z',
      promoEndsAt: '2027-08-17T00:00:00.000Z',
      hasBilling: true,
    });
    expect(await screen.findByText(/Free promo pricing until .*2027/)).toBeInTheDocument();
    expect(screen.queryByText(/Trial ends/)).not.toBeInTheDocument();
  });

  /**
   * The rule is the presence of a promo, not whether it outlasts the trial: a
   * promo ending first is the date of the first charge and so is operative, while
   * the trial end is not operative either way.
   */
  it('still prefers the promo date when the promo ends before the trial does', async () => {
    renderPage({
      plan: 'trial',
      trialEndsAt: '2026-09-13T00:00:00.000Z',
      promoEndsAt: '2026-08-25T00:00:00.000Z',
      hasBilling: true,
    });
    expect(await screen.findByText(/Free promo pricing until .*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Trial ends/)).not.toBeInTheDocument();
  });

  it('shows no date badge for a plain paid account', async () => {
    renderPage({ plan: 'paid', hasBilling: true });
    await screen.findByText('Premium');
    expect(screen.queryByText(/Trial ends/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Free promo pricing until/)).not.toBeInTheDocument();
  });

  /**
   * A paused account resolves to `free`, so the badge says so. On its own that
   * would alarm a teacher who chose the pause, which is why the notice explaining
   * it is not optional — asserted together so neither can be removed alone.
   */
  it('shows a paused account as free, alongside the notice that explains it', async () => {
    renderPage({ plan: 'free', paused: true, pauseResumesAt: '2026-09-01T00:00:00.000Z' });
    expect(await screen.findByText('Free account')).toBeInTheDocument();
    expect(screen.getByText(/Your subscription is paused/)).toBeInTheDocument();
  });
});

/**
 * The pause is withheld while a promo covers the subscription, because pausing
 * something that bills nothing spends two free months and the once-a-year
 * allowance to save nothing.
 */
describe('the cancellation dialog under a promo', () => {
  const future = new Date(Date.now() + 200 * 86_400_000).toISOString();

  it('tells a promo-covered teacher they are not being billed', async () => {
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false, promoEndsAt: future });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/not being billed at the moment/i);
    expect(dialog).toHaveTextContent(/covers you until/i);
    expect(within(dialog).queryByRole('button', { name: /Pause instead/ })).not.toBeInTheDocument();
  });

  /**
   * The expensive misreading. A discounted subscription renews monthly at zero,
   * so cancelling lands on the next monthly boundary rather than when the offer
   * ends — and a teacher cancelling now to avoid a charge eleven months away
   * would forfeit eleven free months to prevent nothing.
   */
  it('says cancelling ends the subscription before the offer does', async () => {
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    renderPage({
      plan: 'paid',
      canCancel: true,
      pauseAvailable: false,
      promoEndsAt: future,
      currentPeriodEnd: periodEnd,
    });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/end of the current billing month/i);
    expect(dialog).toHaveTextContent(/remaining promotional offer time would be lost/i);
  });

  /**
   * The standard sentence is replaced rather than joined, because it is wrong
   * twice for this teacher: nothing has been "already paid", and the period it
   * names ends long before the offer does.
   */
  it('drops the already-paid-for sentence while a promo runs', async () => {
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false, promoEndsAt: future });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent(/already paid for/i);
  });

  it('keeps the standard sentence for an ordinary paying subscriber', async () => {
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/already paid for/i);
  });

  // No date rather than a wrong one: the server withholds currentPeriodEnd
  // unless the subscription is live.
  it('still warns without naming a date when the period end is absent', async () => {
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false, promoEndsAt: future });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/end of the current billing month/i);
  });

  /**
   * `pauseAvailable` is false for several unrelated reasons — an annual plan, a
   * pause already taken this year — and this explanation describes none of them.
   */
  it('does not explain a promo to an account that has none', async () => {
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent(/not being billed at the moment/i);
  });

  it('says nothing about billing pauses once the promo has expired', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    renderPage({ plan: 'paid', canCancel: true, pauseAvailable: false, promoEndsAt: past });
    await userEvent.click(await screen.findByRole('button', { name: /Cancel subscription/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent(/not being billed at the moment/i);
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a). The page keeps everything a
 * teacher does to their account — the guide, the export, the deletion — and
 * loses every row and badge about money, because there is none.
 *
 * Asserted against a profile that would otherwise show all of it: a live
 * subscription with a Stripe customer behind it. The server withholds those
 * fields in reality; this pins the client's own behaviour so the page does not
 * depend on the server to hide them.
 */
describe('the account page with billing switched off', () => {
  it('shows no plan badge and no billing rows', async () => {
    renderPage({
      billingEnabled: false,
      plan: 'free',
      hasBilling: true,
      canCancel: true,
    });
    await screen.findByRole('heading', { name: 'Account settings' });

    expect(screen.queryByText('Free account')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to Premium/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument();
  });

  it('still offers the things that are not about money', async () => {
    renderPage({ billingEnabled: false, plan: 'free' });
    expect(
      await screen.findByRole('button', { name: /Delete account/ }),
    ).toBeInTheDocument();
  });
});
