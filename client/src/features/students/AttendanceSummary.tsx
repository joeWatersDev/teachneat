import { useEffect, useState, type ReactNode } from 'react';
import { CalendarX } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { getAttendanceStats } from '../../api/attendance';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  premiumSentence,
} from '../../components/ui/premiumCopy';
import { isHighAbsenceRisk, describeHighAbsence } from '../attendance/thresholds';
import { useEntitlements } from '../../hooks/useEntitlements';
import type { AttendanceStats } from '../attendance/types';

interface Aggregate {
  totalAbsences: number;
  totalTardies: number;
  totalExcused: number;
  daysRecorded: number;
  absenceRate: number;
  consecutiveAbsences: number;
}

/**
 * Sums a student's per-course stats rows into one all-time summary. Days and
 * counts add across enrollments; the "current streak" is the worst (largest)
 * across the student's classes, since a streak is defined per class.
 */
function aggregate(rows: AttendanceStats[]): Aggregate {
  const agg = rows.reduce(
    (acc, s) => ({
      totalAbsences: acc.totalAbsences + s.totalAbsences,
      totalTardies: acc.totalTardies + s.totalTardies,
      totalExcused: acc.totalExcused + s.totalExcused,
      daysRecorded: acc.daysRecorded + s.daysRecorded,
      consecutiveAbsences: Math.max(acc.consecutiveAbsences, s.consecutiveAbsences),
    }),
    { totalAbsences: 0, totalTardies: 0, totalExcused: 0, daysRecorded: 0, consecutiveAbsences: 0 },
  );
  return {
    ...agg,
    absenceRate: agg.daysRecorded === 0 ? 0 : agg.totalAbsences / agg.daysRecorded,
  };
}

/** The tiles this summary shows, in order — also the shape of the locked preview. */
const STAT_LABELS = [
  'Days recorded',
  'Absences',
  'Tardies',
  'Excused',
  'Absence rate',
  'Current streak',
];

/**
 * Compact all-time attendance summary for one student. When `course` is given,
 * the summary is scoped to that class; otherwise it aggregates across the
 * student's enrollments. Reads the shared stats endpoint and filters client-side,
 * per the API contract.
 *
 * `locked` is the `free` presentation: the same tiles, blurred and without
 * values, so the shape of what Premium adds is visible while the figures
 * are not. It also skips the fetch — the endpoint is gated, so there is nothing
 * to ask for.
 */
export function AttendanceSummary({
  studentId,
  course,
  locked = false,
}: {
  studentId: string;
  course?: string;
  locked?: boolean;
}) {
  const { highAbsence: threshold } = useEntitlements();
  const [stats, setStats] = useState<Aggregate | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<{ studentId: string; course?: string } | null>(null);

  // Reset to the loading state when the target (student or class) changes, during
  // render rather than in the fetch effect (no synchronous setState in an effect).
  if (loaded?.studentId !== studentId || loaded?.course !== course) {
    setLoaded({ studentId, course });
    setStats(null);
    setFailed(false);
  }

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    getAttendanceStats(undefined, undefined, course)
      .then((all) => {
        if (cancelled) return;
        // The stats endpoint lists one row per (student, course); a student with
        // no rows simply has no records, yielding a zeroed summary.
        setStats(aggregate(all.filter((s) => s.studentId === studentId)));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, course, locked]);

  if (locked) {
    return (
      <div className="relative">
        {/* Placeholder tiles, never invented numbers: the labels say what the
            paid plan computes, and the dashes say it is not computed here. */}
        <div aria-hidden="true" className="pointer-events-none select-none blur-[3px] opacity-50">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STAT_LABELS.map((label) => (
              <Stat key={label} label={label} value="—" />
            ))}
          </dl>
        </div>
        <div className="absolute inset-0 flex items-center justify-center p-2">
          {/* One sentence for every un-premium account, whatever the billing
              state behind it. The overlay used to vary with why premium was
              absent — trial ended, subscription ended, collection paused — which
              put the account's payment history into a panel about a student's
              attendance. A locked control only has to say what unlocks it. */}
          <p className="max-w-xs text-center text-sm text-secondary">
            {premiumSentence('Attendance statistics', true)}
          </p>
        </div>
      </div>
    );
  }

  if (failed) {
    return <p className="text-base text-disabled">Attendance data is unavailable right now.</p>;
  }
  if (stats === null) {
    // Skeleton mirrors the six-tile stats grid below (label line + value line).
    return (
      <div role="status" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <span className="sr-only">Loading attendance…</span>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-5 w-10" />
          </div>
        ))}
      </div>
    );
  }
  if (stats.daysRecorded === 0) {
    return <p className="text-base text-disabled">No attendance recorded yet.</p>;
  }

  const highAbsence = isHighAbsenceRisk(stats.daysRecorded, stats.absenceRate, threshold);

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label="Days recorded" value={String(stats.daysRecorded)} />
      <Stat label="Absences" value={String(stats.totalAbsences)} />
      <Stat label="Tardies" value={String(stats.totalTardies)} />
      <Stat label="Excused" value={String(stats.totalExcused)} />
      <Stat
        label="Absence rate"
        value={`${Math.round(stats.absenceRate * 100)}%`}
        badge={
          highAbsence ? (
            // The rule is stated, not left implicit: a teacher cannot judge a
            // warning whose threshold they cannot see.
            <Tooltip label={describeHighAbsence(threshold)}>
              <span className="flex items-center gap-1 text-sm text-warning">
                <CalendarX size={14} strokeWidth={2} aria-hidden="true" />
                High Absences
              </span>
            </Tooltip>
          ) : undefined
        }
      />
      <Stat label="Current streak" value={String(stats.consecutiveAbsences)} />
    </dl>
  );
}

function Stat({ label, value, badge }: { label: string; value: string; badge?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="text-base text-primary">{value}</span>
        {badge}
      </dd>
    </div>
  );
}
