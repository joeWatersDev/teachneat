import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createAesGcmCipher, createKeyedCipher } from './tokenCipher.js';

describe('token cipher (AES-256-GCM)', () => {
  it('roundtrips encrypt/decrypt with the same key', () => {
    const cipher = createAesGcmCipher('k'.repeat(32));
    const enc = cipher.encrypt('rt_secret');
    expect(enc).not.toContain('rt_secret');
    expect(cipher.decrypt(enc)).toBe('rt_secret');
  });

  it('produces a distinct ciphertext each call (random IV)', () => {
    const cipher = createAesGcmCipher('k'.repeat(32));
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('fails to decrypt with a wrong key', () => {
    const enc = createAesGcmCipher('k'.repeat(32)).encrypt('rt_secret');
    expect(() => createAesGcmCipher('x'.repeat(32)).decrypt(enc)).toThrow();
  });

  it('rejects an undersized key', () => {
    expect(() => createAesGcmCipher('tiny').encrypt('x')).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => createAesGcmCipher('k'.repeat(32)).decrypt('garbage')).toThrow();
  });
});

describe('keyed cipher (Step 6d)', () => {
  const k1 = { id: 'k1', key: crypto.randomBytes(32) };
  const k2 = { id: 'k2', key: crypto.randomBytes(32) };

  it('roundtrips and names the active key in the payload', () => {
    const cipher = createKeyedCipher([k1], 'k1');
    const enc = cipher.encrypt('rt_secret');
    expect(enc.startsWith('v2:k1.')).toBe(true);
    expect(enc).not.toContain('rt_secret');
    expect(cipher.decrypt(enc)).toBe('rt_secret');
  });

  it('still decrypts a row written by a key that is no longer active', () => {
    const before = createKeyedCipher([k1], 'k1').encrypt('rt_secret');
    const after = createKeyedCipher([k1, k2], 'k2');
    expect(after.encrypt('x').startsWith('v2:k2.')).toBe(true);
    expect(after.decrypt(before)).toBe('rt_secret');
  });

  it('reads a legacy unkeyed payload through the cutover secret', () => {
    const secret = 'k'.repeat(32);
    const legacy = createAesGcmCipher(secret).encrypt('rt_secret');
    expect(createKeyedCipher([k1], 'k1', secret).decrypt(legacy)).toBe('rt_secret');
  });

  it('refuses a legacy payload when no cutover secret is configured', () => {
    const legacy = createAesGcmCipher('k'.repeat(32)).encrypt('rt_secret');
    expect(() => createKeyedCipher([k1], 'k1').decrypt(legacy)).toThrow();
  });

  it('refuses a payload naming a key that is not in the ring', () => {
    const enc = createKeyedCipher([k2], 'k2').encrypt('rt_secret');
    expect(() => createKeyedCipher([k1], 'k1').decrypt(enc)).toThrow(/unknown key/);
  });

  it('refuses an active id that is not in the ring, and a wrong-sized key', () => {
    expect(() => createKeyedCipher([k1], 'k9')).toThrow();
    expect(() => createKeyedCipher([{ id: 'k1', key: crypto.randomBytes(16) }], 'k1')).toThrow();
  });
});
