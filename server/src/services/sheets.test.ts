import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import {
  appendRow,
  readTabRows,
  validateTabHeader,
  writeHeaderRow,
} from './sheets.js';
import { ApiError } from '../utils/errors.js';
import { TAB_ORDER } from '../config/schema.js';

describe('sheets service', () => {
  let env: FakeGoogleEnv;
  let spreadsheetId: string;

  beforeEach(async () => {
    env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'test' },
        sheets: TAB_ORDER.map((tab) => ({ properties: { title: tab } })),
      },
    });
    spreadsheetId = res.data.spreadsheetId!;
    for (const tab of TAB_ORDER) {
      await writeHeaderRow(sheets, spreadsheetId, tab);
    }
  });

  it('validates a correctly seeded header row', async () => {
    const sheets = env.buildSheets();
    await expect(validateTabHeader(sheets, spreadsheetId, 'students')).resolves.toBeUndefined();
  });

  it('rejects a tampered header row with SHEET_HEADER_MISMATCH', async () => {
    const sheets = env.buildSheets();
    const ss = env.spreadsheets.get(spreadsheetId)!;
    const studentsSheet = ss.sheets.find((s) => s.title === 'students')!;
    studentsSheet.rows[0] = ['Student Name', 'Email', 'Course'];
    await expect(validateTabHeader(sheets, spreadsheetId, 'students')).rejects.toMatchObject({
      code: 'SHEET_HEADER_MISMATCH',
    });
  });

  it('appendRow + readTabRows roundtrip with camelCase fields', async () => {
    const sheets = env.buildSheets();
    await appendRow(sheets, spreadsheetId, 'students', {
      id: 'ULID1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      goesBy: null,
      pronouns: null,
      studentEmail: null,
      parentEmails: null,
      notes: null,
      createdAt: '2026-04-21T14:30:00Z',
      updatedAt: '2026-04-21T14:30:00Z',
      deletedAt: null,
    });
    const rows = await readTabRows(sheets, spreadsheetId, 'students');
    expect(rows).toHaveLength(1);
    expect(rows[0].firstName).toBe('Ada');
    expect(rows[0].lastName).toBe('Lovelace');
    expect(rows[0].deletedAt).toBeNull();
  });

  it('readTabRows refuses to read if header is corrupted', async () => {
    const sheets = env.buildSheets();
    const ss = env.spreadsheets.get(spreadsheetId)!;
    const studentsSheet = ss.sheets.find((s) => s.title === 'students')!;
    studentsSheet.rows[0] = ['Student Name', 'Email', 'Course'];
    await expect(readTabRows(sheets, spreadsheetId, 'students')).rejects.toMatchObject({
      code: 'SHEET_HEADER_MISMATCH',
    });
  });

  it('reads header and data in a single values.get call', async () => {
    const sheets = env.buildSheets();
    await appendRow(sheets, spreadsheetId, 'students', { id: 'ULID1', firstName: 'Ada' });
    env.callCounts['values.get'] = 0;
    await readTabRows(sheets, spreadsheetId, 'students');
    expect(env.callCounts['values.get']).toBe(1);
  });

  it('appendRow refuses to write if header is corrupted', async () => {
    const sheets = env.buildSheets();
    const ss = env.spreadsheets.get(spreadsheetId)!;
    const studentsSheet = ss.sheets.find((s) => s.title === 'students')!;
    studentsSheet.rows[0] = ['something', 'else'];
    await expect(
      appendRow(sheets, spreadsheetId, 'students', { id: 'x' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
