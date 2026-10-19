import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ClassesView } from './ClassesView';
import * as classesApi from '../../api/classes';
import type { ClassList, MoveResult } from '../../api/classes';
import type { ApiError } from '../../api/client';
import { resetSelectedClasses, useSelectedClass } from '../../hooks/useSelectedClass';

vi.mock('../../api/classes', async (importOriginal) => ({
  ...(await importOriginal<typeof classesApi>()),
  listClasses: vi.fn(),
  archiveClasses: vi.fn(),
  unarchiveClasses: vi.fn(),
  renameClass: vi.fn(),
}));

const A = 'Period A Science';
const B = 'Period B Math';

function classList(overrides: Partial<ClassList> = {}): ClassList {
  return {
    live: [
      { id: 'a', name: A, createdAt: '2026-09-01T00:00:00Z', studentCount: 28 },
      { id: 'b', name: B, createdAt: '2026-09-01T00:00:00Z', studentCount: 30 },
    ],
    archived: [],
    ...overrides,
  };
}

function archived(id: string, name: string, archivedAt: string) {
  return { id, name, createdAt: '2023-09-01T00:00:00Z', archivedAt, studentCount: 25 };
}

function moveResult(overrides: Partial<MoveResult> = {}): MoveResult {
  return { live: [], archived: [], renamed: [], ...overrides };
}

beforeEach(() => {
  vi.mocked(classesApi.listClasses).mockResolvedValue(classList());
  resetSelectedClasses();
});
afterEach(() => {
  vi.clearAllMocks();
});

const onChanged = vi.fn();
const onRenamed = vi.fn();

function renderPage() {
  render(
    <MemoryRouter>
      <ClassesView onChanged={onChanged} onRenamed={onRenamed} />
    </MemoryRouter>,
  );
}

const live = () => screen.getByRole('region', { name: 'Current classes' });
const archive = () => screen.getByRole('region', { name: 'Archived classes' });

