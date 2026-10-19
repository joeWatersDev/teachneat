import type { ReactNode } from 'react';
import { EntitlementsProvider } from '../hooks/useEntitlements';
import { UpgradeProvider } from '../hooks/useUpgrade';
import { DEFAULT_HIGH_ABSENCE } from '../features/attendance/thresholds';
import type { LapsedFrom, Plan } from '../api/auth';
import type { HighAbsenceThreshold, Settings } from '../api/settings';

/**
 * Wraps a component under test in the entitlements context. Defaults to `paid`
 * — no badges, nothing disabled — so a test only opts into plan state when the
 * plan is what it is asserting on.
 *
 * `UpgradeProvider` is nested here because that is exactly where it sits in
 * App.tsx: inside the entitlements provider, wrapping the shell. Keeping the
 * test tree the same shape as the real one means a component that reads either
 * context works in tests without each suite knowing which it happens to use.
 */
export function WithEntitlements({
  children,
  billingEnabled = true,
  plan = 'paid',
  trialEndsAt = null,
  lapsedFrom = null,
  highAbsence = DEFAULT_HIGH_ABSENCE,
  storedOverride = null,
}: {
  children: ReactNode;
  /**
   * Defaults to on, which is *not* what ships (Phase 2 Step 8a).
   *
   * The premium boundary is dormant for the first school year but the code is
   * all still here, so the suites describing it keep describing it and stay the
   * proof that it works on the day it comes back. Tests asserting the launch
   * shape pass `billingEnabled={false}` explicitly.
   */
  billingEnabled?: boolean;
  plan?: Plan;
  trialEndsAt?: string | null;
  lapsedFrom?: LapsedFrom | null;
  highAbsence?: HighAbsenceThreshold;
  storedOverride?: HighAbsenceThreshold | null;
}) {
  const settings: Settings = {
    highAbsence: { ...highAbsence, isDefault: storedOverride === null },
    storedOverride,
  };
  return (
    <EntitlementsProvider
      billingEnabled={billingEnabled}
      plan={plan}
      trialEndsAt={trialEndsAt}
      lapsedFrom={lapsedFrom}
      fetchSettings={() => Promise.resolve(settings)}
    >
      <UpgradeProvider>{children}</UpgradeProvider>
    </EntitlementsProvider>
  );
}
