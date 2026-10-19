import { apiClient } from './client';
import type { Student } from '../features/students/types';

export interface StudentInput {
  firstName: string;
  lastName: string;
  goesBy?: string | null;
  pronouns?: string | null;
  courses: string[];
  studentEmail?: string | null;
  parentEmails?: string[];
  notes?: string | null;
}

export type StudentUpdateInput = Partial<StudentInput>;

export interface RiskSummaryEntry {
  studentId: string;
  atRiskCourses: string[];
  highAbsenceCourses: string[];
}

/**
 * The roster read.
 *
 * `forTool` exists for the Name Picker alone (Step 6j). The picker is entirely
 * client-side and has no endpoint of its own, so it declares itself on the read
 * it already makes rather than being given a request whose only purpose is to
 * report usage. Every other caller omits it and is not counted.
 */
export function listStudents(forTool?: 'picker'): Promise<Student[]> {
  return apiClient.get<Student[]>(forTool ? `/students?for=${forTool}` : '/students');
}

/** One entry per active student; feeds the roster's academic-risk / high-absence indicators. */
export function getRiskSummary(): Promise<RiskSummaryEntry[]> {
  return apiClient.get<RiskSummaryEntry[]>('/students/risk-summary');
}

/** Toggles the academic-risk flag for one of a student's courses. */
export function setAtRisk(
  studentId: string,
  course: string,
  atRisk: boolean,
): Promise<{ studentId: string; course: string; atRisk: boolean }> {
  return apiClient.put(`/students/${studentId}/at-risk`, { course, atRisk });
}

export function getStudent(id: string): Promise<Student> {
  return apiClient.get<Student>(`/students/${id}`);
}

export interface StudentDetail {
  student: Student;
}

/**
 * The detail view's read, in one request. It also carried the student's IEP
 * accommodations until Step 8a removed that surface; the response stays an
 * object with one field because that is the shape the API contract specifies.
 */
export function getStudentDetail(id: string): Promise<StudentDetail> {
  return apiClient.get<StudentDetail>(`/students/${id}/detail`);
}

/**
 * Creates many students in one request (one Sheets append per tab server-side)
 * instead of a create call per row. All-or-nothing: on failure nothing is
 * created and the caller keeps the rows for retry.
 */
export function createStudentsBatch(students: StudentInput[]): Promise<Student[]> {
  return apiClient.post<Student[]>('/students/batch', { students });
}

export function updateStudent(id: string, input: StudentUpdateInput): Promise<Student> {
  return apiClient.put<Student>(`/students/${id}`, input);
}

export function deleteStudent(id: string): Promise<void> {
  return apiClient.delete<void>(`/students/${id}`);
}
