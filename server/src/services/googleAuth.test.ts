import { describe, it, expect } from 'vitest';
import { GOOGLE_SCOPES, REQUIRED_DATA_SCOPES, missingRequiredScopes } from './googleAuth.js';

/**
 * Scope discipline. The requested scopes are what Google's verification reviews,
 * what the privacy policy enumerates and what a board admin allowlists, so the
 * list is pinned exactly: adding a scope, or restoring `spreadsheets`, has to be
 * a deliberate edit to this test and not a side effect of another change.
 */
describe('GOOGLE_SCOPES', () => {
  it('is exactly the five scopes the app needs', () => {
    expect([...GOOGLE_SCOPES].sort()).toEqual(
      [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.send',
      ].sort(),
    );
  });
});

describe('missingRequiredScopes', () => {
  const DRIVE = 'https://www.googleapis.com/auth/drive.file';
  const GMAIL = 'https://www.googleapis.com/auth/gmail.send';

  it('finds nothing missing on a full grant', () => {
    expect(missingRequiredScopes(`openid ${DRIVE} email ${GMAIL} profile`)).toEqual([]);
  });

  // The case that motivated the check: Gmail unticked on the consent screen,
  // which still returns a refresh token and still signs the teacher in.
  it('names gmail.send when the teacher unticked it', () => {
    expect(missingRequiredScopes(`openid email profile ${DRIVE}`)).toEqual([GMAIL]);
  });

  it('names both when only the identity scopes were granted', () => {
    expect(missingRequiredScopes('openid email profile')).toEqual([DRIVE, GMAIL]);
  });

  it('matches whole scopes rather than substrings', () => {
    expect(missingRequiredScopes(`${GMAIL}.extra ${DRIVE}`)).toEqual([GMAIL]);
  });

  it('fails open when Google returned no scope field at all', () => {
    expect(missingRequiredScopes(undefined)).toEqual([]);
    expect(missingRequiredScopes(null)).toEqual([]);
  });

  it('requires only scopes the app actually requests', () => {
    for (const scope of REQUIRED_DATA_SCOPES) expect(GOOGLE_SCOPES).toContain(scope);
  });
});
