import { logger } from '../config/logger.js';
import type { AccountStore, Milestone } from './accountStore.js';
import type { UsageStore, UsageTool } from './usageStore.js';

/**
 * The one call a route makes to record activation (Phase 2 Step 6j).
 *
 * Two writes belong to every instrumented action — the write-once milestone on
 * `users` and the monthly counter — and keeping them behind one function is
 * what stops a later call site recording one and forgetting the other. It also
 * gives the whole feature a single place to be switched off.
 *
 * Called *after* the teacher's work has succeeded, never before: a counter that
 * moved for a save that then failed is worse than no counter, because it is
 * wrong in the direction that flatters the product.
 */

/** Every tool counted also has a first-use milestone, under the same name. */
const MILESTONE_FOR_TOOL: Record<UsageTool, Milestone> = {
  attendance: 'attendance',
  grouping: 'grouping',
  email: 'email',
  picker: 'picker',
};

export interface ActivityContext {
  googleSub: string;
  accountId: string;
}

export interface ActivityRecorder {
  recordToolUse(ctx: ActivityContext, tool: UsageTool): Promise<void>;
  /**
   * Records that a free account ran into a premium gate. There is no counter
   * for this — the useful fact is that it happened at all, and counting
   * refusals would measure how often a teacher retried something they cannot
   * do, which tells you about the gate rather than about them.
   */
  recordPremiumAttempt(googleSub: string): Promise<void>;
}

export function createActivityRecorder(
  store: AccountStore,
  usage: UsageStore,
): ActivityRecorder {
  return {
    async recordToolUse({ googleSub, accountId }, tool) {
      // Awaited rather than fired and forgotten. Both writes are local
      // single-row statements against Postgres, next to a Sheets round trip
      // that dominates the request by two orders of magnitude, so the latency
      // is not worth the non-determinism that an un-awaited promise would add
      // to every test that asserts on a counter.
      //
      // Wrapped anyway: usage.record already swallows its own failures, but
      // markMilestone does not, and instrumentation must not be able to turn a
      // successful save into a 500 the teacher sees.
      try {
        await Promise.all([
          store.markMilestone(googleSub, MILESTONE_FOR_TOOL[tool]),
          usage.record(accountId, tool),
        ]);
      } catch (error) {
        logger.warn({ tool, err: error }, 'activity write failed');
      }
    },

    async recordPremiumAttempt(googleSub) {
      try {
        await store.markMilestone(googleSub, 'premiumAttempt');
      } catch (error) {
        logger.warn({ err: error }, 'premium attempt write failed');
      }
    },
  };
}
