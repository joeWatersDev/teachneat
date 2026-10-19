import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { StudentDetail } from './StudentDetail';
import { AuthProvider } from '../../hooks/useAuth';
import { WithEntitlements } from '../../test/entitlements';
import type { LapsedFrom, Plan } from '../../api/auth';
import * as studentsApi from '../../api/students';
import * as attendanceApi from '../../api/attendance';
import type { Student } from './types';

vi.mock('../../api/students');
vi.mock('../../api/attendance');

/** Renders under an `AuthProvider` with a fixed teacher profile, as `StudentDetail` needs it
 * for the "View communication history" Gmail link. */
function render(
  ui: ReactElement,
  plan: Plan = 'paid',
  lapsedFrom: LapsedFrom | null = null,
): RenderResult {
  return baseRender(
    <AuthProvider
      fetchProfile={() =>
        Promise.resolve({
          email: 'teacher@example.com',
          name: 'Teacher',
          avatarUrl: '',
          billingEnabled: true,
          csrfToken: 'csrf-test-token',
          plan: 'paid' as const,
        })
      }
      redirectTo={() => {}}
    >
      <WithEntitlements plan={plan} lapsedFrom={lapsedFrom}>
        {ui}
      </WithEntitlements>
    </AuthProvider>,
  );
}

const base: Student = {
  id: 'id1',
  firstName: 'Alex',
  lastName: 'Rivera',
  goesBy: 'AJ',
  pronouns: 'they/them',
  courses: ['Period 1'],
  atRiskCourses: [],
  studentEmail: 'alex@example.com',
  parentEmails: ['mom@example.com', 'dad@example.com'],
  notes: 'Sits near the window.',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(studentsApi.getStudentDetail).mockResolvedValue({ student: base });
  vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([]);
  vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
});

describe('StudentDetail', () => {
  it('renders profile, parent emails, and the attendance summary section', async () => {
    render(<StudentDetail studentId="id1" onBack={() => {}} onChanged={() => {}} onAtRiskChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument());
    expect(screen.getByText('mom@example.com')).toBeInTheDocument();
    expect(screen.getByText('dad@example.com')).toBeInTheDocument();
    // No records for this student yet -> empty summary state.
    await waitFor(() =>
      expect(screen.getByText('No attendance recorded yet.')).toBeInTheDocument(),
    );
  });

  it('links to a Gmail search over the student and guardian addresses, scoped to the teacher', async () => {
    render(<StudentDetail studentId="id1" onBack={() => {}} onChanged={() => {}} onAtRiskChanged={() => {}} />);
    const link = await screen.findByRole('link', { name: /View communication history/ });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('https://mail.google.com/mail/?authuser=teacher@example.com#search/')).toBe(true);
    const query = decodeURIComponent(href.split('#search/')[1]);
    expect(query).toBe(
      '(from:alex@example.com OR to:alex@example.com OR cc:alex@example.com) OR ' +
        '(from:mom@example.com OR to:mom@example.com OR cc:mom@example.com) OR ' +
        '(from:dad@example.com OR to:dad@example.com OR cc:dad@example.com)',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('omits the communication-history link when the student has no email addresses', async () => {
    vi.mocked(studentsApi.getStudentDetail).mockResolvedValue({
      student: { ...base, studentEmail: null, parentEmails: [] },
    });
    render(<StudentDetail studentId="id1" onBack={() => {}} onChanged={() => {}} onAtRiskChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /View communication history/ })).not.toBeInTheDocument();
  });

  it('shows the student attendance summary when records exist', async () => {
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      {
        studentId: 'id1',
        course: 'Period 1',
        totalAbsences: 3,
        totalTardies: 1,
        totalExcused: 0,
        daysRecorded: 20,
        absenceRate: 0.15,
        consecutiveAbsences: 2,
      },
    ]);
    render(<StudentDetail studentId="id1" onBack={() => {}} onChanged={() => {}} onAtRiskChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('15%')).toBeInTheDocument());
    expect(screen.getByText('Days recorded')).toBeInTheDocument();
  });

  it('aggregates the attendance summary across the student’s course enrollments', async () => {
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      {
        studentId: 'id1',
        course: 'Period 1',
        totalAbsences: 2,
        totalTardies: 1,
        totalExcused: 0,
        daysRecorded: 10,
        absenceRate: 0.2,
        consecutiveAbsences: 1,
      },
      {
        studentId: 'id1',
        course: 'Period 4',
        totalAbsences: 4,
        totalTardies: 0,
        totalExcused: 1,
        daysRecorded: 10,
        absenceRate: 0.4,
        consecutiveAbsences: 3,
      },
      // A different student's row must not leak into this summary.
      {
        studentId: 'other',
        course: 'Period 1',
        totalAbsences: 9,
        totalTardies: 9,
        totalExcused: 9,
        daysRecorded: 9,
        absenceRate: 1,
        consecutiveAbsences: 9,
      },
    ]);
    render(<StudentDetail studentId="id1" onBack={() => {}} onChanged={() => {}} onAtRiskChanged={() => {}} />);
    // Days 10+10=20, absences 2+4=6 -> 30% rate, worst streak 3.
    await waitFor(() => expect(screen.getByText('30%')).toBeInTheDocument());
    const days = screen.getByText('Days recorded').closest('div');
    expect(days).toHaveTextContent('20');
    const streak = screen.getByText('Current streak').closest('div');
    expect(streak).toHaveTextContent('3');
  });

  it('confirms before deleting and calls back handlers', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onChanged = vi.fn();
    vi.mocked(studentsApi.deleteStudent).mockResolvedValue(undefined);

    render(<StudentDetail studentId="id1" onBack={onBack} onChanged={onChanged} onAtRiskChanged={() => {}} />);
    await waitFor(() => screen.getByText(/Alex Rivera/));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/This will remove Alex Rivera/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Student' }));

    await waitFor(() => expect(studentsApi.deleteStudent).toHaveBeenCalledWith('id1'));
    expect(onChanged).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it('toggles academic risk for a course and reports the change up', async () => {
    const user = userEvent.setup();
    const onAtRiskChanged = vi.fn();
    vi.mocked(studentsApi.setAtRisk).mockResolvedValue({
      studentId: 'id1',
      course: 'Period 1',
      atRisk: true,
    });

    render(
      <StudentDetail
        studentId="id1"
        onBack={() => {}}
        onChanged={() => {}}
       
        onAtRiskChanged={onAtRiskChanged}
      />,
    );
    const checkbox = await screen.findByRole('checkbox', { name: 'Academic risk for Period 1' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    await waitFor(() =>
      expect(studentsApi.setAtRisk).toHaveBeenCalledWith('id1', 'Period 1', true),
    );
    expect(checkbox).toBeChecked();
    expect(onAtRiskChanged).toHaveBeenCalledWith(['Period 1']);
  });

  it('flags high absences next to the rate in the attendance summary', async () => {
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      {
        studentId: 'id1',
        course: 'Period 1',
        totalAbsences: 3,
        totalTardies: 0,
        totalExcused: 0,
        daysRecorded: 10,
        absenceRate: 0.3,
        consecutiveAbsences: 1,
      },
    ]);
    render(
      <StudentDetail
        studentId="id1"
        onBack={() => {}}
        onChanged={() => {}}
       
        onAtRiskChanged={() => {}}
      />,
    );
    // The warning sits next to the absence-rate value.
    const rate = await screen.findByText('30%');
    expect(rate.closest('dd')).toHaveTextContent('High Absences');
  });
});

