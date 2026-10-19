import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { CLASS_DAY_MARKER_KEY, TABS, type TabName } from '../config/schema.js';
import { nowIso, dayAfter } from '../utils/time.js';
import { trackGoogleCall } from './apiMetrics.js';
import {
  appendRows,
  replaceTabsRows,
  writeHeaderRow,
  type RowObject,
} from './sheets.js';

/**
 * schemaVersion 4 → 5 (Step 6k): attendance stored as exceptions.
 *
 * Rewrites the `attendance` tab so it holds only non-present marks plus one
 * class-day marker per (course, date) the register was taken, and fills in the
 * `startDate` column the same version adds to `enrollments`.
 *
 * ## Why the startDate backfill is part of *this* migration
 *
 * After the rewrite, the days a student was present are gone as rows. The
 * earliest date a student has any attendance on is therefore only computable
 * *before* the destructive step, and it is the best available answer to "when
 * did this student join the class". Without it, a student who joined in November
 * would be inferred present for every September class-day, and their absence
 * rate computed against a denominator covering weeks before they arrived — so
 * statistics would not survive the migration unchanged, which is the property
 * the whole step turns on.
 *
 * ## Ordering, which is the safety argument
 *
 * Three phases, arranged so that a failure at any point loses nothing and a
 * retry converges rather than double-applying:
 *
 *   1. **Append** the new markers. Purely additive: every original row is still
 *      there, so a failure here leaves the sheet exactly as it was.
 *   2. **Backfill** `enrollments`, which only fills empty cells.
 *   3. **Rewrite** `attendance`, dropping the present rows. This is the only
 *      destructive step and it is last, so a failure leaves duplicates (present
 *      rows that should have gone) rather than absent rows that should have
 *      stayed.
 *
 * Every phase is idempotent. Markers are deduplicated on (course, date), the
 * backfill skips a `startDate` that is already set, and the rewrite is a
 * projection that is stable once applied. The runner stamps the version only
 * after `migrate` resolves, so an interrupted run is retried from the top on the
 * next bootstrap.
 *
 * Reads are raw because `enrollments` still carries its v4 six-column header
 * here and the typed readers assert the current schema. Writes may use the typed
 * helpers: `attendance`'s columns are identical in v4 and v5, and `enrollments`
 * has its v5 header written before its rows.
 */
