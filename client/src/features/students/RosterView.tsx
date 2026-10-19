import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, AlertTriangle, CalendarX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { rosterControls, type SortKey, type AlertFilter } from './rosterControls';
import { describeHighAbsence, highAbsenceLabel } from '../attendance/thresholds';
import { useEntitlements } from '../../hooks/useEntitlements';
import type { RiskFlags } from './rosterCache';
import type { Student } from './types';

interface RosterViewProps {
  students: Student[];
  riskByStudent: Record<string, RiskFlags>;
  /** The class chosen in the page header, or `'all'`. */
  courseFilter: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

function displayName(s: Student): string {
  const base = `${s.firstName} ${s.lastName}`;
  return s.goesBy ? `${base} (${s.goesBy})` : base;
}

export function RosterView({ students, riskByStudent, courseFilter, onSelect, onAdd }: RosterViewProps) {
  const { highAbsence } = useEntitlements();
  const [alertFilter, setAlertFilter] = useState<AlertFilter>(rosterControls.alertFilter);
  const [sortKey, setSortKey] = useState<SortKey>(rosterControls.sortKey);

  // Mirror the current selections back to module scope so a remount restores them.
  useEffect(() => {
    rosterControls.alertFilter = alertFilter;
    rosterControls.sortKey = sortKey;
  }, [alertFilter, sortKey]);

  // Sorting by class is meaningless within a single class, so choosing one in
  // the header drops that sort. Adjusted during render, since the class filter
  // is now set outside this component.
  if (courseFilter !== 'all' && sortKey === 'course') {
    setSortKey('lastName');
  }

  const visible = useMemo(() => {
    const filtered = students.filter((s) => {
      if (courseFilter !== 'all' && !s.courses.includes(courseFilter)) return false;

      // The flags are per class, and the class filter scopes them: with a class
      // chosen, a student counts only if the flag is set in that class, which is
      // the question a teacher looking at one class is asking. On "All", a flag
      // anywhere qualifies.
      if (alertFilter !== 'all') {
        const risk = riskByStudent[s.id];
        const flagged =
          alertFilter === 'atRisk' ? (risk?.atRiskCourses ?? []) : (risk?.highAbsenceCourses ?? []);
        if (courseFilter === 'all' ? flagged.length === 0 : !flagged.includes(courseFilter)) {
          return false;
        }
      }
      return true;
    });
    // Sort by the student's first course (alphabetically) when sorting by course.
    const firstCourse = (s: Student) => [...s.courses].sort((a, b) => a.localeCompare(b))[0] ?? '';
    return filtered.sort((a, b) => {
      if (sortKey === 'firstName') return a.firstName.localeCompare(b.firstName);
      if (sortKey === 'course')
        return firstCourse(a).localeCompare(firstCourse(b)) || a.lastName.localeCompare(b.lastName);
      return a.lastName.localeCompare(b.lastName);
    });
  }, [students, riskByStudent, courseFilter, alertFilter, sortKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-secondary">
          Sort
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort students"
          >
            <option value="lastName">Last name</option>
            <option value="firstName">First name</option>
            {courseFilter === 'all' && <option value="course">Class</option>}
          </Select>
        </label>
        {/* The two warning indicators the roster already draws, made
            selectable. On a class that does not fit a screen, scrolling for a
            triangle is not a substitute for asking. Not premium-gated, because
            the indicators themselves are not: a free account sees both flags on
            the rows, and gating the way to find them would be gating the same
            information twice over. */}
        <label className="flex items-center gap-1 text-sm text-secondary">
          Alerts
          <Select
            value={alertFilter}
            onChange={(e) => setAlertFilter(e.target.value as AlertFilter)}
            aria-label="Filter by alert"
          >
            <option value="all">All</option>
            <option value="atRisk">Academic risk</option>
            <option value="highAbsence">High absences</option>
          </Select>
        </label>
        <Button variant="primary" onClick={onAdd} className="ml-auto">
          <Plus size={16} strokeWidth={2} />
          Add Students
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-secondary">
          No students match the current filters.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-subtle">
          {visible.map((s) => {
            const risk = riskByStudent[s.id];
            const atRiskCourses = risk?.atRiskCourses ?? [];
            const highAbsenceCourses = risk?.highAbsenceCourses ?? [];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className="grid min-h-12 w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 border-b border-subtle bg-surface px-4 py-2.5 text-left last:border-b-0 hover:bg-hover sm:grid-cols-[32px_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_56px] sm:gap-4 sm:py-2"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-hover text-secondary">
                    <Users size={16} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  {/* Below sm the row is a stacked card: the wrapper holds the fields
                      in a column. At sm+ `contents` dissolves it so each field becomes
                      a direct grid cell of the columnar row. */}
                  <span className="flex min-w-0 flex-col gap-0.5 sm:contents">
                    <span className="truncate text-base text-primary">{displayName(s)}</span>
                    <span className="truncate text-sm text-secondary">{s.courses.join(', ')}</span>
                    <span className="hidden truncate text-sm text-secondary sm:block">
                      {s.studentEmail ?? ''}
                    </span>
                    {/* Below sm this is a stacked card, so an empty cell is hidden to
                        avoid a blank line. At sm+ it keeps occupying its grid column
                        even when empty, so the indicators stay in one place down the
                        list rather than sliding to wherever the row before ended. */}
                    <span className="flex items-center justify-start gap-1.5 empty:hidden sm:justify-center sm:empty:flex">
                      {atRiskCourses.length > 0 && (
                        <span
                          title={`At academic risk: ${atRiskCourses.join(', ')}`}
                          className="flex text-danger"
                        >
                          <AlertTriangle
                            size={16}
                            strokeWidth={2}
                            aria-label={`At academic risk: ${atRiskCourses.join(', ')}`}
                          />
                        </span>
                      )}
                      {highAbsenceCourses.length > 0 && (
                        // The rule behind the warning is named, not just the
                        // classes it applies to: a teacher cannot judge a flag
                        // whose threshold they cannot see.
                        <span
                          title={`${highAbsenceLabel(highAbsence)}: ${highAbsenceCourses.join(', ')}. ${describeHighAbsence(highAbsence)}`}
                          className="flex text-warning"
                        >
                          <CalendarX
                            size={16}
                            strokeWidth={2}
                            aria-label={`${highAbsenceLabel(highAbsence)}: ${highAbsenceCourses.join(', ')}`}
                          />
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