const detail = () => (
  <StudentDetail
    studentId="id1"
    onBack={() => {}}
    onChanged={() => {}}
   
    onAtRiskChanged={() => {}}
  />
);

/**
 * The attendance card holds two labelled sections: History, free on every plan,
 * and Statistics, which is premium. On `free` the statistics tiles are shown
 * blurred and valueless rather than removed, so the shape of what Premium
 * adds stays visible.
 */
describe('StudentDetail attendance sections', () => {
  it('labels both sections and marks only Statistics', async () => {
    render(detail());
    await waitFor(() => expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Statistics/ })).toBeInTheDocument();
    // Nothing is marked on paid.
    expect(screen.queryByRole('img', { name: 'Premium feature' })).not.toBeInTheDocument();
  });

  it('keeps History and withholds the statistics figures on free', async () => {
    vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([
      {
        studentId: 'id1',
        course: 'Period 1',
        totalAbsences: 3,
        totalTardies: 1,
        totalExcused: 0,
        daysRecorded: 20,
        absenceRate: 0.15,
        consecutiveAbsences: 0,
      },
    ]);
    render(detail(), 'free');
    await waitFor(() => expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Premium feature' })).toBeInTheDocument();
    // The same sentence every gated surface uses.
    expect(screen.getByText('Attendance statistics are a premium feature.')).toBeInTheDocument();
    // The gated endpoint is never called on free, and no figure is rendered.
    expect(attendanceApi.getAttendanceStats).not.toHaveBeenCalled();
    expect(screen.queryByText('20')).not.toBeInTheDocument();
  });

  /**
   * The overlay says the same thing whatever the billing state behind it. It used
   * to vary — trial ended, subscription ended, collection paused — which put the
   * account's payment history into a panel about one student's attendance. A
   * locked control only has to say what unlocks it.
   */
  it('states the plain premium sentence whatever the account lapsed from', async () => {
    for (const from of ['trial', 'subscription', 'paused'] as LapsedFrom[]) {
      const { unmount } = render(detail(), 'free', from);
      await waitFor(() => expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument());
      expect(screen.getByText('Attendance statistics are a premium feature.')).toBeInTheDocument();
      expect(screen.queryByText(/has ended|paused|trial/i)).not.toBeInTheDocument();
      unmount();
    }
  });
});
