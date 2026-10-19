import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { isApiError } from '../../api/client';
import {
  listClasses,
  archiveClasses,
  unarchiveClasses,
  renameClass,
  type ClassList,
  type Rename,
} from '../../api/classes';
import { clearRosterSnapshot } from '../students/rosterCache';
import { renameRememberedClass } from '../../hooks/useSelectedClass';

/**
 * The teacher's classes: archive, restore and rename. The Manage Classes tab of
 * the Students page, at `/students/classes`.
 *
 * Grew out of the Phase 2 Step 6e archive dialog. The two directions stay on
 * one screen rather than an archive flow and a separate restore screen, because
 * they are the same decision seen from two sides and a teacher who has just
 * archived the wrong class needs the way back to be obvious rather than filed
 * elsewhere.
 *
 * Multi-select throughout: the motivating event is end-of-semester turnover,
 * where nearly every class goes at once, which is also why each list's header
 * row carries a select-all checkbox.
 *
 * **One selection bar carries the action.** Checkboxes select; the bar above the
 * lists names what is selected and holds the single primary button, then shows
 * the progress and the result (with Undo) in the same place. Per-list action
 * buttons put two primary buttons on screen for opposite writes, which the
 * dialog's own review had already removed once.
 */

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "1 class" / "2 classes" / "1 student" / "2 students". */
function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word}${word.endsWith('s') ? 'es' : 's'}`;
}

interface Row {
  id: string;
  name: string;
  meta: string;
}

type Busy = null | 'archive' | 'unarchive' | 'rename';

/** What the selection bar reports once a move has finished. */
interface Outcome {
  direction: 'archive' | 'unarchive';
  ids: string[];
}

interface Editing {
  id: string;
  draft: string;
  error: string | null;
}

interface ClassesViewProps {
  /**
   * Called after every successful archive, restore or rename. The Students page
   * stays mounted across its tabs, so without this the Roster tab would show the
   * roster as it was before the change until the teacher left the page.
   */
  onChanged: () => void;
  /**
   * Called after a live class is renamed, before `onChanged`, so the page can
   * move its class filter to the new name before the reloaded roster arrives.
   */
  onRenamed: (from: string, to: string) => void;
}

export function ClassesView({ onChanged, onRenamed }: ClassesViewProps) {
  const [classes, setClasses] = useState<ClassList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<Rename[]>([]);
  // Which move the rename notice is about. Both directions can force a rename:
  // a restore into a current class's name, and an archive into an archived one's.
  const [renamedBy, setRenamedBy] = useState<'archive' | 'unarchive'>('unarchive');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    let cancelled = false;
    listClasses()
      .then((c) => {
        if (!cancelled) setClasses(c);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Your classes could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Asks before the tab is closed or reloaded mid-operation. The server finishes
   * the operation either way, so this protects the teacher's view of the result
   * rather than the data. Moving to another page in the app needs no guard for
   * the same reason.
   */
  useEffect(() => {
    if (busy === null) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  /** A new selection is a new task, so the last result stops being news. */
  function changeSelection(update: (current: Set<string>) => Set<string>) {
    setOutcome(null);
    setActionError(null);
    setSelected((current) => update(new Set(current)));
  }

  function toggle(id: string) {
    changeSelection((next) => {
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(ids: string[], on: boolean) {
    changeSelection((next) => {
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function run(direction: 'archive' | 'unarchive', ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(direction);
    setActionError(null);
    setOutcome(null);
    setRenamed([]);
    try {
      const result =
        direction === 'archive' ? await archiveClasses(ids) : await unarchiveClasses(ids);
      setClasses({ live: result.live, archived: result.archived });
      setRenamed(result.renamed);
      setRenamedBy(direction);
      setOutcome({ direction, ids });
      setSelected(new Set());
      // The roster renders its snapshot before revalidating, which would show
      // the classes as they were until the refetch landed.
      clearRosterSnapshot();
      onChanged();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function saveRename() {
    if (!editing || busy || !classes) return;
    const name = editing.draft.trim();
    const current = [...classes.live, ...classes.archived].find((c) => c.id === editing.id);
    if (!current || name === '') return;
    if (name === current.name) {
      setEditing(null);
      return;
    }
    setBusy('rename');
    try {
      const result = await renameClass(editing.id, name);
      setClasses(result);
      // A restore notice about this class is answered once it has been renamed.
      setRenamed((notices) => notices.filter((r) => r.to !== current.name));
      clearRosterSnapshot();
      // Only a live class is what the other tools have selected.
      if (classes.live.some((c) => c.id === editing.id)) {
        renameRememberedClass(current.name, name);
        onRenamed(current.name, name);
      }
      onChanged();
      setEditing(null);
    } catch (e) {
      // Both CONFLICTs, a taken name and another class operation running, carry
      // a message written for the teacher. Anything else gets the generic line.
      const message = !isApiError(e)
        ? 'The class could not be renamed. Please try again.'
        : e.code === 'CONFLICT'
          ? e.message
          : e.code === 'VALIDATION_ERROR'
            ? 'Class names can be up to 60 characters.'
            : 'The class could not be renamed. Please try again.';
      setEditing((ed) => (ed ? { ...ed, error: message } : ed));
    } finally {
      setBusy(null);
    }
  }

  const liveIds = (classes?.live ?? []).map((c) => c.id);
  const archivedIds = (classes?.archived ?? []).map((c) => c.id);
  const selectedLive = liveIds.filter((id) => selected.has(id));
  const selectedArchived = archivedIds.filter((id) => selected.has(id));

  /**
   * One direction at a time. Selecting in one list locks the other's
   * checkboxes. A mixed selection would have to be resolved into two opposite
   * writes against the same tabs.
   */
  const direction: 'archive' | 'unarchive' | null =
    selectedLive.length > 0 ? 'archive' : selectedArchived.length > 0 ? 'unarchive' : null;

  const rowProps = {
    selected,
    onToggle: toggle,
    editing,
    busy: busy !== null,
    onStartRename: (row: Row) => setEditing({ id: row.id, draft: row.name, error: null }),
    onDraft: (draft: string) => setEditing((ed) => (ed ? { ...ed, draft, error: null } : ed)),
    onSaveRename: () => void saveRename(),
    onCancelRename: () => setEditing(null),
  };

  return (
    <section className="flex flex-col gap-4">
      {loadError && <ErrorState message={loadError} />}
      {!loadError && classes === null && <LoadingState label="Loading classes…" />}

      {classes !== null && (
        <>
          <SelectionBar
            busy={busy}
            direction={direction}
            count={direction === 'unarchive' ? selectedArchived.length : selectedLive.length}
            outcome={outcome}
            onClear={() => changeSelection(() => new Set())}
            onRun={() =>
              direction && void run(direction, direction === 'archive' ? selectedLive : selectedArchived)
            }
            onUndo={() => outcome && void run('unarchive', outcome.ids)}
          />

          {actionError && (
            <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              {actionError}
            </p>
          )}

          {/* Warning treatment, not the neutral status style: a class landing
              under a name the teacher did not choose is a surprise worth
              noticing, even though it is the expected case rather than a
              failure. */}
          {renamed.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-primary"
            >
              <AlertTriangle
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
              <span className="flex flex-col gap-1">
                {renamed.map((r) => (
                  <span key={r.to}>
                    {renamedBy === 'unarchive'
                      ? `“${r.from}” was restored as “${r.to}”, because a current class already has that name.`
                      : `“${r.from}” was archived as “${r.to}”, because an archived class already has that name.`}{' '}
                    You can rename it with its pencil button.
                  </span>
                ))}
              </span>
            </div>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <ClassSection
              heading="Current classes"
              ids={liveIds}
              selectedCount={selectedLive.length}
              locked={busy !== null || direction === 'unarchive'}
              onSelectAll={(on) => setAll(liveIds, on)}
              empty="No current classes. A class appears here once it has students."
            >
              <ClassRows
                rows={classes.live.map((c) => ({
                  id: c.id,
                  name: c.name,
                  meta: plural(c.studentCount, 'student'),
                }))}
                locked={busy !== null || direction === 'unarchive'}
                {...rowProps}
              />
            </ClassSection>

            <ClassSection
              heading="Archived classes"
              ids={archivedIds}
              selectedCount={selectedArchived.length}
              locked={busy !== null || direction === 'archive'}
              onSelectAll={(on) => setAll(archivedIds, on)}
              empty="Classes you archive appear here."
            >
              <ClassRows
                rows={newestArchivedFirst(classes.archived).map((c) => ({
                  id: c.id,
                  name: c.name,
                  // Both dates, because an archived class may share its name
                  // with a current one (reusing a name each year is the normal
                  // case), and the dates say which term it was.
                  meta: `${plural(c.studentCount, 'student')} · ${formatDate(c.createdAt)} to ${formatDate(c.archivedAt)}`,
                }))}
                locked={busy !== null || direction === 'archive'}
                {...rowProps}
              />

            </ClassSection>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The single place the page's primary action lives, and the place its feedback
 * appears. Sticky under the top bar so the action stays in reach while scrolling
 * a long archived list.
 */
function SelectionBar({
  busy,
  direction,
  count,
  outcome,
  onClear,
  onRun,
  onUndo,
}: {
  busy: Busy;
  direction: 'archive' | 'unarchive' | null;
  count: number;
  outcome: Outcome | null;
  onClear: () => void;
  onRun: () => void;
  onUndo: () => void;
}) {
  let message: ReactNode;
  let actions: ReactNode = null;

  if (busy === 'archive' || busy === 'unarchive') {
    message = `${busy === 'archive' ? 'Archiving' : 'Restoring'} your classes. This takes a few seconds.`;
    actions = (
      <Button variant="primary" loading disabled>
        {busy === 'archive' ? 'Archive' : 'Restore'}
      </Button>
    );
  } else if (direction !== null) {
    const verb = direction === 'archive' ? 'Archive' : 'Restore';
    message = (
      <>
        {plural(count, 'class')} selected
        {direction === 'archive' && (
          <span className="text-secondary">
            {' '}
            · Students who are also in a current class stay on your roster
          </span>
        )}
      </>
    );
    actions = (
      <>
        <Button variant="secondary" onClick={onClear} disabled={busy !== null}>
          Clear
        </Button>
        <Button variant="primary" onClick={onRun} disabled={busy !== null}>
          {verb} {plural(count, 'class')}
        </Button>
      </>
    );
  } else if (outcome) {
    message = `${outcome.direction === 'archive' ? 'Archived' : 'Restored'} ${plural(outcome.ids.length, 'class')}.`;
    if (outcome.direction === 'archive') {
      actions = (
        <Button variant="secondary" onClick={onUndo}>
          Undo
        </Button>
      );
    }
  } else {
    message = <span className="text-secondary">Select classes to archive or restore them.</span>;
  }

  return (
    <div
      role="status"
      className="sticky top-16 z-10 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border border-subtle bg-elevated px-4 py-2 text-sm text-primary"
    >
      <p className="min-w-0">{message}</p>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Most recently archived first, so the term just finished is at the top. Not
 * grouped under year headings: every row already carries its dates, and the
 * headings repeated them.
 */
function newestArchivedFirst(archived: ClassList['archived']): ClassList['archived'] {
  return [...archived].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

/** A bordered list with a header row, following the app's table/list spec. */
function ClassSection({
  heading,
  ids,
  selectedCount,
  locked,
  onSelectAll,
  empty,
  children,
}: {
  heading: string;
  ids: string[];
  selectedCount: number;
  locked: boolean;
  onSelectAll: (on: boolean) => void;
  empty: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLInputElement>(null);
  const all = ids.length > 0 && selectedCount === ids.length;
  const some = selectedCount > 0 && !all;

  // `indeterminate` is a DOM property with no attribute, so it is set directly.
  useEffect(() => {
    if (box.current) box.current.indeterminate = some;
  }, [some]);

  return (
    <section aria-label={heading} className="overflow-hidden rounded-lg border border-subtle">
      <div className="flex min-h-12 items-center gap-3 border-b border-subtle bg-elevated px-4">
        {ids.length > 0 && (
          <input
            ref={box}
            type="checkbox"
            checked={all}
            onChange={() => onSelectAll(!all)}
            disabled={locked}
            aria-label={`Select all ${heading.toLowerCase()}`}
            className="shrink-0 accent-accent disabled:opacity-50"
          />
        )}
        <h2 className="text-sm font-semibold text-primary">{heading}</h2>
        <span className="ml-auto text-sm text-secondary">{ids.length}</span>
      </div>
      {ids.length === 0 ? (
        <p className="bg-surface px-4 py-8 text-center text-sm text-secondary">{empty}</p>
      ) : (
        <ul>{children}</ul>
      )}
    </section>
  );
}

function ClassRows({
  rows,
  selected,
  onToggle,
  locked,
  busy,
  editing,
  onStartRename,
  onDraft,
  onSaveRename,
  onCancelRename,
}: {
  rows: Row[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** The selection is locked for this list. Renaming stays available. */
  locked: boolean;
  busy: boolean;
  editing: Editing | null;
  onStartRename: (row: Row) => void;
  onDraft: (draft: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
}) {
  return (
    <>
      {rows.map((row) => {
        const isSelected = selected.has(row.id);
        return (
          <li
            key={row.id}
            className={`border-b border-subtle last:border-b-0 ${isSelected ? 'bg-accent-muted' : 'bg-surface'}`}
          >
            {editing?.id === row.id ? (
              <form
                className="flex flex-col gap-2 px-4 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSaveRename();
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={editing.draft}
                    onChange={(e) => onDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') onCancelRename();
                    }}
                    maxLength={60}
                    autoFocus
                    aria-label={`New name for ${row.name}`}
                    aria-invalid={editing.error !== null}
                    className="h-9 min-w-0 flex-1 rounded-md border border-subtle bg-base px-3 text-base text-primary focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancelRename}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={busy || editing.draft.trim() === ''}
                  >
                    Save
                  </Button>
                </div>
                {editing.error && (
                  <p role="alert" className="text-sm text-danger">
                    {editing.error}
                  </p>
                )}
              </form>
            ) : (
              <div
                className={`flex min-h-12 items-center gap-2 pr-2 ${isSelected ? '' : 'hover:bg-hover'}`}
              >
                <label
                  className={`flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 pl-4 ${locked ? '' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(row.id)}
                    disabled={locked}
                    className="shrink-0 accent-accent disabled:opacity-50"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="break-words text-base text-primary">{row.name}</span>
                    <span className="text-sm text-secondary">{row.meta}</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => onStartRename(row)}
                  disabled={busy || editing !== null}
                  aria-label={`Rename ${row.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                >
                  <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </>
  );
}
