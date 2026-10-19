import type { sheets_v4 } from 'googleapis';
import { ARCHIVE_OF, TABS, type TabName } from '../config/schema.js';
import { nowIso } from '../utils/time.js';
import { ApiError } from '../utils/errors.js';
import { invalidatePrefix } from './cache.js';
import {
  appendRows,
  countTabRows,
  readTabsRowsIndexed,
  replaceTabsRows,
  updateRowsByNumber,
  isActive,
  type RowObject,
  type IndexedRow,
  type RowWrite,
  type TabReplacement,
} from './sheets.js';
import {
  listCourses,
  deriveCourses,
  resolveNameCollision,
  buildClassList,
  type ClassListPayload,
  type CourseRecord,
} from './courses.js';

/**
 * Moving a class's data between the live tabs and the archive (Phase 2 Step 6e).
 *
 * ## Why rows move rather than getting a flag
 *
 * `listAttendance` reads the whole attendance tab and filters in memory, so an
 * archived flag would leave every archived row still being read and then thrown
 * away. A full timetable adds roughly 27,000 attendance rows a year; the cold
 * read is the cost teachers actually feel at the end of a second or third year.
 * Only removing the rows from the live tab fixes it.
 *
 * ## The ordering, which is the whole safety argument
 *
 * Sheets has no transactions, so the operation is arranged in two phases and
 * the boundary between them is the guarantee:
 *
 *   1. **read** every tab involved, in one call, and plan the whole move in
 *      memory
 *   2. **append** each set of moving rows to its destination, and **verify**
 *      each append landed, before anything anywhere is destroyed
 *   3. only then **rewrite the sources**, in one batch
 *
 * A failure anywhere in 1-2 leaves every source tab untouched: nothing is lost,
 * and a retry redoes the appends. A failure in 3 leaves rows in both places:
 * duplicates, which the next run removes by id. The reverse order — clearing
 * first — would turn the same failure into permanent data loss, which for a
 * teacher's attendance records is the one outcome worth designing the whole
 * operation around. `replaceTabsRows` applies the same argument again one level
 * down, writing the surviving rows before clearing what they did not cover.
 *
 * Phase 3 being a single batch is what makes the boundary real. Rewriting each
 * source as its tab was finished meant the third tab's append happened after the
 * first tab had already been emptied, so a failure in the middle left the class
 * genuinely half-moved.
 *
 * Duplicate-tolerance is what makes it resumable without a progress record: each
 * step is idempotent, so a retry converges rather than double-applying.
 *
 * ## Cost
 *
 * One read for every tab, one append and one verifying count per tab that has
 * rows moving, and two calls for all the source rewrites together — around
 * thirteen Sheets calls for a whole class, whatever its size. That number is the
 * constraint the design answers to: Sheets allows 60 reads and 60 writes per
 * minute *per user*, and an earlier shape of this code spent about forty calls
 * per move, so a teacher who archived two classes in a minute was rate-limited
 * by their own second click.
 */

export type Direction = 'archive' | 'unarchive';

/** Which tabs a move touches, in the order they are processed. */
const MOVED_TABS: TabName[] = ['enrollments', 'attendance', 'groupings'];

/**
 * Every tab the operation reads, fetched in one `batchGet`.
 *
 * Reading all of them up front rather than a pair at a time is what lets the
 * appends be planned together, which is what lets the destructive half be a
 * single batch. The student move is planned from the same snapshot: it depends
 * on which enrollments are about to move, which is known here, rather than on
 * re-reading the tab after they have.
 */
const READ_TABS: TabName[] = [
  'enrollments',
  'enrollmentsArchive',
  'attendance',
  'attendanceArchive',
  'groupings',
  'groupingsArchive',
  'students',
  'studentsArchive',
  'courses',
];

function rowId(obj: RowObject): string {
  return String(obj.id ?? '');
}

/**
 * How many rows `countTabRows` would report for a tab we have already read.
 *
 * It counts column A, so this counts the first column's field — the same
 * question asked of data already in hand rather than of Sheets. Keeping the two
 * definitions identical is what lets the before-count come from the read while
 * the after-count stays a real, independent re-read.
 */
