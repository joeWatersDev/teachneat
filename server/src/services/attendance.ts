import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import { ApiError } from '../utils/errors.js';
import { nowIso, isWeekend, dayAfter } from '../utils/time.js';
import {
  CLASS_DAY_MARKER_KEY,
  isExceptionStatus,
  type AttendanceStatusKey,
} from '../config/schema.js';
import { DEFAULT_HIGH_ABSENCE, type HighAbsenceThreshold } from '../config/plan.js';
import { cacheKey, getOrLoad, updateCached } from './cache.js';
import {
  appendRows,
  readTabRowsIndexed,
  updateRowByNumber,
  updateRowsByNumber,
  isActive,
  type RowObject,
  type RowWrite,
} from './sheets.js';
import { listEnrollments, effectiveStartDate, type Enrollment } from './enrollments.js';

/**
 * Attendance is stored as exceptions (Step 6k, schemaVersion 5).
 *
 * A student who was present has no row. What separates "everyone was present"
 * from "nobody took attendance" is a **class-day marker**: one row per (course,
 * date) saying the register was taken. A year of a full timetable is roughly
 * 1,890 exception rows plus 900 markers instead of 27,000 rows, which shrinks
 * the Sheets read, the sheet's growth and the resident working set together.
 *
 * Two rules hold this together and both are load-bearing:
 *
 *   1. **Markers are never optional.** A save writes one even when every student
 *      is present, and it goes in the *same* append call as the exceptions so the
 *      two cannot diverge. A missing marker turns a perfect record into a day
 *      that never happened and silently changes the statistics' denominator.
 *   2. **A class-day is a marker OR any exception on that date.** Statistics and
 *      expansion both take the union rather than trusting markers alone, so a
 *      marker lost to a partial write cannot hide an absence that was recorded.
 *      This is belt-and-braces, not a licence to skip rule 1.
 *
 * Callers outside this file never see either form: `listByDate` and
 * `listByRange` expand back to the dense per-student records the API has always
 * returned, so the client is unchanged.
 */
export interface ClassDay {
  course: string;
  date: string;
}

/** The stored form: exception rows plus the class-day markers that give them a denominator. */
export interface AttendanceSnapshot {
  /** Non-present marks only. Never contains a `p` record or a marker. */
  records: AttendanceRecord[];
  classDays: ClassDay[];
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  course: string;
  date: string; // YYYY-MM-DD
  statusKey: AttendanceStatusKey;
  notes: string | null;
}

export interface AttendanceEntry {
  studentId: string;
  statusKey: AttendanceStatusKey;
  notes?: string | null;
}

export interface AttendanceUpdateInput {
  statusKey?: AttendanceStatusKey;
  notes?: string | null;
}

export interface AttendanceStats {
  studentId: string;
  course: string;
  totalAbsences: number;
  totalTardies: number;
  totalExcused: number;
  daysRecorded: number;
  absenceRate: number; // 0..1, absences / daysRecorded; 0 if daysRecorded == 0
  consecutiveAbsences: number; // current streak from the most recent recorded days
}

const RESOURCE = 'attendance';

function str(v: RowObject[string]): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/**
 * A string pool for one bulk read (Step 6d).
 *
 * Attendance is by far the largest thing the working set holds, and most of it
 * is the same handful of strings over and over: a year repeats each `studentId`
 * about 180 times, each `course` about 5,400 times and each `date` about 150.
 * Pooling them leaves one copy of each instead of one per row, which measured
 * at roughly half the footprint even though `JSON.parse` already internalises
 * some of it on the way in.
 *
 * Deliberately per-read rather than module-level: a global pool would hold
 * every string any teacher ever read for the life of the process, which is both
 * a leak and student data kept well past the working set's own clocks.
 */
function createInterner(): (v: string | null) => string | null {
  const pool = new Map<string, string>();
  return (v) => {
    if (v === null) return null;
    const held = pool.get(v);
    if (held !== undefined) return held;
    pool.set(v, v);
    return v;
  };
}

/**
 * `intern` is optional so the single-record write paths, which produce one row
 * and have nothing to share it with, can skip building a pool.
 *
 * Note what is absent: `createdAt` and `updatedAt`. Both are still written to
 * the sheet, and neither is read back into the record, because nothing in the
 * client has ever rendered them and two ISO strings per row cost about a
 * quarter of the largest thing we cache.
 */
