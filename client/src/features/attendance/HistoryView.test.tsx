import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryView } from './HistoryView';
import * as attendanceApi from '../../api/attendance';
import { addDays, todayIso, weekday } from './dates';
import type { AttendanceRecord } from './types';
import type { Student } from '../students/types';

vi.mock('../../api/attendance');

const COURSE = 'Period 1';
const TODAY = todayIso();
// The most recent Monday on or before today: a weekday inside the window, so it
// always renders a column and a colored cell regardless of what day the suite runs.
const RECORD_DATE = addDays(TODAY, -((weekday(TODAY) + 6) % 7));

function student(over: Partial<Student> & { id: string }): Student {
  return {
    firstName: 'First',
    lastName: 'Last',
    goesBy: null,
    pronouns: null,
    courses: [COURSE],
    atRiskCourses: [],
    studentEmail: null,
    parentEmails: [],
    notes: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function record(over: Partial<AttendanceRecord> & { studentId: string }): AttendanceRecord {
  return {
    id: `r-${over.studentId}`,
    course: COURSE,
    date: RECORD_DATE,
    statusKey: 'p',
    notes: null,
    ...over,
  };
}

const STUDENTS = [
  student({ id: 's1', firstName: 'Ada', lastName: 'Byron' }),
  student({ id: 's2', firstName: 'Grace', lastName: 'Hopper' }),
];

describe('HistoryView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches scoped to the class and lists every scoped student with the legend', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([
      record({ studentId: 's1', statusKey: 'a' }),
    ]);
    render(<HistoryView students={STUDENTS} course={COURSE} onSelectStudent={() => {}} />);

    await waitFor(() => expect(screen.getByText('Ada Byron')).toBeInTheDocument());
    // A student with no records for the class still gets a row.
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    // Range request is scoped to the single class.
    const [, , course] = vi.mocked(attendanceApi.listAttendanceRange).mock.calls[0];
    expect(course).toBe(COURSE);
    // Legend is present. "Excused" is unique here: no cell has that status, so it
    // only appears in the legend (empty cells' hidden text says "No record").
    expect(screen.getByText('Excused')).toBeInTheDocument();
  });

  it('paints a recorded status with its note in the cell text, and cells are not buttons', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([
      record({ studentId: 's1', statusKey: 'a', notes: 'Left early' }),
    ]);
    render(<HistoryView students={STUDENTS} course={COURSE} onSelectStudent={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText('Absent, note: Left early')).toBeInTheDocument(),
    );
    // Read-only: the only interactive controls are the two student-name links.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows the empty state when the class has no records in the window', async () => {
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
    render(<HistoryView students={STUDENTS} course={COURSE} onSelectStudent={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText('No attendance recorded yet')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Ada Byron')).not.toBeInTheDocument();
  });

  it('navigates to a student detail view when their name is clicked', async () => {
    const onSelect = vi.fn();
    vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([
      record({ studentId: 's1', statusKey: 'p' }),
    ]);
    render(<HistoryView students={STUDENTS} course={COURSE} onSelectStudent={onSelect} />);

    await waitFor(() => expect(screen.getByText('Ada Byron')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Ada Byron'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('prompts to pick a class when no class resolves', () => {
    render(<HistoryView students={STUDENTS} course={null} onSelectStudent={() => {}} />);
    expect(screen.getByText(/Select a single class/i)).toBeInTheDocument();
    expect(attendanceApi.listAttendanceRange).not.toHaveBeenCalled();
  });
});
