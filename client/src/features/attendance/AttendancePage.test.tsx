import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AttendancePage } from './AttendancePage';
import { todayIso } from './dates';
import * as studentsApi from '../../api/students';
import * as attendanceApi from '../../api/attendance';
import { clearRosterSnapshot } from '../students/rosterCache';
import { resetSelectedClasses } from '../../hooks/useSelectedClass';
import { resetRememberedTabs } from '../../hooks/useTabRoute';
import type { Student } from '../students/types';
import type { AttendanceRecord, AttendanceStats } from './types';
import { WithEntitlements } from '../../test/entitlements';
import type { Plan } from '../../api/auth';

vi.mock('../../api/students');
vi.mock('../../api/attendance');

/** A known past Saturday, safely before any real run date. */
const PAST_SATURDAY = '2022-01-01';
/** A known past Monday. */
const PAST_MONDAY = '2022-01-03';

/**
 * **The clock is pinned to a weekday for this whole file, and that is a fix
 * rather than tidiness.** The page opens on today and disables every entry
 * control at weekends, so on a machine whose clock says Saturday the four tests
 * that exercise those controls fail while passing everywhere else. They did
 * exactly that on 2026-09-12: CI runs in UTC, the operator is UTC-4, and the
 * push went out at 21:25 local on the Friday, which is Saturday in UTC. The
 * window is every Friday evening to Sunday evening local — wide enough to be
 * hit, rare enough that nothing in the suite said so.
 *
 * Noon UTC, so the local calendar day is the same Wednesday for every timezone
 * the product plausibly runs in, and only `Date` is faked, so `waitFor` and
 * `userEvent` keep their real timers.
 */
const PINNED_WEEKDAY = new Date('2026-09-09T12:00:00Z');

function StudentMarker() {
  const { studentId } = useParams();
  return <div>detail:{studentId}</div>;
}

