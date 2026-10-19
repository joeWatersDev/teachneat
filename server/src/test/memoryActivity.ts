import { createActivityRecorder, type ActivityRecorder } from '../services/activity.js';
import { createMemoryUsageStore } from '../services/usageStore.js';
import type { AccountStore } from '../services/accountStore.js';

/**
 * An activity recorder backed entirely by memory, for tests that build a tool
 * router (Step 6j).
 *
 * The routers default their recorder to the Postgres usage store, which is
 * right in production and wrong in a unit test: a request that reaches a
 * recording call site would attempt a real connection, and because the recorder
 * swallows its own failures the attempt would be invisible rather than loud.
 * Passing this instead keeps those tests off the network.
 */
export function memoryActivity(accounts: AccountStore): ActivityRecorder {
  return createActivityRecorder(accounts, createMemoryUsageStore());
}
