import {
  AlertTriangle,
  CalendarX,
  Mail,
  Maximize2,
  Minus,
  Plus,
  Volume2,
} from 'lucide-react';
import {
  AppFrame,
  ShotAvatar,
  ShotButton,
  ShotCard,
  ShotField,
  ShotFilter,
  ShotHead,
  ShotList,
  ShotSegments,
  ShotSelect,
  ShotTabs,
} from './shotChrome';
import { Lockup } from '../../components/ui/Wordmark';
// The heatmap's colour mapping is shared with the real attendance views rather
// than restated, so the shot cannot drift from the product on what a day means.
import { CELL_CLASS, type DayCategory } from '../../features/attendance/heatmapDays';

/**
 * The five product shots on the landing page. Read `shotChrome.tsx` first: it
 * explains why these are DOM rather than images, and what that costs.
 *
 * Every student below is invented. That is not a nicety — the product's central
 * claim is that no durable copy of student information exists on our servers, so
 * a marketing asset must not contain a real name even by accident. A real name
 * checked in here would be exactly the durable copy the claim denies.
 */

interface RosterRow {
  name: string;
  courses: string;
  email: string;
  /** Mirrors the roster's two warning indicators. */
  flag?: 'atRisk' | 'highAbsence';
}

/**
 * A roster row.
 *
 * The column behaviour is the one piece of real layout thinking here. Wide, it
 * is the app's five-column grid. Narrow, it becomes three: name over class, and
 * the indicator icons in a reserved track. Only the email drops, because it is
 * the one field a teacher can do without at a glance.
 *
 * The two thresholds are deliberately different things. Losing the email is
 * about how wide *this row* is, so it is a **container** query: the row appears
 * both in the hero (nearly full width) and in the showcase panel (much
 * narrower) at the same viewport, and a viewport breakpoint would be wrong for
 * one of them. Losing the flag track is about being on a phone — it drops at
 * `sm`, the same breakpoint that takes the sort filter above it, so the two go
 * together rather than the flags vanishing on a desktop the moment a panel gets
 * narrow.
 *
 * It carried a sixth column of accommodation tags until Step 8a removed the IEP
 * surface, here and in RosterView, which this shot has to keep mirroring.
 */
function RosterRowView({ row }: { row: RosterRow }) {
  return (
    <div
      className={
        'grid min-h-12 items-center gap-3.5 border-b border-subtle bg-surface px-4 py-2 last:border-b-0 ' +
        'grid-cols-[32px_minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,1fr)_44px] ' +
        '@max-[620px]:gap-3 ' +
        '@max-[620px]:sm:grid-cols-[32px_minmax(0,1.4fr)_40px] ' +
        '@max-[620px]:max-sm:grid-cols-[32px_minmax(0,1.4fr)]'
      }
    >
      <ShotAvatar />
      {/* `contents` dissolves this wrapper into two grid cells when there is
          room, and stacks name over class when there is not. The same trick
          RosterView uses with `sm:contents`. */}
      <span className="contents @max-[620px]:flex @max-[620px]:min-w-0 @max-[620px]:flex-col @max-[620px]:gap-px">
        <span className="truncate text-base text-primary">{row.name}</span>
        <span className="truncate text-sm text-secondary">{row.courses}</span>
      </span>
      <span className="truncate text-sm text-secondary @max-[620px]:hidden">{row.email}</span>
      <span className="flex justify-center gap-1.5 max-sm:hidden">
        {row.flag === 'atRisk' && (
          <AlertTriangle
            size={16}
            strokeWidth={2}
            className="text-danger"
            aria-label="At academic risk"
          />
        )}
        {row.flag === 'highAbsence' && (
          <CalendarX size={16} strokeWidth={2} className="text-warning" aria-label="High absences" />
        )}
      </span>
    </div>
  );
}

const HERO_ROWS: RosterRow[] = [
  { name: 'Delacroix, Iris', courses: 'Grade 9 Science', email: 'i.delacroix@school.example' },
  { name: 'Haddad, Farid', courses: 'Grade 9 Science', email: 'f.haddad@school.example' },
  {
    name: 'Marsh, Devon',
    courses: 'Grade 9 Science',
    email: 'd.marsh@school.example',
    flag: 'highAbsence',
  },
  {
    name: 'Okafor, Amara',
    courses: 'Grade 9 Science',
    email: 'a.okafor@school.example',
    flag: 'atRisk',
  },
  { name: 'Rossi, Elena', courses: 'Grade 9 Science', email: 'e.rossi@school.example' },
  // Clipped by the frame's height, so the class reads as continuing below.
  { name: 'Whitfield, Ben', courses: 'Grade 9 Science', email: 'b.whitfield@school.example' },
];

