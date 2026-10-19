import { describe, it, expect } from 'vitest';
import { assertEnvironmentIsCoherent, isPublicOrigin } from './env.js';

/**
 * The guard against deploying with `NODE_ENV` unset.
 *
 * `nodeEnv` defaults to `development`, and three security decisions hang off it:
 * the session cookie's `Secure` flag, whether the KMS-held token key is
 * required, and whether the development plan toggle can exist. All three fail
 * open, so a deployment missing the variable keeps working and says nothing.
 *
 * What is asserted here is that the check is narrow enough to be safe to make
 * fatal. A false positive stops a developer from working, so the cases that must
 * *not* trip it matter as much as the one that must.
 */
describe('isPublicOrigin', () => {
  it('is true for the real deployment', () => {
    expect(isPublicOrigin('https://teachneat.com')).toBe(true);
  });

  it('is false for the local dev client, which is what npm run dev uses', () => {
    expect(isPublicOrigin('http://localhost:5173')).toBe(false);
  });

  it('is false for local hosts even over https, so a local TLS setup still works', () => {
    expect(isPublicOrigin('https://localhost:5173')).toBe(false);
    expect(isPublicOrigin('https://127.0.0.1:5173')).toBe(false);
  });

  it('is false for a plain-http remote host, which is not a deployment we make', () => {
    expect(isPublicOrigin('http://teachneat.com')).toBe(false);
  });

  it('is false for a malformed value rather than guessing', () => {
    expect(isPublicOrigin('')).toBe(false);
    expect(isPublicOrigin('not a url')).toBe(false);
  });
});

describe('assertEnvironmentIsCoherent', () => {
  it('refuses to start a public deployment that is not marked production', () => {
    expect(() => assertEnvironmentIsCoherent('development', 'https://teachneat.com')).toThrow(
      /NODE_ENV/,
    );
  });

  it('names the consequence, not just the mismatch', () => {
    expect(() => assertEnvironmentIsCoherent('development', 'https://teachneat.com')).toThrow(
      /Secure/,
    );
  });

  it('allows the ordinary development combination', () => {
    expect(() =>
      assertEnvironmentIsCoherent('development', 'http://localhost:5173'),
    ).not.toThrow();
  });

  it('allows a correctly marked production deployment', () => {
    expect(() => assertEnvironmentIsCoherent('production', 'https://teachneat.com')).not.toThrow();
  });

  it('allows the test environment, which the suite itself runs in', () => {
    expect(() => assertEnvironmentIsCoherent('test', 'http://localhost:5173')).not.toThrow();
  });
});
