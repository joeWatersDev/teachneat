import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { isApiError } from '../../api/client';
import {
  listConstraints,
  createConstraint,
  deleteConstraint,
} from '../../api/grouping';
import type { Student } from '../students/types';
import type { GroupingConstraint, GroupingConstraintTypeKey } from './types';

interface ConstraintsEditorProps {
  /** Students of the currently-selected course, offered in the picker. */
  students: Student[];
  nameOf: (id: string) => string;
  onClose: () => void;
}

const SELECT_CLASS =
  'h-9 rounded-md border border-subtle bg-base px-2 text-base text-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

const TYPE_LABEL: Record<GroupingConstraintTypeKey, string> = {
  together: 'Keep together',
  apart: 'Keep apart',
};

export function ConstraintsEditor({ students, nameOf, onClose }: ConstraintsEditorProps) {
  const [constraints, setConstraints] = useState<GroupingConstraint[] | null>(null);
  const [type, setType] = useState<GroupingConstraintTypeKey>('together');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setConstraints(await listConstraints());
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Failed to load constraints.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canAdd = selected.size >= 2 && selected.size <= 10 && !busy;

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      await createConstraint({
        constraintTypeKey: type,
        studentIds: Array.from(selected),
      });
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Failed to add the constraint.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteConstraint(id);
      await refresh();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Failed to remove the constraint.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Grouping constraints" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      {error && (
        <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <section className="mb-5">
        <h3 className="mb-2 text-md font-medium text-primary">Add a constraint</h3>
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-secondary">
            Rule
            <select
              className={SELECT_CLASS}
              value={type}
              onChange={(e) => setType(e.target.value as GroupingConstraintTypeKey)}
              aria-label="Constraint type"
            >
              <option value="together">Keep together</option>
              <option value="apart">Keep apart</option>
            </select>
          </label>
          <span className="text-xs text-secondary">{selected.size} selected (choose 2–10)</span>
        </div>

        {students.length === 0 ? (
          <p className="text-sm text-secondary">No students in this class to choose from.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-subtle">
            {students.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 border-b border-subtle px-3 py-1.5 text-base text-primary last:border-b-0 hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-accent"
                />
                {nameOf(s.id)}
              </label>
            ))}
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="primary" onClick={add} disabled={!canAdd} loading={busy}>
            Add constraint
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-md font-medium text-primary">Saved constraints</h3>
        {constraints === null ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">Loading constraints…</span>
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-14 rounded-md" />
          </div>
        ) : constraints.length === 0 ? (
          <p className="text-sm text-secondary">No constraints yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {constraints.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-md border border-subtle bg-elevated px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-primary">
                    {TYPE_LABEL[c.constraintTypeKey]}
                  </p>
                  <p className="text-sm text-secondary">
                    {c.studentIds.map((id) => nameOf(id)).join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Remove constraint"
                  onClick={() => void remove(c.id)}
                  disabled={busy}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-secondary hover:bg-hover hover:text-danger disabled:opacity-40"
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
