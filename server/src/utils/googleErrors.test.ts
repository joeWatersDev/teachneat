import { describe, it, expect } from 'vitest';
import { summarizeGoogleError } from './googleErrors.js';

describe('summarizeGoogleError', () => {
  it('keeps the status, reason and Google status of a GaxiosError-shaped error', () => {
    const err = Object.assign(new Error('Request had insufficient authentication scopes.'), {
      code: 403,
      errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }],
      response: { status: 403, data: { error: { status: 'PERMISSION_DENIED' } } },
    });
    expect(summarizeGoogleError(err)).toEqual({
      status: 403,
      reason: 'insufficientPermissions',
      googleStatus: 'PERMISSION_DENIED',
    });
  });

  it('reads an OAuth error string such as invalid_grant', () => {
    const err = { response: { status: 400, data: { error: 'invalid_grant' } } };
    expect(summarizeGoogleError(err)).toEqual({ status: 400, googleStatus: 'invalid_grant' });
  });

  // The whole point of the helper: Google quotes the request back in its
  // message, and a refused send can name the recipient.
  it('never carries message text, and drops a code field holding free text', () => {
    const err = Object.assign(new Error('Invalid To header: parent@example.com'), {
      code: 400,
      errors: [{ reason: 'Invalid To header: parent@example.com' }],
      response: { data: { error: { status: 'bad value parent@example.com' } } },
    });
    const summary = summarizeGoogleError(err);
    expect(summary).toEqual({ status: 400 });
    expect(JSON.stringify(summary)).not.toContain('example.com');
  });

  it('returns an empty summary for something that is not a Google error', () => {
    expect(summarizeGoogleError(undefined)).toEqual({});
    expect(summarizeGoogleError(new Error('boom'))).toEqual({});
  });
});
