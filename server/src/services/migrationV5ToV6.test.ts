import { describe, it, expect } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { migrateV5ToV6 } from './migrationV5ToV6.js';
import { getCurrentGrouping } from './groupings.js';
import { readTabRowsIndexed, isActive } from './sheets.js';
import { headerRowForTab, type TabName } from '../config/schema.js';

const USER = 'user-sub-1';

/** id, groupingId, groupIndex, studentIds, groupSize, groupCount, savedAt, deletedAt, course */
function groupRow(
  id: string,
  groupingId: string,
  groupIndex: number,
  studentIds: string,
  course: string,
  deletedAt = '',
): string[] {
  return [
    id,
    groupingId,
    String(groupIndex),
    studentIds,
    '3',
    '',
    '2026-09-01T00:00:00Z',
    deletedAt,
    course,
  ];
}

async function write(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: TabName,
  rows: string[][],
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headerRowForTab(tab), ...rows] },
  } as never);
}

async function rowCounts(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: TabName) {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, tab);
  return { total: rows.length, active: rows.filter((r) => isActive(r.obj)).length };
}

/**
 * A sheet carrying what the old auto-save left behind: one live arrangement per
 * class, and a long tail of soft-deleted rows from every earlier save.
 */
async function setupBloated() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

  const rows: string[][] = [];
  // Twelve superseded saves of three groups each, across two classes.
  for (let save = 0; save < 6; save++) {
    for (const course of ['Math', 'Science']) {
      for (let g = 0; g < 3; g++) {
        rows.push(
          groupRow(`dead-${course}-${save}-${g}`, `old-${course}-${save}`, g, 's1|s2', course, '2026-09-02T00:00:00Z'),
        );
      }
    }
  }
  // The live arrangement for each class.
  for (const course of ['Math', 'Science']) {
    for (let g = 0; g < 3; g++) {
      rows.push(groupRow(`live-${course}-${g}`, `live-${course}`, g, `a${g}|b${g}`, course));
    }
  }
  await write(sheets, spreadsheetId, 'groupings', rows);

  // Archiving moved tombstones across too, since the move partitions by course
  // without an active filter.
  await write(sheets, spreadsheetId, 'groupingsArchive', [
    groupRow('arch-dead-1', 'old-arch', 0, 's1', 'History', '2026-09-02T00:00:00Z'),
    groupRow('arch-live-1', 'live-arch', 0, 's1|s2', 'History'),
  ]);

  clearCache();
  return { env, sheets, spreadsheetId };
}

describe('migrateV5ToV6', () => {
  it('drops the dead rows and keeps every live one', async () => {
    const { sheets, spreadsheetId } = await setupBloated();
    expect(await rowCounts(sheets, spreadsheetId, 'groupings')).toEqual({ total: 42, active: 6 });

    await migrateV5ToV6(sheets, spreadsheetId);

    expect(await rowCounts(sheets, spreadsheetId, 'groupings')).toEqual({ total: 6, active: 6 });
    const ids = (await readTabRowsIndexed(sheets, spreadsheetId, 'groupings')).map((r) =>
      String(r.obj.id),
    );
    expect(ids.every((id) => id.startsWith('live-'))).toBe(true);
  });

  it('compacts the archive tab too', async () => {
    const { sheets, spreadsheetId } = await setupBloated();
    await migrateV5ToV6(sheets, spreadsheetId);

    const archive = await readTabRowsIndexed(sheets, spreadsheetId, 'groupingsArchive');
    expect(archive).toHaveLength(1);
    expect(String(archive[0].obj.id)).toBe('arch-live-1');
  });

  it('leaves each class reading back the arrangement it had', async () => {
    const { sheets, spreadsheetId } = await setupBloated();
    await migrateV5ToV6(sheets, spreadsheetId);
    clearCache();

    for (const course of ['Math', 'Science']) {
      const current = await getCurrentGrouping(sheets, spreadsheetId, USER, course);
      expect(current?.groups).toHaveLength(3);
      // The live rows carried a0|b0, a1|b1, a2|b2 — unchanged by the compaction.
      expect(current?.groups.map((g) => g.studentIds)).toEqual([
        ['a0', 'b0'],
        ['a1', 'b1'],
        ['a2', 'b2'],
      ]);
    }
  });

  it('is idempotent on an already-compacted sheet', async () => {
    const { sheets, spreadsheetId } = await setupBloated();
    await migrateV5ToV6(sheets, spreadsheetId);
    const first = await rowCounts(sheets, spreadsheetId, 'groupings');

    await migrateV5ToV6(sheets, spreadsheetId);
    expect(await rowCounts(sheets, spreadsheetId, 'groupings')).toEqual(first);
  });

  it('does nothing to a sheet that has no grouping rows', async () => {
    const env = new FakeGoogleEnv();
    const sheets = env.buildSheets();
    const drive = env.buildDrive();
    const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);

    await migrateV5ToV6(sheets, spreadsheetId);
    expect(await rowCounts(sheets, spreadsheetId, 'groupings')).toEqual({ total: 0, active: 0 });
  });

  it('keeps every row when the tab is interrupted before clearing, and converges on retry', async () => {
    const { env, sheets, spreadsheetId } = await setupBloated();
    // replaceTabsRows writes the survivors and then clears the tail. A failed
    // clear is the half-applied case: the live rows are in place with a stale
    // tail below them, which is the recoverable direction.
    env.failNextClear = true;
    await expect(migrateV5ToV6(sheets, spreadsheetId)).rejects.toThrow();

    await migrateV5ToV6(sheets, spreadsheetId);
    expect(await rowCounts(sheets, spreadsheetId, 'groupings')).toEqual({ total: 6, active: 6 });
  });
});
