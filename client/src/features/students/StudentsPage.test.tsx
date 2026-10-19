import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { StudentsPage } from './StudentsPage';
import { AuthProvider } from '../../hooks/useAuth';
import * as studentsApi from '../../api/students';
import * as attendanceApi from '../../api/attendance';
import * as classesApi from '../../api/classes';
import { clearRosterSnapshot } from './rosterCache';
import { resetRosterControls } from './rosterControls';
import { resetRememberedTabs } from '../../hooks/useTabRoute';
import type { ApiError } from '../../api/client';
import type { Student } from './types';
import { WithEntitlements } from '../../test/entitlements';

vi.mock('../../api/students');
vi.mock('../../api/attendance');
vi.mock('../../api/classes');

/** Renders the students page under a router with the deep-link route wired up, and an
 * `AuthProvider` with a fixed teacher profile (`StudentDetail` needs it for the Gmail link). */
function renderPage(
  highAbsence?: { minAbsenceRate: number; minDaysRecorded: number },
  at = '/students',
) {
  return render(
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
      <WithEntitlements highAbsence={highAbsence}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/roster" element={<StudentsPage />} />
            <Route path="/students/classes" element={<StudentsPage />} />
            <Route path="/students/:studentId" element={<StudentsPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </WithEntitlements>
    </AuthProvider>,
  );
}

/**
 * Reports the router's own URL. `window.location` is useless here — MemoryRouter
 * never touches it — so an assertion about the address bar has to read this.
 * Rendered with no visible text so it cannot be picked up by a `getByText`.
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="url" hidden>{`${location.pathname}${location.search}`}</span>;
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
    studentEmail: 'alex@example.com',
    parentEmails: [],
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  clearRosterSnapshot();
  resetRosterControls();
  resetRememberedTabs();
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
  // The edit-form tests open StudentDetail, which loads the profile.
  vi.mocked(studentsApi.getStudentDetail).mockResolvedValue({ student: student({}) });
  // StudentDetail's attendance summary + heatmap read the shared endpoints.
  vi.mocked(attendanceApi.getAttendanceStats).mockResolvedValue([]);
  vi.mocked(attendanceApi.listAttendanceRange).mockResolvedValue([]);
});

describe('StudentsPage', () => {
  it('shows the empty state when there are no students', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('No students yet')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add Students' })).toBeInTheDocument();
    // Archiving every class empties the roster; restoring one must still be reachable.
    expect(screen.getByRole('link', { name: 'Manage Classes' })).toHaveAttribute('href', '/students/classes');
  });

  it('offers one add action on the roster, and it opens the add grid', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Bulk Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Student' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Students' }));
    expect(screen.getByRole('heading', { name: 'Add Students' })).toBeInTheDocument();
    expect(screen.getByLabelText('First Name, row 1')).toBeInTheDocument();
  });

  it('renders roster rows with name and course', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
  });

  it('shows a multi-course student under each of their courses via the filter', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1', 'Period 4'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    // The row lists both of Alex's courses.
    expect(screen.getByText('Period 1, Period 4')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 4');
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 1');
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
  });

  it('sorts by last name by default', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Zimmer' }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Adams' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Sam Adams')).toBeInTheDocument());
    const names = screen.getAllByText(/Zimmer|Adams/).map((n) => n.textContent);
    expect(names[0]).toContain('Adams');
  });

  it('shows academic-risk and high-absence warning icons from the risk summary', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', atRiskCourses: ['Period 1'] }),
    ]);
    vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([
      { studentId: 'a', atRiskCourses: ['Period 1'], highAbsenceCourses: ['Period 1'] },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(screen.getByLabelText('At academic risk: Period 1')).toBeInTheDocument();
    // The warning names the rule behind it, not just the classes it applies to.
    expect(
      screen.getByLabelText('High absences (over 15% of recorded days): Period 1'),
    ).toBeInTheDocument();
  });

  it('states the account threshold in the high-absence warning, not a fixed 15%', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([
      { studentId: 'a', atRiskCourses: [], highAbsenceCourses: ['Period 1'] },
    ]);
    renderPage({ minAbsenceRate: 0.25, minDaysRecorded: 10 });
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    expect(
      screen.getByLabelText('High absences (over 25% of recorded days): Period 1'),
    ).toBeInTheDocument();
  });

  /**
   * The alerts filter. Both flags are already drawn on the rows; this is what
   * makes them answerable on a class that does not fit a screen.
   */
  it('filters to each alert separately, and not to the two merged', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera' }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
      student({ id: 'c', firstName: 'Jo', lastName: 'Novak' }),
    ]);
    vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([
      { studentId: 'a', atRiskCourses: ['Period 1'], highAbsenceCourses: [] },
      { studentId: 'b', atRiskCourses: [], highAbsenceCourses: ['Period 1'] },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Jo Novak')).toBeInTheDocument());

    const control = screen.getByLabelText('Filter by alert');
    await user.selectOptions(control, 'atRisk');
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument();
    expect(screen.queryByText('Jo Novak')).not.toBeInTheDocument();

    await user.selectOptions(control, 'highAbsence');
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();

    // The two flags mean different things and prompt different work, so there
    // is deliberately no option that merges them.
    expect(screen.queryByRole('option', { name: /any alert/i })).not.toBeInTheDocument();
  });

  it('scopes an alert to the chosen class rather than to the student', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1', 'Period 4'] }),
    ]);
    vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([
      { studentId: 'a', atRiskCourses: ['Period 4'], highAbsenceCourses: [] },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Filter by alert'), 'atRisk');
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 4');
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();

    // Flagged in Period 4, not in Period 1: looking at Period 1 is asking about
    // Period 1, so the row does not belong in the answer.
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 1');
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
  });

  it('renders the cached roster instantly on remount without a loading flash', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    const first = renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    first.unmount();

    renderPage();
    // Cached snapshot renders synchronously; no "Loading roster…" state.
    expect(screen.queryByText('Loading roster…')).not.toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
  });

  it('removes the course sort option while a course filter is active', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    const sort = screen.getByLabelText('Sort students');
    expect(within(sort).getByRole('option', { name: 'Class' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 1');
    expect(within(sort).queryByRole('option', { name: 'Class' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'all');
    expect(within(sort).getByRole('option', { name: 'Class' })).toBeInTheDocument();
  });

  it('persists the course filter across a remount within the session', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 2'] }),
    ]);
    const first = renderPage();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    first.unmount();

    // Remounting the page (e.g. after visiting a student and returning) keeps the filter.
    renderPage();
    await waitFor(() => expect(screen.getByText('Sam Lee')).toBeInTheDocument());
    expect(screen.getByLabelText('Filter by class')).toHaveValue('Period 2');
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
  });

});

