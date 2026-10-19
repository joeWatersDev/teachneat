import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GroupingPage } from './GroupingPage';
import * as studentsApi from '../../api/students';
import * as groupingApi from '../../api/grouping';
import { clearRosterSnapshot } from '../students/rosterCache';
import { resetSelectedClasses } from '../../hooks/useSelectedClass';
import type { Student } from '../students/types';
import type { Grouping, GroupingConstraint } from './types';
import type { SaveCurrentInput } from '../../api/grouping';
import { WithEntitlements } from '../../test/entitlements';

vi.mock('../../api/students');
vi.mock('../../api/grouping');

// Longer than the page's SAVE_DEBOUNCE_MS so the debounced write has fired.
const SAVE_WAIT = { timeout: 2500 };

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

const FOUR_STUDENTS: Student[] = [
  student({ id: 'a', firstName: 'Alex', lastName: 'Rivera' }),
  student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
  student({ id: 'c', firstName: 'Jo', lastName: 'Park' }),
  student({ id: 'd', firstName: 'Kai', lastName: 'Ng' }),
];

function grouping(over: Partial<Grouping>): Grouping {
  return {
    id: null,
    groupSize: 2,
    groupCount: null,
    groups: [{ studentIds: ['a', 'b'] }, { studentIds: ['c', 'd'] }],
    generatedAt: '2026-07-14T00:00:00Z',
    savedAt: null,
    ...over,
  };
}

function constraint(over: Partial<GroupingConstraint>): GroupingConstraint {
  return {
    id: 'c1',
    constraintTypeKey: 'together',
    studentIds: ['a', 'b'],
    notes: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function renderPage() {
  return render(
    <WithEntitlements>
      <MemoryRouter initialEntries={['/grouping']}>
        <GroupingPage />
      </MemoryRouter>
    </WithEntitlements>,
  );
}

/** The generate button, once constraints have loaded and it is enabled. */
async function readyGenerateButton(): Promise<HTMLElement> {
  const btn = await screen.findByRole('button', { name: /Generate groups/ });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

beforeEach(() => {
  vi.resetAllMocks();
  clearRosterSnapshot();
  // The selected class now outlives a remount by design, so it has to be
  // cleared between tests the same way the roster snapshot is.
  resetSelectedClasses();
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
  vi.mocked(groupingApi.listConstraints).mockResolvedValue([]);
  vi.mocked(groupingApi.getCurrentGrouping).mockResolvedValue(null);
  vi.mocked(groupingApi.saveCurrentGrouping).mockImplementation((input: SaveCurrentInput) =>
    Promise.resolve(grouping({ id: 'g1', groups: input.groups, savedAt: '2026-07-14T00:00:00Z' })),
  );
});

describe('GroupingPage', () => {
  it('shows an empty state when the roster has no students', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No students to group')).toBeInTheDocument());
  });

  it('restores the class’s saved grouping on load without saving', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);
    vi.mocked(groupingApi.getCurrentGrouping).mockResolvedValue(
      grouping({ id: 'saved', savedAt: '2026-07-14T00:00:00Z' }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('Group 1')).toBeInTheDocument());
    expect(groupingApi.getCurrentGrouping).toHaveBeenCalledWith('Period 1');
    expect(screen.getByText('Alex R.')).toBeInTheDocument();
    expect(groupingApi.saveCurrentGrouping).not.toHaveBeenCalled();
  });

  it('generates locally and displays groups immediately, then auto-saves', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);

    renderPage();
    await user.click(await readyGenerateButton());

    // Displayed synchronously from the local solver — no network wait.
    expect(screen.getByText('Group 1')).toBeInTheDocument();

    // size 4 over 4 students => one group holding everyone.
    await waitFor(() => expect(groupingApi.saveCurrentGrouping).toHaveBeenCalled(), SAVE_WAIT);
    const arg = vi.mocked(groupingApi.saveCurrentGrouping).mock.calls[0][0];
    expect(arg.course).toBe('Period 1');
    expect(arg.groupSize).toBe(4);
    expect(arg.groups.flatMap((g) => g.studentIds).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('generates by number of groups when that mode is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);

    renderPage();
    await readyGenerateButton();
    await user.click(screen.getByRole('button', { name: 'Number of groups' }));
    await user.click(screen.getByRole('button', { name: /Generate groups/ }));

    await waitFor(() => expect(groupingApi.saveCurrentGrouping).toHaveBeenCalled(), SAVE_WAIT);
    const arg = vi.mocked(groupingApi.saveCurrentGrouping).mock.calls[0][0];
    expect(arg.groupCount).toBe(4);
    expect(arg.groups.flatMap((g) => g.studentIds).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('coalesces rapid regenerate presses into a single save (mashable)', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);

    renderPage();
    const btn = await readyGenerateButton();
    await user.click(btn);
    await user.click(screen.getByRole('button', { name: /Regenerate/ }));
    await user.click(screen.getByRole('button', { name: /Regenerate/ }));

    await waitFor(
      () => expect(groupingApi.saveCurrentGrouping).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    );
  });

  it('reorders groups (swaps the numbering) and persists', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);
    vi.mocked(groupingApi.getCurrentGrouping).mockResolvedValue(
      grouping({ id: 'saved', savedAt: '2026-07-14T00:00:00Z' }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('Group 1')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Move Group 1 later' }));

    await waitFor(
      () =>
        expect(groupingApi.saveCurrentGrouping).toHaveBeenCalledWith({
          course: 'Period 1',
          groupSize: 2,
          groups: [{ studentIds: ['c', 'd'] }, { studentIds: ['a', 'b'] }],
        }),
      SAVE_WAIT,
    );
  });

  it('surfaces a conflict from unsatisfiable constraints', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);
    vi.mocked(groupingApi.listConstraints).mockResolvedValue([
      constraint({ id: 'c1', constraintTypeKey: 'together', studentIds: ['a', 'b'] }),
      constraint({ id: 'c2', constraintTypeKey: 'apart', studentIds: ['a', 'b'] }),
    ]);

    renderPage();
    await user.click(await readyGenerateButton());

    expect(
      screen.getByText(/required both together and apart/),
    ).toBeInTheDocument();
    expect(groupingApi.saveCurrentGrouping).not.toHaveBeenCalled();
  });

  it('opens the display options modal', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(FOUR_STUDENTS);

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Display options/ }));

    expect(screen.getByRole('dialog', { name: 'Display options' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mark group leader' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rainbow' })).toBeInTheDocument();
  });
});