function rowToRecord(obj: RowObject, intern?: (v: string | null) => string | null): AttendanceRecord {
  const it = intern ?? ((v: string | null) => v);
  return {
    id: String(obj.id),
    studentId: it(String(obj.studentId)) as string,
    course: it(String(obj.course ?? '')) as string,
    date: it(String(obj.date)) as string,
    statusKey: it(String(obj.statusKey)) as AttendanceStatusKey,
    notes: it(str(obj.notes)),
  };
}

/**
 * The stored attendance for one teacher, cached per user. Derived reads filter
 * and expand in memory. Single-flighted so concurrent cold reads collapse to one
 * Sheets call.
 *
 * **This is the one place rows are parsed, and that is deliberate.** Markers are
 * split off from exceptions here so that no marker ever exists as an
 * `AttendanceRecord`, which is what keeps `CLASS_DAY_MARKER_KEY` from leaking
 * into the client's status union, the heatmap classifier, or the statistics.
 * Anything reading attendance goes through this function.
 */
async function loadSnapshot(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<AttendanceSnapshot> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
    const intern = createInterner();
    return splitRows(
      rows.filter((r) => isActive(r.obj)).map((r) => r.obj),
      intern,
    );
  });
}

/** Partitions raw active rows into exceptions and markers. Shared by the loader and the cache merges. */
function splitRows(objs: RowObject[], intern: (v: string | null) => string | null): AttendanceSnapshot {
  const records: AttendanceRecord[] = [];
  const classDays: ClassDay[] = [];
  for (const obj of objs) {
    const statusKey = String(obj.statusKey ?? '');
    if (statusKey === CLASS_DAY_MARKER_KEY) {
      classDays.push({
        course: intern(String(obj.course ?? '')) as string,
        date: intern(String(obj.date)) as string,
      });
    } else if (isExceptionStatus(statusKey)) {
      records.push(rowToRecord(obj, intern));
    }
    // Anything else — a stray `p` row from before schemaVersion 5, or a status a
    // later version adds — is dropped rather than guessed at. A leftover `p` row
    // means present, which is now what no row already means.
  }
  return { records, classDays };
}

/** NUL-joined, so a course name containing the separator cannot collide. */
function dayKey(studentId: string, course: string, date: string): string {
  return `${studentId}\u0000${course}\u0000${date}`;
}

/**
 * The dates each course had attendance taken, within an optional range and
 * course scope, sorted ascending and deduplicated.
 *
 * The union of markers and exception dates, per rule 2 at the top of this file:
 * a date carrying an absence was self-evidently a day the register was taken,
 * whether or not its marker survived. Weekends are excluded here rather than by
 * each caller, matching `computeStats`'s long-standing treatment of them as
 * non-instructional regardless of any stray row.
 */
function classDayDates(
  snapshot: AttendanceSnapshot,
  course?: string,
  range?: { startDate: string; endDate: string },
): Map<string, string[]> {
  const byCourse = new Map<string, Set<string>>();
  const add = (c: string, date: string) => {
    if (course !== undefined && c !== course) return;
    // ISO dates compare correctly as strings.
    if (range && (date < range.startDate || date > range.endDate)) return;
    if (isWeekend(date)) return;
    const set = byCourse.get(c) ?? new Set<string>();
    set.add(date);
    byCourse.set(c, set);
  };
  for (const cd of snapshot.classDays) add(cd.course, cd.date);
  for (const r of snapshot.records) add(r.course, r.date);

  const out = new Map<string, string[]>();
  for (const [c, set] of byCourse) out.set(c, [...set].sort());
  return out;
}

/**
 * The id given to a record that exists only by inference. Nothing stores it and
 * `PUT /attendance/:id` will not find it, which is correct: there is no row to
 * edit, and setting a student to a non-present status goes through
 * `POST /attendance` like every other mark.
 */
function inferredId(studentId: string, course: string, date: string): string {
  return `~p:${date}:${course}:${studentId}`;
}

/**
 * Expands the stored form back into the dense per-student records the API has
 * always returned: every student enrolled in a class on a day the register was
 * taken gets a record, carrying their exception if they have one and `p` if they
 * do not.
 *
 * A student is only expanded from the date they joined the class, which is what
 * keeps a mid-year arrival from being reported present for the weeks before they
 * were there.
 */
