import { describe, it, expect } from 'vitest';
import {
  createMemorySupportStore,
  SUPPORT_RETENTION_MONTHS,
  type SupportRequest,
} from './supportStore.js';

/**
 * Step 6d. The privacy policy states a retention ceiling for resolved support
 * requests, so these are tests of a published promise rather than of a tidy-up.
 */
function seed(overrides: Partial<SupportRequest>): SupportRequest {
  return {
    id: 'r1',
    googleSub: 'sub-1',
    category: 'question',
    subject: 's',
    message: 'm',
    status: 'new',
    adminNote: '',
    planAtSubmit: 'free',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString();
}

describe('support request retention', () => {
  it('deletes a request resolved beyond the retention window', async () => {
    const store = createMemorySupportStore([
      seed({ status: 'resolved', resolvedAt: monthsAgo(SUPPORT_RETENTION_MONTHS + 1) }),
    ]);
    expect(await store.prune()).toBe(1);
    expect(await store.get('r1')).toBeNull();
  });

  it('keeps a request resolved inside the window', async () => {
    const store = createMemorySupportStore([
      seed({ status: 'resolved', resolvedAt: monthsAgo(SUPPORT_RETENTION_MONTHS - 1) }),
    ]);
    expect(await store.prune()).toBe(0);
    expect(await store.get('r1')).not.toBeNull();
  });

  it('never deletes an unresolved request, however old', async () => {
    const store = createMemorySupportStore([
      seed({ status: 'open', createdAt: monthsAgo(60), updatedAt: monthsAgo(60) }),
    ]);
    expect(await store.prune()).toBe(0);
  });

  it('starts the clock on resolution and stops it on reopening', async () => {
    const store = createMemorySupportStore([seed({})]);
    expect((await store.update('r1', { status: 'resolved' }))?.resolvedAt).not.toBeNull();
    expect((await store.update('r1', { status: 'open' }))?.resolvedAt).toBeNull();
  });

  it('leaves the clock alone when only the note changes', async () => {
    const resolvedAt = monthsAgo(1);
    const store = createMemorySupportStore([seed({ status: 'resolved', resolvedAt })]);
    const updated = await store.update('r1', { adminNote: 'chased' });
    expect(updated?.resolvedAt).toBe(resolvedAt);
  });
});
