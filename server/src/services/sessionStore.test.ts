import { describe, it, expect } from 'vitest';
import {
  createMemorySessionStore,
  hashSessionId,
  newSessionId,
  newCsrfToken,
} from './sessionStore.js';

describe('session store', () => {
  it('creates a session with a distinct id and CSRF token', async () => {
    const store = createMemorySessionStore();
    const a = await store.create('user-1');
    const b = await store.create('user-1');
    expect(a.id).not.toBe(b.id);
    expect(a.csrfToken).not.toBe(b.csrfToken);
    expect(a.googleSub).toBe('user-1');
  });

  it('resolves a session by its raw id', async () => {
    const store = createMemorySessionStore();
    const created = await store.create('user-1');
    const found = await store.get(created.id);
    expect(found?.googleSub).toBe('user-1');
    expect(found?.csrfToken).toBe(created.csrfToken);
  });

  it('returns null for an unknown id', async () => {
    const store = createMemorySessionStore();
    expect(await store.get(newSessionId())).toBeNull();
  });

  it('destroys a single session', async () => {
    const store = createMemorySessionStore();
    const created = await store.create('user-1');
    await store.destroy(created.id);
    expect(await store.get(created.id)).toBeNull();
  });

  it('destroys every session for a user, leaving other users alone', async () => {
    const store = createMemorySessionStore();
    const first = await store.create('user-1');
    const second = await store.create('user-1');
    const other = await store.create('user-2');
    await store.destroyAllForUser('user-1');
    expect(await store.get(first.id)).toBeNull();
    expect(await store.get(second.id)).toBeNull();
    expect(await store.get(other.id)).not.toBeNull();
  });
});

describe('session id hashing', () => {
  it('is stable and does not reveal the id', () => {
    const id = newSessionId();
    expect(hashSessionId(id)).toBe(hashSessionId(id));
    expect(hashSessionId(id)).not.toContain(id);
    expect(hashSessionId(id)).toHaveLength(64);
  });

  it('generates high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newCsrfToken()));
    expect(tokens.size).toBe(200);
  });
});