describe('ClassesView', () => {
  it('lists classes with the counts and dates that tell same-named classes apart', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', A, '2024-02-01T00:00:00Z')] }),
    );
    renderPage();

    // Two classes share a name, which is allowed across time — the dates are
    // what distinguishes them.
    await waitFor(() => {
      expect(screen.getAllByText(A)).toHaveLength(2);
    });
    expect(screen.getByText(/25 students/)).toHaveTextContent('2023');
    // A current class is unique by name, so it carries no dates: the one it had
    // was when the app first saw the class, which read as a start date and was not.
    expect(screen.getByText('28 students')).toBeInTheDocument();
  });

  it('offers no action until something is selected, then exactly one', async () => {
    renderPage();
    await screen.findByText(A);
    expect(screen.queryByRole('button', { name: /^(Archive|Restore)/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Select classes to archive or restore/)).toBeInTheDocument();

    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    expect(screen.getByText('1 class selected')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Archive|Restore)/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Archive 1 class' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument();
  });

  it('archives every class at once from the header checkbox, which is the end-of-semester case', async () => {
    vi.mocked(classesApi.archiveClasses).mockResolvedValue(moveResult());
    renderPage();
    await screen.findByText(A);

    const selectAll = within(live()).getByRole('checkbox', { name: 'Select all current classes' });
    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    // Part of the list selected reads as mixed rather than as unchecked.
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    await userEvent.click(selectAll);
    expect(selectAll).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Archive 2 classes' }));

    await waitFor(() => {
      expect(classesApi.archiveClasses).toHaveBeenCalledWith(['a', 'b']);
    });
    // The Students page stays mounted across its tabs, so it has to be told to
    // reload the roster the archive has just changed.
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('lists archived classes most recently archived first, with no year headings', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({
        archived: [
          archived('x', 'Period X', '2024-02-01T12:00:00Z'),
          archived('y', 'Period Y', '2026-02-01T12:00:00Z'),
          archived('z', 'Period Z', '2024-06-20T12:00:00Z'),
        ],
      }),
    );
    renderPage();
    await screen.findByText('Period Y');

    const names = within(archive())
      .getAllByRole('checkbox', { name: /^Period/ })
      .map((box) => box.closest('label')?.textContent ?? '');
    expect(names.map((n) => n.slice(0, 8))).toEqual(['Period Y', 'Period Z', 'Period X']);
    expect(within(archive()).queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  /**
   * A mixed selection would need two opposite writes against the same tabs and
   * two enabled buttons the teacher has to match back to their own checkboxes.
   */
  it('locks one direction out once the other is chosen', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', 'Period C History', '2024-02-01T00:00:00Z')] }),
    );
    renderPage();
    await screen.findByText(A);

    const aBox = within(live()).getByRole('checkbox', { name: new RegExp(A) });
    const oldBox = within(archive()).getByRole('checkbox', { name: /Period C History/ });
    await userEvent.click(aBox);
    expect(oldBox).toBeDisabled();
    expect(within(archive()).getByRole('checkbox', { name: 'Select all archived classes' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument();

    // And back, so the lock is a consequence of the selection rather than a
    // one-way door.
    await userEvent.click(aBox);
    await userEvent.click(oldBox);
    expect(aBox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore 1 class' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument();
  });

  /**
   * Restoring into a live name is the expected September case rather than a
   * failure, so it is reported as information and the operation still succeeds.
   */
  it('reports a restore rename rather than presenting it as an error', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', A, '2024-02-01T00:00:00Z')] }),
    );
    vi.mocked(classesApi.unarchiveClasses).mockResolvedValue(
      moveResult({ renamed: [{ from: A, to: `${A} (2023)` }] }),
    );
    renderPage();
    await screen.findAllByText(A);

    await userEvent.click(within(archive()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore 1 class' }));

    expect(await screen.findByText(/was restored as/)).toHaveTextContent(`“${A} (2023)”`);
    expect(screen.getByText('Restored 1 class.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an archive rename as an archive, not a restore', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', A, '2024-02-01T00:00:00Z')] }),
    );
    vi.mocked(classesApi.archiveClasses).mockResolvedValue(
      moveResult({ renamed: [{ from: A, to: `${A} (2026)` }] }),
    );
    renderPage();
    await screen.findAllByText(A);

    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive 1 class' }));

    const notice = await screen.findByText(/was archived as/);
    expect(notice).toHaveTextContent(`“${A} (2026)”, because an archived class already has that name.`);
    expect(screen.queryByText(/was restored as/)).not.toBeInTheDocument();
  });

  it('reports a failed move in the alert region', async () => {
    vi.mocked(classesApi.archiveClasses).mockRejectedValue(new Error('offline'));
    renderPage();
    await screen.findByText(A);

    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive 1 class' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Something went wrong/i);
  });

  /**
   * Immediately-regretted archiving is the likeliest mistake, and undo needs no
   * new machinery because undo is unarchive.
   */
  it('offers Undo after archiving, restoring exactly what was archived', async () => {
    vi.mocked(classesApi.archiveClasses).mockResolvedValue(moveResult());
    vi.mocked(classesApi.unarchiveClasses).mockResolvedValue(moveResult());
    renderPage();
    await screen.findByText(A);

    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive 1 class' }));

    expect(await screen.findByText('Archived 1 class.')).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: 'Undo' });
    await userEvent.click(undo);

    await waitFor(() => {
      expect(classesApi.unarchiveClasses).toHaveBeenCalledWith(['a']);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });
  });

  it('warns the teacher to wait, and guards closing the tab, while a move runs', async () => {
    let finish!: (r: MoveResult) => void;
    vi.mocked(classesApi.archiveClasses).mockReturnValue(
      new Promise<MoveResult>((resolve) => {
        finish = resolve;
      }),
    );
    renderPage();
    await screen.findByText(A);

    await userEvent.click(within(live()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive 1 class' }));

    expect(await screen.findByText(/takes a few seconds/i)).toBeInTheDocument();
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    finish(moveResult());
    await waitFor(() => {
      expect(screen.queryByText(/takes a few seconds/i)).not.toBeInTheDocument();
    });
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('reports a failure to load the class list', async () => {
    vi.mocked(classesApi.listClasses).mockRejectedValue(new Error('nope'));
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});

describe('ClassesView rename', () => {
  it('renames a class in place and carries remembered selections across', async () => {
    vi.mocked(classesApi.renameClass).mockResolvedValue(
      classList({
        live: [
          { id: 'a', name: 'Grade 9 Science', createdAt: '2026-09-01T00:00:00Z', studentCount: 28 },
          { id: 'b', name: B, createdAt: '2026-09-01T00:00:00Z', studentCount: 30 },
        ],
      }),
    );
    // The attendance tool has class A selected.
    function Remember() {
      const [, select] = useSelectedClass('attendance', [A, B]);
      return (
        <button type="button" onClick={() => select(A)}>
          remember
        </button>
      );
    }
    const { unmount } = render(<Remember />);
    await userEvent.click(screen.getByRole('button', { name: 'remember' }));
    unmount();

    renderPage();
    await screen.findByText(A);
    await userEvent.click(screen.getByRole('button', { name: `Rename ${A}` }));
    const input = screen.getByRole('textbox', { name: `New name for ${A}` });
    await userEvent.clear(input);
    await userEvent.type(input, 'Grade 9 Science{Enter}');

    await waitFor(() => {
      expect(classesApi.renameClass).toHaveBeenCalledWith('a', 'Grade 9 Science');
    });
    expect(await screen.findByText('Grade 9 Science')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onRenamed).toHaveBeenCalledWith(A, 'Grade 9 Science');
    expect(onChanged).toHaveBeenCalledTimes(1);

    function Read() {
      const [remembered] = useSelectedClass('attendance', ['Grade 9 Science', B]);
      return <output aria-label="remembered">{remembered}</output>;
    }
    render(<Read />);
    expect(screen.getByLabelText('remembered')).toHaveTextContent('Grade 9 Science');
  });

  it('shows a taken name as an error on the row and keeps the edit open', async () => {
    vi.mocked(classesApi.renameClass).mockRejectedValue({
      code: 'CONFLICT',
      message: `You already have a class called “${B}”.`,
      status: 409,
    } satisfies ApiError);
    renderPage();
    await screen.findByText(A);

    await userEvent.click(screen.getByRole('button', { name: `Rename ${A}` }));
    const input = screen.getByRole('textbox', { name: `New name for ${A}` });
    await userEvent.clear(input);
    await userEvent.type(input, B);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`You already have a class called “${B}”.`);
    expect(screen.getByRole('textbox', { name: `New name for ${A}` })).toHaveValue(B);
  });

  it('cancels with Escape without calling the server', async () => {
    renderPage();
    await screen.findByText(A);
    await userEvent.click(screen.getByRole('button', { name: `Rename ${A}` }));
    await userEvent.type(screen.getByRole('textbox', { name: `New name for ${A}` }), 'x{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(classesApi.renameClass).not.toHaveBeenCalled();
  });

  it('renames an archived class too', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', `${A} (2023)`, '2024-02-01T00:00:00Z')] }),
    );
    vi.mocked(classesApi.renameClass).mockResolvedValue(
      classList({ archived: [archived('old', 'Science 2023', '2024-02-01T00:00:00Z')] }),
    );
    renderPage();
    await screen.findByText(`${A} (2023)`);

    await userEvent.click(within(archive()).getByRole('button', { name: `Rename ${A} (2023)` }));
    const input = screen.getByRole('textbox', { name: `New name for ${A} (2023)` });
    await userEvent.clear(input);
    await userEvent.type(input, 'Science 2023{Enter}');

    expect(await within(archive()).findByText('Science 2023')).toBeInTheDocument();
    expect(classesApi.renameClass).toHaveBeenCalledWith('old', 'Science 2023');
    // No tool can have an archived class selected, so there is no filter to move.
    expect(onRenamed).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('drops the restore notice once the restored class has been renamed', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue(
      classList({ archived: [archived('old', A, '2024-02-01T00:00:00Z')] }),
    );
    const restored = classList({
      live: [
        { id: 'a', name: A, createdAt: '2026-09-01T00:00:00Z', studentCount: 28 },
        { id: 'old', name: `${A} (2023)`, createdAt: '2023-09-01T00:00:00Z', studentCount: 25 },
      ],
    });
    vi.mocked(classesApi.unarchiveClasses).mockResolvedValue(
      moveResult({ ...restored, renamed: [{ from: A, to: `${A} (2023)` }] }),
    );
    vi.mocked(classesApi.renameClass).mockResolvedValue(
      classList({
        live: [restored.live[0], { ...restored.live[1], name: 'Science 2023' }],
      }),
    );
    renderPage();
    await screen.findAllByText(A);

    await userEvent.click(within(archive()).getByRole('checkbox', { name: new RegExp(A) }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore 1 class' }));
    await screen.findByText(/was restored as/);

    await userEvent.click(within(live()).getByRole('button', { name: `Rename ${A} (2023)` }));
    const input = screen.getByRole('textbox', { name: `New name for ${A} (2023)` });
    await userEvent.clear(input);
    await userEvent.type(input, 'Science 2023{Enter}');

    expect(await within(live()).findByText('Science 2023')).toBeInTheDocument();
    expect(screen.queryByText(/was restored as/)).not.toBeInTheDocument();
  });
});
