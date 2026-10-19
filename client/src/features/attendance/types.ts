export type AttendanceStatusKey = 'p' | 'a' | 't' | 'e';

export interface AttendanceRecord {
  id: string;
  studentId: string;
  course: string;
  date: string; // YYYY-MM-DD
  statusKey: AttendanceStatusKey;
  notes: string | null;
}

export interface AttendanceStats {
  studentId: string;
  course: string;
  totalAbsences: number;
  totalTardies: number;
  totalExcused: number;
  daysRecorded: number;
  absenceRate: number; // 0..1
  consecutiveAbsences: number;
}
