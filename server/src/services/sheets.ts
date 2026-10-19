import type { sheets_v4 } from 'googleapis';
import { ApiError } from '../utils/errors.js';
import { TABS, TAB_ORDER, type TabName, headerRowForTab } from '../config/schema.js';
import { trackGoogleCall } from './apiMetrics.js';

type CellValue = string | number | boolean | null;

export interface RowObject {
  [field: string]: CellValue;
}

function a1Range(tab: TabName, range: string): string {
  return `${tab}!${range}`;
}

export async function readHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<string[]> {
  const res = await trackGoogleCall('sheets', 'values.get', () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1Range(tab, '1:1'),
      majorDimension: 'ROWS',
    }),
  );
  const row = res.data.values?.[0] ?? [];
  return row.map((v) => String(v ?? ''));
}

/**
 * Pure check of an already-read header row against the tab's expected schema.
 * Throws SHEET_HEADER_MISMATCH on mismatch. Shared by the standalone header
 * validation and the combined read below so both enforce the same invariant.
 */
function assertHeaderMatches(tab: TabName, actual: string[]): void {
  const expected = headerRowForTab(tab);
  const matches =
    actual.length >= expected.length &&
    expected.every((code, i) => actual[i] === code);
  if (!matches) {
    throw new ApiError(
      'SHEET_HEADER_MISMATCH',
      `Header row for "${tab}" does not match the expected schema. Please contact support.`,
    );
  }
}

export async function validateTabHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<void> {
  const actual = await readHeaderRow(sheets, spreadsheetId, tab);
  assertHeaderMatches(tab, actual);
}

export async function validateAllHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  for (const tab of TAB_ORDER) {
    await validateTabHeader(sheets, spreadsheetId, tab);
  }
}

export async function writeHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<void> {
  const header = headerRowForTab(tab);
  await trackGoogleCall('sheets', 'values.update', () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1Range(tab, '1:1'),
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    }),
  );
}

export async function appendRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
  obj: RowObject,
): Promise<void> {
  await validateTabHeader(sheets, spreadsheetId, tab);
  const row = TABS[tab].columns.map((c) => serializeCell(obj[c.field]));
  await trackGoogleCall('sheets', 'values.append', () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1Range(tab, 'A1'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    }),
  );
}

/** Appends many rows in a single Sheets call. */
export async function appendRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
  objs: RowObject[],
  opts: { headerValidated?: boolean } = {},
): Promise<void> {
  if (objs.length === 0) return;
  if (!opts.headerValidated) await validateTabHeader(sheets, spreadsheetId, tab);
  const cols = TABS[tab].columns;
  const values = objs.map((obj) => cols.map((c) => serializeCell(obj[c.field])));
  await trackGoogleCall('sheets', 'values.append', () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1Range(tab, 'A1'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    }),
  );
}

export interface TabReplacement {
  tab: TabName;
  /** The complete new set of data rows for the tab. */
  rows: RowObject[];
}

/**
 * Replaces every data row in each of several tabs, leaving their headers
 * untouched. **Two Sheets calls in total, whatever the number of tabs or rows.**
 *
 * The alternative — deleting the rows that are leaving — needs one delete range
 * per contiguous block, and archiving one class out of a mixed attendance tab
 * produces thousands of scattered blocks. Rewriting whole tabs does not depend
 * on rows being adjacent.
 *
 * ## Write first, then clear the tail
 *
 * The order is the safety property, and it is the reverse of the obvious one.
 * The new rows are written over the top of the old from A2 down, and only then
 * is whatever the old content left sticking out past them cleared.
 *
 * Clearing first would mean a failure before the write loses every row the tab
 * held, including the ones that were only ever meant to stay. Writing first
 * means the same failure leaves the new rows correct and a tail of stale rows
 * below them: duplicates, which a retry removes, rather than data that is gone.
 * For a teacher's attendance records that is the trade the whole operation is
 * designed around, and it is the same argument `classArchive.ts` makes for
 * appending to the archive before touching the source.
 *
 * **Headers are the caller's responsibility.** Every caller reaches this having
 * just read the tabs in full, which validates their headers from the same
 * response; re-reading them here would be a round trip per tab for an answer
 * already in hand.
 */
export async function replaceTabsRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  replacements: TabReplacement[],
): Promise<void> {
  if (replacements.length === 0) return;

  const data = replacements
    .filter((r) => r.rows.length > 0)
    .map((r) => {
      const cols = TABS[r.tab].columns;
      return {
        range: a1Range(r.tab, 'A2'),
        values: r.rows.map((obj) => cols.map((c) => serializeCell(obj[c.field]))),
      };
    });
  if (data.length > 0) {
    await trackGoogleCall('sheets', 'values.batchUpdate', () =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      }),
    );
  }

  // The tail starts immediately after the rows just written: row 1 is the
  // header, so `rows.length` rows occupy 2 .. rows.length + 1.
  const ranges = replacements.map((r) => a1Range(r.tab, `A${r.rows.length + 2}:ZZ`));
  await trackGoogleCall('sheets', 'values.batchClear', () =>
    sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges } }),
  );
}

/**
 * The number of populated data rows in a tab, without parsing them.
 *
 * Used to verify an archive append landed before the source tab is rewritten.
 * Reads one narrow column rather than the whole tab, so verifying costs a
 * fraction of what re-reading would.
 */
export async function countTabRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<number> {
  const res = await trackGoogleCall('sheets', 'values.get', () =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: a1Range(tab, 'A2:A') }),
  );
  const rows = (res.data.values ?? []) as unknown[][];
  return rows.filter((r) => r[0] !== '' && r[0] != null).length;
}

