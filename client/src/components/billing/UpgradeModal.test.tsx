import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeModal } from './UpgradeModal';
import * as billingApi from '../../api/billing';

vi.mock('../../api/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  createCheckout: vi.fn(),
}));

/** Checkout is a full navigation to a Stripe-hosted page, so this is the effect. */
let assigned: string | null = null;

beforeEach(() => {
  assigned = null;
  vi.stubGlobal('location', { assign: (url: string) => (assigned = url) });
  vi.mocked(billingApi.createCheckout).mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('UpgradeModal', () => {
  // Annual is the default we want a teacher to have to actively move away from.
  // The reasoning is retention rather than fee efficiency (see NEXT_STEPS,
  // "Billing provider"), but either way the default is the decision.
  it('preselects annual and starts checkout with it', async () => {
    render(<UpgradeModal onClose={() => {}} />);

    expect(screen.getByRole('radio', { name: /69\.90/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /6\.99/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(billingApi.createCheckout).toHaveBeenCalledWith('annual');
  });

  it('starts checkout with monthly when the teacher picks it', async () => {
    render(<UpgradeModal onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: /6\.99/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(billingApi.createCheckout).toHaveBeenCalledWith('monthly');
  });

  it('sends the browser to the Stripe-hosted URL', async () => {
    render(<UpgradeModal onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(assigned).toBe('https://checkout.stripe.com/x'));
  });

  // A failure here must be recoverable in place: the teacher is mid-intent, and
  // a dead button with no explanation is the worst outcome.
  it('reports a failure and lets the teacher try again', async () => {
    vi.mocked(billingApi.createCheckout).mockRejectedValue(new Error('nope'));
    render(<UpgradeModal onClose={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not start checkout/);
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
    expect(assigned).toBeNull();
  });
});
