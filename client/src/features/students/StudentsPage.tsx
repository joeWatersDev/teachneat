import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Users, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { TabNav } from '../../components/ui/TabNav';
import { useTabRoute } from '../../hooks/useTabRoute';
import { useRoster } from './useRoster';
import { RosterView } from './RosterView';
import { StudentDetail } from './StudentDetail';
import { BulkAddStudents } from './BulkAddStudents';
import { rosterControls } from './rosterControls';
import { ClassesView } from '../classes/ClassesView';

/** URL slugs: `/students/roster` and `/students/classes`. */
const TABS = ['roster', 'classes'] as const;

export function StudentsPage() {
  const { students, riskByStudent, loading, error, reload, patchAtRisk } = useRoster();
  const navigate = useNavigate();
  // A student's detail view is deep-linkable (e.g. from the Attendance tool) at
  // `/students/:studentId`. The two tabs are static routes beside it.
  const { studentId: selectedId = null } = useParams();
  const route = useTabRoute('students', '/students', TABS, 'roster');

  /**
   * `?add=bulk` opens the add grid on arrival, so the first-run guide can send a
   * teacher into the actual form rather than to a page where they then have to
   * find it. There is one add flow; the grid serves a single student as well as
   * a class list.
   *
   * Read once, in the state initializer, because it is an instruction for this
   * navigation rather than state of its own — which also means no effect has to
   * synchronise it into local state, and the form is open on the very first
   * render instead of flashing the roster first. The parameter is then dropped
   * from the URL, since left there it would reopen the form on every reload and
   * every back navigation.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const addParam = searchParams.get('add');
  const [adding, setAdding] = useState(() => addParam === 'bulk');
  const redirecting = selectedId === null && route.redirectTo !== null;

  useEffect(() => {
    // Not while redirecting: the redirect carries the parameter to the tab's
    // address, and clearing it here would navigate back over that redirect.
    if (addParam !== null && !redirecting) setSearchParams({}, { replace: true });
  }, [addParam, redirecting, setSearchParams]);

  const list = useMemo(() => students ?? [], [students]);
  const courses = useMemo(
    () => Array.from(new Set(list.flatMap((s) => s.courses))).sort((a, b) => a.localeCompare(b)),
    [list],
  );

  // The class filter lives here rather than in RosterView because its control
  // sits in the page header, above the tabs. Mirrored to module scope so a
  // remount restores it.
  const [courseFilter, setCourseFilter] = useState(rosterControls.courseFilter);
  useEffect(() => {
    rosterControls.courseFilter = courseFilter;
  }, [courseFilter]);
  // A remembered class that no longer exists (its last student was removed)
  // falls back to "All" rather than showing an empty, confusing list. Adjusted
  // during render, React's adjust-state-from-props pattern, and only once the
  // roster has loaded, since an empty list while loading is not "your class is
  // gone". Not while a reload is in flight either: a rename on Manage Classes
  // moves the filter to the new name before the roster carrying it arrives, and
  // checking it against the old roster would drop it to "All".
  if (
    students !== null &&
    !loading &&
    courseFilter !== 'all' &&
    !courses.includes(courseFilter)
  ) {
    setCourseFilter('all');
  }

  if (selectedId) {
    return (
      <StudentDetail
        studentId={selectedId}
        onBack={() => navigate('/students/roster')}
        onChanged={() => void reload()}
        onAtRiskChanged={(courses) => patchAtRisk(selectedId, courses)}
      />
    );
  }

  // The bare `/students`, or an unknown tab, goes to the last tab used.
  if (route.redirectTo !== null) {
    return <Navigate to={route.redirectTo} replace />;
  }

  if (adding) {
    return <BulkAddStudents onBack={() => setAdding(false)} onAdded={() => void reload()} />;
  }

  const onRoster = route.tab === 'roster';

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Students">
        {/* Scopes the roster only. Manage Classes lists every class, so a
            selector there would have nothing to act on. */}
        {onRoster && list.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-secondary">
            Class
            <Select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter by class"
            >
              <option value="all">All</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
        )}
      </PageHeader>

      {/* Manage Classes stays reachable from an empty roster, which is what
          archiving every class at the end of a term leaves behind. */}
      <TabNav
        label="Students views"
        items={[
          { to: '/students/roster', label: 'Roster' },
          { to: '/students/classes', label: 'Manage Classes' },
        ]}
      />

      {!onRoster ? (
        <ClassesView
          onChanged={() => void reload()}
          onRenamed={(from, to) => setCourseFilter((f) => (f === from ? to : f))}
        />
      ) : loading && students === null ? (
        <LoadingState label="Loading roster…" />
      ) : error && students === null ? (
        <ErrorState
          message={error}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Users}
          heading="No students yet"
          description="Add your students to start building the roster. Attendance, grouping and email all build on top of it."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} strokeWidth={2} />
              Add Students
            </Button>
          }
        />
      ) : (
        <RosterView
          students={list}
          riskByStudent={riskByStudent}
          courseFilter={courseFilter}
          onSelect={(id) => navigate(`/students/${id}`)}
          onAdd={() => setAdding(true)}
        />
      )}
    </section>
  );
}
