import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarCheck } from 'lucide-react';
import { useRoster } from '../students/useRoster';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { TabNav } from '../../components/ui/TabNav';
import { Select } from '../../components/ui/Select';
import { PremiumBadge, PremiumNotice } from '../../components/ui/Premium';
import { premiumSentence } from '../../components/ui/premiumCopy';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useSelectedClass } from '../../hooks/useSelectedClass';
import { useTabRoute } from '../../hooks/useTabRoute';
import { EntryView } from './EntryView';
import { HistoryView } from './HistoryView';
import { StatsView } from './StatsView';

/** URL slugs, so each view is its own address: `/attendance/history`. */
const TABS = ['daily', 'history', 'statistics'] as const;

/** The same sentence the gated view itself shows, so the two never diverge. */
const STATS_EXPLANATION = premiumSentence('Attendance statistics', true);
const STATS_DESCRIPTION_ID = 'attendance-stats-premium';

export function AttendancePage() {
  const { students, loading, error, reload } = useRoster();
  const { isPremium } = useEntitlements();
  const navigate = useNavigate();
  const route = useTabRoute('attendance', '/attendance', TABS, 'daily');
  const view = route.tab;

  const courses = useMemo(
    () =>
      Array.from(new Set((students ?? []).flatMap((s) => s.courses))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [students],
  );

  // Defaults to the first class alphabetically, and is remembered across
  // navigation per tool — see useSelectedClass.
  const [activeCourse, setCourse] = useSelectedClass('attendance', courses);

  const scoped = useMemo(() => {
    const list = students ?? [];
    if (activeCourse === null) return list;
    return list.filter((s) => s.courses.includes(activeCourse));
  }, [students, activeCourse]);

  // The bare `/attendance`, or an unknown slug, goes to the last tab used.
  if (route.redirectTo !== null) {
    return <Navigate to={route.redirectTo} replace />;
  }

  if (loading && students === null) {
    return <LoadingState label="Loading roster…" />;
  }

  if (error && students === null) {
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        }
      />
    );
  }

  const list = students ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        heading="No students to track"
        description="Attendance is taken against your roster. Add students on the Students page first."
      />
    );
  }

  const openStudent = (id: string) => navigate(`/students/${id}`);

  // "All classes" has no single course to record or scope stats to.
  const scopedCourse = activeCourse;

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Attendance">
        <label className="flex items-center gap-2 text-sm text-secondary">
          Class
          <Select
            value={activeCourse ?? ''}
            onChange={(e) => setCourse(e.target.value)}
            aria-label="Filter by class"
          >
            {courses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
      </PageHeader>

      {/* Daily entry and History are free: both are the record of what was
          taken. Only the computed statistics are premium. */}
      <TabNav
        label="Attendance views"
        items={[
          { to: '/attendance/daily', label: 'Daily Entry' },
          { to: '/attendance/history', label: 'History' },
          {
            to: '/attendance/statistics',
            label: 'Statistics',
            disabled: !isPremium,
            suffix: <PremiumBadge />,
            describedBy: isPremium ? undefined : STATS_DESCRIPTION_ID,
            // The same hover explanation every other gated control carries; a
            // disabled tab is no less in need of saying why.
            tooltip: isPremium ? undefined : STATS_EXPLANATION,
            // The last of three tabs, most of the way across a phone's content
            // column: a centred 224px bubble can end past the right edge of a
            // 375px screen and widen the document, which is the Step 3a defect.
            // Grown leftward instead.
            tooltipAlign: 'end',
          },
        ]}
      />
      {!isPremium && (
        <span id={STATS_DESCRIPTION_ID} className="sr-only">
          {STATS_EXPLANATION}
        </span>
      )}

      {view === 'daily' ? (
        <EntryView students={scoped} course={scopedCourse} onSelectStudent={openStudent} />
      ) : view === 'history' ? (
        <HistoryView students={scoped} course={scopedCourse} onSelectStudent={openStudent} />
      ) : isPremium ? (
        <StatsView students={list} course={scopedCourse} onSelectStudent={openStudent} />
      ) : (
        // Reachable by address, or when the plan changes while Statistics is
        // open; the tab itself is disabled on `free`.
        <PremiumNotice feature="Attendance statistics" plural />
      )}
    </section>
  );
}
