import type { sheets_v4 } from 'googleapis';
import { TABS, type TabName } from '../config/schema.js';
import { trackGoogleCall } from './apiMetrics.js';
import { replaceTabsRows, type RowObject } from './sheets.js';

/** The tabs this migration compacts. Both accumulated the same dead rows. */
const TABS_TO_COMPACT: TabName[] = ['groupings', 'groupingsArchive'];

/**
 * schemaVersion 5 → 6 (Step 6k follow-up): drop the soft-deleted grouping rows.
 *
 * ## What went wrong
 *
 * `saveCurrentGrouping` used to soft-delete a course's rows and append a fresh
 * set on every save, and the Grouping page auto-saves on every generate,
 * drag-move and reorder. So ordinary use grew the tab without limit: a class of
 * 30 in groups of 4 writes 8 rows per save, and a single planning session of
 * generate-drag-regenerate is easily ten saves and eighty rows, seventy-two of
 * them dead. A term across several classes reached thousands.
 *
 * Nothing ever read that history — `listCurrentGroupings` is the only reader and
 * it filters to active rows — and it reads the whole tab before filtering, so
 * every cold grouping load paid for every dead row. Class archiving moved them
 * too, since the move partitions by course without an active filter, which is
 * why `groupingsArchive` is compacted here as well.
 *
 * The save path is fixed to reuse rows in place, so the growth stops. This
 * clears what the old behaviour already left behind.
 *
 * ## Why this is safe to do destructively
 *
 * A soft-deleted grouping row is unreachable: no endpoint, view or export
 * surfaces one, and no row references another by id. Dropping them changes what
 * every reader sees by exactly nothing. **Live arrangements are kept** — the
 * teacher's current grouping for each class survives, so nobody has to
 * regenerate anything.
 *
 * `replaceTabsRows` writes the survivors before clearing what they did not
 * cover, so an interruption leaves duplicates rather than a hole. Converging
 * from there takes the second half of the same argument, and it is the half that
 * is easy to miss: the survivors are **deduplicated by id**, because a failed
 * clear leaves the rows this step just wrote *and* the originals they were meant
 * to replace, and a retry that kept both would settle on two copies of every live
 * arrangement — which `listCurrentGroupings` would render as double the groups.
 * Two rows sharing an id are the same record, so keeping either is the same
 * answer. The same reasoning is spelled out at `dedupeById` in classArchive.ts.
 *
 * The step is idempotent: on a tab that has already been compacted it writes the
 * same rows back and clears nothing.
 */
export async function migrateV5ToV6(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  const res = await trackGoogleCall('sheets', 'values.batchGet', () =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: TABS_TO_COMPACT.map((t) => `${t}!A1:ZZ`),
      majorDimension: 'ROWS',
    }),
  );
  const valueRanges = res.data.valueRanges ?? [];

  const replacements = TABS_TO_COMPACT.map((tab, i) => {
    const values = (valueRanges[i]?.values ?? []) as unknown[][];
    const codes = (values[0] ?? []).map((c) => String(c ?? ''));
    const columns = TABS[tab].columns;
    const deletedAtIndex = codes.indexOf(
      columns.find((c) => c.field === 'deletedAt')?.code ?? '',
    );

    const rows: RowObject[] = [];
    const seen = new Set<string>();
    for (const raw of values.slice(1)) {
      const cells = (raw ?? []).map((c) => (c == null ? '' : String(c)));
      if (cells.every((v) => v === '')) continue;
      // A tab whose header lacks the column is not one we can judge, so keep
      // every row rather than guess. Reading it as "nothing is deleted" is the
      // safe direction: this migration only ever removes.
      if (deletedAtIndex !== -1 && cells[deletedAtIndex]) continue;
      const obj: RowObject = {};
      columns.forEach((col) => {
        const at = codes.indexOf(col.code);
        const value = at === -1 ? '' : (cells[at] ?? '');
        obj[col.field] = value === '' ? null : value;
      });
      const id = String(obj.id ?? '');
      // Rows with no id share nothing but their emptiness, so they are not
      // collapsed into one.
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(obj);
    }
    return { tab, rows };
  });

  await replaceTabsRows(sheets, spreadsheetId, replacements);
}
