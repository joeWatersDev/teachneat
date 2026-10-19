import { describe, it, expect } from 'vitest';
import { testAccount } from './accountStore.js';
import { resolvePlan, resolveEffectivePlan, isPremium, effectiveHighAbsence } from './plan.js';
import { withBillingEnabled } from '../test/billing.js';
import { DEFAULT_HIGH_ABSENCE } from '../config/plan.js';

const NOW = new Date('2026-07-28T00:00:00Z');
const future = new Date('2026-08-27T00:00:00Z').toISOString();
const past = new Date('2026-06-01T00:00:00Z').toISOString();

describe('resolvePlan', () => {
  it('resolves a new account with an unexpired trial to trial', () => {
    expect(resolvePlan(testAccount({ trialEndsAt: future }), NOW)).toBe('trial');
  });

  it('drops an expired trial with no subscription to free, not a lockout', () => {
    expect(resolvePlan(testAccount({ trialEndsAt: past }), NOW)).toBe('free');
  });

  it('resolves an active subscription to paid even after the trial expired', () => {
    const account = testAccount({ trialEndsAt: past, subscriptionStatus: 'active' });
    expect(resolvePlan(account, NOW)).toBe('paid');
  });

  it('resolves an account with neither trial nor subscription to free', () => {
    expect(resolvePlan(testAccount(), NOW)).toBe('free');
  });

  // Each layer must win over the ones below it.
  it('lets plan_override win over an unexpired trial and an active subscription', () => {
    const account = testAccount({
      planOverride: 'free',
      trialEndsAt: future,
      subscriptionStatus: 'active',
    });
    expect(resolvePlan(account, NOW)).toBe('free');
  });

  it('falls back to an unexpired trial when the subscription is not a live one', () => {
    const account = testAccount({ trialEndsAt: future, subscriptionStatus: 'canceled' });
    expect(resolvePlan(account, NOW)).toBe('trial');
  });

  /**
   * The ordinary case for the founding-user promo, which is aimed at new signups:
   * a teacher subscribes while their trial is still running. Resolving that to
   * `trial` granted the same access but drove the interface to keep offering
   * "Upgrade to Premium" in the account menu and a trial countdown with its own
   * upgrade button in the sidebar, to someone whose card had just been taken.
   */
  it('resolves to paid when a subscription is taken during the trial', () => {
    const account = testAccount({ trialEndsAt: future, subscriptionStatus: 'active' });
    expect(resolvePlan(account, NOW)).toBe('paid');
  });

  /**
   * A pause must not cost a teacher trial time they still have. The pause
   * disqualifies the subscription, and resolution then falls through to the
   * trial rather than straight to `free`.
   */
  it('keeps trial access when a subscription is paused during the trial', () => {
    const account = testAccount({
      trialEndsAt: future,
      subscriptionStatus: 'active',
      collectionPaused: true,
    });
    expect(resolvePlan(account, NOW)).toBe('trial');
  });

  it('drops a paused subscription with no trial left to free', () => {
    const account = testAccount({
      trialEndsAt: past,
      subscriptionStatus: 'active',
      collectionPaused: true,
    });
    expect(resolvePlan(account, NOW)).toBe('free');
  });

  it('treats trial and paid as entitlement-identical', () => {
    expect(isPremium('trial')).toBe(true);
    expect(isPremium('paid')).toBe(true);
    expect(isPremium('free')).toBe(false);
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a), which is one branch and is
 * asserted in both directions because the whole premium boundary hangs off it.
 * Off, every account is entitled regardless of what `resolvePlan` would say;
 * on, this must be `resolvePlan` and nothing else, or the day billing returns
 * it returns subtly wrong.
 */
describe('resolveEffectivePlan', () => {
  describe('with billing switched off, which is the launch default', () => {
    it('resolves an expired trial and no subscription to paid, not free', () => {
      expect(resolveEffectivePlan(testAccount({ trialEndsAt: past }), NOW)).toBe('paid');
    });

    it('ignores an explicit free override', () => {
      expect(resolveEffectivePlan(testAccount({ planOverride: 'free' }), NOW)).toBe('paid');
    });

    it('resolves a paused subscription to paid rather than dropping it to free', () => {
      const account = testAccount({
        trialEndsAt: past,
        subscriptionStatus: 'active',
        collectionPaused: true,
      });
      expect(resolveEffectivePlan(account, NOW)).toBe('paid');
    });
  });

  describe('with billing switched on', () => {
    withBillingEnabled();

    it('agrees with resolvePlan on every account it is given', () => {
      const accounts = [
        testAccount({ trialEndsAt: future }),
        testAccount({ trialEndsAt: past }),
        testAccount({ trialEndsAt: past, subscriptionStatus: 'active' }),
        testAccount({ planOverride: 'free' }),
        testAccount({ trialEndsAt: past, subscriptionStatus: 'active', collectionPaused: true }),
        testAccount(),
      ];
      for (const account of accounts) {
        expect(resolveEffectivePlan(account, NOW)).toBe(resolvePlan(account, NOW));
      }
    });
  });
});

describe('effectiveHighAbsence', () => {
  const stored = { minAbsenceRate: 0.3, minDaysRecorded: 10 };

  it('applies a stored threshold on trial and paid', () => {
    const account = testAccount({ highAbsence: stored });
    expect(effectiveHighAbsence(account, 'paid')).toEqual({ threshold: stored, isDefault: false });
    expect(effectiveHighAbsence(account, 'trial')).toEqual({ threshold: stored, isDefault: false });
  });

  // Stored but not applied: a free account keeps one fixed definition, and the
  // saved value survives for re-upgrade rather than being reset.
  it('computes a free account with the default even when it has a stored threshold', () => {
    const account = testAccount({ highAbsence: stored });
    expect(effectiveHighAbsence(account, 'free')).toEqual({
      threshold: DEFAULT_HIGH_ABSENCE,
      isDefault: true,
    });
    expect(account.highAbsence).toEqual(stored);
  });

  it('returns the default when no threshold is stored', () => {
    expect(effectiveHighAbsence(testAccount(), 'paid')).toEqual({
      threshold: DEFAULT_HIGH_ABSENCE,
      isDefault: true,
    });
  });
});
