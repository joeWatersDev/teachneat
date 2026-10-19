import { apiClient } from './client';

/** The two ways to pay for the single premium plan. There is no middle tier. */
export type BillingInterval = 'monthly' | 'annual';

/**
 * What each interval costs, for display. Duplicated from the server's
 * `ADVERTISED_PRICES` rather than fetched: it is copy on a button, and a network
 * round trip to render a price the page already knows would be a worse
 * experience than a constant.
 *
 * Two checks keep the copies honest, and it takes both. The server compares its
 * own figures against the live Stripe Price at startup, which catches a price
 * edited in the dashboard. And `server/src/config/billing.test.ts` reads the
 * strings below and asserts they carry the server's amounts, which catches this
 * file being left behind — the case that actually happens, since prices change
 * here in copy and there in arithmetic. Until that test existed this comment
 * claimed a guarantee the startup check never provided.
 */
export const PRICING: Record<
  BillingInterval,
  { label: string; price: string; caption: string }
> = {
  annual: {
    label: 'Annual',
    price: '$69.90 CAD / year',
    caption: 'Annual plan gets two months free',
  },
  monthly: {
    label: 'Monthly',
    price: '$6.99 CAD / month',
    caption: 'Cancel any time',
  },
};

/**
 * Starts checkout and returns the Stripe-hosted URL to send the browser to.
 * Card details are entered on Stripe's page and never touch this app.
 */
export function createCheckout(interval: BillingInterval): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>('/billing/checkout', { interval });
}

/**
 * Returns a Stripe billing-portal URL: cancellation, cards, invoices, receipts.
 *
 * `flow: 'cancel'` opens the portal on its cancellation page rather than its
 * home page. Without it the "Continue to cancel" button and the "Manage
 * billing" row land in exactly the same place, and a teacher who has already
 * said they want to cancel has to go and find the control again.
 */
export function createPortalSession(flow?: 'cancel'): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>('/billing/portal', flow ? { flow } : {});
}

/** How long a subscription may be paused, and the default the dialog opens on. */
export const PAUSE_MONTH_CHOICES = [1, 2, 3] as const;
export const PAUSE_DEFAULT_MONTHS = 2;

/**
 * Pauses billing for one to three months (Phase 2 Step 6i).
 *
 * Offered inside the cancellation flow and nowhere else — not on the pricing
 * page, and not as a standalone row here. At list prices a monthly subscriber
 * who pauses for two months pays exactly the annual price, so advertising the
 * pause tells every visitor that annual has no advantage; told to the teacher
 * who is already leaving, it is a reason to stay.
 *
 * The response carries the resume date but not a plan: the Stripe webhook is
 * the sole writer of subscription state, so the caller refreshes the profile
 * rather than assuming the pause has landed.
 */
export function pauseSubscription(
  months: number = PAUSE_DEFAULT_MONTHS,
): Promise<{ resumesAt: string; months: number }> {
  return apiClient.post<{ resumesAt: string; months: number }>('/billing/pause', { months });
}
