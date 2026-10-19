export type SortKey = 'lastName' | 'firstName' | 'course';

/**
 * The alerts filter. The two flags already drawn on the roster as warning
 * indicators are selectable, which is what makes them usable on a class larger
 * than a screen: spotting a triangle by scrolling is not the same as asking for
 * the students who have one.
 *
 * Deliberately single-select and not a "has any alert" option. The two flags
 * mean different things and prompt different work, so an option merging them
 * would produce a list a teacher then has to sort by eye.
 */
export type AlertFilter = 'all' | 'atRisk' | 'highAbsence';

/**
 * The roster's filter and sort selections, held at module scope so they persist
 * while the app is open (navigating to a student, another tool, and back keeps
 * the view). Not stored to disk — a fresh app session starts at the defaults.
 * Lives in its own module (not RosterView.tsx) so the component file exports
 * only components, keeping fast-refresh happy.
 */
export const rosterControls = {
  courseFilter: 'all',
  alertFilter: 'all' as AlertFilter,
  sortKey: 'lastName' as SortKey,
};

/** Test hook: restore the roster controls to their defaults between runs. */
export function resetRosterControls(): void {
  rosterControls.courseFilter = 'all';
  rosterControls.alertFilter = 'all';
  rosterControls.sortKey = 'lastName';
}
