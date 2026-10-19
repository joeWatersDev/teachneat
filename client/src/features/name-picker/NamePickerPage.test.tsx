import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NamePickerPage } from './NamePickerPage';
import * as studentsApi from '../../api/students';
import { clearRosterSnapshot } from '../students/rosterCache';
import { resetSelectedClasses } from '../../hooks/useSelectedClass';
import type { Student } from '../students/types';
import { WithEntitlements } from '../../test/entitlements';

vi.mock('../../api/students');
// Force the reduced-motion path so the pick animations settle synchronously,
// making the selection outcome deterministic to assert (animation quality is a
// manual-verification item per TESTING_PLAN Step 8).
vi.mock('./usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }));

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

const STUDENTS: Student[] = [
  student({ id: 'a', firstName: 'Alex', lastName: 'Rivera', courses: ['Period 1'] }),
  student({ id: 'b', firstName: 'Sam', lastName: 'Lee', courses: ['Period 1'] }),
  student({ id: 'c', firstName: 'Zoe', lastName: 'Quinn', courses: ['Period 2'] }),
];

function renderPage() {
  return render(
    <WithEntitlements>
      <MemoryRouter initialEntries={['/name-picker']}>
        <NamePickerPage />
      </MemoryRouter>
    </WithEntitlements>,
  );
}

/** The settled-result caption (below the animation stage). */
function selectedName(): string | null {
  const label = screen.queryByText('Selected');
  return label?.parentElement?.querySelector('p')?.textContent ?? null;
}

beforeEach(() => {
  vi.resetAllMocks();
  clearRosterSnapshot();
  // The selected class now outlives a remount by design, so it has to be
  // cleared between tests the same way the roster snapshot is.
  resetSelectedClasses();
  localStorage.clear();
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
});

describe('NamePickerPage', () => {
  it('shows an empty state when the roster has no students', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('No students to pick from')).toBeInTheDocument(),
    );
  });

  it('does not pick until Pick a name is pressed', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);
    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    // Nothing selected on arrival.
    expect(selectedName()).toBeNull();
  });

  it('picks a name from the active class', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    const pick = await screen.findByRole('button', { name: 'Pick a name' });
    await user.click(pick);

    // Default class is Period 1; the winner must be one of its two students.
    await waitFor(() => expect(selectedName()).not.toBeNull());
    expect(['Alex Rivera', 'Sam Lee']).toContain(selectedName());
  });

  it('scopes the pool to the selected class', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    await user.selectOptions(screen.getByLabelText('Filter by class'), 'Period 2');
    await user.click(screen.getByRole('button', { name: 'Pick a name' }));

    // Period 2 has exactly one student, so the pick is deterministic.
    await waitFor(() => expect(selectedName()).toBe('Zoe Quinn'));
  });

  it('removes selected students only on the next draw, then exhausts the round', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    await user.click(screen.getByRole('switch', { name: 'Remove selected students' }));
    expect(screen.getByText('Picked 0 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() => expect(screen.getByText('Picked 1 of 2')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() => expect(screen.getByText('Picked 2 of 2')).toBeInTheDocument());

    // A third draw commits the last winner, draining the pool.
    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() =>
      expect(screen.getByText('Everyone has been picked')).toBeInTheDocument(),
    );

    // Reset restores the full pool.
    await user.click(screen.getByRole('button', { name: /Reset round/ }));
    await waitFor(() => expect(screen.getByText('Picked 0 of 2')).toBeInTheDocument());
  });

  it('keeps the selected student on the wheel until the next spin', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    await user.click(screen.getByRole('switch', { name: 'Remove selected students' }));

    // First draw: both names still on the wheel (the winner is not yet removed).
    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() => expect(selectedName()).not.toBeNull());
    const wheel = screen.getByRole('img', { name: /Wheel with 2 names/ });
    expect(within(wheel).getByText('Alex Rivera')).toBeInTheDocument();
    expect(within(wheel).getByText('Sam Lee')).toBeInTheDocument();

    // Second draw: the first winner is now removed, leaving one segment.
    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() => expect(screen.getByText('Picked 2 of 2')).toBeInTheDocument());
    const single = screen.getByRole('img', { name: /Wheel with 1 name/ });
    const remaining = ['Alex Rivera', 'Sam Lee'].filter((n) => within(single).queryByText(n));
    expect(remaining).toHaveLength(1);
  });

  it('keeps the Selected caption after Reset', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    await user.click(screen.getByRole('switch', { name: 'Remove selected students' }));
    await user.click(screen.getByRole('button', { name: 'Pick a name' }));
    await waitFor(() => expect(selectedName()).not.toBeNull());
    const picked = selectedName();

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    // The round counter resets, but the last selection stays on screen.
    await waitFor(() => expect(screen.getByText('Picked 0 of 2')).toBeInTheDocument());
    expect(selectedName()).toBe(picked);
  });

  it('spins when the wheel itself is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    await user.click(screen.getByRole('button', { name: 'Spin the wheel' }));

    await waitFor(() => expect(selectedName()).not.toBeNull());
    expect(['Alex Rivera', 'Sam Lee']).toContain(selectedName());
  });

  it('draws when the card deck itself is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' }); // card mode is the default
    await user.click(screen.getByRole('button', { name: 'Draw a card' }));

    await waitFor(() => expect(selectedName()).not.toBeNull());
    expect(['Alex Rivera', 'Sam Lee']).toContain(selectedName());
  });

  it('opens Display options with font plus mode-specific colour choices', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Display options' });
    await user.click(screen.getByRole('button', { name: 'Display options' }));

    const dialog = screen.getByRole('dialog', { name: 'Display options' });
    expect(within(dialog).getByRole('group', { name: 'Font' })).toBeInTheDocument();
    // Card mode is the default, so the card-back choices show (not wheel colours).
    expect(within(dialog).getByRole('group', { name: 'Card back' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('group', { name: 'Wheel colours' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    // Switch to the wheel and reopen: now the wheel colour choices show.
    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    await user.click(screen.getByRole('button', { name: 'Display options' }));
    const wheelDialog = screen.getByRole('dialog', { name: 'Display options' });
    expect(within(wheelDialog).getByRole('group', { name: 'Wheel colours' })).toBeInTheDocument();
    expect(within(wheelDialog).getByRole('button', { name: 'Rainbow' })).toBeInTheDocument();
  });

  it('keeps wheel and card fonts independent', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Display options' });

    // Set the wheel font to Serif.
    await user.click(screen.getByRole('button', { name: 'Wheel' }));
    await user.click(screen.getByRole('button', { name: 'Display options' }));
    let dialog = screen.getByRole('dialog', { name: 'Display options' });
    await user.click(within(dialog).getByRole('button', { name: 'Serif' }));
    expect(within(dialog).getByRole('button', { name: 'Serif' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    // The card deck's font is unaffected — still System.
    await user.click(screen.getByRole('button', { name: 'Card deck' }));
    await user.click(screen.getByRole('button', { name: 'Display options' }));
    dialog = screen.getByRole('dialog', { name: 'Display options' });
    expect(within(dialog).getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Serif' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('toggles sound off and on', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue(STUDENTS);

    renderPage();
    await screen.findByRole('button', { name: 'Pick a name' });
    // Sound is on by default, so the control offers to mute.
    await user.click(screen.getByRole('button', { name: 'Mute sound' }));
    expect(screen.getByRole('button', { name: 'Unmute sound' })).toBeInTheDocument();
  });
});

describe('usage marker', () => {
  it('identifies its roster read as the picker’s', async () => {
    renderPage();
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenCalled());

    // The picker has no endpoint of its own (Step 8), so this argument is the
    // only way its use is counted (Step 6j). Dropping it silently zeroes the
    // picker column on the operator metrics page, which nothing else would
    // catch: the roster still loads and the page still works.
    expect(studentsApi.listStudents).toHaveBeenCalledWith('picker');
  });
});
