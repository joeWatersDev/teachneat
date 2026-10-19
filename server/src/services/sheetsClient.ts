import { google, sheets_v4, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export interface GoogleClients {
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
}

export function buildGoogleClients(auth: OAuth2Client): GoogleClients {
  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}
