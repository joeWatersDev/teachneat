import { apiClient } from './client';
import type {
  AttendanceRecord,
  AttendanceStats,
  AttendanceStatusKey,
} from '../features/attendance/types';

export interface AttendanceEntryInput {
  studentId: string;
  statusKey: AttendanceStatusKey;
  notes?: string | null;
}

export function listAttendance(date: string, course?: string): Promise<AttendanceRecord[]> {
  let qs = `date=${encodeURIComponent(date)}`;
  if (course !== undefined) qs += `&course=${encodeURIComponent(course)}`;
  return apiClient.get<AttendanceRecord[]>(`/attendance?${qs}`);
}

export function listAttendanceRange(
  startDate: string,
  endDate: string,
  course?: string,
): Promise<AttendanceRecord[]> {
  let qs = `startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  if (course !== undefined) qs += `&course=${encodeURIComponent(course)}`;
  return apiClient.get<AttendanceRecord[]>(`/attendance/range?${qs}`);
}

export function submitAttendance(
  date: string,
  course: string,
  entries: AttendanceEntryInput[],
): Promise<{ written: number }> {
  return apiClient.post<{ written: number }>('/attendance', { date, course, entries });
}

export function updateAttendance(
  id: string,
  patch: { statusKey?: AttendanceStatusKey; notes?: string | null },
): Promise<AttendanceRecord> {
  return apiClient.put<AttendanceRecord>(`/attendance/${id}`, patch);
}

/** Omit the range for all recorded data; pass both bounds to scope it. Optional course scopes to one class. */
export function getAttendanceStats(
  startDate?: string,
  endDate?: string,
  course?: string,
): Promise<AttendanceStats[]> {
  const params: string[] = [];
  if (startDate !== undefined && endDate !== undefined) {
    params.push(`startDate=${encodeURIComponent(startDate)}`);
    params.push(`endDate=${encodeURIComponent(endDate)}`);
  }
  if (course !== undefined) params.push(`course=${encodeURIComponent(course)}`);
  const qs = params.length > 0 ? `?${params.join('&')}` : '';
  return apiClient.get<AttendanceStats[]>(`/attendance/stats${qs}`);
}
