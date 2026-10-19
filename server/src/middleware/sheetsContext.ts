import type { Request } from 'express';
import type { gmail_v1 } from 'googleapis';
import { authorizedClientForRefreshToken } from '../services/googleAuth.js';
import { buildGoogleClients } from '../services/sheetsClient.js';
import { buildGmailClient } from '../services/gmailClient.js';
import { sessionOf } from './session.js';
import { loadAccount } from './entitlements.js';
import type { AccountStore } from '../services/accountStore.js';
import { ApiError } from '../utils/errors.js';

export interface SheetsContext {
  sheets: ReturnType<typeof buildGoogleClients>['sheets'];
  spreadsheetId: string;
  userKey: string;
  /**
   * The account's own row id (`users.id`), as distinct from `userKey`, which is
   * the google_sub the Sheets layer partitions on. Carried here because the
   * Step 6j usage counters key on the row id for their delete cascade, and this
   * helper has already loaded the account — asking a route to load it a second
   * time to count a write would double the cost of instrumenting it.
   */
  accountId: string;
}

export interface EmailContext extends SheetsContext {
  gmail: gmail_v1.Gmail;
  /** The authenticated teacher's own address — the send From, never a hardcoded one. */
  senderEmail: string;
}

/**
 * Resolves the authenticated user's Sheets client and spreadsheet id for a
 * request. The account (and thus the Sheet ID) is resolved from the session's
 * google_sub against the account store, never from the client. The session
 * itself is loaded by requireSession, which every tool route mounts behind.
 */
export async function resolveSheetsContext(
  req: Request,
  store: AccountStore,
): Promise<SheetsContext> {
  const session = sessionOf(req);
  const account = await loadAccount(req, store);
  if (!account.spreadsheetId) {
    throw new ApiError('SHEET_UNAVAILABLE', 'Your data spreadsheet is not ready yet.');
  }
  const auth = authorizedClientForRefreshToken(account.refreshToken);
  const { sheets } = buildGoogleClients(auth);
  return {
    sheets,
    spreadsheetId: account.spreadsheetId,
    userKey: session.googleSub,
    accountId: account.id,
  };
}

/**
 * Like resolveSheetsContext, but also builds a Gmail client and resolves the
 * teacher's own address for use as the message From. Used by the email routes.
 */
export async function resolveEmailContext(
  req: Request,
  store: AccountStore,
): Promise<EmailContext> {
  const session = sessionOf(req);
  const account = await loadAccount(req, store);
  if (!account.spreadsheetId) {
    throw new ApiError('SHEET_UNAVAILABLE', 'Your data spreadsheet is not ready yet.');
  }
  const auth = authorizedClientForRefreshToken(account.refreshToken);
  const { sheets } = buildGoogleClients(auth);
  const gmail = buildGmailClient(auth);
  return {
    sheets,
    gmail,
    spreadsheetId: account.spreadsheetId,
    userKey: session.googleSub,
    accountId: account.id,
    senderEmail: account.email,
  };
}