/**
 * The edit modal. It was also the single-student add form until the two add
 * flows were consolidated into the grid, and these cases moved here with it.
 */
describe('StudentsPage edit form', () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({})]);
    vi.mocked(studentsApi.updateStudent).mockResolvedValue(student({}));
    renderPage(undefined, '/students/id1');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    return screen.getByRole('dialog');
  }

  it('adds and removes classes and submits them all', async () => {
    const user = userEvent.setup();
    const dialog = await openEdit(user);

    const courseInput = within(dialog).getByLabelText('Add a class');
    await user.type(courseInput, 'Period 4');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.type(courseInput, 'Period 9');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove Period 9' }));

    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(studentsApi.updateStudent).toHaveBeenCalledWith(
        'id1',
        expect.objectContaining({ courses: ['Period 1', 'Period 4'] }),
      ),
    );
  });

  it('disables saving while a required field is empty', async () => {
    const user = userEvent.setup();
    const dialog = await openEdit(user);

    const submit = within(dialog).getByRole('button', { name: 'Save Changes' });
    expect(submit).toBeEnabled();
    expect(within(dialog).getByText('* indicates a required field')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/First name/));
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/First name/), 'Jordan');
    expect(submit).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove Period 1' }));
    expect(submit).toBeDisabled();
  });

  it('submits the selected pronoun option', async () => {
    const user = userEvent.setup();
    const dialog = await openEdit(user);

    await user.selectOptions(within(dialog).getByLabelText('Pronouns'), 'They/Them');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(studentsApi.updateStudent).toHaveBeenCalledWith(
        'id1',
        expect.objectContaining({ pronouns: 'They/Them' }),
      ),
    );
  });
});

