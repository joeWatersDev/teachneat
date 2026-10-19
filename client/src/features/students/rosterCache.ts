import type { Student } from './types';

/**
 * Module-level stale-while-revalidate store for the roster. Lives above the
 * router so the Students page can render the last known roster instantly on
 * revisit while a background refetch updates it in place. Intentionally
 * hand-rolled — a data-fetching library would need a DEPENDENCIES.md review.
 */

export interface RiskFlags {
  /** Courses in which the student is flagged as at academic risk. */
  atRiskCourses: string[];
  /** Courses in which the student crosses the high-absence threshold. */
  highAbsenceCourses: string[];
}

export interface RosterSnapshot {
  students: Student[];
  /** Per student, the academic-risk / high-absence warning flags. */
  riskByStudent: Record<string, RiskFlags>;
}

let snapshot: RosterSnapshot | null = null;

export function getRosterSnapshot(): RosterSnapshot | null {
  return snapshot;
}

export function setRosterSnapshot(next: RosterSnapshot): void {
  snapshot = next;
}

/** Distinct course names across the cached roster, for the course combobox suggestions. */
export function getCachedCourses(): string[] {
  if (!snapshot) return [];
  return Array.from(new Set(snapshot.students.flatMap((s) => s.courses))).sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Test hook: reset between runs. */
export function clearRosterSnapshot(): void {
  snapshot = null;
}