export async function migrateV4ToV5(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  const [attendanceRows, enrollmentRows] = await readRaw(sheets, spreadsheetId, [
    'attendance',
    'enrollments',
  ]);

  const active = attendanceRows.filter((r) => !cell(r, 'deletedAt'));

  // Every (course, date) that has any active row is a day the register was
  // taken, whatever the statuses on it were. Existing markers are included so a
  // retry after a partial run does not duplicate them.
  const needed = new Map<string, { course: string; date: string }>();
  const existing = new Set<string>();
  for (const row of active) {
    const course = cell(row, 'course');
    const date = cell(row, 'date');
    if (!date) continue;
    const key = classDayKey(course, date);
    needed.set(key, { course, date });
    if (cell(row, 'statusKey') === CLASS_DAY_MARKER_KEY) existing.add(key);
  }

  const now = nowIso();
  const newMarkers: RowObject[] = [];
  for (const [key, { course, date }] of needed) {
    if (existing.has(key)) continue;
    newMarkers.push({
      id: ulid(),
      studentId: null,
      course,
      date,
      statusKey: CLASS_DAY_MARKER_KEY,
      notes: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  // Phase 1: additive. Nothing is lost if this fails.
  await appendRows(sheets, spreadsheetId, 'attendance', newMarkers, { headerValidated: true });

  // Phase 2: the startDate backfill, computed from the pre-rewrite rows.
  //
  // This is what makes every statistic survive the migration unchanged, and it
  // has two halves because "no rows" meant two different things under v4:
  //
  //   - A student **with** rows joined no later than their earliest one, so that
  //     date is their start. Days before it were days they were not recorded,
  //     and must not become inferred presents.
  //   - A student with **no** rows in a course that has recorded days was never
  //     in a session that was taken. Under v4 they read as `daysRecorded: 0`;
  //     left unbounded they would now read as present on every one of those
  //     days. Starting them the day after the last recorded one preserves the
  //     zero exactly, and the next register the teacher takes counts normally.
  const earliest = new Map<string, string>();
  for (const row of active) {
    const studentId = cell(row, 'studentId');
    if (!studentId) continue; // a marker, which belongs to no student
    const date = cell(row, 'date');
    if (!date) continue;
    const key = enrollmentKey(studentId, cell(row, 'course'));
    const held = earliest.get(key);
    if (held === undefined || date < held) earliest.set(key, date);
  }

  const lastDayByCourse = new Map<string, string>();
  for (const { course, date } of needed.values()) {
    const held = lastDayByCourse.get(course);
    if (held === undefined || date > held) lastDayByCourse.set(course, date);
  }

  const enrollments: RowObject[] = enrollmentRows.map((row) => {
    const obj = toObject(row, 'enrollments');
    if (!obj.startDate) {
      const course = cell(row, 'course');
      const found = earliest.get(enrollmentKey(cell(row, 'studentId'), course));
      const lastDay = lastDayByCourse.get(course);
      obj.startDate = found ?? (lastDay ? dayAfter(lastDay) : null);
    }
    return obj;
  });

  // The header first, so the tab is never a v4 header over v5 rows. Bootstrap's
  // additive reconciliation runs immediately after this and sees a header that
  // already matches, so it does nothing.
  await writeHeaderRow(sheets, spreadsheetId, 'enrollments');
  await replaceTabsRows(sheets, spreadsheetId, [{ tab: 'enrollments', rows: enrollments }]);

  // Phase 3: the destructive step, last. Present rows go; exception rows stay,
  // including soft-deleted ones, which are history rather than clutter. A
  // soft-deleted present row is dropped with the rest: present is now what the
  // absence of a row already means.
  //
  // **The rewrite is a normalising projection, not a copy**, and that is what
  // makes a retry converge. Phase 1 appended its markers to the tab, so on the
  // path where phase 3 half-completes the tab ends up holding them twice: once
  // from the append and once from the rewrite that did not finish clearing.
  // Rebuilding one marker per class-day here means the next run collapses that
  // back to the canonical form instead of faithfully preserving the duplicates,
  // which is what an earlier version did — it converged on row *count* and never
  // on row *content*, and the difference is a denominator counted twice.
  const kept = attendanceRows
    .filter((r) => {
      const status = cell(r, 'statusKey');
      return status !== 'p' && status !== CLASS_DAY_MARKER_KEY;
    })
    .map((r) => toObject(r, 'attendance'));

  const markerByKey = new Map<string, RowObject>();
  for (const row of active) {
    if (cell(row, 'statusKey') !== CLASS_DAY_MARKER_KEY) continue;
    const key = classDayKey(cell(row, 'course'), cell(row, 'date'));
    if (!markerByKey.has(key)) markerByKey.set(key, toObject(row, 'attendance'));
  }
  for (const marker of newMarkers) {
    const key = classDayKey(String(marker.course ?? ''), String(marker.date ?? ''));
    if (!markerByKey.has(key)) markerByKey.set(key, marker);
  }

  await replaceTabsRows(sheets, spreadsheetId, [
    { tab: 'attendance', rows: [...kept, ...markerByKey.values()] },
  ]);
}

/**
 * Composite map keys, NUL-joined so a course name cannot collide with the
 * separator. Declared once rather than written inline: `markerByKey` is built by
 * two separate loops that must agree on the key exactly, and a marker deduped
 * under one spelling and looked up under another would write the same class-day
 * twice.
 */
function classDayKey(course: string, date: string): string {
  return `${course}\u0000${date}`;
}

function enrollmentKey(studentId: string, course: string): string {
  return `${studentId}\u0000${course}`;
}

/** One tab's raw rows, as arrays of cell strings, paired with the header codes read alongside. */
interface RawTab {
  codes: string[];
  rows: string[][];
}

type RawRow = { tab: TabName; codes: string[]; values: string[] };

async function readRaw(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: TabName[],
): Promise<RawRow[][]> {
  const res = await trackGoogleCall('sheets', 'values.batchGet', () =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: tabs.map((t) => `${t}!A1:ZZ`),
      majorDimension: 'ROWS',
    }),
  );
  const valueRanges = res.data.valueRanges ?? [];
  return tabs.map((tab, i) => {
    const values = (valueRanges[i]?.values ?? []) as unknown[][];
    const raw: RawTab = {
      codes: (values[0] ?? []).map((c) => String(c ?? '')),
      rows: values.slice(1).map((r) => (r ?? []).map((c) => (c == null ? '' : String(c)))),
    };
    return raw.rows
      .filter((values) => values.some((v) => v !== ''))
      .map((values) => ({ tab, codes: raw.codes, values }));
  });
}

/** One field of a raw row, resolved through the header codes actually present on the sheet. */
function cell(row: RawRow, field: string): string {
  const spec = TABS[row.tab].columns.find((c) => c.field === field);
  if (!spec) return '';
  const index = row.codes.indexOf(spec.code);
  return index === -1 ? '' : (row.values[index] ?? '');
}

/** A raw row as a typed row object, with any column the sheet does not yet carry left null. */
function toObject(row: RawRow, tab: TabName): RowObject {
  const obj: RowObject = {};
  for (const col of TABS[tab].columns) {
    const value = cell(row, col.field);
    obj[col.field] = value === '' ? null : value;
  }
  return obj;
}
