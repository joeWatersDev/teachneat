import type { Student } from '../students/types';

/** Projection-friendly label: preferred/first name plus a last initial to disambiguate. */
export function displayName(s: Student): string {
  const first = s.goesBy?.trim() || s.firstName;
  const lastInitial = s.lastName ? ` ${s.lastName[0]}.` : '';
  return `${first}${lastInitial}`;
}

/** Resolves a studentId to a display name; students no longer on the roster read as "(removed)". */
export function buildNameLookup(students: Student[]): (id: string) => string {
  const map = new Map(students.map((s) => [s.id, displayName(s)]));
  return (id: string) => map.get(id) ?? '(removed)';
}
