import type { sheets_v4 } from 'googleapis';
import { APP_MARKER_KEY, SCHEMA_VERSION } from '../config/schema.js';
import { readTabRowsIndexed, updateRowByNumber } from './sheets.js';

/**
 * The meta tab records the schema version the sheet was last brought up to, in
 * two rows: the `schemaVersion` key/value row and the `TN_APP_MARKER` row
 * (whose value also carries the version). These helpers read and update that
 * anchor. The `meta` tab schema (c01 key, c02 value) is intentionally stable
 * across versions, so reading it with the current schema is always safe.
 */

/** The schema version recorded in the meta tab, or null if absent. */
export async function readStoredSchemaVersion(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<string | null> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'meta');
  const row = rows.find((r) => r.obj.key === 'schemaVersion');
  const value = row?.obj.value;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Stamps the meta `schemaVersion` and `TN_APP_MARKER` rows to `version`
 * (default: the code's current `SCHEMA_VERSION`). Idempotent — a row already at
 * `version` is left untouched, so a no-op restamp costs only the meta read.
 */
export async function stampSchemaVersion(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  version: string = SCHEMA_VERSION,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'meta');
  for (const r of rows) {
    const isVersionRow = r.obj.key === 'schemaVersion' || r.obj.key === APP_MARKER_KEY;
    if (!isVersionRow || String(r.obj.value) === version) continue;
    await updateRowByNumber(
      sheets,
      spreadsheetId,
      'meta',
      r.rowNumber,
      { ...r.obj, value: version },
      { headerValidated: true },
    );
  }
}