function populatedRowCount(tab: TabName, rows: RowObject[]): number {
  const first = TABS[tab].columns[0].field;
  return rows.filter((obj) => obj[first] !== '' && obj[first] != null).length;
}

/** One tab's move, decided entirely from the snapshot and not yet executed. */
interface PlannedMove {
  from: TabName;
  to: TabName;
  /** Rows leaving `from`, with any rename already applied. */
  moving: RowObject[];
  /** Rows that stay, i.e. what `from` will hold afterwards. */
  staying: RowObject[];
  /** What `to` already holds, from the same read. */
  destination: RowObject[];
}

/**
 * Drops rows repeating an id already seen, keeping the first.
 *
 * This is the repair half of writing before clearing. A rewrite interrupted
 * between the two leaves the surviving rows correct and a tail of stale copies
 * below them, and those copies are what a retry has to converge away — without
 * this, a retry would faithfully write the duplicates back and the tab would
 * carry them for good, which is corruption of a different shape rather than a
 * recovery. Two rows sharing an id are the same record by definition, so keeping
 * either is the same answer.
 *
 * Rows with no id are left alone rather than collapsed into one, since they
 * share nothing but their emptiness.
 */
function dedupeById(rows: RowObject[]): RowObject[] {
  const seen = new Set<string>();
  return rows.filter((obj) => {
    const id = rowId(obj);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function plan(
  read: Map<TabName, IndexedRow[]>,
  from: TabName,
  to: TabName,
  matches: (obj: RowObject) => boolean,
  transform: (obj: RowObject) => RowObject = (obj) => obj,
): PlannedMove {
  const source = dedupeById((read.get(from) ?? []).map((r) => r.obj));
  const destination = (read.get(to) ?? []).map((r) => r.obj);
  return {
    from,
    to,
    // Transformed *before* the append, never after. Renaming rows once they have
    // landed cannot work: the destination may already hold a live class with the
    // same name — which, on a restore, is precisely why the rename is needed — so
    // a rename pass over the destination hits both and merges the two classes.
    // That was a real data-loss bug, not a hypothetical one.
    moving: source.filter(matches).map(transform),
    staying: source.filter((obj) => !matches(obj)),
    destination,
  };
}

/**
 * Appends a plan's moving rows to its destination, skipping any whose id is
 * already present, then confirms the tab grew by what was actually written.
 *
 * The skip is what makes a retry after a mid-operation failure safe: the previous
 * run's append is recognised rather than duplicated. The verification is what
 * earns the right to destroy the source afterwards — without it, "the append
 * succeeded" would rest on the API call not having thrown, which is not the same
 * claim.
 *
 * Only the after-count is a Sheets read. The before-count is the destination we
 * have already read, so verification costs one call rather than two, and the one
 * it keeps is the one doing the work: an independent re-read after the write.
 */
async function appendVerified(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  move: PlannedMove,
): Promise<void> {
  const existingIds = new Set(move.destination.map(rowId));
  const fresh = move.moving.filter((r) => !existingIds.has(rowId(r)));
  if (fresh.length === 0) return;
  const before = populatedRowCount(move.to, move.destination);
  // The header was validated when this tab was read, in the same response.
  await appendRows(sheets, spreadsheetId, move.to, fresh, { headerValidated: true });
  const after = await countTabRows(sheets, spreadsheetId, move.to);
  if (after - before < fresh.length) {
    throw new ApiError(
      'SHEET_UNAVAILABLE',
      'Some rows could not be written. Nothing has been removed — try again.',
    );
  }
}

export interface MoveResult {
  /** Renames forced by a live-name collision on unarchive. */
  renamed: { from: string; to: string }[];
  /**
   * Every class and its student count, as they stand after the move.
   *
   * Returned rather than re-read. The operation has just rewritten these exact
   * tabs and holds the result in memory, so answering the request from a fresh
   * read would spend calls re-learning what it had just written — and it would
   * do so immediately after dropping the cache, so every one of them would miss.
   */
  classes: ClassListPayload;
}

/**
 * Archives or restores whole classes.
 *
 * The student rule: archiving moves a class's enrollments, its attendance and
 * its saved grouping. A student in classes A and B with A archived keeps their
 * student row, their B enrollment and all their B attendance. A student left
 * with **no** live enrollment has their student row moved too — without that the
 * roster never shrinks, which is most of the point.
 */
export async function moveClasses(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  classIds: string[],
  direction: Direction,
): Promise<MoveResult> {
  const all = await listCourses(sheets, spreadsheetId, userKey);
  const byId = new Map(all.map((c) => [c.id, c]));
  const targets: CourseRecord[] = [];
  for (const id of classIds) {
    const course = byId.get(id);
    if (!course) throw new ApiError('NOT_FOUND', 'That class no longer exists.');
    const alreadyThere = direction === 'archive' ? course.archivedAt !== null : course.archivedAt === null;
    // Not an error: re-submitting an already-archived class is a double click,
    // not a mistake worth failing the whole batch for.
    if (!alreadyThere) targets.push(course);
  }

  const read = await readTabsRowsIndexed(sheets, spreadsheetId, READ_TABS);
  if (targets.length === 0) {
    return { renamed: [], classes: classListFrom(read, all) };
  }

  /**
   * The invariant that makes matching rows by course name safe:
   * **a name is unique among live classes and unique among archived classes**,
   * though the same name may exist once in each.
   *
   * It has to be enforced in *both* directions, not just on restore. Rows in the
   * archive tabs carry the course name and nothing else identifying, so two
   * archived classes sharing a name would have indistinguishable rows — and
   * archiving "Period A Science" in 2025 and again in 2026 is a completely
   * ordinary thing for a teacher to do. Resolving the collision on the way in
   * keeps every archived row attributable to exactly one class.
   */
  const renamed: { from: string; to: string }[] = [];
  const names = new Map<string, string>();
  // The set the moved rows are landing among — live names when restoring,
  // archived names when archiving.
  const taken = new Set(
    all
      .filter((c) => (direction === 'unarchive' ? c.archivedAt === null : c.archivedAt !== null))
      .map((c) => c.name),
  );
  for (const course of targets) {
    const next = resolveNameCollision(course.name, course.createdAt, taken);
    // Added even when unchanged, so two classes with the same name moving in one
    // batch cannot both claim it.
    taken.add(next);
    names.set(course.id, next);
    if (next !== course.name) renamed.push({ from: course.name, to: next });
  }

  // Source rows carry the class's *current* name; the invariant above makes that
  // unambiguous within the tab being read.
  const courseNames = new Set(targets.map((c) => c.name));
  const matchesCourse = (obj: RowObject) => courseNames.has(String(obj.course ?? ''));

  const renameByOldName = new Map<string, string>();
  for (const course of targets) {
    const next = names.get(course.id);
    if (next && next !== course.name) renameByOldName.set(course.name, next);
  }
  const applyName = (obj: RowObject): RowObject => {
    const next = renameByOldName.get(String(obj.course ?? ''));
    return next ? { ...obj, course: next } : obj;
  };

  const moves: PlannedMove[] = MOVED_TABS.map((tab) => {
    const archive = ARCHIVE_OF[tab];
    const [from, to] = direction === 'archive' ? [tab, archive] : [archive, tab];
    return plan(read, from, to, matchesCourse, applyName);
  });
  // Which students move is a question about which enrollments move, so the
  // student plan is derived from that one rather than from its position here.
  const enrollmentMove = moves.find((m) => m.from === 'enrollments' || m.to === 'enrollments');
  if (!enrollmentMove) throw new Error('No enrollment move planned');
  moves.push(planStudentMove(read, direction, enrollmentMove));

  const pending = moves.filter((m) => m.moving.length > 0);

  // Phase 2: everything is written and verified before anything is destroyed.
  for (const move of pending) {
    await appendVerified(sheets, spreadsheetId, move);
  }

  // Phase 3: one batch, and the only destructive step.
  const replacements: TabReplacement[] = pending.map((m) => ({ tab: m.from, rows: m.staying }));
  await replaceTabsRows(sheets, spreadsheetId, replacements);

  // Phase 4, and it must stay last: the course row is this operation's commit
  // record. `moveClasses` decides there is nothing to do by reading `archivedAt`,
  // so a stamp written alongside the rewrites would mark the class moved even
  // when the rewrite failed — and the retry that should repair it would find
  // nothing to do and return success over a half-moved class. Writing it only
  // once every row is where it belongs keeps a failed run fully retryable.
  //
  // Changed rows in place rather than a tab rewrite: nothing is being removed
  // here, so this needs no clear and costs one call.
  const stamped = stampCourses(read, targets, direction, names);
  await updateRowsByNumber(sheets, spreadsheetId, 'courses', stamped, { headerValidated: true });

  // Everything derived from these tabs is now wrong; drop this teacher's whole
  // working set rather than reasoning about which keys survived.
  invalidatePrefix(`${userKey}::`);

  const stampedByRow = new Map(stamped.map((w) => [w.rowNumber, w.obj]));
  const coursesAfter = (read.get('courses') ?? []).map((r) =>
    stampedByRow.has(r.rowNumber) ? { rowNumber: r.rowNumber, obj: stampedByRow.get(r.rowNumber)! } : r,
  );
  const after = new Map(read);
  for (const move of pending) {
    after.set(move.from, asIndexed(move.staying));
    after.set(move.to, asIndexed([...move.destination, ...dedupeAgainst(move)]));
  }
  return { renamed, classes: classListFrom(after, deriveCourses(coursesAfter)) };
}

/** The rows an append actually added, i.e. excluding ids the destination already had. */
function dedupeAgainst(move: PlannedMove): RowObject[] {
  const existing = new Set(move.destination.map(rowId));
  return move.moving.filter((r) => !existing.has(rowId(r)));
}

function asIndexed(rows: RowObject[]): IndexedRow[] {
  return rows.map((obj, i) => ({ rowNumber: i + 2, obj }));
}

function classListFrom(
  rows: Map<TabName, IndexedRow[]>,
  courses: CourseRecord[],
): ClassListPayload {
  return buildClassList(
    courses,
    (rows.get('enrollments') ?? []).map((r) => r.obj),
    (rows.get('enrollmentsArchive') ?? []).map((r) => r.obj),
  );
}

/**
 * Plans the student rows that move with the class.
 *
 * Derived from the enrollment plan rather than from a second read: which
 * students are about to be left with nothing live is a question about rows we
 * have already decided to move, so re-reading the tab afterwards to ask it was
 * a round trip spent confirming our own arithmetic.
 */
function planStudentMove(
  read: Map<TabName, IndexedRow[]>,
  direction: Direction,
  enrollments: PlannedMove,
): PlannedMove {
  const studentIds = (rows: RowObject[]) =>
    new Set(rows.filter(isActive).map((obj) => String(obj.studentId)));
  const moving = studentIds(enrollments.moving);

  if (direction === 'archive') {
    // Deliberately *not* "every student with no live enrollment". A student the
    // teacher created moments ago and has not yet put in a class also has no
    // live enrollment, and sweeping them into the archive because someone
    // archived an unrelated class would be a bug that looks like data loss.
    // Only students who were actually in one of the archived classes are
    // considered, and only those left with nothing live.
    const stillEnrolled = studentIds(enrollments.staying);
    return plan(
      read,
      'students',
      'studentsArchive',
      (obj) => moving.has(String(obj.id)) && !stillEnrolled.has(String(obj.id)),
    );
  }

  // Restoring: bring back exactly the students the restored classes need. A
  // student already on the live roster simply has no row in studentsArchive to
  // match, so no special case is needed for them.
  return plan(read, 'studentsArchive', 'students', (obj) => moving.has(String(obj.id)));
}

/**
 * The course rows the move changes — `archivedAt` set or cleared, and any rename
 * applied — addressed by their existing row numbers.
 *
 * Pure, and returned rather than written, so the caller controls when it lands.
 * That timing is the point: see phase 4 above.
 */
function stampCourses(
  read: Map<TabName, IndexedRow[]>,
  targets: CourseRecord[],
  direction: Direction,
  names: Map<string, string>,
): RowWrite[] {
  const ids = new Set(targets.map((c) => c.id));
  const now = nowIso();
  return (read.get('courses') ?? [])
    .filter((r) => ids.has(String(r.obj.id)))
    .map((r) => ({
      rowNumber: r.rowNumber,
      obj: {
        ...r.obj,
        archivedAt: direction === 'archive' ? now : null,
        name: names.get(String(r.obj.id)) ?? r.obj.name,
      },
    }));
}