/** The router's own address, which MemoryRouter never writes to `window.location`. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="url" hidden>{location.pathname}</span>;
}

function renderAttendance(plan: Plan = 'paid', at = '/attendance') {
  return render(
    <WithEntitlements plan={plan}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/attendance/:tab" element={<AttendancePage />} />
          <Route path="/students/:studentId" element={<StudentMarker />} />
          <Route path="/grouping" element={<p>Grouping page</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </WithEntitlements>,
  );
}

function student(over: Partial<Student>): Student {
  return {
    id: 'id1',
    firstName: 'Alex',
    lastName: 'Rivera',
    goesBy: null,
    pronouns: null,
    courses: ['Period 1'],
    atRiskCourses: [],
    studentEmail: null,
    parentEmails: [],
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function stats(over: Partial<AttendanceStats>): AttendanceStats {
  return {
    studentId: 'id1',
    course: 'Period 1',
    totalAbsences: 0,
    totalTardies: 0,
    totalExcused: 0,
    daysRecorded: 0,
    absenceRate: 0,
    consecutiveAbsences: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_WEEKDAY);
  vi.resetAllMocks();
  clearRosterSnapshot();
  // The selected class now outlives a remount by design, so it has to be
  // cleared between tests the same way the roster snapshot is.
  resetSelectedClasses();
  resetRememberedTabs();
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
  vi.mocked(attendanceApi.listAttendance).mockResolvedValue([]);
  vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AttendancePage entry view', () => {
  it('shows an empty state when the roster has no students', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    renderAttendance();
    await waitFor(() =>
      expect(screen.getByText('No students to track')).toBeInTheDocument(),
    );
  });

  it('lists in-scope students with status controls, defaulting to present', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a' }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
    ]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();

    const presentAlex = screen.getByRole('button', { name: 'Present: Alex Rivera' });
    expect(presentAlex).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Absent: Alex Rivera' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('saves one entry per in-scope student with the chosen statuses and notes', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a' }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
    ]);
    vi.mocked(attendanceApi.submitAttendance).mockResolvedValue({ written: 2 });

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Absent: Sam Lee' }));
    await user.type(screen.getByLabelText('Note for Sam Lee'), 'called home');
    await user.click(screen.getByRole('button', { name: 'Save Attendance' }));

    await waitFor(() =>
      expect(attendanceApi.submitAttendance).toHaveBeenCalledWith(todayIso(), 'Period 1', [
        { studentId: 'a', statusKey: 'p', notes: null },
        { studentId: 'b', statusKey: 'a', notes: 'called home' },
      ]),
    );
    expect(screen.getByText('Saved attendance for 2 students.')).toBeInTheDocument();
  });

  it('loads recorded data when a past date is selected', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    const recorded: AttendanceRecord = {
      id: 'rec1',
      studentId: 'a',
      course: 'Period 1',
      date: PAST_MONDAY,
      statusKey: 't',
      notes: 'bus delay',
    };
    vi.mocked(attendanceApi.listAttendance).mockImplementation((date) =>
      Promise.resolve(date === PAST_MONDAY ? [recorded] : []),
    );

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Attendance date'), {
      target: { value: PAST_MONDAY },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tardy: Alex Rivera' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByLabelText('Note for Alex Rivera')).toHaveValue('bus delay');
  });

  it('marks every student present with one click', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Absent: Alex Rivera' }));
    expect(screen.getByRole('button', { name: 'Absent: Alex Rivera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Mark All Present' }));
    expect(screen.getByRole('button', { name: 'Present: Alex Rivera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('makes entry read-only on weekends', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Attendance date'), {
      target: { value: PAST_SATURDAY },
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Weekends are not school days/),
      ).toBeInTheDocument(),
    );
    // Excused is fixed on, all controls disabled, Save disabled.
    expect(screen.getByRole('button', { name: 'Excused: Alex Rivera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Present: Alex Rivera' })).toBeDisabled();
    expect(screen.getByLabelText('Note for Alex Rivera')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Attendance' })).toBeDisabled();
    expect(attendanceApi.submitAttendance).not.toHaveBeenCalled();
  });

  it('navigates to a student detail view when their name is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Alex Rivera' }));
    expect(screen.getByText('detail:a')).toBeInTheDocument();
  });
});

describe('AttendancePage class filter', () => {
  it('defaults to the first course alphabetically and scopes to the chosen class', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    // Default scope is Period 1: Sam (Period 2) is hidden.
    expect(screen.getByLabelText('Filter by class')).toHaveValue('Period 1');
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();

    // Attendance is per-class only; there is no "All classes" option.
    expect(
      screen.queryByRole('option', { name: 'All classes' }),
    ).not.toBeInTheDocument();
  });

  /**
   * The class survives leaving the tool and coming back, matching the roster's
   * filters. Resetting to the first class alphabetically on every remount put a
   * teacher back in a class they were not teaching, which for attendance means
   * recording against the wrong one.
   */
  it('remembers the chosen class across a remount', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    const first = renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    first.unmount();

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Sam Lee')).toBeInTheDocument());
    expect(screen.getByLabelText('Filter by class')).toHaveValue('Period 2');
  });

  /**
   * The remembered class can vanish — archived, or its last student removed —
   * and the tool falls back rather than showing an empty class.
   */
  it('falls back to the first class when the remembered one is gone', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    const first = renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    first.unmount();

    clearRosterSnapshot();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
    ]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByLabelText('Filter by class')).toHaveValue('Period 1');
  });

  it('lists a multi-course student under each of their classes', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1', 'Period 2'] }),
    ]);
    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    // Present under the default (Period 1) scope…
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    // …and still present when scoped to Period 2.
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
  });

  it('submits only the in-scope class when saving', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    vi.mocked(attendanceApi.submitAttendance).mockResolvedValue({ written: 1 });

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Save Attendance' }));

    await waitFor(() =>
      expect(attendanceApi.submitAttendance).toHaveBeenCalledWith(todayIso(), 'Period 1', [
        { studentId: 'a', statusKey: 'p', notes: null },
      ]),
    );
  });
});

describe('AttendancePage statistics view', () => {
  it('shows per-student aggregates and flags high-absence students', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a' }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
    ]);
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      stats({
        studentId: 'a',
        daysRecorded: 20,
        totalAbsences: 6,
        totalTardies: 2,
        absenceRate: 0.3,
        consecutiveAbsences: 3,
      }),
      stats({ studentId: 'b', daysRecorded: 20, totalAbsences: 1, absenceRate: 0.05 }),
    ]);

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'Statistics' }));

    await waitFor(() => expect(screen.getByText('30%')).toBeInTheDocument());
    const alexRow = screen.getByText('Alex Rivera').closest('tr');
    expect(alexRow).not.toBeNull();
    expect(alexRow).toHaveTextContent('High absences');
    expect(alexRow).toHaveTextContent('6');

    const samRow = screen.getByText('Sam Lee').closest('tr');
    expect(samRow).not.toHaveTextContent('High absences');
  });

  it('navigates to a student detail view from the statistics table', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      stats({ studentId: 'a', daysRecorded: 5 }),
    ]);

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'Statistics' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Rivera' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Alex Rivera' }));
    expect(screen.getByText('detail:a')).toBeInTheDocument();
  });

  it('requests a scoped range once both bounds are set', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      stats({ studentId: 'a', daysRecorded: 5 }),
    ]);

    renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'Statistics' }));
    await waitFor(() =>
      expect(attendanceApi.getAttendanceStats).toHaveBeenCalledWith(undefined, undefined, 'Period 1'),
    );

    fireEvent.change(screen.getByLabelText('Statistics start date'), {
      target: { value: '2026-05-01' },
    });
    expect(attendanceApi.getAttendanceStats).not.toHaveBeenCalledWith(
      '2026-05-01',
      expect.anything(),
      expect.anything(),
    );

    fireEvent.change(screen.getByLabelText('Statistics end date'), {
      target: { value: '2026-05-31' },
    });
    await waitFor(() =>
      expect(attendanceApi.getAttendanceStats).toHaveBeenCalledWith(
        '2026-05-01',
        '2026-05-31',
        'Period 1',
      ),
    );
  });
});

