import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

/**
 * No `spreadsheets` scope. `drive.file` already grants the Sheets API full
 * access to files this OAuth client created, which is the only spreadsheet the
 * app ever touches, and every discovery path starts from a Drive `files.list`
 * that `drive.file` bounds regardless. Verified live on 2026-09-12 against an
 * existing sheet (found, read, written) and a fresh account (folder and sheet
 * created) with the grant revoked first. Requesting `spreadsheets` added a
 * sensitive scope to justify and an all-spreadsheets line to the consent screen
 * while granting nothing the app used.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

/**
 * The data scopes the app cannot work without, which the consent screen
 * nonetheless lets a teacher untick one at a time.
 *
 * Google's granular consent shows each sensitive scope as its own checkbox, and
 * a sign-in with one of them unticked still succeeds and still returns a refresh
 * token. Nothing failed at that point, so nothing said anything: the teacher
 * reached the app, and the missing permission surfaced later as every email in a
 * send coming back `send_failed`, with no explanation to them or to us.
 */
export const REQUIRED_DATA_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

/**
 * Which required scopes the token response did not grant.
 *
 * `granted` is the space-separated `scope` field Google returns with the tokens.
 * When it is absent the answer is "none missing", deliberately failing open:
 * Google documents the field as always present, so its absence would mean the
 * client library changed shape, and refusing every sign-in in production on that
 * guess is a far worse outcome than one account reaching a tool that later fails.
 */
export function missingRequiredScopes(granted: string | null | undefined): string[] {
  if (typeof granted !== 'string') return [];
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return REQUIRED_DATA_SCOPES.filter((scope) => !have.has(scope));
}

/** A sign-in that completed with one or more required scopes unticked. */
export class MissingScopesError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super('Required Google permissions were not granted');
    this.name = 'MissingScopesError';
    this.missing = missing;
  }
}

export function buildOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret,
    env.google.redirectUri,
  );
}

export function buildAuthorizationUrl(state: string): string {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

/**
 * Tells Google to invalidate a refresh token and everything derived from it
 * (Phase 2 Step 6f).
 *
 * Required rather than courteous: Google's OAuth 2.0 Policies say to revoke
 * tokens when access to a user's account is no longer needed and to delete them
 * permanently afterwards. Deleting the account row destroys our copy, which
 * satisfies the second half and not the first — the grant would go on existing
 * in the teacher's Google account, listed among the apps with access to their
 * Drive and their ability to send mail as them, long after they deleted the
 * account that was using it.
 *
 * Resolves rather than throws on failure, and the caller is expected to
 * continue. A token Google will not revoke is usually one that is already
 * invalid, and in every case the row holding it is about to be destroyed: the
 * alternative is refusing to delete a teacher's account because a third party
 * returned a 400.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    await buildOAuthClient().revokeToken(refreshToken);
    return true;
  } catch {
    return false;
  }
}

export interface GoogleProfile {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string;
  /**
   * Google's `hd` (hosted domain) claim: the Workspace domain the account
   * belongs to, or empty for a personal account. Recorded because the
   * allowlisting problem this app has is per-domain — several blocked teachers
   * from one board are one admin conversation, not several.
   */
  workspaceDomain: string;
}

export interface ExchangeResult {
  refreshToken: string;
  profile: GoogleProfile;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  // Before the refresh-token check and the profile read: a partial grant is the
  // more specific explanation, and nothing about this sign-in should be used.
  const missing = missingRequiredScopes(tokens.scope);
  if (missing.length > 0) throw new MissingScopesError(missing);
  if (!tokens.refresh_token) {
    throw new ApiError(
      'INTERNAL_ERROR',
      'Google did not return a refresh token. Revoke the app in your Google Account and try again.',
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const profileRes = await oauth2.userinfo.get();
  const p = profileRes.data;
  if (!p.id || !p.email) {
    throw new ApiError('INTERNAL_ERROR', 'Failed to read Google profile.');
  }
  return {
    refreshToken: tokens.refresh_token,
    profile: {
      googleSub: p.id,
      email: p.email,
      name: p.name ?? '',
      avatarUrl: p.picture ?? '',
      workspaceDomain: (p.hd ?? '').toLowerCase(),
    },
  };
}

export function authorizedClientForRefreshToken(refreshToken: string): OAuth2Client {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function isReauthRequiredError(err: unknown): boolean {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  const msg = e?.response?.data?.error ?? e?.message ?? '';
  return typeof msg === 'string' && /invalid_grant|invalid_token/i.test(msg);
}
