import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, updateCached } from './cache.js';
import {
  appendRows,
  readTabRowsIndexed,
  updateRowsByNumber,
  isActive,
  type RowObject,
  type RowWrite,
} from './sheets.js';
import { listEnrollments } from './enrollments.js';
import { listConstraints } from './groupingConstraints.js';
import { buildGroups, type AlgoConstraint, type GeneratedGroup } from './groupingAlgorithm.js';

export interface Grouping {
  /** null until saved. */
  id: string | null;
  groupSize: number | null;
  groupCount: number | null;
  groups: GeneratedGroup[];
  generatedAt: string;
  savedAt: string | null;
}

/** Exactly one of groupSize / groupCount is set, matching the generation parameter. */
export interface GroupingParams {
  groupSize?: number;
  groupCount?: number;
}

export const GROUPINGS_RESOURCE = 'groupings';
const RESOURCE = GROUPINGS_RESOURCE;

/**
 * Generates groups for the students enrolled in `course`, applying the stored
 * constraints plus any one-off ad-hoc constraints. Reads only (roster and
 * constraints are cached) — nothing is persisted until `saveGrouping`.
 */
export async function generateGrouping(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  course: string,
  params: GroupingParams,
  adHocConstraints: AlgoConstraint[] = [],
  /**
   * Constraints are premium. A `free` account still generates and saves
   * groupings; its saved rules are ignored rather than erroring, so a lapsed
   * account's constraints survive in the Sheet and re-apply on upgrade.
   */
  applyConstraints = true,
): Promise<Grouping> {
  const [enrollments, stored] = await Promise.all([
    listEnrollments(sheets, spreadsheetId, userKey),
    applyConstraints ? listConstraints(sheets, spreadsheetId, userKey) : Promise.resolve([]),
  ]);
  const studentIds = enrollments.filter((e) => e.course === course).map((e) => e.studentId);

  const constraints: AlgoConstraint[] = applyConstraints
    ? [
        ...stored.map((c) => ({ constraintTypeKey: c.constraintTypeKey, studentIds: c.studentIds })),
        ...adHocConstraints,
      ]
    : [];

  const groups = buildGroups({
    studentIds,
    constraints,
    groupSize: params.groupSize,
    groupCount: params.groupCount,
  });

  return {
    id: null,
    groupSize: params.groupSize ?? null,
    groupCount: params.groupCount ?? null,
    groups,
    generatedAt: nowIso(),
    savedAt: null,
  };
}

/**
 * Persists the current grouping for a course, overwriting any prior one. Each
 * class keeps exactly one saved grouping: the new arrangement replaces the
 * previous one, one row per group. This backs auto-save — every change
 * (generate, drag-move, renumber) calls this so the class's grouping survives
 * reloads until it is changed again.
 *
 * ## Rows are reused rather than replaced, and that is the whole point
 *
 * The obvious implementation soft-deletes the course's rows and appends a fresh
 * set. It is what this did, and because auto-save fires on **every** interaction
 * it turned ordinary use into unbounded growth: a class of 30 in groups of 4
 * writes 8 rows per save, and one planning session of generate-drag-regenerate
 * is easily ten saves and eighty rows, seventy-two of them dead. A term across
 * several classes reached thousands. Nothing ever read that history — the only
 * reader filters to active rows — and `listCurrentGroupings` reads the whole tab
 * before filtering, so every cold load paid for all of it.
 *
 * So the course's existing rows are **overwritten in place**: the first
 * `min(old, new)` groups take over the rows the previous arrangement used, any
 * further groups first reuse rows this course had soft-deleted before appending
 * new ones, and any surplus rows are soft-deleted. Dragging a student between
 * groups does not change the group count, which is the common case, so the
 * common case now writes zero new rows. The tab settles at each course's
 * high-water mark of group count instead of growing without limit.
 *
 * Only this course's rows are touched. Rewriting the whole tab would bound
 * growth too, and was rejected: it turns a concurrent save for a *different*
 * class from "last write wins on a row" into "last write wins on the tab",
 * which would silently drop the other class's arrangement.
 *
 * Reusing a row means reusing the storage, not the record: each row still gets a
 * fresh `id` and the grouping a fresh `groupingId`, because it is a new
 * arrangement. Nothing references either across a save.
 */
