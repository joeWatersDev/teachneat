import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv, FAKE_ROOT_ID } from '../test/fakeGoogle.js';
import {
  discoverOrCreateSpreadsheet,
  getBootstrapStatus,
} from './bootstrap.js';
import {
  APP_FILED_KEY,
  APP_FILED_VALUE,
  APP_FOLDER_NAME,
  APP_FOLDER_PROPERTY_VALUE,
  APP_MARKER_KEY,
  APP_PROPERTY_KEY,
  FOLDER_MIME_TYPE,
  APP_PROPERTY_VALUE,
  SCHEMA_VERSION,
  TAB_ORDER,
  headerRowForTab,
} from '../config/schema.js';
import { listEnrollments } from './enrollments.js';
import { clearCache } from './cache.js';
import { readStoredSchemaVersion, stampSchemaVersion } from './schemaMeta.js';

function getSheetRows(env: FakeGoogleEnv, spreadsheetId: string, tab: string): string[][] {
  return env.spreadsheets.get(spreadsheetId)!.sheets.find((s) => s.title === tab)!.rows;
}

describe('discoverOrCreateSpreadsheet — first-login create path', () => {
  let env: FakeGoogleEnv;

  beforeEach(() => {
    env = new FakeGoogleEnv();
  });

  it('creates a spreadsheet with all tabs, header rows, and seeded meta rows', async () => {
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId, created } = await discoverOrCreateSpreadsheet(sheets, drive);

    expect(created).toBe(true);
    expect(env.callCounts['sheets.create']).toBe(1);
    const ss = env.spreadsheets.get(spreadsheetId)!;
    expect(ss.sheets.map((s) => s.title).sort()).toEqual([...TAB_ORDER].sort());

    for (const tab of TAB_ORDER) {
      const rows = getSheetRows(env, spreadsheetId, tab);
      expect(rows[0]).toEqual(headerRowForTab(tab));
    }

    const metaRows = getSheetRows(env, spreadsheetId, 'meta').slice(1);
    const keys = metaRows.map((r) => r[0]);
    expect(keys).toContain(APP_MARKER_KEY);
    expect(keys).toContain('schemaVersion');
    expect(keys).toContain('appId');
    expect(keys).toContain('createdAt');
  });

  it('stamps Drive appProperties with the discovery marker', async () => {
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
    const file = env.files.get(spreadsheetId)!;
    expect(file.appProperties?.[APP_PROPERTY_KEY]).toBe(APP_PROPERTY_VALUE);
  });
});