function expand(
  snapshot: AttendanceSnapshot,
  enrollments: Enrollment[],
  course?: string,
  range?: { startDate: string; endDate: string },
): AttendanceRecord[] {
  const days = classDayDates(snapshot, course, range);
  if (days.size === 0) return [];

  const exceptions = new Map<string, AttendanceRecord>();
  for (const r of snapshot.records) {
    exceptions.set(dayKey(r.studentId, r.course, r.date), r);
  }

  const byCourse = new Map<string, Enrollment[]>();
  for (const e of enrollments) {
    if (course !== undefined && e.course !== course) continue;
    const list = byCourse.get(e.course) ?? [];
    list.push(e);
    byCourse.set(e.course, list);
  }

  const out: AttendanceRecord[] = [];
  for (const [c, dates] of days) {
    const enrolled = byCourse.get(c) ?? [];
    for (const date of dates) {
      for (const e of enrolled) {
        const existing = exceptions.get(dayKey(e.studentId, c, date));
        if (existing) {
          // A recorded mark is a fact and outranks the start date, which only
          // ever suppresses a guess. A teacher who marks a student absent on a
          // day before their recorded start has told us something; dropping it
          // would lose a real record to a bookkeeping field.
          out.push(existing);
          continue;
        }
        const start = effectiveStartDate(e);
        if (start !== null && date < start) continue;
        out.push({
          id: inferredId(e.studentId, c, date),
          studentId: e.studentId,
          course: c,
          date,
          statusKey: 'p',
          notes: null,
        });
      }
    }
  }
  return out;
}

export async function listByDate(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  date: string,
  course?: string,
): Promise<AttendanceRecord[]> {
  const [snapshot, enrollments] = await Promise.all([
    loadSnapshot(sheets, spreadsheetId, userKey),
    listEnrollments(sheets, spreadsheetId, userKey),
  ]);
  return expand(snapshot, enrollments, course, { startDate: date, endDate: date });
}

export async function listByRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  startDate: string,
  endDate: string,
  course?: string,
): Promise<AttendanceRecord[]> {
  const [snapshot, enrollments] = await Promise.all([
    loadSnapshot(sheets, spreadsheetId, userKey),
    listEnrollments(sheets, spreadsheetId, userKey),
  ]);
  return expand(snapshot, enrollments, course, { startDate, endDate });
}

/**
 * Writes attendance for a set of students in one course on one date. Validation
 * (unknown course, students not enrolled in the course, duplicate student ids)
 * happens before any write, so a rejected request writes nothing. Existing active
 * (studentId, course, date) rows are overwritten in place — one batch call — and
 * new rows are appended in one call, preserving the app-enforced
 * (studentId, course, date) uniqueness. Records in other courses are untouched.
 *
 * From schemaVersion 5 the request is unchanged — the client still submits every
 * student including the present ones — but only the non-present marks become
 * rows. Present students write nothing, a student moved back to present has
 * their row deleted, and the class-day marker is appended alongside so the day
 * still reads as taken.
 */