export async function saveCurrentGrouping(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  course: string,
  params: GroupingParams,
  groups: GeneratedGroup[],
): Promise<Grouping> {
  const existing = await readTabRowsIndexed(sheets, spreadsheetId, 'groupings');
  const now = nowIso();
  const forCourse = existing.filter((r) => String(r.obj.course) === course);
  // Live rows first, in sheet order, then this course's tombstones as spare
  // storage. Both are ordinary rows; the only difference is which gets reused
  // first, and preferring the live ones keeps a grouping's rows contiguous.
  const live = forCourse.filter((r) => isActive(r.obj));
  const spare = forCourse.filter((r) => !isActive(r.obj));
  const reusable = [...live, ...spare];

  const groupingId = ulid();
  const desired: RowObject[] = groups.map((g, groupIndex) => ({
    id: ulid(),
    groupingId,
    groupIndex,
    studentIds: g.studentIds.join('|'),
    groupSize: params.groupSize ?? null,
    groupCount: params.groupCount ?? null,
    savedAt: now,
    deletedAt: null,
    course,
  }));

  const updates: RowWrite[] = [];
  const rows: RowObject[] = [];
  desired.forEach((obj, i) => {
    const slot = reusable[i];
    if (slot) updates.push({ rowNumber: slot.rowNumber, obj });
    else rows.push(obj);
  });
  // Whatever the previous arrangement used and this one does not.
  for (const leftover of live.slice(desired.length)) {
    updates.push({ rowNumber: leftover.rowNumber, obj: { ...leftover.obj, deletedAt: now } });
  }

  if (updates.length > 0) {
    await updateRowsByNumber(sheets, spreadsheetId, 'groupings', updates, {
      headerValidated: true,
    });
  }
  await appendRows(sheets, spreadsheetId, 'groupings', rows, { headerValidated: true });
  const saved: Grouping = {
    id: groupingId,
    groupSize: params.groupSize ?? null,
    groupCount: params.groupCount ?? null,
    groups,
    generatedAt: now,
    savedAt: now,
  };
  // Auto-save fires on every drag/renumber/regenerate, so merge the new grouping
  // for this course into the warm cache instead of dropping the whole map.
  updateCached<Map<string, Grouping>>(cacheKey(userKey, RESOURCE), (m) => {
    const next = new Map(m);
    next.set(course, saved);
    return next;
  });
  return saved;
}

function toIntOrNull(v: RowObject[string]): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The saved grouping for one course, or null if the class has none. */
export async function getCurrentGrouping(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  course: string,
): Promise<Grouping | null> {
  const byCourse = await listCurrentGroupings(sheets, spreadsheetId, userKey);
  return byCourse.get(course) ?? null;
}

/** Active groupings keyed by course; cached per user, filtered in memory. */
async function listCurrentGroupings(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<Map<string, Grouping>> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const rows = (await readTabRowsIndexed(sheets, spreadsheetId, 'groupings')).filter((r) =>
      isActive(r.obj),
    );

    const byGrouping = new Map<string, { obj: RowObject; groupIndex: number }[]>();
    for (const r of rows) {
      const gid = String(r.obj.groupingId);
      const list = byGrouping.get(gid) ?? [];
      list.push({ obj: r.obj, groupIndex: Number(r.obj.groupIndex ?? 0) });
      byGrouping.set(gid, list);
    }

    const byCourse = new Map<string, Grouping>();
    for (const [gid, list] of byGrouping) {
      list.sort((a, b) => a.groupIndex - b.groupIndex);
      const first = list[0].obj;
      const course = String(first.course ?? '');
      const savedAt = String(first.savedAt ?? '');
      const idsFor = (obj: RowObject): string[] => {
        const raw = obj.studentIds;
        return raw ? String(raw).split('|').filter(Boolean) : [];
      };
      byCourse.set(course, {
        id: gid,
        groupSize: toIntOrNull(first.groupSize),
        groupCount: toIntOrNull(first.groupCount),
        groups: list.map((l) => ({ studentIds: idsFor(l.obj) })),
        generatedAt: savedAt,
        savedAt,
      });
    }
    return byCourse;
  });
}
