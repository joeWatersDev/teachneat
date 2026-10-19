import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { UpgradeModal } from '../components/billing/UpgradeModal';
import { useEntitlements } from './useEntitlements';

/**
 * One upgrade modal for the whole app, opened from wherever a teacher meets the
 * paid boundary. A shared provider rather than per-component state because there
 * are several entry points and two of them (the account menu and the sidebar
 * footer) are in different subtrees — duplicating the modal would let two open
 * at once.
 */
interface UpgradeValue {
  /** Opens the modal. Safe to call from any plan; the callers decide when. */
  openUpgrade: () => void;
  /**
   * Whether a **gated control** should offer an upgrade prompt.
   *
   * True on `free` only, deliberately. On `trial` a premium control is live and
   * merely badged, so an upgrade prompt attached to it would interrupt someone
   * who currently has access, to sell them something they already have. The
   * account menu and the sidebar footer are different: those are places a
   * teacher goes deliberately, so they offer the upgrade on `trial` too.
   *
   * **A paused account is excluded even though it resolves to `free`**, and this
   * one is not a matter of tone. A paused subscription still exists, so sending
   * that teacher to Checkout creates a *second* subscription: the webhook
   * overwrites `stripe_subscription_id` with the new one, the paused subscription
   * is orphaned where nothing in the app can see it, and it starts billing again
   * on its resume date. They would be paying twice, and the app would show one.
   *
   * The gated-control entry points are not built yet — they arrive with the
   * pricing page (Phase 2 Step 5). This is here so the rule is defined in one
   * place when they are.
   */
  promptFromGatedControls: boolean;
}

const UpgradeContext = createContext<UpgradeValue | null>(null);

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { billingEnabled, plan, lapsedFrom } = useEntitlements();
  const [open, setOpen] = useState(false);
  const openUpgrade = useCallback(() => setOpen(true), []);

  const value = useMemo<UpgradeValue>(
    () => ({
      openUpgrade,
      // Step 8a: nothing is gated while billing is off, so there is nothing to
      // prompt from.
      promptFromGatedControls: billingEnabled && plan === 'free' && lapsedFrom !== 'paused',
    }),
    [openUpgrade, billingEnabled, plan, lapsedFrom],
  );

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      {/* Mounted only when there is something to sell. The provider itself
          stays in the tree at every plan, so the components that read this
          context do not have to care whether billing is on. */}
      {billingEnabled && open && <UpgradeModal onClose={() => setOpen(false)} />}
    </UpgradeContext.Provider>
  );
}

export function useUpgrade(): UpgradeValue {
  const v = useContext(UpgradeContext);
  if (!v) throw new Error('useUpgrade must be used inside <UpgradeProvider>');
  return v;
}

/**
 * The same value, or null outside a provider.
 *
 * For shared primitives that offer an upgrade as a secondary affordance rather
 * than as their purpose — `PremiumNotice` is the one — where throwing would
 * make a presentational component untestable in isolation and would couple
 * every one of its call sites to billing being mounted. The same reasoning that
 * split `EntitlementsProvider` from its wiring: a component should not require
 * a provider for a control it merely might render.
 */
export function useUpgradeIfAvailable(): UpgradeValue | null {
  return useContext(UpgradeContext);
}
