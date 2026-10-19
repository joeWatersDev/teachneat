import { isWeekend } from './dates';
import type { AttendanceStatusKey } from './types';

export type DayCategory =
  | 'present'
  | 'tardy'
  | 'absent'
  | 'excused'
  | 'weekend'
  | 'empty'
  | 'future';

/**
 * Classifies one calendar day for attendance visualizations. Weekends are gray
 * regardless of any record; excused days are gray; recorded school days take
 * their status color; unrecorded past school days are empty; days after today
 * are future. Pure, and shared by the student-detail heatmap and the class-wide
 * History grid so the two can never disagree on what a day means.
 */
export function classifyDay(
  date: string,
  status: AttendanceStatusKey | undefined,
  today: string,
): DayCategory {
  if (date > today) return 'future';
  if (isWeekend(date)) return 'weekend';
  if (!status) return 'empty';
  if (status === 'p') return 'present';
  if (status === 't') return 'tardy';
  if (status === 'a') return 'absent';
  return 'excused';
}

// Present days are blue; the attention states carry warm/red color. Excused is a
// dark gray, a weekend is a darker gray, and a data gap is a faint fill. Future
// cells are invisible placeholders. Shared by both attendance visualizations.
export const CELL_CLASS: Record<DayCategory, string> = {
  present: 'bg-info',
  tardy: 'bg-warning',
  absent: 'bg-danger',
  excused: 'bg-secondary',
  weekend: 'bg-strong',
  empty: 'bg-hover',
  future: 'opacity-0',
};

export const CATEGORY_LABEL: Record<DayCategory, string> = {
  present: 'Present',
  tardy: 'Tardy',
  absent: 'Absent',
  excused: 'Excused',
  weekend: 'Weekend',
  empty: 'No record',
  future: '',
};

// A student may have several records on one day (one per course). When several
// statuses must collapse to one cell, the most severe wins so an absence in any
// class is never hidden: absent > tardy > excused > present.
const STATUS_SEVERITY: Record<AttendanceStatusKey, number> = { a: 3, t: 2, e: 1, p: 0 };

export function mergeStatus(
  current: AttendanceStatusKey | undefined,
  next: AttendanceStatusKey,
): AttendanceStatusKey {
  if (current === undefined) return next;
  return STATUS_SEVERITY[next] > STATUS_SEVERITY[current] ? next : current;
}
