import type { Student } from '../students/types';
import type { PickerStudent } from './picker';

/**
 * Full display name for the picker: the preferred name (or first name) plus the
 * last name. Unlike Grouping — which abbreviates to a last initial to fit small
 * group cards — the picker reveals one name at a time on a large surface, so the
 * whole name reads well when projected.
 */
export function pickerDisplayName(s: Student): string {
  const first = s.goesBy?.trim() || s.firstName;
  return s.lastName ? `${first} ${s.lastName}` : first;
}

export function toPickerStudents(students: Student[]): PickerStudent[] {
  return students.map((s) => ({ id: s.id, name: pickerDisplayName(s) }));
}
