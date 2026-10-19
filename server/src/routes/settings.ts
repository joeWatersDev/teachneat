import { Router } from 'express';
import { z } from 'zod';
import { loadAccount, planOf, requirePremium } from '../middleware/entitlements.js';
import { createPgAccountStore, type Account, type AccountStore } from '../services/accountStore.js';
import { effectiveHighAbsence, resolveEffectivePlan, isPremium } from '../services/plan.js';
import { DEFAULT_HIGH_ABSENCE } from '../config/plan.js';

/**
 * Per-teacher settings that change what the server computes, as opposed to the
 * display and styling preferences, which are cosmetic and stay in localStorage.
 * Stored on the account record rather than the teacher's Sheet: the threshold is
 * a scalar preference, not student data, it has to be applied server-side, and
 * keeping it out of the Sheet avoids a read on every risk calculation.
 */

/**
 * Only the rate is the teacher's to choose. The minimum sample stays fixed at
 * the product default: it exists to stop a class with two recorded days from
 * flagging everyone, which is a statistical guard rather than a policy choice,
 * and exposing it asked teachers to reason about sample size to set a threshold
 * they think of purely as a percentage. The column still stores it, so the lever
 * can come back without a migration.
 */
const highAbsenceSchema = z.object({ minAbsenceRate: z.number().min(0.01).max(1) }).strict();

const settingsUpdateSchema = z.object({ highAbsence: highAbsenceSchema }).strict();

/**
 * The effective threshold, plus the account's stored one when it exists and is
 * not currently being applied — so a lapsed teacher can be shown what upgrading
 * would restore rather than being told their setting vanished.
 */
function settingsPayload(account: Account) {
  const plan = resolveEffectivePlan(account);
  const { threshold, isDefault } = effectiveHighAbsence(account, plan);
  const stored = account.highAbsence;
  return {
    highAbsence: { ...threshold, isDefault },
    storedOverride: stored && !isPremium(plan) ? stored : null,
  };
}

export function buildSettingsRouter(store: AccountStore = createPgAccountStore()): Router {
  const router = Router();

  // Deliberately not gated: the high-absence tooltip names the threshold on
  // every plan, so a free account must be able to read what it cannot change.
  router.get('/', async (req, res, next) => {
    try {
      res.json(settingsPayload(await loadAccount(req, store)));
    } catch (e) {
      next(e);
    }
  });

  router.put(
    '/',
    requirePremium(store, 'Choosing the high-absence threshold'),
    async (req, res, next) => {
      try {
        const { account } = await planOf(req, store);
        const { highAbsence } = settingsUpdateSchema.parse(req.body);
        // The sample minimum is not the teacher's to set, so it is written from
        // the product default rather than from the request.
        const stored = {
          minAbsenceRate: highAbsence.minAbsenceRate,
          minDaysRecorded: DEFAULT_HIGH_ABSENCE.minDaysRecorded,
        };
        await store.setHighAbsence(account.googleSub, stored);
        res.json(settingsPayload({ ...account, highAbsence: stored }));
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