describe('discoverOrCreateSpreadsheet — discovery on subsequent login', () => {
  it('finds existing spreadsheet via appProperties and does not call create', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId: firstId } = await discoverOrCreateSpreadsheet(sheets, drive);

    const env2State = { ...env };
    env.callCounts = {};
    const { spreadsheetId: secondId, created } = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(secondId).toBe(firstId);
    expect(created).toBe(false);
    expect(env.callCounts['sheets.create'] ?? 0).toBe(0);
    void env2State;
  });

  it('finds via meta marker when appProperties is missing, and re-stamps appProperties', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
    const file = env.files.get(spreadsheetId)!;
    file.appProperties = {};

    env.callCounts = {};
    const result = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(result.spreadsheetId).toBe(spreadsheetId);
    expect(result.created).toBe(false);
    expect(env.files.get(spreadsheetId)!.appProperties?.[APP_PROPERTY_KEY]).toBe(
      APP_PROPERTY_VALUE,
    );
  });

  /**
   * Discovery must answer "the teacher's own spreadsheet", not "a spreadsheet
   * carrying our marker". Adopting one owned by somebody else would point the
   * account at a document that person can read, and then write every roster
   * entry and guardian address into it.
   *
   * Both discovery paths are covered because they are separately reachable and
   * fail differently: appProperties is the fast path, and the meta-marker scan
   * is the fallback that reads candidate files one by one.
   */
  it('does not adopt a marked spreadsheet the teacher does not own (appProperties path)', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId: mine } = await discoverOrCreateSpreadsheet(sheets, drive);

    // Someone shares in a spreadsheet carrying the same marker.
    const theirs = { ...env.files.get(mine)! };
    theirs.id = 'shared-in-file';
    theirs.ownedByMe = false;
    env.files.set(theirs.id, theirs);
    // Remove ours, so the only marked candidate left is the shared one.
    env.files.delete(mine);

    const result = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(result.spreadsheetId).not.toBe('shared-in-file');
    expect(result.created).toBe(true);
  });

  it('does not adopt a marked spreadsheet the teacher does not own (meta-marker path)', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId: mine } = await discoverOrCreateSpreadsheet(sheets, drive);

    const theirs = { ...env.files.get(mine)! };
    theirs.id = 'shared-in-file';
    theirs.ownedByMe = false;
    // No appProperties, so only the meta-marker scan could find it.
    theirs.appProperties = {};
    env.spreadsheets.set(theirs.id, env.spreadsheets.get(mine)!);
    env.files.set(theirs.id, theirs);
    env.files.delete(mine);

    const result = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(result.spreadsheetId).not.toBe('shared-in-file');
    expect(result.created).toBe(true);
  });

  it('still finds the teacher’s own spreadsheet when a shared one is present too', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId: mine } = await discoverOrCreateSpreadsheet(sheets, drive);

    const theirs = { ...env.files.get(mine)!, id: 'shared-in-file', ownedByMe: false };
    env.files.set(theirs.id, theirs);

    const result = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(result.spreadsheetId).toBe(mine);
    expect(result.created).toBe(false);
  });

  it('recreates a missing tab without recreating the whole spreadsheet', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
    const ss = env.spreadsheets.get(spreadsheetId)!;
    ss.sheets = ss.sheets.filter((s) => s.title !== 'attendance');

    env.callCounts = {};
    const { created } = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(created).toBe(false);
    expect((env.callCounts['sheets.create'] ?? 0)).toBe(0);
    const restored = env.spreadsheets.get(spreadsheetId)!.sheets.find((s) => s.title === 'attendance');
    expect(restored).toBeDefined();
    expect(restored!.rows[0]).toEqual(headerRowForTab('attendance'));
  });

  /**
   * The schemaVersion 4 upgrade path (class archiving). It is purely additive —
   * five new tabs and no change to any existing one — so it must be handled by
   * the generic reconciliation with no entry in the migration registry and no
   * clean reset. Asserted from a sheet shaped like a v3 account: the tabs that
   * archiving depends on appear, with correct headers and no data touched.
   */
  it('adds the v4 archiving tabs to an existing sheet without a migration', async () => {
    clearCache();
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

    // Reshape it as a v3 sheet: the archiving tabs did not exist yet.
    const v4Tabs = [
      'courses',
      'enrollmentsArchive',
      'attendanceArchive',
      'groupingsArchive',
      'studentsArchive',
    ];
    const ss = env.spreadsheets.get(spreadsheetId)!;
    ss.sheets = ss.sheets.filter((s) => !v4Tabs.includes(s.title));
    const studentsBefore = ss.sheets.find((s) => s.title === 'students')!.rows.length;
    clearCache();

    const { created } = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(created).toBe(false);

    const after = env.spreadsheets.get(spreadsheetId)!;
    for (const tab of v4Tabs) {
      const restored = after.sheets.find((s) => s.title === tab);
      expect(restored, `${tab} should have been created`).toBeDefined();
      expect(restored!.rows[0]).toEqual(headerRowForTab(tab as never));
    }
    // Existing data is untouched by the upgrade.
    expect(after.sheets.find((s) => s.title === 'students')!.rows).toHaveLength(studentsBefore);
  });

  it('extends a tab whose header is a prefix of the current schema, defaulting new columns', async () => {
    clearCache();
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

    const full = headerRowForTab('enrollments'); // includes the v3 trailing atRisk column
    const enrollments = env.spreadsheets
      .get(spreadsheetId)!
      .sheets.find((s) => s.title === 'enrollments')!;
    // Simulate a pre-v3 sheet: a prefix header (atRisk dropped) and an old 5-column row.
    enrollments.rows[0] = full.slice(0, -1);
    enrollments.rows[1] = ['e1', 'stu1', 'Math', '2026-01-01T00:00:00.000Z', ''];

    const { created } = await discoverOrCreateSpreadsheet(sheets, drive);
    expect(created).toBe(false);
    // The header was extended in place to the full current schema.
    expect(enrollments.rows[0]).toEqual(full);

    clearCache();
    const list = await listEnrollments(sheets, spreadsheetId, 'user-x');
    const e1 = list.find((e) => e.id === 'e1')!;
    expect(e1.course).toBe('Math');
    expect(e1.atRisk).toBe(false); // the new column reads as its default
  });

  it('restamps the recorded schema version to the code target on reconcile', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

    await stampSchemaVersion(sheets, spreadsheetId, '2'); // simulate an older recorded version
    expect(await readStoredSchemaVersion(sheets, spreadsheetId)).toBe('2');

    await discoverOrCreateSpreadsheet(sheets, drive);
    expect(await readStoredSchemaVersion(sheets, spreadsheetId)).toBe(SCHEMA_VERSION);
  });

  it('refuses to proceed if a tab has a tampered header row', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
    const ss = env.spreadsheets.get(spreadsheetId)!;
    ss.sheets.find((s) => s.title === 'students')!.rows[0] = ['Student Name', 'Email'];

    await expect(discoverOrCreateSpreadsheet(sheets, drive)).rejects.toMatchObject({
      code: 'SHEET_HEADER_MISMATCH',
    });
  });
});