export async function readTabRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<RowObject[]> {
  const indexed = await readTabRowsIndexed(sheets, spreadsheetId, tab);
  return indexed.map((r) => r.obj);
}

export interface IndexedRow {
  /** 1-based spreadsheet row number. Data rows start at 2 (row 1 is the header). */
  rowNumber: number;
  obj: RowObject;
}

/**
 * Turns a raw `values.get`/`values.batchGet` payload (header row included) into
 * indexed data rows, validating the header from the same response. Row 1 is the
 * header, so data row i in the slice is spreadsheet row i + 2.
 */
function rowsFromValues(tab: TabName, values: unknown[][]): IndexedRow[] {
  const headerRow = (values[0] ?? []).map((v) => String(v ?? ''));
  assertHeaderMatches(tab, headerRow);
  const cols = TABS[tab].columns;
  const out: IndexedRow[] = [];
  values.slice(1).forEach((r, i) => {
    if (!r.some((v) => v !== '' && v != null)) return;
    const obj: RowObject = {};
    cols.forEach((c, j) => {
      obj[c.field] = parseCell(r[j]);
    });
    out.push({ rowNumber: i + 2, obj });
  });
  return out;
}

/**
 * Reads the header and all populated data rows in a single Sheets call,
 * preserving each row's spreadsheet row number so callers can address a specific
 * row for in-place update or soft delete.
 *
 * Row 1 (the header) is validated from the same response rather than via a
 * separate round-trip, halving the Sheets read quota this costs. The invariant
 * is unchanged: a mismatched header still refuses the read.
 */
export async function readTabRowsIndexed(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
): Promise<IndexedRow[]> {
  const res = await trackGoogleCall('sheets', 'values.get', () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1Range(tab, 'A1:ZZ'),
      majorDimension: 'ROWS',
    }),
  );
  return rowsFromValues(tab, (res.data.values ?? []) as unknown[][]);
}

/**
 * Reads several tabs in a single `values.batchGet` call — one Sheets request for
 * N tabs instead of N. Each tab's header is validated from its own slice of the
 * response, preserving the header-validation invariant. Returns a map keyed by
 * tab; the caller decides which derived values to build and cache.
 */
export async function readTabsRowsIndexed(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: TabName[],
): Promise<Map<TabName, IndexedRow[]>> {
  const out = new Map<TabName, IndexedRow[]>();
  if (tabs.length === 0) return out;
  const res = await trackGoogleCall('sheets', 'values.batchGet', () =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: tabs.map((t) => a1Range(t, 'A1:ZZ')),
      majorDimension: 'ROWS',
    }),
  );
  const valueRanges = res.data.valueRanges ?? [];
  tabs.forEach((tab, i) => {
    out.set(tab, rowsFromValues(tab, (valueRanges[i]?.values ?? []) as unknown[][]));
  });
  return out;
}

/** Active = not soft-deleted (deletedAt is null). */
export function isActive(obj: RowObject): boolean {
  return obj.deletedAt === null || obj.deletedAt === undefined || obj.deletedAt === '';
}

function columnLetter(oneBased: number): string {
  let n = oneBased;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Overwrites every column of a single data row, addressed by its spreadsheet row number.
 *
 * Pass `headerValidated: true` only when the same operation already validated this
 * tab's header (e.g. via readTabRowsIndexed on the same tab) — it skips the second
 * round-trip without weakening the invariant.
 */
export async function updateRowByNumber(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
  rowNumber: number,
  obj: RowObject,
  opts: { headerValidated?: boolean } = {},
): Promise<void> {
  if (!opts.headerValidated) await validateTabHeader(sheets, spreadsheetId, tab);
  const cols = TABS[tab].columns;
  const row = cols.map((c) => serializeCell(obj[c.field]));
  const lastCol = columnLetter(cols.length);
  await trackGoogleCall('sheets', 'values.update', () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1Range(tab, `A${rowNumber}:${lastCol}${rowNumber}`),
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    }),
  );
}

export interface RowWrite {
  rowNumber: number;
  obj: RowObject;
}

/** Overwrites many full data rows in a single values.batchUpdate call. */
export async function updateRowsByNumber(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
  writes: RowWrite[],
  opts: { headerValidated?: boolean } = {},
): Promise<void> {
  if (writes.length === 0) return;
  if (!opts.headerValidated) await validateTabHeader(sheets, spreadsheetId, tab);
  const cols = TABS[tab].columns;
  const lastCol = columnLetter(cols.length);
  await trackGoogleCall('sheets', 'values.batchUpdate', () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: writes.map((w) => ({
          range: a1Range(tab, `A${w.rowNumber}:${lastCol}${w.rowNumber}`),
          values: [cols.map((c) => serializeCell(w.obj[c.field]))],
        })),
      },
    }),
  );
}

export interface TabRowWrite extends RowWrite {
  tab: TabName;
}

/**
 * Overwrites full data rows across several tabs in a single values.batchUpdate
 * call. Nothing is cleared, so no row can be lost by it.
 *
 * **Headers are the caller's responsibility**, as with `replaceTabsRows`: every
 * caller has just read these tabs in full, which validated them.
 */
export async function updateRowsInTabs(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  writes: TabRowWrite[],
): Promise<void> {
  if (writes.length === 0) return;
  await trackGoogleCall('sheets', 'values.batchUpdate', () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: writes.map((w) => {
          const cols = TABS[w.tab].columns;
          const lastCol = columnLetter(cols.length);
          return {
            range: a1Range(w.tab, `A${w.rowNumber}:${lastCol}${w.rowNumber}`),
            values: [cols.map((c) => serializeCell(w.obj[c.field]))],
          };
        }),
      },
    }),
  );
}

function serializeCell(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function parseCell(raw: unknown): CellValue {
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw);
}
