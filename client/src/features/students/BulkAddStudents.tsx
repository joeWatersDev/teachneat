import { useState, useId } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { isApiError } from '../../api/client';
import { createStudentsBatch, type StudentInput } from '../../api/students';
import { PronounsSelect } from './PronounsSelect';
import { getCachedCourses } from './rosterCache';

interface BulkAddStudentsProps {
  onBack: () => void;
  /** Called after at least one student was created, so the roster refetches. */
  onAdded: () => void;
}

type TextField = 'firstName' | 'lastName' | 'course' | 'studentEmail' | 'parentEmail';

interface BulkRow {
  key: number;
  firstName: string;
  lastName: string;
  pronouns: string;
  course: string;
  studentEmail: string;
  parentEmail: string;
  /** Per-cell client validation errors, keyed by field. */
  errors: Partial<Record<TextField, string>>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CELL_CLASS =
  'h-9 w-full rounded-md border bg-base px-2 text-sm text-primary placeholder:text-secondary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

let nextKey = 0;

function emptyRow(): BulkRow {
  nextKey += 1;
  return {
    key: nextKey,
    firstName: '',
    lastName: '',
    pronouns: '',
    course: '',
    studentEmail: '',
    parentEmail: '',
    errors: {},
  };
}

function isEmpty(row: BulkRow): boolean {
  return (
    row.firstName.trim() === '' &&
    row.lastName.trim() === '' &&
    row.pronouns === '' &&
    row.course.trim() === '' &&
    row.studentEmail.trim() === '' &&
    row.parentEmail.trim() === ''
  );
}

function validate(row: BulkRow): Partial<Record<TextField, string>> {
  const errors: Partial<Record<TextField, string>> = {};
  if (row.firstName.trim() === '') errors.firstName = 'Required';
  if (row.lastName.trim() === '') errors.lastName = 'Required';
  if (parseCourses(row.course).length === 0) errors.course = 'Required';
  if (row.studentEmail.trim() !== '' && !EMAIL_RE.test(row.studentEmail.trim())) {
    errors.studentEmail = 'Invalid email';
  }
  if (row.parentEmail.trim() !== '' && !EMAIL_RE.test(row.parentEmail.trim())) {
    errors.parentEmail = 'Invalid email';
  }
  return errors;
}

/**
 * Drops every empty row, then guarantees exactly one trailing blank row —
 * reusing the existing one (same key) when possible so a focused input in the
 * bottom row is not remounted mid-keystroke. Called on row blur (not on every
 * keystroke) so a row the user is still editing never vanishes under them.
 */
function withTrailingBlank(rows: BulkRow[]): BulkRow[] {
  const kept = rows.filter((r) => !isEmpty(r));
  const last = rows[rows.length - 1];
  kept.push(last && isEmpty(last) ? last : emptyRow());
  return kept;
}

/** A course cell holds one or more courses, comma- or pipe-separated. */
function parseCourses(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,|]/)
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  );
}

function toInput(row: BulkRow): StudentInput {
  const studentEmail = row.studentEmail.trim();
  const parentEmail = row.parentEmail.trim();
  return {
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    pronouns: row.pronouns === '' ? null : row.pronouns,
    courses: parseCourses(row.course),
    studentEmail: studentEmail === '' ? null : studentEmail,
    parentEmails: parentEmail === '' ? [] : [parentEmail],
  };
}

/**
 * Full-width bulk entry grid (3d). The trailing empty row is never submitted;
 * a fresh one appears as soon as the last row gains content. Submission sends
 * every row in one `POST /students/batch` (one Sheets append per tab). It is
 * all-or-nothing: on success the grid resets, and on failure nothing is created
 * and the rows are kept for retry.
 */