describe('StudentsPage bulk add', () => {
  it('submits every filled row in one batch call and reports the count', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    vi.mocked(studentsApi.createStudentsBatch).mockResolvedValue([student({ id: 'new' })]);

    renderPage();
    await waitFor(() => screen.getByText('No students yet'));
    await user.click(screen.getByRole('button', { name: 'Add Students' }));

    expect(screen.getByRole('heading', { name: 'Add Students' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('First Name, row 1'), 'Jordan');
    await user.type(screen.getByLabelText('Last Name, row 1'), 'Kim');
    await user.type(screen.getByLabelText('Classes (comma-separated), row 1'), 'Period 3');

    // A trailing empty row appeared once row 1 gained content.
    expect(screen.getByLabelText('First Name, row 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add 1 Student' }));
    await waitFor(() =>
      expect(studentsApi.createStudentsBatch).toHaveBeenCalledWith([
        expect.objectContaining({ firstName: 'Jordan', lastName: 'Kim', courses: ['Period 3'] }),
      ]),
    );
    expect(studentsApi.createStudentsBatch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Added 1 student.')).toBeInTheDocument();
  });

  it('removes an emptied row once focus leaves it, keeping one trailing blank row', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);

    renderPage();
    await waitFor(() => screen.getByText('No students yet'));
    await user.click(screen.getByRole('button', { name: 'Add Students' }));

    await user.type(screen.getByLabelText('First Name, row 1'), 'Jo');
    expect(screen.getByLabelText('First Name, row 2')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('First Name, row 1'));
    // Still focused: the emptied row survives until focus leaves it.
    expect(screen.getByLabelText('First Name, row 2')).toBeInTheDocument();

    // Moving focus within the same row does not trigger cleanup.
    await user.click(screen.getByLabelText('Last Name, row 1'));
    expect(screen.getByLabelText('First Name, row 2')).toBeInTheDocument();

    // Focus leaving the row drops it; only the single trailing blank row remains.
    await user.click(screen.getByLabelText('First Name, row 2'));
    expect(screen.getByLabelText('First Name, row 1')).toHaveValue('');
    expect(screen.queryByLabelText('First Name, row 2')).not.toBeInTheDocument();
  });

  it('blocks submission with per-cell errors on incomplete rows', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);

    renderPage();
    await waitFor(() => screen.getByText('No students yet'));
    await user.click(screen.getByRole('button', { name: 'Add Students' }));

    await user.type(screen.getByLabelText('First Name, row 1'), 'Jordan');
    await user.click(screen.getByRole('button', { name: 'Add 1 Student' }));

    expect(studentsApi.createStudentsBatch).not.toHaveBeenCalled();
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    expect(screen.getByText('Fix the highlighted fields, then submit again.')).toBeInTheDocument();
  });

  it('keeps every row on the grid when the batch is rejected', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    vi.mocked(studentsApi.createStudentsBatch).mockRejectedValue({
      code: 'SHEET_RATE_LIMITED',
      message: 'The data service is busy. Try again.',
      status: 429,
    } satisfies ApiError);

    renderPage();
    await waitFor(() => screen.getByText('No students yet'));
    await user.click(screen.getByRole('button', { name: 'Add Students' }));

    await user.type(screen.getByLabelText('First Name, row 1'), 'Jordan');
    await user.type(screen.getByLabelText('Last Name, row 1'), 'Kim');
    await user.type(screen.getByLabelText('Classes (comma-separated), row 1'), 'Period 3');
    await user.type(screen.getByLabelText('First Name, row 2'), 'Sam');
    await user.type(screen.getByLabelText('Last Name, row 2'), 'Lee');
    await user.type(screen.getByLabelText('Classes (comma-separated), row 2'), 'Period 4');

    await user.click(screen.getByRole('button', { name: 'Add 2 Students' }));

    // All-or-nothing: nothing was created, so both rows stay for retry.
    await waitFor(() =>
      expect(screen.getByText(/No students were added/)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('First Name, row 1')).toHaveValue('Jordan');
    expect(screen.getByLabelText('First Name, row 2')).toHaveValue('Sam');
    expect(screen.getByText(/The data service is busy/)).toBeInTheDocument();
  });
});

/**
 * The first-run guide's two buttons promise to land the teacher inside the form
 * rather than on an empty roster with the form to find, so the parameter that
 * carries that promise is asserted here rather than only at the sending end.
 */
