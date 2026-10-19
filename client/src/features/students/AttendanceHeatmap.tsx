import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { listAttendanceRange } from '../../api/attendance';
import { addDays, parseIso, todayIso, weekday } from '../attendance/dates';
import {
  classifyDay,
  mergeStatus,
  CELL_CLASS,
  CATEGORY_LABEL,
  type DayCategory,
} from '../attendance/heatmapDays';
import type { AttendanceStatusKey } from '../attendance/types';

const WEEKS = 26;
/** Always show at least this many trailing weeks, even for a sparse history. */
const MIN_WEEKS = 12;
/** Weekday-only grid (Mon–Fri); weekends are non-instructional. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Cell/gap geometry (px). The day-label gutter width is fixed so the month-label
// row and the cell grid share the same left offset.
const CELL = 20;
const GAP = 4;
const GUTTER = 40;
const FLEX_GAP = 10;

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

interface Hover {
  date: string;
  category: DayCategory;
}

/**
 * GitHub-contribution-style attendance history for one student: a trailing
 * window of weeks, columns as weeks and rows as school days (Mon–Fri). Reads the
 * shared attendance range endpoint and filters client-side. When `course` is
 * given, only that class's records populate the grid.
 */
export function AttendanceHeatmap({
  studentId,
  course,
}: {
  studentId: string;
  course?: string;
}) {
  const [byDate, setByDate] = useState<Map<string, AttendanceStatusKey> | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<{ studentId: string; course?: string } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Available width of the grid's container, so the number of weeks shown can be
  // trimmed to fit (avoids horizontal scrolling on narrow / mobile viewports).
  const rootRef = useRef<HTMLDivElement>(null);
  const [availWidth, setAvailWidth] = useState<number | null>(null);

  const today = useMemo(() => todayIso(), []);
  const gridStart = useMemo(
    () => addDays(sundayOnOrBefore(today), -(WEEKS - 1) * 7),
    [today],
  );

  // Reset to the loading state when the target (student or class) changes, during
  // render rather than in the fetch effect (no synchronous setState in an effect).
  if (loaded?.studentId !== studentId || loaded?.course !== course) {
    setLoaded({ studentId, course });
    setByDate(null);
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    listAttendanceRange(gridStart, today)
      .then((records) => {
        if (cancelled) return;
        const map = new Map<string, AttendanceStatusKey>();
        for (const r of records) {
          if (r.studentId !== studentId) continue;
          if (course !== undefined && r.course !== course) continue;
          map.set(r.date, mergeStatus(map.get(r.date), r.statusKey));
        }
        setByDate(map);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, gridStart, today, course]);

  // Track the container width so the visible-week count can fit it. Measured in a
  // layout effect (before paint) so a too-wide grid never flashes on mobile.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setAvailWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [byDate]);

  // Open on the most recent week when the grid overflows its container.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [byDate, availWidth]);

  if (failed) {
    return (
      <p className="text-base text-disabled">
        Attendance history is unavailable right now.
      </p>
    );
  }
  if (byDate === null) {
    // Skeleton mirrors the heatmap grid: a gutter plus 14 columns of 5 cells.
    const SKELETON_COLS = 14;
    return (
      <div role="status">
        <span className="sr-only">Loading history…</span>
        <div className="flex justify-center" style={{ gap: FLEX_GAP }}>
          <div style={{ width: GUTTER }} aria-hidden="true" />
          <div
            aria-hidden="true"
            className="grid"
            style={{
              gridAutoFlow: 'column',
              gridTemplateRows: `repeat(5,${CELL}px)`,
              gridAutoColumns: `${CELL}px`,
              columnGap: `${GAP}px`,
              rowGap: `${GAP}px`,
            }}
          >
            {Array.from({ length: SKELETON_COLS * 5 }).map((_, i) => (
              <Skeleton key={i} className="rounded-sm" style={{ width: CELL, height: CELL }} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  // Said here rather than left to the sibling summary, which is withheld on the
  // free account and so cannot be relied on to state it. Worded for this section
  // specifically, so the two do not print the same sentence side by side.
  if (byDate.size === 0) {
    return <p className="text-base text-disabled">No history to show yet.</p>;
  }

  const weeks: string[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) week.push(addDays(gridStart, w * 7 + d));
    weeks.push(week);
  }

  // Trim leading all-empty weeks so a short history is not lost in blank cells,
  // while always keeping a reasonable minimum window.
  let firstRecorded = weeks.length - 1;
  for (let w = 0; w < weeks.length; w++) {
    if (weeks[w].some((d) => byDate.has(d))) {
      firstRecorded = w;
      break;
    }
  }
  const startIndex = Math.max(0, Math.min(firstRecorded, weeks.length - MIN_WEEKS));
  // How many trailing weeks fit the measured width (each week is one CELL + GAP
  // column, past the fixed day-label gutter). Until measured, show the full window.
  const fitWeeks =
    availWidth === null
      ? WEEKS
      : Math.max(4, Math.min(WEEKS, Math.floor((availWidth - GUTTER - FLEX_GAP + GAP) / (CELL + GAP))));
  // Show the fewer of "since first record" and "what fits" — width wins on a narrow
  // screen, so the grid never needs to scroll there.
  const shown = weeks.slice(Math.max(startIndex, weeks.length - fitWeeks));

  const monthLabels = shown.map((week, i) => {
    const monday = parseIso(week[1]);
    const prev = i > 0 ? parseIso(shown[i - 1][1]) : null;
    if (i === 0 || (prev && monday.getUTCMonth() !== prev.getUTCMonth())) {
      return monday.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    }
    return '';
  });

  const rangeLabel = `${monthYear(shown[0][1])} – ${monthYear(today)}`;

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-3">
      <div ref={scrollRef} className="w-max max-w-full overflow-x-auto overflow-y-hidden">
        <div className="flex flex-col gap-2">
          <div className="flex" style={{ gap: FLEX_GAP }}>
            <div className="shrink-0" style={{ width: GUTTER }} />
            <div
              className="grid"
              style={{ gridAutoFlow: 'column', gridAutoColumns: `${CELL}px`, columnGap: `${GAP}px` }}
            >
              {monthLabels.map((label, i) => (
                <span
                  key={i}
                  className="whitespace-nowrap text-sm text-secondary"
                  style={{ minWidth: 0, overflow: 'visible' }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex" style={{ gap: FLEX_GAP }}>
            <div
              className="grid shrink-0 text-sm text-secondary"
              style={{ gridTemplateRows: `repeat(5,${CELL}px)`, rowGap: `${GAP}px`, width: GUTTER }}
            >
              {DAY_LABELS.map((label, i) => (
                <span key={label} style={{ lineHeight: `${CELL}px` }}>
                  {i % 2 === 0 ? label : ''}
                </span>
              ))}
            </div>

            <div
              role="img"
              aria-label="Attendance history heatmap, most recent weeks"
              className="grid"
              style={{
                gridAutoFlow: 'column',
                gridTemplateRows: `repeat(5,${CELL}px)`,
                gridAutoColumns: `${CELL}px`,
                columnGap: `${GAP}px`,
                rowGap: `${GAP}px`,
              }}
              onMouseLeave={() => setHover(null)}
            >
              {shown.flatMap((week) =>
                [1, 2, 3, 4, 5].map((d) => {
                  const date = week[d];
                  const category = classifyDay(date, byDate.get(date), today);
                  if (category === 'future') {
                    return <span key={date} aria-hidden="true" style={{ width: CELL, height: CELL }} />;
                  }
                  return (
                    <span
                      key={date}
                      aria-hidden="true"
                      onMouseEnter={() => setHover({ date, category })}
                      style={{ width: CELL, height: CELL }}
                      className={`box-border rounded-sm hover:ring-2 hover:ring-inset hover:ring-primary ${CELL_CLASS[category]}`}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>

      <p role="status" className="h-6 text-center text-base text-secondary">
        {hover ? `${formatDay(hover.date)} · ${CATEGORY_LABEL[hover.category]}` : rangeLabel}
      </p>

      <Legend />
    </div>
  );
}

function Legend() {
  const items: Array<[DayCategory, string]> = [
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
