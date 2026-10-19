import { useEffect, useState } from 'react';
import { CalendarX } from 'lucide-react';
import { LoadingState } from '../../components/ui/LoadingState';
import { isApiError } from '../../api/client';
import { getAttendanceStats } from '../../api/attendance';
import { isHighAbsenceRisk, describeHighAbsence, highAbsenceLabel } from './thresholds';
import { HighAbsenceSetting } from './HighAbsenceSetting';
import { useEntitlements } from '../../hooks/useEntitlements';
import type { HighAbsenceThreshold } from '../../api/settings';
import type { AttendanceStats } from './types';
import type { Student } from '../students/types';

interface StatsViewProps {
  /** Full roster, used to resolve student names for the returned stats rows. */
  students: Student[];
  /** The course to scope to, or null for all classes (one row per enrollment). */
  course: string | null;
  onSelectStudent: (studentId: string) => void;
}

const DATE_INPUT_CLASS =
  'h-9 rounded-md border border-subtle bg-base px-2 text-base text-primary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

// The pinned Student column: narrower on mobile, roomier at sm+ (where the flag
// keeps its text label). `table-fixed` makes these widths authoritative, which
// also keeps the sticky header and body cells aligned.
const NAME_COL_W = 'w-[150px] sm:w-[210px]';
// Non-pinned header cells: sticky to the top only, on the elevated header fill.
const HEADER_CELL =
  'sticky top-0 z-20 border-b border-subtle bg-elevated px-4 py-2 text-sm font-medium text-secondary';
const BODY_CELL = 'border-b border-subtle px-4 py-2 text-base text-primary';

function isFlagged(s: AttendanceStats, threshold: HighAbsenceThreshold): boolean {
  return isHighAbsenceRisk(s.daysRecorded, s.absenceRate, threshold);
}

function ratePercent(s: AttendanceStats): string {
  if (s.daysRecorded === 0) return '—';
  return `${Math.round(s.absenceRate * 100)}%`;
}

/**
 * Per-student aggregates. With no range set, covers all recorded data; both
 * bounds together scope the view. Students past the account's effective
 * high-absence threshold are flagged, and the threshold itself is stated in the
 * toolbar rather than left as an unexplained icon.
 */
export function StatsView({ students, course, onSelectStudent }: StatsViewProps) {
  const { highAbsence: threshold } = useEntitlements();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState<AttendanceStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeComplete = startDate !== '' && endDate !== '';
  const rangeValid = rangeComplete && startDate <= endDate;
  const rangeEmpty = startDate === '' && endDate === '';

  useEffect(() => {
    if (!rangeEmpty && !rangeValid) return; // wait for a complete, ordered range
    let cancelled = false;
    const scope = course ?? undefined;
    const request = rangeValid
      ? getAttendanceStats(startDate, endDate, scope)
      : getAttendanceStats(undefined, undefined, scope);
    request
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(isApiError(e) ? e.message : 'Could not load attendance statistics.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, rangeEmpty, rangeValid, course]);

  const nameById = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  const showCourse = course === null;
  // One row per (student, course) enrollment, sorted by student then course.
  const rows = [...(stats ?? [])].sort((a, b) => {
    const an = nameById.get(a.studentId) ?? '';
    const bn = nameById.get(b.studentId) ?? '';
    return an.localeCompare(bn) || a.course.localeCompare(b.course);
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-secondary">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={DATE_INPUT_CLASS}
            aria-label="Statistics start date"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-secondary">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={DATE_INPUT_CLASS}
            aria-label="Statistics end date"
          />
        </label>
        {!rangeEmpty && (
          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
            className="text-sm text-secondary underline"
          >
            Clear range
          </button>
        )}
        <span className="text-sm text-secondary">
          {rangeEmpty
            ? 'Showing all recorded data.'
            : rangeValid
              ? `Showing ${startDate} to ${endDate}.`
              : 'Select both dates, start before end.'}
        </span>

        <HighAbsenceSetting />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {stats === null && !error ? (
        <LoadingState label="Loading statistics…" />
      ) : stats !== null ? (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-subtle">
          {/* border-separate (not collapse) so the sticky header/first-column cells
              keep their borders while scrolling. The Student column and header row are
              pinned; the name column is fixed-width and truncates on overflow. */}
          <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`sticky left-0 top-0 z-[25] border-b border-subtle bg-elevated px-4 py-2 text-sm font-medium text-secondary ${NAME_COL_W}`}
                >
                  Student
                </th>
                {showCourse && <th scope="col" className={HEADER_CELL}>Class</th>}
                <th scope="col" className={HEADER_CELL}>Days</th>
                <th scope="col" className={HEADER_CELL}>Absent</th>
                <th scope="col" className={HEADER_CELL}>Tardy</th>
                <th scope="col" className={HEADER_CELL}>Excused</th>
                <th scope="col" className={HEADER_CELL}>Absence rate</th>
                <th scope="col" className={HEADER_CELL}>Current streak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const flagged = isFlagged(s, threshold);
                return (
                  <tr key={`${s.studentId} ${s.course}`}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 border-b border-subtle bg-surface px-4 py-2 font-normal ${NAME_COL_W}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectStudent(s.studentId)}
                          title={nameById.get(s.studentId) ?? 'Unknown student'}
                          className="min-w-0 flex-1 truncate text-left text-base text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          {nameById.get(s.studentId) ?? 'Unknown student'}
                        </button>
                        {flagged && (
                          <span
                            className="flex shrink-0 items-center gap-1 text-warning"
                            title={describeHighAbsence(threshold)}
                          >
                            <CalendarX
                              size={14}
                              strokeWidth={2}
                              aria-label={highAbsenceLabel(threshold)}
                            />
                            <span className="hidden text-xs font-medium sm:inline">High absences</span>
                          </span>
                        )}
                      </span>
                    </th>
                    {showCourse && <td className={`${BODY_CELL} text-secondary`}>{s.course}</td>}
                    <td className={BODY_CELL}>{s.daysRecorded}</td>
                    <td className={BODY_CELL}>{s.totalAbsences}</td>
                    <td className={BODY_CELL}>{s.totalTardies}</td>
                    <td className={BODY_CELL}>{s.totalExcused}</td>
                    <td className={BODY_CELL}>{ratePercent(s)}</td>
                    <td className={BODY_CELL}>{s.consecutiveAbsences}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
