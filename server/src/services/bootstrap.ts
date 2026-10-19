import type { sheets_v4, drive_v3 } from 'googleapis';
import {
  APP_ID,
  APP_FILED_KEY,
  APP_FILED_VALUE,
  APP_FOLDER_NAME,
  APP_FOLDER_PROPERTY_VALUE,
  APP_MARKER_KEY,
  APP_PROPERTY_KEY,
  APP_PROPERTY_VALUE,
  FOLDER_MIME_TYPE,
  SCHEMA_VERSION,
  TABS,
  TAB_ORDER,
  type TabName,
  headerRowForTab,
} from '../config/schema.js';
import { ApiError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';
import {
  appendRow,
  readHeaderRow,
  validateAllHeaders,
  writeHeaderRow,
} from './sheets.js';
import { trackGoogleCall } from './apiMetrics.js';
import { runMigrations } from './migrations.js';
import { logger } from '../config/logger.js';
import { readStoredSchemaVersion, stampSchemaVersion } from './schemaMeta.js';

/**
 * Exported only so the Step 6g set-assertion in config/schema.test.ts can check
 * it alongside the four constants in schema.ts. It moves with them or not at
 * all.
 */
export const SPREADSHEET_TITLE = 'Teachneat Data';

export interface BootstrapResult {
  spreadsheetId: string;
  created: boolean;
}

export async function discoverOrCreateSpreadsheet(
  sheets: sheets_v4.Sheets,
  drive: drive_v3.Drive,
): Promise<BootstrapResult> {
  const existingId = await discoverSpreadsheet(sheets, drive);
  if (existingId) {
    await fileIntoAppFolderOnce(drive, existingId);
    // Bring an existing sheet up to the current schema, in order:
    //  1. version-gated migrations for non-additive changes (renames/removals),
    //  2. additive reconciliation (missing tabs, new trailing columns),
    //  3. restamp the recorded schema version to the code's target.
    const applied = await runMigrations(sheets, existingId, { drive });
    if (applied.length > 0) {
      // The one signal that a non-additive migration ran against a real sheet.
      // Nothing else records it: the version stamp shows where the sheet ended
      // up, not that this process is what moved it there.
      logger.info({ applied }, 'Applied schema migrations');
    }
    await reconcileSchema(sheets, existingId);
    await stampSchemaVersion(sheets, existingId);
    return { spreadsheetId: existingId, created: false };
  }
  const created = await createSpreadsheet(sheets, drive);
  return { spreadsheetId: created, created: true };
}

async function discoverSpreadsheet(
  sheets: sheets_v4.Sheets,
  drive: drive_v3.Drive,
): Promise<string | null> {
  const byAppProperties = await findByAppProperties(drive);
  if (byAppProperties) return byAppProperties;

  return findByMetaMarker(sheets, drive);
}

/**
 * Both discovery queries require the signed-in account to *own* the file.
 *
 * Without it, discovery answers "a spreadsheet this app can see that carries our
 * marker", and adopting one the teacher does not own would point the account at
 * a document somebody else controls — after which every roster entry,
 * attendance mark and guardian address the teacher enters is written into a file
 * that person can read. That is total compromise of one teacher's data, from a
 * single share.
 *
 * It is not reachable today, and the clause is here anyway. `appProperties` are
 * private to the OAuth client that set them, so the marker below cannot be
 * planted by anyone else; and under `drive.file` the app sees only files it
 * created, since nothing in the product opens a Drive picker. Both of those are
 * properties of the *current* build rather than of the design: a Marketplace
 * listing with Drive integration (Step 9) widens what `drive.file` exposes, and
 * NEXT_STEPS already records that what survives a revoke and re-consent could
 * not be established from Google's documentation. The cost of the clause is one
 * term in a query. The cost of needing it and not having it is a teacher's
 * whole roster.
 *
 * It also narrows the copy problem that has already been hit once: a duplicate
 * the app made (a pre-migration backup) carries the same marker and is
 * discoverable, and one shared *to* the teacher no longer matches. A copy the
 * teacher made by hand never matches at all, because `drive.file` keeps it out
 * of the listing before this clause is reached.
 */
const OWNED_BY_ME = `'me' in owners`;

async function findByAppProperties(drive: drive_v3.Drive): Promise<string | null> {
  const q = `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } and trashed=false and ${OWNED_BY_ME} and mimeType='application/vnd.google-apps.spreadsheet'`;
  const res = await trackGoogleCall('drive', 'files.list', () =>
    drive.files.list({
      q,
      spaces: 'drive',
      fields: 'files(id, name, appProperties)',
      pageSize: 10,
    }),
  );
  const file = res.data.files?.[0];
  return file?.id ?? null;
}

async function findByMetaMarker(
  sheets: sheets_v4.Sheets,
  drive: drive_v3.Drive,
): Promise<string | null> {
  const res = await trackGoogleCall('drive', 'files.list', () =>
    drive.files.list({
      q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and ${OWNED_BY_ME}`,
      spaces: 'drive',
      fields: 'files(id, name)',
      pageSize: 100,
    }),
  );
  const candidates = res.data.files ?? [];
  for (const f of candidates) {
    if (!f.id) continue;
    const fileId = f.id;
    try {
      const meta = await trackGoogleCall('sheets', 'values.get', () =>
        sheets.spreadsheets.values.get({
          spreadsheetId: fileId,
          range: `meta!A2:B`,
        }),
      );
      const rows = meta.data.values ?? [];
      const found = rows.find((r) => r[0] === APP_MARKER_KEY);
      if (found) {
        await trackGoogleCall('drive', 'files.update', () =>
          drive.files.update({
            fileId,
            requestBody: { appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE } },
          }),
        );
        return fileId;
      }
    } catch {
      // Not our spreadsheet (no meta tab, or no permission). Skip.
    }
  }
  return null;
}

/**
 * Finds (or creates) the app's folder on the teacher's Drive. Everything the
 * app creates lives here rather than loose at the Drive root. Creating and
 * managing it needs no extra scope: `drive.file` covers files the app itself
 * created, which includes this folder.
 */
async function discoverOrCreateAppFolder(drive: drive_v3.Drive): Promise<string | null> {
  const q =
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_FOLDER_PROPERTY_VALUE}' } ` +
    `and trashed=false and mimeType='${FOLDER_MIME_TYPE}'`;
  const existing = await trackGoogleCall('drive', 'files.list', () =>
    drive.files.list({ q, spaces: 'drive', fields: 'files(id, name)', pageSize: 10 }),
  );
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await trackGoogleCall('drive', 'files.create', () =>
    drive.files.create({
      requestBody: {
        name: APP_FOLDER_NAME,
        mimeType: FOLDER_MIME_TYPE,
        appProperties: { [APP_PROPERTY_KEY]: APP_FOLDER_PROPERTY_VALUE },
      },
      fields: 'id',
    }),
  );
  return created.data.id ?? null;
}

/**
 * Files a spreadsheet created before the app had a folder into that folder —
 * once, and only once. The `drive.file` scope cannot read the Drive root or any
 * folder the app did not create, so the app has no way to see where a sheet
 * currently sits or whether the teacher put it there deliberately. A marker on
 * the file records that the migration already ran, so a teacher who later moves
 * the sheet somewhere of their own keeps it there.
 *
 * Best-effort: a sheet that stays where it is still works, so nothing here is
 * worth failing a sign-in over.
 */
async function fileIntoAppFolderOnce(drive: drive_v3.Drive, spreadsheetId: string): Promise<void> {
  try {
    const meta = await trackGoogleCall('drive', 'files.get', () =>
      drive.files.get({ fileId: spreadsheetId, fields: 'parents, appProperties' }),
    );
    if (meta.data.appProperties?.[APP_FILED_KEY] === APP_FILED_VALUE) return;

    const folderId = await discoverOrCreateAppFolder(drive);
    if (!folderId) return;
    const parents = meta.data.parents ?? [];
    if (parents.includes(folderId)) return;

    await trackGoogleCall('drive', 'files.update', () =>
      drive.files.update({
        fileId: spreadsheetId,
        addParents: folderId,
        ...(parents.length > 0 ? { removeParents: parents.join(',') } : {}),
        requestBody: { appProperties: { [APP_FILED_KEY]: APP_FILED_VALUE } },
      }),
    );
  } catch {
    // Drive would not tell us where the file lives, or would not move it. The
    // spreadsheet is still usable exactly where it is; leave it alone.
  }
}

async function createSpreadsheet(
  sheets: sheets_v4.Sheets,
  drive: drive_v3.Drive,
): Promise<string> {
  const createRes = await trackGoogleCall('sheets', 'spreadsheets.create', () =>
    sheets.spreadsheets.create({
      requestBody: {
        properties: { title: SPREADSHEET_TITLE },
        sheets: TAB_ORDER.map((tab) => ({ properties: { title: tab } })),
      },
    }),
  );
  const spreadsheetId = createRes.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new ApiError('INTERNAL_ERROR', 'Failed to create spreadsheet.');
  }

  // Tag it as ours and, in the same call, move it out of the Drive root into
  // the app folder. Sheets' create API takes no parent, so the placement has to
  // happen here. A folder we cannot create or find is not fatal — the sheet
  // simply stays at the root.
  const folderId = await discoverOrCreateAppFolder(drive);
  await trackGoogleCall('drive', 'files.update', () =>
    drive.files.update({
      fileId: spreadsheetId,
      ...(folderId ? { addParents: folderId, removeParents: 'root' } : {}),
      requestBody: {
        appProperties: {
          [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE,
          // Created in the folder already, so the one-time migration above
          // never needs to touch it.
          [APP_FILED_KEY]: APP_FILED_VALUE,
        },
      },
    }),
  );

  for (const tab of TAB_ORDER) {
    await writeHeaderRow(sheets, spreadsheetId, tab);
  }
  await seedMetaRows(sheets, spreadsheetId);

  await validateAllHeaders(sheets, spreadsheetId);
  return spreadsheetId;
}

async function seedMetaRows(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
  const now = nowIso();
  const rows: Array<[string, string]> = [
    [APP_MARKER_KEY, SCHEMA_VERSION],
    ['schemaVersion', SCHEMA_VERSION],
    ['appId', APP_ID],
    ['createdAt', now],
  ];
  for (const [key, value] of rows) {
    await appendRow(sheets, spreadsheetId, 'meta', { key, value });
  }
}

/**
 * Reconciles an existing sheet's structure to the current schema, additively:
 *  - adds any missing tabs (with their header rows), and
 *  - extends any tab whose header is a *prefix* of the current one (new trailing
 *    columns were appended in a later version) by rewriting row 1 to the full
 *    header.
 *
 * New columns are always appended and are nullable/defaulted, so existing data
 * rows need no backfill — a blank cell reads as the column's default. A header
 * that diverges from the schema in any existing position (not a clean prefix)
 * is a genuine mismatch and still aborts with SHEET_HEADER_MISMATCH; a
 * non-additive change must be handled by a registered migration instead.
 */
async function reconcileSchema(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
  const meta = await trackGoogleCall('sheets', 'spreadsheets.get', () =>
    sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' }),
  );
  const existing = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => !!t),
  );
  const missing = TAB_ORDER.filter((t) => !existing.has(t));
  if (missing.length > 0) {
    await trackGoogleCall('sheets', 'spreadsheets.batchUpdate', () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missing.map((tab) => ({
            addSheet: { properties: { title: tab } },
          })),
        },
      }),
    );
    for (const tab of missing) {
      await writeHeaderRow(sheets, spreadsheetId, tab);
    }
  }
  for (const tab of TAB_ORDER) {
    const header = await readHeaderRow(sheets, spreadsheetId, tab);
    const expected = headerRowForTab(tab);
    const empty = header.length === 0 || header.every((c) => !c);
    if (empty) {
      await writeHeaderRow(sheets, spreadsheetId, tab);
      continue;
    }
    // A prefix header (shorter, matching so far) means new trailing columns were
    // added since this sheet was last reconciled — extend it in place.
    const isPrefix = header.every((code, i) => code === expected[i]);
    if (isPrefix && header.length < expected.length) {
      await writeHeaderRow(sheets, spreadsheetId, tab);
    } else if (!expected.every((code, i) => header[i] === code)) {
      throw new ApiError(
        'SHEET_HEADER_MISMATCH',
        `Header row for "${tab}" does not match the expected schema. Please contact support.`,
      );
    }
  }
}

export interface BootstrapStatus {
  spreadsheetReady: boolean;
  schemaVersion: string;
  headerValidation: 'ok' | 'mismatch';
}

export async function getBootstrapStatus(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string | null,
): Promise<BootstrapStatus> {
  if (!spreadsheetId) {
    return { spreadsheetReady: false, schemaVersion: SCHEMA_VERSION, headerValidation: 'mismatch' };
  }
  try {
    await validateAllHeaders(sheets, spreadsheetId);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'SHEET_HEADER_MISMATCH') {
      return {
        spreadsheetReady: true,
        schemaVersion: SCHEMA_VERSION,
        headerValidation: 'mismatch',
      };
    }
    throw e;
  }
  const schemaVersion = (await readStoredSchemaVersion(sheets, spreadsheetId)) ?? SCHEMA_VERSION;
  return { spreadsheetReady: true, schemaVersion, headerValidation: 'ok' };
}
