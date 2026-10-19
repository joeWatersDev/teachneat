import type { Student } from '../students/types';

export interface PlaceholderDef {
  key: string;
  label: string;
}

/** The placeholder tokens the server resolves per recipient. Record fields plus
 * course and cross-course attendance totals. Offered in the editor and
 * previewed against real data. */
export const PLACEHOLDERS: readonly PlaceholderDef[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'goesBy', label: 'Goes by' },
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'courseName', label: 'Course name' },
  { key: 'lateCount', label: 'Number of lates' },
  { key: 'unexcusedAbsences', label: 'Number of unexcused absences' },
];

/** Per-student attendance totals summed across their courses. */
export interface AttendanceTotals {
  tardies: number;
  absences: number;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]{0,40})\s*\}\}/g;

/** Mirrors the server escape so the preview matches what recipients receive. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Default placeholder values for a (student, course) send, matching the
 * server. `courseName` is the send's course; attendance totals are for that
 * course and default to 0 when not yet loaded. */
export function studentPlaceholderValues(
  s: Student,
  course: string,
  totals?: AttendanceTotals,
): Record<string, string> {
  return {
    firstName: s.firstName ?? '',
    lastName: s.lastName ?? '',
    goesBy: s.goesBy ?? '',
    pronouns: s.pronouns ?? '',
    courseName: course,
    lateCount: String(totals?.tardies ?? 0),
    unexcusedAbsences: String(totals?.absences ?? 0),
  };
}

/** Renders `{{token}}` in an HTML body, escaping substituted values. */
export function renderBody(html: string, values: Record<string, string>): string {
  return html.replace(PLACEHOLDER_PATTERN, (_m, key: string) => {
    const raw = values[key];
    return raw === undefined ? '' : escapeHtml(raw);
  });
}

/** Renders `{{token}}` in a plain-text subject (no escaping; strips newlines). */
export function renderSubject(subject: string, values: Record<string, string>): string {
  return subject.replace(PLACEHOLDER_PATTERN, (_m, key: string) => {
    const raw = values[key];
    return raw === undefined ? '' : raw.replace(/[\r\n]+/g, ' ');
  });
}

/** Unique placeholder keys referenced across the subject and body. */
export function extractPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PLACEHOLDER_PATTERN)) {
      found.add(m[1]);
    }
  }
  return [...found];
}
