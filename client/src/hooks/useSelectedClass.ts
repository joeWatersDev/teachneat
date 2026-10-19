import { useCallback, useState } from 'react';

/**
 * The class each tool is currently scoped to, remembered while the app is open.
 *
 * Attendance, Grouping and the Name Picker all reset to the first class
 * alphabetically on every remount, which means every trip through another tool
 * silently put a teacher back in a class they were not teaching. The roster
 * already solved this for its own filters (see `rosterControls`); this is the
 * same treatment for the tools that scope to exactly one class.
 *
 * **Kept per tool rather than shared between them.** One selection across all
 * three would mean changing the class in the Name Picker also changes which
 * class attendance is about to be recorded for, and attendance is the one place
 * where being in the wrong class writes wrong data.
 *
 * Module scope, not localStorage, matching the roster: it survives navigation,
 * and a fresh app session starts at the default. Persisting to disk would need
 * an answer for a stored class that no longer exists a term later, and the
 * within-session case is the one that was actually annoying.
 *
 * The Email tool is deliberately not included — it selects recipients across
 * classes rather than scoping to one.
 */
export type ClassScope = 'attendance' | 'grouping' | 'namePicker';

const selection: Record<ClassScope, string | null> = {
  attendance: null,
  grouping: null,
  namePicker: null,
};

/**
 * Carries each tool's remembered class across a rename. Without it the tools
 * would find their class missing and fall back to the first alphabetically,
 * which for attendance is the wrong class to record into.
 */
export function renameRememberedClass(from: string, to: string): void {
  for (const scope of Object.keys(selection) as ClassScope[]) {
    if (selection[scope] === from) selection[scope] = to;
  }
}

/** Test hook: forget every remembered class selection between runs. */
export function resetSelectedClasses(): void {
  selection.attendance = null;
  selection.grouping = null;
  selection.namePicker = null;
}

/**
 * Returns the class the given tool is scoped to and a setter for it.
 *
 * `courses` decides what is selectable, and a remembered class that is not in it
 * falls back to the first alphabetically — the class was archived, or its last
 * student was removed. The fallback is **not** written back: `courses` is empty
 * while the roster loads, and treating that as "your class is gone" would
 * discard the selection on every single remount, which is the bug this exists to
 * fix.
 */
export function useSelectedClass(
  scope: ClassScope,
  courses: string[],
): [string | null, (course: string | null) => void] {
  const [, bump] = useState(0);
  const remembered = selection[scope];
  const active = remembered !== null && courses.includes(remembered) ? remembered : (courses[0] ?? null);

  const select = useCallback(
    (course: string | null) => {
      selection[scope] = course;
      bump((n) => n + 1);
    },
    [scope],
  );

  return [active, select];
}
