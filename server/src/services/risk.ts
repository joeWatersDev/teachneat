import type { sheets_v4 } from 'googleapis';
import { DEFAULT_HIGH_ABSENCE, type HighAbsenceThreshold } from '../config/plan.js';
import { listStudents } from './students.js';
import { getStats, isHighAbsenceRisk } from './attendance.js';

export interface RiskSummaryEntry {
  studentId: string;
  /** Courses in which the student is flagged as at academic risk (stored flag). */
  atRiskCourses: string[];
  /** Courses in which the student crosses the high-absence threshold (computed). */
  highAbsenceCourses: string[];
}

/**
 * One entry per active student for the roster's warning indicators, carrying the
 * specific courses each warning applies to (so the roster can name them in a
 * tooltip): the courses flagged at academic risk (stored per-enrollment flag) and
 * the courses crossing the high-absence threshold (computed from attendance).
 */
export async function listRiskSummary(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  threshold: HighAbsenceThreshold = DEFAULT_HIGH_ABSENCE,
): Promise<RiskSummaryEntry[]> {
  const [students, stats] = await Promise.all([
    listStudents(sheets, spreadsheetId, userKey),
    getStats(sheets, spreadsheetId, userKey),
  ]);
  const highAbsenceByStudent = new Map<string, string[]>();
  for (const s of stats) {
    if (!isHighAbsenceRisk(s, threshold)) continue;
    const list = highAbsenceByStudent.get(s.studentId) ?? [];
    list.push(s.course);
    highAbsenceByStudent.set(s.studentId, list);
  }
  return students.map((s) => ({
    studentId: s.id,
    atRiskCourses: s.atRiskCourses,
    highAbsenceCourses: highAbsenceByStudent.get(s.id) ?? [],
  }));
}
