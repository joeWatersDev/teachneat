import { afterAll, beforeAll } from 'vitest';

/**
 * Runs the enclosing suite with billing switched on (Phase 2 Step 8a).
 *
 * The launch is free to every account, so `BILLING_ENABLED` is off by default
 * and every entitlement resolves to full access. That is the shipped behaviour
 * and it has its own tests. But the plan split, the gates, the trial and the
 * lifecycle scans are all still here, dormant, waiting to be turned back on —
 * and code that ships dormant is code that is not exercised, which is how it
 * comes back broken.
 *
 * So the suites that describe the paid product keep describing it, under this,
 * and the suites that describe the launch assert the default. Call it at the
 * top of a `describe` block.
 */
export function withBillingEnabled(): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.BILLING_ENABLED;
    process.env.BILLING_ENABLED = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = previous;
  });
}