export async function submitAttendance(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  date: string,
  course: string,
  entries: AttendanceEntry[],
): Promise<{ written: number }> {
  if (isWeekend(date)) {
    throw new ApiError('VALIDATION_ERROR', 'Attendance cannot be recorded on weekends.');
  }

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.studentId)) {
      throw new ApiError('VALIDATION_ERROR', 'Duplicate student in attendance entries.');
    }
    seen.add(e.studentId);
  }

  const enrollments = await listEnrollments(sheets, spreadsheetId, userKey);
  const enrolledInCourse = new Set(
    enrollments.filter((e) => e.course === course).map((e) => e.studentId),
  );
  if (enrolledInCourse.size === 0) {
    throw new ApiError('VALIDATION_ERROR', 'That course was not found.');
  }
  if (entries.some((e) => !enrolledInCourse.has(e.studentId))) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'One or more students are not enrolled in that course.',
    );
  }

  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
  const existingByStudent = new Map<string, { rowNumber: number; obj: RowObject }>();
  let markerRow: { rowNumber: number; obj: RowObject } | undefined;
  for (const r of rows) {
    if (!isActive(r.obj) || r.obj.date !== date || r.obj.course !== course) continue;
    if (String(r.obj.statusKey ?? '') === CLASS_DAY_MARKER_KEY) {
      markerRow = r;
    } else {
      existingByStudent.set(String(r.obj.studentId), r);
    }
  }

  const now = nowIso();
  const updates: RowWrite[] = [];
  const appends: RowObject[] = [];
  // Ids of rows this save removes, so the cache merge below can drop them.
  const removedIds = new Set<string>();

  for (const entry of entries) {
    const existing = existingByStudent.get(entry.studentId);
    if (entry.statusKey === 'p') {
      // Present is stored as the absence of an *active* row, so returning a
      // student to present soft-deletes their exception rather than rewriting it
      // to `p`. The row stays on the tab with `deletedAt` stamped, as every soft
      // delete in this schema does: removing a row from a Sheet means rewriting
      // the whole tab. The day stays taken, because the marker below is written
      // regardless. Any note goes with the row: there is nothing left to hang it
      // on.
      if (existing) {
        updates.push({
          rowNumber: existing.rowNumber,
          obj: { ...existing.obj, deletedAt: now, updatedAt: now },
        });
        removedIds.add(String(existing.obj.id));
      }
      continue;
    }
    if (existing) {
      updates.push({
        rowNumber: existing.rowNumber,
        obj: {
          ...existing.obj,
          statusKey: entry.statusKey,
          notes: entry.notes ?? null,
          updatedAt: now,
        },
      });
    } else {
      appends.push({
        id: ulid(),
        studentId: entry.studentId,
        course,
        date,
        statusKey: entry.statusKey,
        notes: entry.notes ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
  }

  // The marker, in the SAME append as the exceptions. Not an optimisation: one
  // call means the register cannot end up recorded without its marker, which is
  // the failure that turns a class of present students into a class nobody took.
  // A day where every student is present appends only this row, which is exactly
  // the case that must not be skipped.
  if (markerRow === undefined) {
    appends.push({
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

  await updateRowsByNumber(sheets, spreadsheetId, 'attendance', updates, {
    headerValidated: true,
  });
  await appendRows(sheets, spreadsheetId, 'attendance', appends, { headerValidated: true });

  // Merge the writes into the warm cache instead of dropping it, so repeated
  // daily-entry saves (and the History/Stats views that follow) stay warm.
  // Overwrites replace the existing record by id, deletions drop it, and new
  // rows are appended. Both carry generated ids, so the derived cache never
  // needs the sheet row number. One pool across both, since a bulk save is many
  // rows of one class on one date — exactly the repetition the pool exists for.
  const intern = createInterner();
  const stillActive = updates.filter((u) => !removedIds.has(String(u.obj.id)));
  const updatedById = new Map(
    stillActive.map((u) => [String(u.obj.id), rowToRecord(u.obj, intern)]),
  );
  const appended = splitRows(appends, intern);
  updateCached<AttendanceSnapshot>(cacheKey(userKey, RESOURCE), (snapshot) => ({
    records: [
      ...snapshot.records
        .filter((r) => !removedIds.has(r.id))
        .map((r) => updatedById.get(r.id) ?? r),
      ...appended.records,
    ],
    classDays: [...snapshot.classDays, ...appended.classDays],
  }));
  return { written: entries.length };
}

/**
 * Corrects a single stored mark.
 *
 * Only exception rows are addressable. A class-day marker is skipped rather than
 * matched, so a marker id cannot be edited into a student's status or deleted
 * out from under the day it records; an inferred-present record has no row at
 * all and its synthetic id simply does not match. Both answer `NOT_FOUND`.
 *
 * Setting `statusKey` to `p` soft-deletes the row, since present is stored as
 * the absence of an active one. `deletedAt` is stamped and the row stays on the
 * tab, like every other soft delete here — removing a row from a Sheet means
 * rewriting the whole tab, which is the cost class archiving exists to avoid.
 * Marking the student absent again appends a fresh row rather than reviving the
 * tombstone, so a repeatedly corrected mark leaves more than one row behind. That
 * is bounded by corrections rather than by student-days, so it does not threaten
 * the saving this step exists for.
 *
 * The day stays taken either way, its marker being untouched, and any note on
 * the row goes with it.
 */
export async function updateAttendance(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
  patch: AttendanceUpdateInput,
): Promise<AttendanceRecord> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'attendance');
  const match = rows.find(
    (r) =>
      r.obj.id === id &&
      isActive(r.obj) &&
      String(r.obj.statusKey ?? '') !== CLASS_DAY_MARKER_KEY,
  );
  if (!match) throw new ApiError('NOT_FOUND', 'Attendance record not found.');

  const now = nowIso();
  const removing = patch.statusKey === 'p';
  const next: RowObject = { ...match.obj };
  if (patch.statusKey !== undefined) next.statusKey = patch.statusKey;
  if (patch.notes !== undefined) next.notes = patch.notes;
  next.updatedAt = now;
  if (removing) next.deletedAt = now;

  await updateRowByNumber(sheets, spreadsheetId, 'attendance', match.rowNumber, next, {
    headerValidated: true,
  });

  if (removing) {
    updateCached<AttendanceSnapshot>(cacheKey(userKey, RESOURCE), (snapshot) => ({
      records: snapshot.records.filter((r) => r.id !== id),
      classDays: snapshot.classDays,
    }));
    // What the day now reads as: present by inference, at the id inference gives it.
    return {
      id: inferredId(String(match.obj.studentId), String(match.obj.course ?? ''), String(match.obj.date)),
      studentId: String(match.obj.studentId),
      course: String(match.obj.course ?? ''),
      date: String(match.obj.date),
      statusKey: 'p',
      notes: null,
    };
  }

  const updated = rowToRecord(next);
  updateCached<AttendanceSnapshot>(cacheKey(userKey, RESOURCE), (snapshot) => ({
    records: snapshot.records.map((r) => (r.id === updated.id ? updated : r)),
    classDays: snapshot.classDays,
  }));
  return updated;
}

/** A student's membership in one course — the unit of attendance aggregation. */
export interface EnrollmentPair {
  studentId: string;
  course: string;
  /**
   * The already-resolved date this student joined the class (see
   * `effectiveStartDate`), or null for no bound. Class-days before it are not
   * counted, because the student was not there to be present.
   */
  startDate?: string | null;
}


/**
 * Pure aggregation over the stored form, one result row per (student, course)
 * enrollment. When a range is passed, only class-days inside it count. Every
 * listed enrollment appears exactly once, with zeros when nothing is recorded.
 * Attendance is keyed per class, so a student in two courses yields two
 * independent stats rows.
 *
 * **`daysRecorded` is the class-day count, not the student's row count**, which
 * is the whole point of the marker: a student with no rows at all now correctly
 * reads as present on every day the register was taken, where before
 * schemaVersion 5 they read as never recorded. It is clamped to the enrollment's
 * start date so the denominator covers only days the student was in the class,
 * and that clamp is what keeps a mid-year arrival from being reported present
 * for the weeks before they joined.
 *
 * Over the dense data schemaVersion 4 produced, every figure here is identical
 * to what the previous implementation returned, which is the property the
 * migration turns on.
 */
export function computeStats(
  records: AttendanceRecord[],
  classDays: ClassDay[],
  enrollments: EnrollmentPair[],
  range?: { startDate: string; endDate: string },
): AttendanceStats[] {
  const days = classDayDates({ records, classDays }, undefined, range);

  const byDay = new Map<string, AttendanceStatusKey>();
  for (const r of records) {
    if (range && (r.date < range.startDate || r.date > range.endDate)) continue;
    // Weekends are non-instructional and never count, even if a stray row exists.
    if (isWeekend(r.date)) continue;
    byDay.set(dayKey(r.studentId, r.course, r.date), r.statusKey);
  }

  return enrollments.map(({ studentId, course, startDate }) => {
    const all = days.get(course) ?? [];
    // The start date suppresses inferred presents, never a recorded mark: a day
    // the student actually has a row on counts however it compares to the date.
    const scoped = startDate
      ? all.filter((d) => d >= startDate || byDay.has(dayKey(studentId, course, d)))
      : all;

    let totalAbsences = 0;
    let totalTardies = 0;
    let totalExcused = 0;
    for (const date of scoped) {
      const status = byDay.get(dayKey(studentId, course, date));
      if (status === 'a') totalAbsences++;
      else if (status === 't') totalTardies++;
      else if (status === 'e') totalExcused++;
    }

    // The streak walks class-days rather than the student's own rows, so a day
    // they were present breaks it. Before schemaVersion 5 a present day was a
    // row like any other and broke it the same way.
    let consecutiveAbsences = 0;
    for (let i = scoped.length - 1; i >= 0; i--) {
      if (byDay.get(dayKey(studentId, course, scoped[i])) !== 'a') break;
      consecutiveAbsences++;
    }

    const daysRecorded = scoped.length;
    return {
      studentId,
      course,
      totalAbsences,
      totalTardies,
      totalExcused,
      daysRecorded,
      absenceRate: daysRecorded === 0 ? 0 : totalAbsences / daysRecorded,
      consecutiveAbsences,
    };
  });
}

/**
 * The most recent date each course had attendance taken, for courses that have
 * any recorded day at all.
 *
 * Exists for the enrollment start-date rule (Step 6k follow-up): a student added
 * to a class that has already been recorded starts the day after the last
 * register, so they are not inferred present for sessions held before they
 * arrived. A course absent from the map has no recorded days, so a student
 * joining it needs no bound.
 *
 * Lives here rather than in `enrollments.ts` because it reads the attendance
 * working set, and `enrollments.ts` cannot import this module without creating a
 * cycle — `students.ts` is the caller that composes the two, and it already
 * depends on both. It costs no extra Sheets call when the snapshot is warm,
 * which on the roster-add path it generally is.
 */
export async function lastRecordedDayByCourse(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<Map<string, string>> {
  const snapshot = await loadSnapshot(sheets, spreadsheetId, userKey);
  const out = new Map<string, string>();
  for (const [course, dates] of classDayDates(snapshot)) {
    // `classDayDates` sorts ascending, so the last entry is the most recent.
    const latest = dates[dates.length - 1];
    if (latest !== undefined) out.set(course, latest);
  }
  return out;
}

/**
 * The start date to stamp on a new enrollment, given the course's last recorded
 * day. Null when the course has never been recorded, which leaves the enrollment
 * unbounded so a teacher can still enter attendance predating the roster.
 *
 * Deliberately derived from the data rather than from the clock. "Today" would
 * need the teacher's timezone, which the server does not have, and an
 * off-by-one there drops a real day from the register they are about to take.
 * It is also the same rule the v4→v5 migration applies to a student who had no
 * rows, so the system carries one definition of this rather than two.
 */
export function startDateForNewEnrollment(lastRecordedDay: string | undefined): string | null {
  return lastRecordedDay === undefined ? null : dayAfter(lastRecordedDay);
}

export async function getStats(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  range?: { startDate: string; endDate: string },
  course?: string,
): Promise<AttendanceStats[]> {
  const [snapshot, enrollments] = await Promise.all([
    loadSnapshot(sheets, spreadsheetId, userKey),
    listEnrollments(sheets, spreadsheetId, userKey),
  ]);
  const pairs: EnrollmentPair[] = enrollments
    .filter((e) => course === undefined || e.course === course)
    .map((e) => ({
      studentId: e.studentId,
      course: e.course,
      startDate: effectiveStartDate(e),
    }));
  return computeStats(snapshot.records, snapshot.classDays, pairs, range);
}

/**
 * The single "high absence" threshold used everywhere the app flags absences:
 * the roster and student-detail warning indicators, the Statistics view flag, and
 * the email "High absences" recipient selection. A student crosses it when they
 * have at least `minDaysRecorded` recorded days and an absence rate strictly above
 * `minAbsenceRate`. The product default (over 15%, ≥ 5 days) lives in
 * config/plan.ts; a `trial` or `paid` account may store its own via PUT /settings,
 * resolved per request by services/plan.ts `effectiveHighAbsence`. Callers must
 * pass the effective threshold rather than reaching for the default, so all four
 * places the flag appears agree.
 */
export const HIGH_ABSENCE_RISK = DEFAULT_HIGH_ABSENCE;

/** Whether a per-(student, course) stats row crosses the given high-absence threshold. */
export function isHighAbsenceRisk(
  stats: AttendanceStats,
  threshold: HighAbsenceThreshold = DEFAULT_HIGH_ABSENCE,
): boolean {
  return (
    stats.daysRecorded >= threshold.minDaysRecorded && stats.absenceRate > threshold.minAbsenceRate
  );
}

export interface AttendanceThreshold {
  /** Flag when totalAbsences >= this value. */
  minAbsences?: number;
  /** Flag when absenceRate >= this value (0..1). */
  minAbsenceRate?: number;
}

/**
 * Threshold detection used by the stats view's flags now and the Step 6 rules
 * engine later. A student crosses the threshold when any configured bound is
 * met or exceeded.
 */
export function exceedsThreshold(stats: AttendanceStats, threshold: AttendanceThreshold): boolean {
  if (threshold.minAbsences !== undefined && stats.totalAbsences >= threshold.minAbsences) {
    return true;
  }
  if (
    threshold.minAbsenceRate !== undefined &&
    stats.daysRecorded > 0 &&
    stats.absenceRate >= threshold.minAbsenceRate
  ) {
    return true;
  }
  return false;
}
