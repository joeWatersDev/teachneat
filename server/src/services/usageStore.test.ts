import { describe, it, expect, vi } from 'vitest';
import {
  createMemoryUsageStore,
  periodBefore,
  windowStart,
  USAGE_RETENTION_MONTHS,
  USAGE_TOOLS,
} from './usageStore.js';
import { createActivityRecorder } from './activity.js';
import { createMemoryAccountStore, testAccount, type AccountStore } from './accountStore.js';

const JAN = new Date('2026-01-15T12:00:00Z');
const FEB = new Date('2026-02-02T09:00:00Z');

describe('usage counters', () => {
  it('accumulates within a month and separates across months', async () => {
    const usage = createMemoryUsageStore();
    await usage.record('acct-1', 'attendance', JAN);
    await usage.record('acct-1', 'attendance', JAN);
    await usage.record('acct-1', 'attendance', FEB);

    const rows = await usage.forAccount('acct-1', 24);
    // Newest month first, and January's two did not leak into February.
    expect(rows.map((r) => r.period)).toEqual(['2026-02', '2026-01']);
    expect(rows[0].counts.attendance).toBe(1);
    expect(rows[1].counts.attendance).toBe(2);
  });

  it('keeps one account’s counts out of another’s', async () => {
    const usage = createMemoryUsageStore();
    await usage.record('acct-1', 'email', JAN);
    await usage.record('acct-2', 'email', JAN);
    await usage.record('acct-2', 'email', JAN);

    expect((await usage.forAccount('acct-1', 24))[0].counts.email).toBe(1);
    expect((await usage.forAccount('acct-2', 24))[0].counts.email).toBe(2);
  });

  it('totals across accounts and counts how many contributed', async () => {
    const usage = createMemoryUsageStore();
    await usage.record('acct-1', 'grouping', JAN);
    await usage.record('acct-1', 'grouping', JAN);
    await usage.record('acct-2', 'grouping', JAN);

    const [jan] = await usage.totalsByPeriod(24);
    // Three uses, but only two teachers: the second number is the one that says
    // whether a tool is broadly used or heavily used by one person.
    expect(jan.counts.grouping).toBe(3);
    expect(jan.accounts.grouping).toBe(2);
  });

  it('prunes only what is past the retention window', async () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const usage = createMemoryUsageStore();
    const old = new Date('2023-01-10T00:00:00Z');
    await usage.record('acct-1', 'attendance', old);
    await usage.record('acct-1', 'attendance', now);

    expect(await usage.prune(now)).toBe(1);
    const rows = await usage.forAccount('acct-1', 240);
    expect(rows.map((r) => r.period)).toEqual(['2026-06']);
  });

  it('keeps the retention window wider than the metrics view reads', () => {
    // The view reads 12 months. If retention ever dropped below that, the page
    // would show a partly-pruned window as a decline that never happened.
    expect(USAGE_RETENTION_MONTHS).toBeGreaterThan(12);
  });

  it('computes period boundaries across a year edge', () => {
    expect(periodBefore(3, new Date('2026-02-10T00:00:00Z'))).toBe('2025-11');
  });

  it('spans exactly N months inclusive of the current one', () => {
    // The off-by-one this guards is easy to reintroduce: `period >= floor`
    // includes both endpoints, so a floor of "12 months ago" spans thirteen
    // buckets. Harmless on a chart, wrong in prune, where it kept counters for
    // 25 months against a policy that promises 24.
    const now = new Date('2026-08-19T00:00:00Z');
    expect(windowStart(12, now)).toBe('2025-09');
    const months = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const period = periodBefore(i, now);
      if (period >= windowStart(12, now)) months.add(period);
    }
    expect(months.size).toBe(12);
  });

  it('retains exactly the retention window and no more', async () => {
    const now = new Date('2026-08-19T00:00:00Z');
    const usage = createMemoryUsageStore();
    // The oldest month that must survive, and the newest that must not.
    const oldestKept = new Date('2024-09-15T00:00:00Z');
    const firstDropped = new Date('2024-08-15T00:00:00Z');
    await usage.record('acct-1', 'attendance', oldestKept);
    await usage.record('acct-1', 'attendance', firstDropped);

    expect(await usage.prune(now)).toBe(1);
    expect((await usage.forAccount('acct-1', 240)).map((r) => r.period)).toEqual(['2024-09']);
  });
});

describe('activity recorder', () => {
  function setup(): { store: AccountStore } {
    return { store: createMemoryAccountStore([testAccount({ googleSub: 'sub-1' })]) };
  }

  it('sets the milestone once and keeps counting after', async () => {
    const { store } = setup();
    const usage = createMemoryUsageStore();
    const activity = createActivityRecorder(store, usage);
    const ctx = { googleSub: 'sub-1', accountId: 'acct-1' };

    await activity.recordToolUse(ctx, 'attendance');
    const first = (await store.getByGoogleSub('sub-1'))?.firstAttendanceAt;
    expect(first).not.toBeNull();

    await activity.recordToolUse(ctx, 'attendance');
    // The milestone is the *first* use, so a second call must not move it,
    // while the counter must still go up.
    expect((await store.getByGoogleSub('sub-1'))?.firstAttendanceAt).toBe(first);
    expect((await usage.forAccount('acct-1', 24))[0].counts.attendance).toBe(2);
  });

  it('does not throw when the milestone write fails', async () => {
    const { store } = setup();
    store.markMilestone = vi.fn().mockRejectedValue(new Error('db down'));
    const activity = createActivityRecorder(store, createMemoryUsageStore());

    // Instrumentation must never be able to fail a request whose real work has
    // already succeeded.
    await expect(
      activity.recordToolUse({ googleSub: 'sub-1', accountId: 'acct-1' }, 'email'),
    ).resolves.toBeUndefined();
  });

  it('records a premium attempt without a counter', async () => {
    const { store } = setup();
    const usage = createMemoryUsageStore();
    await createActivityRecorder(store, usage).recordPremiumAttempt('sub-1');

    expect((await store.getByGoogleSub('sub-1'))?.firstPremiumAttemptAt).not.toBeNull();
    // A refusal is a milestone, not a usage count: nothing should have been
    // added to any tool's series.
    expect(await usage.totalsByPeriod(24)).toEqual([]);
  });

  it('covers every counted tool with a milestone', async () => {
    const { store } = setup();
    const activity = createActivityRecorder(store, createMemoryUsageStore());
    for (const tool of USAGE_TOOLS) {
      await activity.recordToolUse({ googleSub: 'sub-1', accountId: 'acct-1' }, tool);
    }
    const account = await store.getByGoogleSub('sub-1');
    expect([
      account?.firstAttendanceAt,
      account?.firstGroupingAt,
      account?.firstEmailAt,
      account?.firstPickerAt,
    ]).not.toContain(null);
  });
});