describe('StudentsPage add deep links', () => {
  beforeEach(() => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
  });

  it('opens the bulk form on ?add=bulk', async () => {
    renderPage(undefined, '/students?add=bulk');
    expect(await screen.findByLabelText('First Name, row 1')).toBeInTheDocument();
  });

  // The single-student form it used to open is gone; the value is now as
  // meaningless as any other and must not open the grid in its place.
  it('treats the retired ?add=one as unrecognised', async () => {
    renderPage(undefined, '/students/roster?add=one');
    expect(await screen.findByText('No students yet')).toBeInTheDocument();
  });

  // The parameter is an instruction for one navigation, not state. Left in the
  // address bar it would reopen the form on every reload and back navigation.
  it('clears the parameter once it has been acted on', async () => {
    renderPage(undefined, '/students?add=bulk');
    await screen.findByLabelText('First Name, row 1');
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/students/roster'));
  });

  it('ignores an unrecognised value and shows the ordinary roster', async () => {
    renderPage(undefined, '/students/roster?add=banana');
    expect(await screen.findByText('No students yet')).toBeInTheDocument();
  });
});

/**
 * Roster and Manage Classes are URL-backed tabs. The class filter sits in the
 * page header above them and belongs to the roster alone.
 */
describe('StudentsPage tabs', () => {
  beforeEach(() => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([student({ id: 'a' })]);
    vi.mocked(classesApi.listClasses).mockResolvedValue({ live: [], archived: [] });
  });

  const url = () => screen.getByTestId('url').textContent;

  it('lands on the roster, with the class filter in the header', async () => {
    renderPage();
    await waitFor(() => expect(url()).toBe('/students/roster'));
    expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Roster' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Filter by class')).toBeInTheDocument();
  });

  it('orders the roster toolbar as sort, alerts, then Add Students', async () => {
    renderPage();
    await screen.findByText('Alex Rivera');
    const sort = screen.getByLabelText('Sort students');
    const alerts = screen.getByLabelText('Filter by alert');
    const add = screen.getByRole('button', { name: 'Add Students' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(sort, alerts)).toBe(true);
    expect(follows(alerts, add)).toBe(true);
  });

  it('shows Manage Classes without the class filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Alex Rivera');
    await user.click(screen.getByRole('link', { name: 'Manage Classes' }));
    await waitFor(() => expect(url()).toBe('/students/classes'));
    expect(await screen.findByRole('region', { name: 'Current classes' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by class')).not.toBeInTheDocument();
  });

  /**
   * Roster and Manage Classes render the same mounted page, so a change made on
   * Manage Classes has to reload the roster explicitly. Without it the roster
   * showed the classes as they were until the teacher left the page, and the
   * class filter fell back to All when the reload finally came.
   */
  it('reloads the roster after a rename and keeps the filter on the renamed class', async () => {
    const user = userEvent.setup();
    // The reload is held open, so the page renders the new filter against the
    // old roster first, as it does in a browser while the request is in flight.
    let finishReload: (list: Student[]) => void = () => {};
    vi.mocked(studentsApi.listStudents)
      .mockResolvedValueOnce([student({ id: 'a', courses: ['Alpha'] }), student({ id: 'b', courses: ['Beta'] })])
      .mockImplementationOnce(() => new Promise((resolve) => (finishReload = resolve)));
    const cls = (id: string, name: string) => ({ id, name, createdAt: '', studentCount: 1 });
    vi.mocked(classesApi.listClasses).mockResolvedValue({
      live: [cls('c1', 'Alpha'), cls('c2', 'Beta')],
      archived: [],
    });
    vi.mocked(classesApi.renameClass).mockResolvedValue({
      live: [cls('c1', 'Gamma'), cls('c2', 'Beta')],
      archived: [],
    });

    renderPage(undefined, '/students/roster');
    await screen.findAllByText('Alex Rivera');
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Alpha');

    await user.click(screen.getByRole('link', { name: 'Manage Classes' }));
    await user.click(await screen.findByRole('button', { name: 'Rename Alpha' }));
    const input = screen.getByRole('textbox', { name: 'New name for Alpha' });
    await user.clear(input);
    await user.type(input, 'Gamma{Enter}');
    await screen.findByText('Gamma');
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('link', { name: 'Roster' }));
    await act(async () => {
      finishReload([student({ id: 'a', courses: ['Gamma'] }), student({ id: 'b', courses: ['Beta'] })]);
    });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Gamma' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Filter by class')).toHaveValue('Gamma');
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
  });

  it('returns to the last tab used from the bare path', async () => {
    const first = renderPage(undefined, '/students/classes');
    await screen.findByRole('region', { name: 'Current classes' });
    first.unmount();
    renderPage();
    await waitFor(() => expect(url()).toBe('/students/classes'));
  });
});