/** The hero shot: the whole app frame, sidebar included, on the Students page. */
export function HeroShot() {
  return (
    <AppFrame
      rail
      bar={
        <div className="flex h-14 items-center gap-2 border-b border-subtle bg-base px-3">
          {/* The real top bar's lockup, not the name in bold: the shot is a
              picture of the app, and the app puts the mark here. */}
          <Lockup />
        </div>
      }
    >
      <ShotHead title="Students">
        <ShotFilter label="Class" value="Grade 9 Science" />
      </ShotHead>
      <ShotTabs options={['Roster', 'Manage Classes']} active="Roster" />
      <div className="flex flex-wrap items-center gap-2">
        {/* Dropped on a phone. The toolbar wraps to three lines at that width
            and pushes the roster itself out of the frame, and sort order is the
            least interesting control to someone meeting the product. */}
        <span className="hidden sm:block">
          <ShotFilter label="Sort" value="Last name" />
        </span>
        <ShotFilter label="Alerts" value="All" />
        <span className="ml-auto">
          <ShotButton variant="primary">Add Students</ShotButton>
        </span>
      </div>
      <ShotList>
        {HERO_ROWS.map((r) => (
          <RosterRowView key={r.name} row={r} />
        ))}
      </ShotList>
    </AppFrame>
  );
}

/**
 * One student's history, as a fixed pattern rather than anything generated.
 *
 * Each string is a school week, Monday to Friday: `p` present, `t` tardy,
 * `a` absent, `e` excused. Written out literally so the shot is identical on
 * every render and every build — a random pattern would flicker between visits
 * and could, by chance, draw a student who is never in class. The run of
 * absences near the end is what earns the "High absences" flag in the
 * statistics beside it, so the two halves of the card agree.
 *
 * Every day is recorded, unlike the real heatmap, which also has an unrecorded
 * state. A gap would need its own legend entry to be readable, and the legend
 * is the wrong place to spend height in a shot this size.
 */
const HISTORY_WEEKS = [
  'ppppp',
  'ppepp',
  'pappp',
  'pptpp',
  'paapp',
  'ppptp',
  'ppppe',
  'ptppp',
  'apppa',
  'ppapp',
  'aappp',
  'pppaa',
];

const HISTORY_CATEGORY: Record<string, DayCategory> = {
  p: 'present',
  t: 'tardy',
  a: 'absent',
  e: 'excused',
};

/** Cell geometry, smaller than the real heatmap's so the weeks fit the panel. */
const HEAT_CELL = 14;
const HEAT_GAP = 3;

