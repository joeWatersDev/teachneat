import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { listAttendanceRange } from '../../api/attendance';
import { addDays, parseIso, todayIso, weekday } from './dates';
import { classifyDay, CELL_CLASS, CATEGORY_LABEL } from './heatmapDays';
import type { AttendanceStatusKey } from './types';
import type { Student } from '../students/types';

interface HistoryViewProps {
  /** Students enrolled in the scoped class, already filtered by the page. */
  students: Student[];
  /** The class being viewed. Null when no class resolves (defensive — the page always picks one). */
  course: string | null;
  onSelectStudent: (studentId: string) => void;
}

// Same trailing window as the student-detail heatmap: 26 weeks, with a floor so a
// sparse history is not lost in blank columns.
const WEEKS = 26;
const MIN_WEEKS = 12;

// Cell geometry (px). Kept compact so a semester of school days fits a scroll.
const CELL = 22;
const NAME_COL = 160;

// Shared cell classes. Borders are side-specific (not the `border-subtle`
// shorthand) so the transparent week-gap left border can't clash with the row's
// bottom rule. `border-l-8 border-l-transparent` is the fixed gap between weeks —
// it takes the cell's own background, reading as blank space rather than a line,
// and shifts header and body cells by the same 8px so columns stay aligned.
const CELL_BORDER = 'border-b border-b-subtle';
const WEEK_GAP = 'border-l-8 border-l-transparent';
// Width of the week gap (border-l-8 = 0.5rem), in px. Used to trim the column
// highlight so a Monday's bar matches every other day rather than swallowing the gap.
const GAP = 8;

interface Cell {
  statusKey: AttendanceStatusKey;
  notes: string | null;
}

interface Column {
  date: string;
  /** First school day of a week (except the very first column): carries the week gap. */
  weekStart: boolean;
}

/** The hovered cell: identity for the readout, geometry for the highlight bars. */
interface Hover {
  studentId: string;
  date: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** A week-start cell carries the gap in its left border; trim it from the column bar. */
  weekStart: boolean;
}

function displayName(s: Student): string {
  const base = `${s.firstName} ${s.lastName}`;
  return s.goesBy ? `${base} (${s.goesBy})` : base;
}

/** The Sunday on or before the given date. */
function sundayOnOrBefore(date: string): string {
  return addDays(date, -weekday(date));
}