describe('getBootstrapStatus', () => {
  it('reports not-ready when no spreadsheet id is known', async () => {
    const env = new FakeGoogleEnv();
    const status = await getBootstrapStatus(env.buildSheets(), null);
    expect(status.spreadsheetReady).toBe(false);
  });

  it('reports ok when headers match', async () => {
    const env = new FakeGoogleEnv();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    const status = await getBootstrapStatus(env.buildSheets(), spreadsheetId);
    expect(status.spreadsheetReady).toBe(true);
    expect(status.headerValidation).toBe('ok');
    expect(status.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('reports mismatch when a header is tampered', async () => {
    const env = new FakeGoogleEnv();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    const ss = env.spreadsheets.get(spreadsheetId)!;
    ss.sheets.find((s) => s.title === 'students')!.rows[0] = ['nope'];
    const status = await getBootstrapStatus(env.buildSheets(), spreadsheetId);
    expect(status.headerValidation).toBe('mismatch');
  });
});

describe('app folder placement', () => {
  let env: FakeGoogleEnv;

  beforeEach(() => {
    env = new FakeGoogleEnv();
    clearCache();
  });

  it('creates the spreadsheet inside a TEACHNEAT DATA folder, not the Drive root', async () => {
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());

    const folder = [...env.files.values()].find((f) => f.mimeType === FOLDER_MIME_TYPE);
    expect(folder?.name).toBe(APP_FOLDER_NAME);
    expect(folder?.appProperties?.[APP_PROPERTY_KEY]).toBe(APP_FOLDER_PROPERTY_VALUE);

    const sheetFile = env.files.get(spreadsheetId)!;
    expect(sheetFile.parents).toEqual([folder!.id]);
    expect(sheetFile.parents).not.toContain(FAKE_ROOT_ID);
  });

  it('reuses the existing folder rather than creating a second one', async () => {
    await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    // Second sign-in: same Drive, spreadsheet already discovered.
    clearCache();
    await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());

    const folders = [...env.files.values()].filter((f) => f.mimeType === FOLDER_MIME_TYPE);
    expect(folders).toHaveLength(1);
  });

  it('moves a sheet created before the folder existed into it, once', async () => {
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    // Simulate the pre-folder world: loose at the root, never filed by us.
    const sheetFile = env.files.get(spreadsheetId)!;
    sheetFile.parents = [FAKE_ROOT_ID];
    delete sheetFile.appProperties![APP_FILED_KEY];
    for (const f of [...env.files.values()]) {
      if (f.mimeType === FOLDER_MIME_TYPE) env.files.delete(f.id);
    }
    clearCache();

    await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());

    const folder = [...env.files.values()].find((f) => f.mimeType === FOLDER_MIME_TYPE)!;
    expect(env.files.get(spreadsheetId)!.parents).toEqual([folder.id]);
    expect(env.files.get(spreadsheetId)!.appProperties?.[APP_FILED_KEY]).toBe(APP_FILED_VALUE);
  });

  it('never moves the sheet a second time, so a teacher can refile it and have it stay', async () => {
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());
    // The teacher moves it into a folder of their own after we filed it once.
    env.files.get(spreadsheetId)!.parents = ['teachers_own_folder'];
    clearCache();

    await discoverOrCreateSpreadsheet(env.buildSheets(), env.buildDrive());

    expect(env.files.get(spreadsheetId)!.parents).toEqual(['teachers_own_folder']);
  });
});
