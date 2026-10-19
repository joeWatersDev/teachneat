import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { isApiError } from '../../api/client';
import { listAttendance, submitAttendance } from '../../api/attendance';
import { STATUSES } from './statuses';
import { isWeekend, todayIso } from './dates';
import type { AttendanceStatusKey } from './types';
import type { Student } from '../students/types';

interface EntryViewProps {
  students: Student[];
  /** The class being recorded. Null when "All classes" is selected — entry is per-class only. */
  course: string | null;
  onSelectStudent: (studentId: string) => void;
}

interface RowState {
  statusKey: AttendanceStatusKey;
  notes: string;
}

const DATE_INPUT_CLASS =
  'h-9 rounded-md border border-subtle bg-base px-2 text-base text-primary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

function displayName(s: Student): string {
  const base = `${s.firstName} ${s.lastName}`;
  return s.goesBy ? `${base} (${s.goesBy})` : base;
}

/**
 * Daily attendance entry. Every roster student defaults to Present; selecting a
 * date that already has records loads them for review or correction. Saving
 * submits one entry per listed student and overwrites that date's records.
 *
 * Weekends are non-instructional: on a Saturday or Sunday every row is shown as
 * a read-only "Excused" and saving is disabled.
 */
export function EntryView({ students, course, onSelectStudent }: EntryViewProps) {
  const [date, setDate] = useState(todayIso);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekend = isWeekend(date);

  useEffect(() => {
    setMessage(null);
    setError(null);

    if (course === null) {
      setLoading(false);
      return;
    }

    if (isWeekend(date)) {
      // No fetch, no entry: every student is a read-only Excused row.
      const next: Record<string, RowState> = {};
      for (const s of students) next[s.id] = { statusKey: 'e', notes: '' };
      setRows(next);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    listAttendance(date, course)
      .then((records) => {
        if (cancelled) return;
        const byStudent = new Map(records.map((r) => [r.studentId, r]));
        const next: Record<string, RowState> = {};
        for (const s of students) {
          const rec = byStudent.get(s.id);
          next[s.id] = { statusKey: rec?.statusKey ?? 'p', notes: rec?.notes ?? '' };
        }
        setRows(next);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(isApiError(e) ? e.message : 'Could not load attendance for this date.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, students, course]);

  function setStatus(studentId: string, statusKey: AttendanceStatusKey) {
    setRows((r) => ({ ...r, [studentId]: { ...r[studentId], statusKey } }));
    setMessage(null);
  }

  function setNotes(studentId: string, notes: string) {
    setRows((r) => ({ ...r, [studentId]: { ...r[studentId], notes } }));
    setMessage(null);
  }

  function markAllPresent() {
    setRows((r) => {
      const next: Record<string, RowState> = {};
      for (const [id, row] of Object.entries(r)) next[id] = { ...row, statusKey: 'p' };
      return next;
    });
    setMessage(null);
  }

  async function handleSave() {
    if (course === null) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const entries = students.map((s) => {
        const row = rows[s.id];
        const notes = row.notes.trim();
        return {
          studentId: s.id,
          statusKey: row.statusKey,
          notes: notes === '' ? null : notes,
        };
      });
      const { written } = await submitAttendance(date, course, entries);
      setMessage(`Saved attendance for ${written} student${written === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save attendance. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (course === null) {
    return (
      <p className="py-12 text-center text-sm text-secondary">
        Select a single class above to take attendance. Attendance is recorded per class.
      </p>
    );
  }

  const sorted = [...students].sort((a, b) => a.lastName.localeCompare(b.lastName));
  const ready = !loading && students.every((s) => rows[s.id] !== undefined);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-secondary">
          Date
          <input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={DATE_INPUT_CLASS}
            aria-label="Attendance date"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={markAllPresent} disabled={!ready || saving || weekend}>
            Mark All Present
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={!ready || weekend}
          >
            Save Attendance
          </Button>
        </div>
      </div>

      {weekend && (
        <p role="status" className="rounded-md bg-elevated px-3 py-2 text-sm text-secondary">
          Weekends are not school days. Attendance is not recorded on Saturdays and Sundays.
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md bg-elevated px-3 py-2 text-sm text-primary">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingState label="Loading attendance…" />
      ) : (
        <ul className={'overflow-hidden rounded-lg border border-subtle' + (weekend ? ' opacity-60' : '')}>
          {sorted.map((s) => {
            const row = rows[s.id];
            if (!row) return null;
            return (
              <li
                key={s.id}
                className="grid min-h-12 grid-cols-1 items-center gap-2 border-b border-subtle bg-surface px-4 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] sm:gap-4"
              >
                <span className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectStudent(s.id)}
                    className="block truncate text-left text-base text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {displayName(s)}
                  </button>
                  <span className="block truncate text-sm text-secondary">{course}</span>
                </span>
                <div role="group" aria-label={`Status for ${s.firstName} ${s.lastName}`} className="flex gap-1">
                  {STATUSES.map((st) => {
                    const selected = row.statusKey === st.key;
                    return (
                      <button
                        key={st.key}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${st.label}: ${s.firstName} ${s.lastName}`}
                        title={st.label}
                        disabled={weekend}
                        onClick={() => setStatus(s.id, st.key)}
                        className={
                          'grid h-8 w-8 place-items-center rounded-md text-sm font-semibold ' +
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
                          'disabled:cursor-not-allowed ' +
                          (selected
                            ? 'bg-accent text-on-accent'
                            : 'border border-subtle bg-elevated text-secondary hover:bg-hover')
                        }
                      >
                        {st.abbr}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={row.notes}
                  maxLength={500}
                  placeholder="Note (optional)"
                  aria-label={`Note for ${s.firstName} ${s.lastName}`}
                  disabled={weekend}
                  onChange={(e) => setNotes(s.id, e.target.value)}
                  className="h-8 w-full rounded-md border border-subtle bg-base px-2 text-sm text-primary placeholder:text-secondary focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed"
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