export function BulkAddStudents({ onBack, onAdded }: BulkAddStudentsProps) {
  const [rows, setRows] = useState<BulkRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const courseListId = useId();
  const courses = getCachedCourses();

  const filledCount = rows.filter((r) => !isEmpty(r)).length;

  function setField(key: number, field: TextField | 'pronouns', value: string) {
    setRows((rs) => {
      const next = rs.map((r) =>
        r.key === key ? { ...r, [field]: value, errors: { ...r.errors, [field]: undefined } } : r,
      );
      // While typing, only keep a blank row available at the bottom; emptied
      // rows are cleaned up when focus leaves them.
      if (!isEmpty(next[next.length - 1])) next.push(emptyRow());
      return next;
    });
  }

  /** Fires when focus leaves a row entirely; drops it (and any other emptied rows). */
  function cleanupEmptyRows() {
    setRows((rs) => withTrailingBlank(rs));
  }

  function removeRow(key: number) {
    setRows((rs) => withTrailingBlank(rs.filter((r) => r.key !== key)));
  }

  async function handleSubmit() {
    setSummary(null);
    const candidates = rows.filter((r) => !isEmpty(r));
    if (candidates.length === 0) return;

    // Client-side pass first: block submission until every non-empty row is clean.
    let hasErrors = false;
    const validated = rows.map((r) => {
      if (isEmpty(r)) return r;
      const errors = validate(r);
      if (Object.keys(errors).length > 0) hasErrors = true;
      return { ...r, errors };
    });
    if (hasErrors) {
      setRows(validated);
      setSummary('Fix the highlighted fields, then submit again.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createStudentsBatch(candidates.map(toInput));
      setRows([emptyRow()]);
      setSummary(`Added ${created.length} student${created.length === 1 ? '' : 's'}.`);
      onAdded();
    } catch (e) {
      // All-or-nothing: nothing was created, so keep every row for retry.
      setSummary(
        `No students were added. ${isApiError(e) ? e.message : 'Could not save these students.'}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back to roster"
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
          >
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
          <h1 className="text-lg font-semibold text-primary">Add Students</h1>
        </div>
        <Button
          variant="primary"
          onClick={() => void handleSubmit()}
          loading={submitting}
          disabled={filledCount === 0}
        >
          {filledCount > 0 ? `Add ${filledCount} Student${filledCount === 1 ? '' : 's'}` : 'Add Students'}
        </Button>
      </div>

      {summary && (
        <p role="status" className="rounded-md bg-elevated px-3 py-2 text-sm text-primary">
          {summary}
        </p>
      )}

      <div className="overflow-x-auto">
        {/* pb-1 keeps the bottom row's 2px focus outline inside the scroll clip. */}
        <div className="min-w-[860px] pb-1">
          <div className="grid grid-cols-[1fr_1fr_minmax(120px,0.8fr)_1fr_1.2fr_1.2fr_36px] gap-2 px-1 pb-2 text-sm text-secondary">
            <span>
              First Name<span aria-hidden="true"> *</span>
            </span>
            <span>
              Last Name<span aria-hidden="true"> *</span>
            </span>
            <span>Pronouns</span>
            <span>
              Classes<span aria-hidden="true"> *</span>
            </span>
            <span>Student Email</span>
            <span>Parent Email</span>
            <span />
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div
                key={row.key}
                onBlur={(e) => {
                  // Only clean up when focus leaves the row, not when moving between its cells.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  cleanupEmptyRows();
                }}
              >
                <div className="grid grid-cols-[1fr_1fr_minmax(120px,0.8fr)_1fr_1.2fr_1.2fr_36px] items-start gap-2 px-1">
                  <Cell
                    row={i}
                    label="First Name"
                    value={row.firstName}
                    error={row.errors.firstName}
                    maxLength={80}
                    onChange={(v) => setField(row.key, 'firstName', v)}
                  />
                  <Cell
                    row={i}
                    label="Last Name"
                    value={row.lastName}
                    error={row.errors.lastName}
                    maxLength={80}
                    onChange={(v) => setField(row.key, 'lastName', v)}
                  />
                  <PronounsSelect
                    aria-label={`Pronouns, row ${i + 1}`}
                    value={row.pronouns}
                    onChange={(v) => setField(row.key, 'pronouns', v)}
                  />
                  <Cell
                    row={i}
                    label="Classes (comma-separated)"
                    title="Separate multiple classes with commas. Existing classes are suggested as you type."
                    value={row.course}
                    error={row.errors.course}
                    maxLength={200}
                    list={courseListId}
                    onChange={(v) => setField(row.key, 'course', v)}
                  />
                  <Cell
                    row={i}
                    label="Student Email"
                    type="email"
                    value={row.studentEmail}
                    error={row.errors.studentEmail}
                    maxLength={254}
                    onChange={(v) => setField(row.key, 'studentEmail', v)}
                  />
                  <Cell
                    row={i}
                    label="Parent Email"
                    type="email"
                    value={row.parentEmail}
                    error={row.errors.parentEmail}
                    maxLength={254}
                    onChange={(v) => setField(row.key, 'parentEmail', v)}
                  />
                  <button
                    type="button"
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => removeRow(row.key)}
                    disabled={submitting || isEmpty(row)}
                    className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <datalist id={courseListId}>
            {courses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <p className="text-sm text-secondary">
        * indicates a required field. Separate multiple classes with commas.
      </p>
    </section>
  );
}

interface CellProps {
  row: number;
  label: string;
  value: string;
  error?: string;
  maxLength: number;
  type?: string;
  list?: string;
  title?: string;
  onChange: (value: string) => void;
}

function Cell({ row, label, value, error, maxLength, type = 'text', list, title, onChange }: CellProps) {
  return (
    <div className="flex flex-col gap-1">
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        list={list}
        title={title}
        aria-label={`${label}, row ${row + 1}`}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${CELL_CLASS} ${error ? 'border-danger' : 'border-subtle'}`}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
