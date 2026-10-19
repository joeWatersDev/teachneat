import type { AttendanceStatusKey } from './types';

export interface StatusMeta {
  key: AttendanceStatusKey;
  label: string;
  /** Single-letter tag shown on the compact entry buttons. */
  abbr: string;
}

// Fixed Phase 1 set, in display order (SHEETS_SCHEMA status keys).
export const STATUSES: readonly StatusMeta[] = [
  { key: 'p', label: 'Present', abbr: 'P' },
  { key: 'a', label: 'Absent', abbr: 'A' },
  { key: 't', label: 'Tardy', abbr: 'T' },
  { key: 'e', label: 'Excused', abbr: 'E' },
];

// The high-absence flag threshold lives in ./thresholds (`isHighAbsenceRisk`),
// shared by the statistics view, the email selection, and the risk indicators.