function formatDay(date: string): string {
  return parseIso(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function monthYear(date: string): string {
  return parseIso(date).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Class-wide attendance history: one row per student, one column per school day
 * (Mon–Fri), scrolling into the past. Read-only — corrections are made in Daily
 * Entry. It reads the shared range endpoint scoped to the class, and paints each
 * cell with the same classifier the student-detail heatmap uses, so the two views
 * cannot disagree. A real table with row/column headers and per-cell status text,
 * so it is navigable without relying on color.
 *
 * Cross-highlight is drawn with two absolutely-positioned overlay bars rather than
 * per-cell classes, so moving the pointer never re-renders the (large) grid — only
 * the two bars and the readout, which depend on the hovered cell.
 */
export function HistoryView({ students, course, onSelectStudent }: HistoryViewProps) {
  const [byStudent, setByStudent] = useState<Map<string, Map<string, Cell>> | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => todayIso(), []);
  const gridStart = useMemo(
    () => addDays(sundayOnOrBefore(today), -(WEEKS - 1) * 7),
    [today],
  );

  // Reset to loading when the class changes, during render (no setState in the effect).
  if (course !== null && loaded !== course) {
    setLoaded(course);
    setByStudent(null);
    setFailed(false);
    setHover(null);
  }

  useEffect(() => {
    if (course === null) return;
    let cancelled = false;
    listAttendanceRange(gridStart, today, course)
      .then((records) => {
        if (cancelled) return;
        const map = new Map<string, Map<string, Cell>>();
        for (const r of records) {
          let days = map.get(r.studentId);
          if (!days) {
            days = new Map<string, Cell>();
            map.set(r.studentId, days);
          }
          // One record per (student, course, date) within a single class.
          days.set(r.date, { statusKey: r.statusKey, notes: r.notes });
        }
        setByStudent(map);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gridStart, today, course]);

  const sorted = useMemo(
    () => [...students].sort((a, b) => a.lastName.localeCompare(b.lastName)),
    [students],
  );

  // Weeks across the full window, then the school-day columns within the trimmed
  // window. Leading weeks with no record for anyone in the class are dropped.
  const columns = useMemo<Column[]>(() => {
    const weeks: string[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) week.push(addDays(gridStart, w * 7 + d));
      weeks.push(week);
    }

    const hasRecord = (date: string): boolean => {
      if (byStudent === null) return false;
      for (const days of byStudent.values()) if (days.has(date)) return true;
      return false;
    };

    let firstRecorded = weeks.length - 1;
    for (let w = 0; w < weeks.length; w++) {
      if (weeks[w].some((d) => hasRecord(d))) {
        firstRecorded = w;
        break;
      }
    }
    const startIndex = Math.max(0, Math.min(firstRecorded, weeks.length - MIN_WEEKS));

    const cols: Column[] = [];
    for (let w = startIndex; w < weeks.length; w++) {
      for (const d of [1, 2, 3, 4, 5]) {
        cols.push({ date: weeks[w][d], weekStart: d === 1 && cols.length > 0 });
      }
    }
    return cols;
  }, [gridStart, byStudent]);

  // Open scrolled to the most recent day once data (and thus columns) are in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [byStudent]);

  const handleEnter = useCallback(
    (studentId: string, date: string, weekStart: boolean, el: HTMLElement) => {
      setHover({
        studentId,
        date,
        weekStart,
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    },
    [],
  );
  const handleLeave = useCallback(() => setHover(null), []);

  if (course === null) {
    return (
      <p className="py-12 text-center text-sm text-secondary">
        Select a single class above to view attendance history. History is shown per class.
      </p>
    );
  }

  if (failed) {
    return (
      <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
        Attendance history is unavailable right now.
      </p>
    );
  }

  if (byStudent === null) {
    return <HistorySkeleton />;
  }

  const hasAnyRecord = Array.from(byStudent.values()).some((days) => days.size > 0);
  if (!hasAnyRecord) {
    return (
      <EmptyState
        icon={CalendarCheck}
        heading="No attendance recorded yet"
        description="Once you record attendance for this class in Daily Entry, its history appears here."
      />
    );
  }

  const hoverCell = hover ? byStudent.get(hover.studentId)?.get(hover.date) ?? null : null;
  const hoverName = hover ? sorted.find((s) => s.id === hover.studentId) : undefined;
  const readout =
    hover && hoverName
      ? `${hoverName.firstName} ${hoverName.lastName} · ${formatDay(hover.date)} · ${
          CATEGORY_LABEL[classifyDay(hover.date, hoverCell?.statusKey, today)]
        }${hoverCell?.notes ? ` · ${hoverCell.notes}` : ''}`
      : `${monthYear(columns[0].date)} – ${monthYear(today)}`;

  return (
    <section className="flex flex-col gap-3">
      <div
        ref={scrollRef}
        className="max-h-[70vh] overflow-auto rounded-lg border border-subtle"
      >
        <div className="relative w-max" onMouseLeave={handleLeave}>
          <HistoryGrid
            sorted={sorted}
            columns={columns}
            byStudent={byStudent}
            today={today}
            onEnter={handleEnter}
            onSelectStudent={onSelectStudent}
          />
          {hover && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-[5] bg-primary/9"
                style={{
                  left: hover.weekStart ? hover.left + GAP : hover.left,
                  width: hover.weekStart ? hover.width - GAP : hover.width,
                  top: 0,
                  height: '100%',
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-[5] bg-primary/9"
                style={{ top: hover.top, height: hover.height, left: 0, width: '100%' }}
              />
            </>
          )}
        </div>
      </div>

      <p role="status" className="min-h-6 text-center text-sm text-secondary">
        {readout}
      </p>

      <Legend />
    </section>
  );
}

interface HistoryGridProps {
  sorted: Student[];
  columns: Column[];
  byStudent: Map<string, Map<string, Cell>>;
  today: string;
  onEnter: (studentId: string, date: string, weekStart: boolean, el: HTMLElement) => void;
  onSelectStudent: (studentId: string) => void;
}

// Memoized so pointer movement (which only changes the parent's hover state) never
// reconciles the grid; the overlay bars and readout carry the highlight instead.
//
// Sticky layers within the scroll container: highlight bars z-5, body name column
// z-10, the two header rows z-20, and the top-left corners (sticky in both axes)
// z-25 so they mask both. All kept below 30 so the mobile drawer overlay (z-30)
// still fades the whole grid, headers included, when the menu is open.
const HistoryGrid = memo(function HistoryGrid({
  sorted,
  columns,
  byStudent,
  today,
  onEnter,
  onSelectStudent,
}: HistoryGridProps) {
  // Month header groups: consecutive columns sharing a month, for the colgroup row.
  const monthGroups: Array<{ label: string; count: number }> = [];
  for (const col of columns) {
    const label = parseIso(col.date).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === label) last.count += 1;
    else monthGroups.push({ label, count: 1 });
  }

  return (
    <table className="border-separate border-spacing-0 text-left">
      <thead>
        <tr>
          <th
            scope="col"
            className="sticky left-0 top-0 z-[25] h-6 bg-elevated"
            style={{ width: NAME_COL, minWidth: NAME_COL }}
          >
            <span className="sr-only">Student</span>
          </th>
          {monthGroups.map((g, i) => (
            <th
              key={`${g.label}-${i}`}
              scope="colgroup"
              colSpan={g.count}
              className="sticky top-0 z-20 h-6 whitespace-nowrap bg-elevated px-1 text-left align-bottom text-xs font-medium text-secondary"
            >
              {g.label}
            </th>
          ))}
        </tr>
        <tr>
          <th
            scope="col"
            className="sticky left-0 top-6 z-[25] border-b border-b-subtle bg-elevated px-4 py-2 text-sm font-medium text-secondary"
            style={{ width: NAME_COL, minWidth: NAME_COL }}
          >
            Student
          </th>
          {columns.map((col) => (
            <th
              key={col.date}
              scope="col"
              className={
                'sticky top-6 z-20 bg-elevated pb-1 text-center align-bottom text-xs font-normal text-secondary ' +
                CELL_BORDER +
                (col.weekStart ? ' ' + WEEK_GAP : '')
              }
              style={{ minWidth: CELL }}
            >
              <span aria-hidden="true">{parseIso(col.date).getUTCDate()}</span>
              <span className="sr-only">{formatDay(col.date)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((s, i) => {
          const days = byStudent.get(s.id);
          // Very faint zebra: alternate rows sit on `elevated` over the default
          // `surface`. The sticky name cell must stay opaque to mask scrolled cells,
          // so both stripe colors are opaque tokens rather than a translucent wash.
          const stripe = i % 2 === 1 ? 'bg-elevated' : 'bg-surface';
          const cellStripe = i % 2 === 1 ? 'bg-elevated' : '';
          return (
            <tr key={s.id}>
              <th
                scope="row"
                className={
                  'sticky left-0 z-10 px-4 py-1 text-left align-middle font-normal ' +
                  CELL_BORDER +
                  ' ' +
                  stripe
                }
                style={{ width: NAME_COL, minWidth: NAME_COL }}
              >
                <button
                  type="button"
                  onClick={() => onSelectStudent(s.id)}
                  title={displayName(s)}
                  // Fixed width (column minus the cell's px-4) so the auto-layout
                  // table can't grow this column past NAME_COL for a long name.
                  style={{ width: NAME_COL - 32 }}
                  className="block truncate text-left text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {displayName(s)}
                </button>
              </th>
              {columns.map((col) => {
                const rec = days?.get(col.date);
                const category = classifyDay(col.date, rec?.statusKey, today);
                const base = CELL_BORDER + (col.weekStart ? ' ' + WEEK_GAP : '') + ' ' + cellStripe;
                if (category === 'future') {
                  return <td key={col.date} aria-hidden="true" className={'p-0.5 ' + base} />;
                }
                return (
                  <td
                    key={col.date}
                    onMouseEnter={(e) => onEnter(s.id, col.date, col.weekStart, e.currentTarget)}
                    className={'p-0.5 ' + base}
                  >
                    <span
                      className={'relative block rounded-sm ' + CELL_CLASS[category]}
                      style={{ width: CELL, height: CELL }}
                    >
                      {rec?.notes && (
                        <span
                          aria-hidden="true"
                          className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-primary"
                        />
                      )}
                      <span className="sr-only">
                        {CATEGORY_LABEL[category]}
                        {rec?.notes ? `, note: ${rec.notes}` : ''}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

function Legend() {
  const items: Array<['present' | 'tardy' | 'absent' | 'excused' | 'empty', string]> = [
    ['present', 'Present'],
    ['tardy', 'Tardy'],
    ['absent', 'Absent'],
    ['excused', 'Excused'],
    ['empty', 'No record'],
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-secondary">
      {items.map(([category, label]) => (
        <span key={category} className="flex items-center gap-1.5">
          <span className={`box-border h-4 w-4 rounded-sm ${CELL_CLASS[category]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Loading placeholder shaped like the real table: a blank header bar of about the
 * header's height, then a single student row with just the name-column gutter.
 */
function HistorySkeleton() {
  return (
    <div role="status" className="overflow-hidden rounded-lg border border-subtle">
      <span className="sr-only">Loading history…</span>
      <div aria-hidden="true" className="h-10 border-b border-subtle bg-elevated" />
      <div aria-hidden="true" className="flex items-center bg-surface">
        <div className="shrink-0 px-4 py-2" style={{ width: NAME_COL, minWidth: NAME_COL }}>
          <Skeleton className="h-4 rounded" style={{ width: NAME_COL - 56 }} />
        </div>
      </div>
    </div>
  );
}
