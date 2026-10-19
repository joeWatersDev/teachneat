import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { ApiError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, updateCached } from './cache.js';
import {
  appendRow,
  readTabRowsIndexed,
  updateRowByNumber,
  isActive,
  type RowObject,
} from './sheets.js';
import type { GroupingConstraintTypeKey } from '../config/schema.js';

export interface GroupingConstraint {
  id: string;
  constraintTypeKey: GroupingConstraintTypeKey;
  studentIds: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConstraintCreateInput {
  constraintTypeKey: GroupingConstraintTypeKey;
  studentIds: string[];
  notes?: string | null;
}

export type ConstraintUpdateInput = Partial<ConstraintCreateInput>;

export const GROUPING_CONSTRAINTS_RESOURCE = 'groupingConstraints';
const RESOURCE = GROUPING_CONSTRAINTS_RESOURCE;

function str(v: RowObject[string]): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function rowToConstraint(obj: RowObject): GroupingConstraint {
  const ids = str(obj.studentIds);
  return {
    id: String(obj.id),
    constraintTypeKey: String(obj.constraintTypeKey) as GroupingConstraintTypeKey,
    studentIds: ids ? ids.split('|').filter(Boolean) : [],
    notes: str(obj.notes),
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

/** All active constraints, cached per user. */
export async function listConstraints(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<GroupingConstraint[]> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'groupingConstraints');
    return rows.filter((r) => isActive(r.obj)).map((r) => rowToConstraint(r.obj));
  });
}

export async function createConstraint(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  input: ConstraintCreateInput,
): Promise<GroupingConstraint> {
  const now = nowIso();
  const row: RowObject = {
    id: ulid(),
    constraintTypeKey: input.constraintTypeKey,
    studentIds: input.studentIds.join('|'),
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await appendRow(sheets, spreadsheetId, 'groupingConstraints', row);
  const created = rowToConstraint(row);
  updateCached<GroupingConstraint[]>(cacheKey(userKey, RESOURCE), (list) => [...list, created]);
  return created;
}

export async function updateConstraint(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
  patch: ConstraintUpdateInput,
): Promise<GroupingConstraint> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'groupingConstraints');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Constraint not found.');

  const next: RowObject = { ...match.obj };
  if (patch.constraintTypeKey !== undefined) next.constraintTypeKey = patch.constraintTypeKey;
  if (patch.studentIds !== undefined) next.studentIds = patch.studentIds.join('|');
  if (patch.notes !== undefined) next.notes = patch.notes;
  next.updatedAt = nowIso();

  await updateRowByNumber(sheets, spreadsheetId, 'groupingConstraints', match.rowNumber, next, {
    headerValidated: true,
  });
  const updated = rowToConstraint(next);
  updateCached<GroupingConstraint[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.map((c) => (c.id === updated.id ? updated : c)),
  );
  return updated;
}

export async function softDeleteConstraint(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'groupingConstraints');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Constraint not found.');

  const now = nowIso();
  await updateRowByNumber(
    sheets,
    spreadsheetId,
    'groupingConstraints',
    match.rowNumber,
    { ...match.obj, updatedAt: now, deletedAt: now },
    { headerValidated: true },
  );
  updateCached<GroupingConstraint[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.filter((c) => c.id !== id),
  );
}
