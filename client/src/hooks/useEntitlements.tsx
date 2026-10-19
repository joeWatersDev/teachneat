import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './useAuth';
import type { LapsedFrom, Plan } from '../api/auth';
import { getSettings, type HighAbsenceThreshold, type Settings } from '../api/settings';
import { DEFAULT_HIGH_ABSENCE } from '../features/attendance/thresholds';

/**
 * Plan state and the one server-applied setting, in one place so every tool
 * agrees. This is presentation only: what a control looks like, and which
 * threshold the client renders flags with. Enforcement is server-side on every
 * gated endpoint, so nothing here is a security boundary.
 */
interface EntitlementsValue {
  /**
   * Whether the product charges anybody (Phase 2 Step 8a), read from the
   * profile rather than built in, so the client and the server cannot disagree
   * about it.
   *
   * False for the first school year: no plan boundary, no trial, no upgrade
   * path. Every premium affordance in the app checks this and renders nothing
   * — the star markers, the sidebar plan card and its countdown, the account
   * menu's upgrade item, the billing section of account settings, the upgrade
   * modal. It is deliberately not inferred from `plan === 'paid'`: a comped
   * account is also `paid` and should still see that Premium is a thing.
   */
  billingEnabled: boolean;
  plan: Plan;
  /** `trial` and `paid` are entitlement-identical; only the badge differs. */
  isPremium: boolean;
  /** `trial` is the one state where a premium control is live *and* badged. */
  isTrial: boolean;
  /** When the trial runs out, for the sidebar's countdown. Null on other plans. */
  trialEndsAt: string | null;
  /**
   * Why this account is on `free`, when it has had premium before (Step 6h,
   * widened once it turned out there are three reasons and not two). Chooses the
   * wording on a locked surface and nothing else; every value resolves to the
   * same locked control.
   *
   * Null means the account has never been premium, which the copy treats as an
   * invitation rather than an explanation.
   */
  lapsedFrom: LapsedFrom | null;
  /**
   * The threshold the server is actually applying — the product default on
   * `free`, the account's stored value on `trial` and `paid`. Read rather than
   * assumed, so the roster icons, the detail summary, the Statistics flag, and
   * the email tool's high-absence selection can never disagree.
   */
  highAbsence: HighAbsenceThreshold;
  /** The saved threshold a lapsed account would get back on upgrade, if any. */
  storedOverride: HighAbsenceThreshold | null;
  settingsLoaded: boolean;
  /** Re-reads settings, after the threshold is changed or the plan moves. */
  refreshSettings: () => Promise<void>;
}

const EntitlementsContext = createContext<EntitlementsValue | null>(null);

export function EntitlementsProvider({
  billingEnabled,
  plan,
  trialEndsAt = null,
  lapsedFrom = null,
  children,
  fetchSettings = getSettings,
}: {
  /**
   * Required rather than defaulted, deliberately. There are two call sites and
   * they want opposite defaults — the app renders the launch shape, the test
   * harness describes the full product — so a default here would silently be
   * wrong for one of them.
   */
  billingEnabled: boolean;
  /** Taken as given rather than read from auth, so the provider stays pure. */
  plan: Plan;
  trialEndsAt?: string | null;
  lapsedFrom?: LapsedFrom | null;
  children: ReactNode;
  /** Override the /settings read in tests. */
  fetchSettings?: () => Promise<Settings>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await fetchSettings());
    } catch {
      // Non-critical: the default threshold below keeps every flag working, and
      // the server is the one that actually applies it either way.
      setSettings(null);
    }
  }, [fetchSettings]);

  // The effective threshold changes with the plan (a free account is computed
  // with the default), so re-read when the plan moves.
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSettings, plan]);

  const value = useMemo<EntitlementsValue>(
    () => ({
      billingEnabled,
      plan,
      // With billing off every account is entitled server-side, and the client
      // must agree or it would draw a lock over a control that works.
      isPremium: !billingEnabled || plan !== 'free',
      isTrial: billingEnabled && plan === 'trial',
      trialEndsAt: billingEnabled ? trialEndsAt : null,
      // Only meaningful on `free`; a premium account is not lapsed whatever its
      // history, and the server omits it in that case anyway.
      lapsedFrom: billingEnabled && plan === 'free' ? lapsedFrom : null,
      highAbsence: settings
        ? {
            minAbsenceRate: settings.highAbsence.minAbsenceRate,
            minDaysRecorded: settings.highAbsence.minDaysRecorded,
          }
        : DEFAULT_HIGH_ABSENCE,
      storedOverride: settings?.storedOverride ?? null,
      settingsLoaded: settings !== null,
      refreshSettings,
    }),
    [billingEnabled, plan, trialEndsAt, lapsedFrom, settings, refreshSettings],
  );

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

/** The app's wiring: the plan comes from the signed-in account's profile. */
export function AccountEntitlementsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  return (
    <EntitlementsProvider
      billingEnabled={profile?.billingEnabled ?? false}
      plan={profile?.plan ?? 'free'}
      trialEndsAt={profile?.trialEndsAt ?? null}
      lapsedFrom={profile?.lapsedFrom ?? null}
    >
      {children}
    </EntitlementsProvider>
  );
}

export function useEntitlements(): EntitlementsValue {
  const v = useContext(EntitlementsContext);
  if (!v) throw new Error('useEntitlements must be used inside <EntitlementsProvider>');
  return v;
}