describe('AttendancePage entitlements', () => {
  beforeEach(() => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'id1' })]);
  });

  // Entry and History are both the record of what was taken, not analysis of
  // it. Gating entry would leave the free tier with no reason to be opened
  // twice, and History is where a teacher checks what they already recorded.
  it('leaves Daily Entry and History available on free', async () => {
    renderAttendance('free');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Daily Entry' })).toHaveAttribute('href', '/attendance/daily');
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/attendance/history');
  });

  it('marks and disables Statistics alone on free', async () => {
    renderAttendance('free');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /Statistics/ })).not.toBeInTheDocument();
    expect(screen.getByText('Statistics')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByRole('img', { name: 'Premium feature' })).toHaveLength(1);
  });

  // Step 3a, and the tabs' own version of it. The bubble is absolutely
  // positioned, so two things can go wrong that jsdom cannot measure: centred on
  // a tab near the right of a phone screen it widens the document even at
  // `opacity-0`, and inside a scrolling tab row it is clipped out of sight. This
  // asserts the anchoring and the absence of a clipping ancestor instead.
  it('anchors the Statistics tooltip leftward, outside any clipping container', async () => {
    renderAttendance('free');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    const bubble = screen.getByRole('tooltip', { hidden: true });
    expect(bubble).toHaveClass('right-0');
    expect(bubble).not.toHaveClass('left-1/2');

    const nav = screen.getByRole('navigation', { name: 'Attendance views' });
    for (let el: HTMLElement | null = bubble.parentElement; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/\boverflow-(x-|y-)?(auto|hidden|scroll)\b/);
      if (el === nav) break;
    }
  });

  // A disabled tab needs the explanation as much as a disabled button.
  it('explains why Statistics is disabled, on hover and to screen readers', async () => {
    renderAttendance('free');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    const sentence = 'Attendance statistics are a premium feature.';
    // The tooltip is the visual affordance and is aria-hidden by design; the
    // sr-only description below is what assistive technology reads.
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(sentence);

    const stats = screen.getByText('Statistics');
    const describedBy = stats.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(sentence);
  });

  it('leaves Statistics usable and marked on trial', async () => {
    renderAttendance('trial');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Statistics/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Premium feature' })).toHaveLength(1);
  });

  it('shows no marker anywhere on paid', async () => {
    renderAttendance('paid');
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: 'Premium feature' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Statistics' })).toBeInTheDocument();
    // No explanation where there is nothing to explain.
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });
});

/**
 * The views are URL-backed tabs: each has its own address, the bare page path
 * lands on the last one used, and the tab outlives leaving the tool.
 */
describe('AttendancePage tabs', () => {
  beforeEach(() => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'id1' })]);
  });

  const url = () => screen.getByTestId('url').textContent;

  it('sends the bare path to Daily Entry the first time', async () => {
    renderAttendance();
    await waitFor(() => expect(url()).toBe('/attendance/daily'));
    expect(screen.getByRole('link', { name: 'Daily Entry' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the tab its address names', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
    renderAttendance('paid', '/attendance/history');
    expect(await screen.findByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(url()).toBe('/attendance/history');
  });

  it('redirects an unknown tab rather than rendering an empty page', async () => {
    renderAttendance('paid', '/attendance/nonsense');
    await waitFor(() => expect(url()).toBe('/attendance/daily'));
  });

  it('returns to the last tab used after leaving the tool', async () => {
    const user = userEvent.setup();
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
    const first = renderAttendance();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'History' }));
    await waitFor(() => expect(url()).toBe('/attendance/history'));
    first.unmount();

    // Arriving at the bare path again, as the sidebar link does.
    renderAttendance();
    await waitFor(() => expect(url()).toBe('/attendance/history'));
  });

  it('shows the premium notice when a free account opens Statistics by address', async () => {
    renderAttendance('free', '/attendance/statistics');
    // The notice, plus the disabled tab's tooltip and screen-reader description.
    expect(await screen.findAllByText(/Attendance statistics are a premium feature/)).toHaveLength(3);
    expect(attendanceApi.getAttendanceStats).not.toHaveBeenCalled();
  });
});