function HistoryHeatmap() {
  return (
    <div className="flex flex-col items-start gap-2.5">
      <div className="flex gap-2">
        <div
          className="grid shrink-0 text-xs text-secondary"
          style={{ gridTemplateRows: `repeat(5,${HEAT_CELL}px)`, rowGap: `${HEAT_GAP}px`, width: 26 }}
        >
          {['Mon', '', 'Wed', '', 'Fri'].map((label, i) => (
            <span key={i} style={{ lineHeight: `${HEAT_CELL}px` }}>
              {label}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label="Attendance history heatmap for the last twelve weeks"
          className="grid"
          style={{
            gridAutoFlow: 'column',
            gridTemplateRows: `repeat(5,${HEAT_CELL}px)`,
            gridAutoColumns: `${HEAT_CELL}px`,
            columnGap: `${HEAT_GAP}px`,
            rowGap: `${HEAT_GAP}px`,
          }}
        >
          {HISTORY_WEEKS.flatMap((week, w) =>
            week.split('').map((code, d) => (
              <span
                key={`${w}-${d}`}
                aria-hidden="true"
                style={{ width: HEAT_CELL, height: HEAT_CELL }}
                className={`box-border rounded-sm ${CELL_CLASS[HISTORY_CATEGORY[code]]}`}
              />
            )),
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
        {(
          [
            ['present', 'Present'],
            ['tardy', 'Tardy'],
            ['absent', 'Absent'],
            ['excused', 'Excused'],
          ] as [DayCategory, string][]
        ).map(([category, label]) => (
          <span key={category} className="flex items-center gap-1.5">
            <span className={`box-border h-3 w-3 rounded-sm ${CELL_CLASS[category]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Counted off `HISTORY_WEEKS`, not invented: 60 school days holding 10 absences,
 * 3 tardies and 2 excused, ending on a two-day streak. The rate that follows
 * (17%) is over the product's default high-absence threshold of 15%, which is
 * what entitles the flag beside it. Change the weeks above and these move too.
 */
const STATS: [string, string][] = [
  ['Days recorded', '60'],
  ['Absences', '10'],
  ['Tardies', '3'],
  ['Excused', '2'],
  ['Absence rate', '17%'],
  ['Current streak', '2'],
];

/**
 * The Students panel: one student's detail page, not the roster.
 *
 * The list view is already the hero shot, so repeating it here would show the
 * same screen twice. The detail page is also where the claim in the rail's
 * description actually lands — contacts, notes, attendance and the link out to
 * past correspondence are all one click from a name.
 */
export function StudentsShot() {
  return (
    <AppFrame>
      {/* The page's back / Edit / Delete row is left out. It is chrome for
          working on the record, and the shot is about what the record holds. */}
      <header>
        <span className="block text-lg font-semibold text-primary">
          Amara Okafor <span className="text-secondary">(Amy)</span>
        </span>
        <span className="mt-1 block text-sm text-secondary">
          she/her · Grade 9 Science, Grade 9 Art
        </span>
      </header>

      <ShotCard title="Contact">
        {/* Two short fields stacked is wasted height wherever there is room for
            a column each. A container query, not a viewport one: this card is
            inside the showcase panel, which is far narrower than the page.
            The 500px figure is set by the Attendance card below, which pairs on
            the same line and needs that much to fit its heatmap in half. */}
        <div className="@container">
          <div className="grid gap-3 @min-[500px]:grid-cols-2">
            <ShotField label="Student email" value="a.okafor@school.example" />
            <div className="flex flex-col gap-1">
              <span className="text-sm text-secondary">Parent / guardian emails</span>
              <span className="text-base text-primary">n.okafor@example.com</span>
            </div>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 text-sm text-primary underline">
          <Mail size={14} strokeWidth={2} aria-hidden="true" />
          View communication history
        </span>
      </ShotCard>

      <ShotCard title="Notes">
        <span className="text-base text-primary">
          May 4 — called home about missed labs. Mother will check in nightly.
        </span>
      </ShotCard>

      <ShotCard title="Attendance" action={<ShotFilter label="Class" value="Grade 9 Science" />}>
        <div className="@container">
          {/* Deliberately the same template, breakpoint and column gap as the
              Contact card above, so Statistics starts on the same vertical line
              as the guardian emails and the two cards break to one column at the
              same width. Sizing this pair to its own content instead would put
              the two cards' inner edges a few pixels apart, which reads as a
              mistake rather than as a choice. Row gap is free to be larger.

              500px rather than something smaller because that is where half the
              card clears the heatmap's fixed ~235px; below it, both cards go to
              one column together. */}
          <div className="grid gap-x-3 gap-y-5 @min-[500px]:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-2.5">
              <span className="text-sm font-semibold text-secondary">History</span>
              <HistoryHeatmap />
            </section>
            <section className="flex min-w-0 flex-col gap-2.5">
              <span className="text-sm font-semibold text-secondary">Statistics</span>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {STATS.map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-secondary">{label}</dt>
                    <dd className="flex items-center gap-1.5 text-base text-primary">
                      {value}
                      {label === 'Absence rate' && (
                        <CalendarX
                          size={13}
                          strokeWidth={2}
                          className="text-warning"
                          aria-label="High absences"
                        />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      </ShotCard>

      {/* Replaced the IEP accommodations card when Step 8a removed that surface.
          Academic Risk is what actually sits in that position on the real page,
          and it is the better shot besides: a per-class flag the teacher sets is
          a more honest picture of the record than a static list was. It reuses
          ShotCheck, the inert checkbox the email shot already draws, rather
          than a real input — the frame is a picture of the app, not a copy. */}
      <ShotCard title="Academic Risk">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            { course: 'Grade 9 Science', on: true },
            { course: 'Grade 9 Art', on: false },
          ].map(({ course, on }) => (
            <span key={course} className="flex items-center gap-2 text-base text-primary">
              <ShotCheck on={on} />
              {course}
            </span>
          ))}
        </div>
      </ShotCard>
    </AppFrame>
  );
}

/** Daily entry: four status buttons per student, then an optional note. */
const ATTENDANCE_ROWS: { name: string; status: 'P' | 'A' | 'T' | 'E'; note?: string }[] = [
  { name: 'Delacroix, Iris', status: 'P' },
  { name: 'Marsh, Devon', status: 'A' },
  { name: 'Okafor, Amara', status: 'T', note: 'Bus was late' },
  { name: 'Rossi, Elena', status: 'P' },
  { name: 'Whitfield, Ben', status: 'E', note: 'Field trip' },
];

const STATUSES = ['P', 'A', 'T', 'E'] as const;

export function AttendanceShot() {
  return (
    <AppFrame>
      <ShotHead title="Attendance">
        <ShotFilter label="Class" value="Grade 9 Science" />
      </ShotHead>
      <ShotTabs options={['Daily Entry', 'History', 'Statistics']} active="Daily Entry" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShotFilter label="Date" value="2026-05-14" />
        <div className="flex gap-2">
          <ShotButton>Mark All Present</ShotButton>
          <ShotButton variant="primary">Save Attendance</ShotButton>
        </div>
      </div>
      <ShotList>
        {ATTENDANCE_ROWS.map((r) => (
          <div
            key={r.name}
            className="grid min-h-12 items-center gap-4 border-b border-subtle bg-surface px-4 py-2 last:border-b-0 grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] @max-[560px]:grid-cols-[minmax(0,1fr)_auto]"
          >
            <span className="min-w-0">
              <span className="block truncate text-base text-primary">{r.name}</span>
              <span className="block truncate text-sm text-secondary">Grade 9 Science</span>
            </span>
            <span className="flex gap-1">
              {STATUSES.map((s) => (
                <span
                  key={s}
                  className={
                    'grid h-8 w-8 place-items-center rounded-md text-sm font-semibold ' +
                    (s === r.status
                      ? 'bg-accent text-on-accent'
                      : 'border border-subtle bg-elevated text-secondary')
                  }
                >
                  {s}
                </span>
              ))}
            </span>
            <span
              className={
                'flex h-8 items-center truncate rounded-md border border-subtle bg-base px-2 text-sm @max-[560px]:hidden ' +
                (r.note ? 'text-primary' : 'text-secondary')
              }
            >
              {r.note ?? 'Note (optional)'}
            </span>
          </div>
        ))}
      </ShotList>
    </AppFrame>
  );
}

const GROUPS = [
  ['Amara Okafor', 'Devon Marsh', 'Grace Lindqvist'],
  ['Ben Whitfield', 'Elena Rossi', 'Hassan Ali'],
  ['Chloe Tran', 'Farid Haddad', 'Iris Delacroix'],
  ['Jonah Petrov', 'Nadia Karim', 'Omar Sadiq'],
];

/** The zoom and fullscreen strip both projection tools carry. Always free. */
function StageBar({ sound = false }: { sound?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <span className="mr-1 text-sm text-secondary">Size</span>
        <span className="grid h-8 w-8 place-items-center rounded-full text-secondary">
          <Minus size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="grid h-8 w-8 place-items-center rounded-full text-secondary">
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        {sound && (
          <span className="ml-1 grid h-8 w-8 place-items-center rounded-full text-secondary">
            <Volume2 size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </div>
      <span className="grid h-8 w-8 place-items-center rounded-full text-secondary">
        <Maximize2 size={18} strokeWidth={1.75} aria-hidden="true" />
      </span>
    </div>
  );
}

export function GroupingShot() {
  return (
    <AppFrame>
      <ShotHead title="Grouping">
        <ShotFilter label="Class" value="Grade 9 Science" />
      </ShotHead>
      <div className="flex flex-wrap items-end gap-4">
        <span className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Grouping mode</span>
          <ShotSegments options={['Group size', 'Number of groups']} active="Group size" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Students per group</span>
          {/* A flex column stretches the select to the label's width, which left
              the chevron hugging the value; a fixed width with the chevron at
              the right edge reads as the control. `h-[38px]` matches the
              segmented control's outer height, whose border sits outside its
              `h-9` segments, so the two labels share a baseline. */}
          <ShotSelect className="h-[38px] w-24 self-start">3</ShotSelect>
        </span>
        <span className="ml-auto">
          <ShotButton variant="primary">Generate Groups</ShotButton>
        </span>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-subtle bg-surface p-4">
        <StageBar />
        <div className="flex flex-wrap gap-3">
          {GROUPS.map((members, i) => (
            <article
              key={members[0]}
              className="flex min-w-[9em] max-w-[16em] flex-1 flex-col overflow-hidden rounded-lg border border-subtle bg-elevated"
            >
              {/* The default header colour is the accent, with dark text on it. */}
              <header className="flex items-center justify-between gap-1 bg-accent px-2 py-1.5 text-on-accent">
                <span className="text-base font-semibold">Group {i + 1}</span>
              </header>
              <ul className="flex flex-col gap-1.5 p-3">
                {members.map((m) => (
                  <li key={m} className="text-base leading-tight text-primary">
                    {m}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

/**
 * The wheel, using the app's own rainbow scheme and pointer.
 *
 * Eight names on eight segments. The whole wheel is turned back half a segment
 * so a segment's middle, not a boundary, sits under the pointer. Labels on the
 * left half are placed from the opposite ray so they read upright rather than
 * upside down.
 */
const WHEEL = [
  { name: 'Elena', fill: '#ffab00', text: '#1a1a1a' },
  { name: 'Amara', fill: '#4285f4', text: '#ffffff' },
  { name: 'Devon', fill: '#34a853', text: '#ffffff' },
  { name: 'Farid', fill: '#d93025', text: '#ffffff' },
  { name: 'Iris', fill: '#a142f4', text: '#ffffff' },
  { name: 'Ben', fill: '#12b5cb', text: '#1a1a1a' },
  { name: 'Grace', fill: '#fa7b17', text: '#1a1a1a' },
  { name: 'Hassan', fill: '#e52592', text: '#ffffff' },
];

const SEGMENT = 360 / WHEEL.length;
const R = 92;

function segmentPath(index: number): string {
  const a0 = (index * SEGMENT * Math.PI) / 180;
  const a1 = ((index + 1) * SEGMENT * Math.PI) / 180;
  const x0 = (R * Math.cos(a0)).toFixed(2);
  const y0 = (R * Math.sin(a0)).toFixed(2);
  const x1 = (R * Math.cos(a1)).toFixed(2);
  const y1 = (R * Math.sin(a1)).toFixed(2);
  return `M0 0 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`;
}

export function PickerShot() {
  return (
    <AppFrame>
      <ShotHead title="Name Picker">
        <ShotFilter label="Class" value="Grade 9 Science" />
      </ShotHead>
      {/* Bare, like the Grouping shot's config row above: a card around the
          controls put a second panel inside a frame that is already one, and the
          two shots sit next to each other in the showcase. */}
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Style</span>
          <ShotSegments options={['Card deck', 'Wheel']} active="Wheel" />
        </span>
        {/* `pt-6` is the height of the Style label plus its gap, which is what
            puts the buttons level with the segmented control rather than with
            the word above it. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-3 pt-6">
          <span className="text-sm text-secondary">Picked 3 of 24</span>
          <ShotButton>Reset</ShotButton>
          <ShotButton variant="primary">Pick a name</ShotButton>
        </span>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-4">
        <StageBar sound />
        <svg
          viewBox="0 0 200 200"
          className="mx-auto h-auto w-[300px] max-w-full"
          role="img"
          aria-label="Name picker wheel, currently on Elena Rossi"
        >
          <g transform={`translate(100,100) rotate(${-SEGMENT / 2})`}>
            {WHEEL.map((seg, i) => (
              <path key={seg.name} d={segmentPath(i)} fill={seg.fill} />
            ))}
            {WHEEL.map((seg, i) => {
              const mid = i * SEGMENT + SEGMENT / 2;
              // Past a quarter turn the label would read upside down, so it is
              // placed from the opposite ray instead and anchored the other way.
              const flip = mid > 90 && mid < 270;
              return (
                <g key={seg.name} transform={`rotate(${flip ? mid - 180 : mid})`}>
                  <text
                    x={flip ? -80 : 80}
                    y={4}
                    textAnchor={flip ? 'start' : 'end'}
                    fill={seg.text}
                    fontSize={12}
                    fontWeight={600}
                  >
                    {seg.name}
                  </text>
                </g>
              );
            })}
            <circle r={15} fill="var(--color-elevated)" stroke="var(--color-subtle)" />
          </g>
          {/* Apex on the left, so the pointer aims into the wheel. Its flat
              back sits at x192, which is the centre plus `R` — flush with the
              rim rather than a few units inside it. The shape is sized in
              viewBox units independently of the wheel, so raising `R` or the
              rendered width does not drag the pointer along with it. */}
          <polygon
            points="177,100 192,92.5 192,107.5"
            fill="#000000"
            stroke="#ffffff"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-center text-xl font-semibold text-primary">Elena Rossi</p>
      </div>
    </AppFrame>
  );
}

const RECIPIENTS = [
  { name: 'Iris Delacroix', student: 'i.delacroix@school.example', guardian: 'm.delacroix@example.com' },
  { name: 'Devon Marsh', student: 'd.marsh@school.example', guardian: 'p.marsh@example.com' },
  { name: 'Amara Okafor', student: 'a.okafor@school.example', guardian: 'n.okafor@example.com' },
  { name: 'Elena Rossi', student: 'e.rossi@school.example', guardian: 'g.rossi@example.com' },
];

const RECIPIENT_GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-3 px-3 py-2 @max-[560px]:grid-cols-1';

/** A checkbox drawn as the app draws it, but inert. */
function ShotCheck({ on = false }: { on?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ' +
        (on ? 'border-info bg-info' : 'border-strong bg-base')
      }
    >
      {on && (
        <svg width="9" height="9" viewBox="0 0 12 12">
          <path d="M2 6.5 4.5 9 10 3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function EmailShot() {
  return (
    <AppFrame>
      <ShotHead title="Email" />
      <ShotTabs options={['Compose', 'Templates']} active="Compose" />
      <div className="flex flex-wrap items-center gap-2">
        <ShotFilter label="Template" value="Field trip reminder" />
        <ShotFilter label="Class" value="Grade 9 Science" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-secondary">Select</span>
        <ShotSegments
          options={['Students', 'Guardians', 'High absences', 'At risk']}
          active="Guardians"
        />
      </div>
      <div className="@container overflow-hidden rounded-md border border-subtle">
        <div className={`${RECIPIENT_GRID} border-b border-subtle bg-elevated text-xs text-secondary @max-[560px]:hidden`}>
          <span>Student</span>
          <span>Student email</span>
          <span>Guardian email(s)</span>
        </div>
        {RECIPIENTS.map((r) => (
          <div
            key={r.name}
            className={`${RECIPIENT_GRID} items-start border-b border-subtle bg-surface last:border-b-0`}
          >
            <span className="min-w-0">
              <span className="block truncate text-base text-primary">{r.name}</span>
              <span className="block truncate text-xs text-secondary">Grade 9 Science</span>
            </span>
            <span className="flex min-w-0 items-start gap-2 text-sm @max-[560px]:hidden">
              <ShotCheck />
              <span className="truncate text-primary">{r.student}</span>
            </span>
            <span className="flex min-w-0 items-start gap-2 text-sm @max-[560px]:hidden">
              <ShotCheck on />
              <span className="truncate text-primary">{r.guardian}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-subtle bg-surface p-3">
        <span className="text-xs text-secondary">Preview for Iris Delacroix</span>
        <span className="text-sm text-primary">Hello Marie Delacroix,</span>
        <span className="text-sm text-primary">
          A reminder that Iris needs her museum trip form signed by Friday.
        </span>
      </div>
      {/* The send bar. Four, because one guardian address is ticked on each of
          the four rows above — the count a teacher sees is always the count of
          selected addresses, never the count of students. */}
      <div className="flex justify-end">
        <ShotButton variant="primary">Send 4 Emails</ShotButton>
      </div>
    </AppFrame>
  );
}
