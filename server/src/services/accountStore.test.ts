import { describe, it, expect } from 'vitest';
import { createMemoryAccountStore } from './accountStore.js';

const input = {
  googleSub: 'sub-123',
  email: 'teacher@example.com',
  name: 'Teacher',
  avatarUrl: 'https://example.com/a.png',
  refreshToken: 'rt_secret',
};

describe('memory account store', () => {
  it('returns null for an unknown sub', async () => {
    const store = createMemoryAccountStore();
    expect(await store.getByGoogleSub('nope')).toBeNull();
  });

  it('inserts on first upsert and reads back', async () => {
    const store = createMemoryAccountStore();
    const created = await store.upsert(input);
    expect(created.id).toBeTruthy();
    expect(created.spreadsheetId).toBeNull();
    expect(created.subscriptionStatus).toBe('inactive');
    const fetched = await store.getByGoogleSub('sub-123');
    expect(fetched?.email).toBe('teacher@example.com');
    expect(fetched?.refreshToken).toBe('rt_secret');
  });

  it('keeps id + spreadsheetId and updates identity on re-upsert', async () => {
    const store = createMemoryAccountStore();
    const first = await store.upsert(input);
    await store.updateSpreadsheetId('sub-123', 'SHEET1');
    const second = await store.upsert({ ...input, name: 'New Name', refreshToken: 'rt_new' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('New Name');
    expect(second.refreshToken).toBe('rt_new');
    expect(second.spreadsheetId).toBe('SHEET1');
  });

  it('sets the spreadsheet id', async () => {
    const store = createMemoryAccountStore();
    await store.upsert(input);
    await store.updateSpreadsheetId('sub-123', 'SHEET123');
    expect((await store.getByGoogleSub('sub-123'))?.spreadsheetId).toBe('SHEET123');
  });

  it('deletes an account', async () => {
    const store = createMemoryAccountStore();
    await store.upsert(input);
    await store.delete('sub-123');
    expect(await store.getByGoogleSub('sub-123')).toBeNull();
  });

  it('isolates two accounts by sub', async () => {
    const store = createMemoryAccountStore();
    await store.upsert(input);
    await store.upsert({ ...input, googleSub: 'sub-456', email: 'other@example.com' });
    expect((await store.getByGoogleSub('sub-123'))?.email).toBe('teacher@example.com');
    expect((await store.getByGoogleSub('sub-456'))?.email).toBe('other@example.com');
  });
});
