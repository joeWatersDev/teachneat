import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConstraintsEditor } from './ConstraintsEditor';
import * as groupingApi from '../../api/grouping';
import type { Student } from '../students/types';
import type { GroupingConstraint } from './types';

vi.mock('../../api/grouping');

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
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const STUDENTS: Student[] = [
  student({ id: 'a', firstName: 'Alex', lastName: 'Rivera' }),
  student({ id: 'b', firstName: 'Sam', lastName: 'Lee' }),
];

const NAMES: Record<string, string> = { a: 'Alex Rivera', b: 'Sam Lee' };
const nameOf = (id: string) => NAMES[id] ?? id;

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ConstraintsEditor', () => {
  it('adds a constraint from selected students', async () => {
    const user = userEvent.setup();
    vi.mocked(groupingApi.listConstraints).mockResolvedValueOnce([]).mockResolvedValueOnce([
      constraint({}),
    ]);
    vi.mocked(groupingApi.createConstraint).mockResolvedValue(constraint({}));

    render(<ConstraintsEditor students={STUDENTS} nameOf={nameOf} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('No constraints yet.')).toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: 'Alex Rivera' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sam Lee' }));
    await user.click(screen.getByRole('button', { name: 'Add constraint' }));

    await waitFor(() =>
      expect(groupingApi.createConstraint).toHaveBeenCalledWith({
        constraintTypeKey: 'together',
        studentIds: ['a', 'b'],
      }),
    );
    await waitFor(() => expect(screen.getByText('Alex Rivera, Sam Lee')).toBeInTheDocument());
  });

  it('requires at least two students before the add button is enabled', async () => {
    const user = userEvent.setup();
    vi.mocked(groupingApi.listConstraints).mockResolvedValue([]);

    render(<ConstraintsEditor students={STUDENTS} nameOf={nameOf} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('No constraints yet.')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Add constraint' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Alex Rivera' }));
    expect(screen.getByRole('button', { name: 'Add constraint' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Sam Lee' }));
    expect(screen.getByRole('button', { name: 'Add constraint' })).toBeEnabled();
  });

  it('removes a constraint', async () => {
    const user = userEvent.setup();
    vi.mocked(groupingApi.listConstraints)
      .mockResolvedValueOnce([constraint({})])
      .mockResolvedValueOnce([]);
    vi.mocked(groupingApi.deleteConstraint).mockResolvedValue(undefined);

    render(<ConstraintsEditor students={STUDENTS} nameOf={nameOf} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Alex Rivera, Sam Lee')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove constraint' }));
    await waitFor(() => expect(groupingApi.deleteConstraint).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.getByText('No constraints yet.')).toBeInTheDocument());
  });
});
