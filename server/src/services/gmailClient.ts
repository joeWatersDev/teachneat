import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/** Builds an authorized Gmail client. Kept separate from the Sheets/Drive
 * clients so the per-request Sheets path does not construct a Gmail client it
 * never uses. */
export function buildGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth });
}
