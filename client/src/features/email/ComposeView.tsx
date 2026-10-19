import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Select } from '../../components/ui/Select';
import { isApiError } from '../../api/client';
import { sendEmail, getRecipientMetrics } from '../../api/email';
import { useRoster } from '../students/useRoster';
import { EmailPreview } from './EmailPreview';
import {
  renderBody,
  renderSubject,
  studentPlaceholderValues,
  type AttendanceTotals,
} from './placeholders';
import { applyConditions, type ConditionContext } from './conditions';
import type { Student } from '../students/types';
import type { CopyMode, EmailTemplate, RecipientSelection, SendResult, SendStatus } from './types';

interface ComposeViewProps {
  templates: EmailTemplate[] | null;
  sendStatus: SendStatus | null;
  onSent: () => void;
}

const INPUT_CLASS =
  'h-9 rounded-md border border-subtle bg-base px-3 text-base text-primary placeholder:text-secondary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const GRID = 'grid grid-cols-[minmax(8rem,1.1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-3';
const QUICK_BTN =
  'inline-flex h-8 items-center rounded-md border border-subtle bg-elevated px-2.5 text-sm ' +
  'font-medium text-primary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
// A single quick-select segment. Rounded corners and dividers come from the
// group wrapper, so the segments read as one connected control rather than a
// crowded row of separate pills.
const SEG_GROUP = 'flex divide-x divide-subtle overflow-hidden rounded-md border border-subtle';
const SEG_BTN =
  'inline-flex h-8 items-center bg-elevated px-2.5 text-sm font-medium text-primary ' +
  'hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

interface StatAgg extends AttendanceTotals {
  days: number;
  /** Server-computed against the account's effective high-absence threshold. */
  highAbsence: boolean;
}

/** One selectable recipient: a student in a specific course. */
interface RecipientRow {
  key: string;
  student: Student;
  course: string;
}

/** Which address kinds are checked for a row. */
interface RowSelection {
  student: boolean;
  guardian: boolean;
}

// A newline can't appear in a single-line course-name field, so it is a safe
// separator between the student id and course in a composite key.
const ROW_SEP = '\n';
const makeKey = (id: string, course: string) => `${id}${ROW_SEP}${course}`;
const parseKey = (key: string): { id: string; course: string } => {
  const sep = key.indexOf(ROW_SEP);
  return { id: key.slice(0, sep), course: key.slice(sep + 1) };
};

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function ComposeView({ templates, sendStatus, onSent }: ComposeViewProps) {
  const navigate = useNavigate();
  const { students, loading, error: rosterError, reload } = useRoster();
  const [templateId, setTemplateId] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [selected, setSelected] = useState<Map<string, RowSelection>>(new Map());
  const [copyAddress, setCopyAddress] = useState('');
  const [copyMode, setCopyMode] = useState<CopyMode>('bcc');
  const [previewKey, setPreviewKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statsAgg, setStatsAgg] = useState<Map<string, StatAgg> | null>(null);

  const roster = useMemo(() => students ?? [], [students]);
  const studentById = useMemo(() => new Map(roster.map((s) => [s.id, s])), [roster]);

  // Per-(student, course) attendance figures, for the preview placeholders and
  // the high-absences quick select. Reads the email tool's own ungated endpoint
  // rather than the premium statistics view, since both of those are free-tier.
  // Non-critical: on failure the preview shows 0s.
  useEffect(() => {
    let cancelled = false;
    getRecipientMetrics()
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<string, StatAgg>();
        for (const r of rows) {
          m.set(makeKey(r.studentId, r.course), {
            tardies: r.lateCount,
            absences: r.unexcusedAbsences,
            days: r.daysRecorded,
            highAbsence: r.highAbsence,
          });
        }
        setStatsAgg(m);
      })
      .catch(() => {
        if (!cancelled) setStatsAgg(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const courses = useMemo(
    () => Array.from(new Set(roster.flatMap((s) => s.courses))).sort((a, b) => a.localeCompare(b)),
    [roster],
  );

  // One row per (student, course). A multi-course student appears once per course.
  const rows = useMemo<RecipientRow[]>(() => {
    const out: RecipientRow[] = [];
    for (const s of roster) {
      const enrolled = courseFilter ? s.courses.filter((c) => c === courseFilter) : s.courses;
      for (const course of enrolled) out.push({ key: makeKey(s.id, course), student: s, course });
    }
    return out.sort(
      (a, b) =>
        a.student.lastName.localeCompare(b.student.lastName) || a.course.localeCompare(b.course),
    );
  }, [roster, courseFilter]);

  const template = templates?.find((t) => t.id === templateId) ?? null;

  const clearResult = () => setResult(null);

  function toggleField(key: string, field: keyof RowSelection) {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(key) ?? { student: false, guardian: false };
      const updated = { ...cur, [field]: !cur[field] };
      if (!updated.student && !updated.guardian) next.delete(key);
      else next.set(key, updated);
      return next;
    });
    clearResult();
  }

  function setField(rowsToSet: RecipientRow[], field: keyof RowSelection, has: (s: Student) => boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rowsToSet) {
        if (!has(r.student)) continue;
        const cur = next.get(r.key) ?? { student: false, guardian: false };
        next.set(r.key, { ...cur, [field]: true });
      }
      return next;
    });
    clearResult();
  }

  const selectAllStudents = () => setField(rows, 'student', (s) => Boolean(s.studentEmail));
  const selectAllGuardians = () => setField(rows, 'guardian', (s) => s.parentEmails.length > 0);
  function selectHighAbsences() {
    if (!statsAgg) return;
    // The server computed this with the account's effective threshold, so the
    // selection here agrees with the roster icons and the Statistics flag.
    const flagged = rows.filter((r) => statsAgg.get(r.key)?.highAbsence === true);
    // Absence notices go to both the student and their guardians, where each exists.
    setField(flagged, 'student', (s) => Boolean(s.studentEmail));
    setField(flagged, 'guardian', (s) => s.parentEmails.length > 0);
  }
  function selectAtRisk() {
    // At-risk is per (student, course); `rows` is already course-scoped.
    const flagged = rows.filter((r) => r.student.atRiskCourses.includes(r.course));
    // Academic-risk notices go to both the student and their guardians, where each exists.
    setField(flagged, 'student', (s) => Boolean(s.studentEmail));
    setField(flagged, 'guardian', (s) => s.parentEmails.length > 0);
  }
  function clearSelection() {
    setSelected(new Map());
    clearResult();
  }

  const recipients = useMemo<RecipientSelection[]>(() => {
    const out: RecipientSelection[] = [];
    for (const [key, sel] of selected) {
      const { id, course } = parseKey(key);
      out.push({ studentId: id, course, includeStudent: sel.student, includeParents: sel.guardian });
    }
    return out;
  }, [selected]);

  // Selected rows that resolve to at least one address (drive the preview + counts).
  const sendable = useMemo(() => {
    const out: RecipientRow[] = [];
    for (const [key, sel] of selected) {
      const { id, course } = parseKey(key);
      const s = studentById.get(id);
      if (!s) continue;
      const count = (sel.student && s.studentEmail ? 1 : 0) + (sel.guardian ? s.parentEmails.length : 0);
      if (count > 0) out.push({ key, student: s, course });
    }
    return out.sort(
      (a, b) =>
        a.student.lastName.localeCompare(b.student.lastName) || a.course.localeCompare(b.course),
    );
  }, [selected, studentById]);

  const messageCount = useMemo(() => {
    let n = 0;
    for (const [key, sel] of selected) {
      const s = studentById.get(parseKey(key).id);
      if (!s) continue;
      if (sel.student && s.studentEmail) n += 1;
      if (sel.guardian) n += s.parentEmails.length;
    }
    return n;
  }, [selected, studentById]);

  const remaining = sendStatus?.remaining ?? null;
  const overCap = remaining !== null && messageCount > remaining;
  // The warning names the limit the account is actually up against, and a free
  // account that has spent its month is told when the allowance comes back
  // rather than being shown a bare refusal.
  const monthlyBinds =
    sendStatus?.monthlyCap !== undefined && sendStatus.remainingThisMonth === remaining;
  const overCapMessage = monthlyBinds
    ? `over the ${sendStatus?.remainingThisMonth} remaining in this month's free allowance of ${sendStatus?.monthlyCap}${
        sendStatus?.monthlyResetsAt
          ? `, which resets on ${sendStatus.monthlyResetsAt.slice(0, 10)}`
          : ''
      }.`
    : `over today's remaining ${remaining}.`;
  const copyValid = copyAddress.trim() === '' || isValidEmail(copyAddress.trim());

  const effectivePreviewKey = sendable.some((r) => r.key === previewKey)
    ? previewKey
    : (sendable[0]?.key ?? '');
  const previewRow = sendable.find((r) => r.key === effectivePreviewKey) ?? null;
  const previewValues = previewRow
    ? studentPlaceholderValues(previewRow.student, previewRow.course, statsAgg?.get(previewRow.key))
    : {};
  const previewCtx: ConditionContext | null = previewRow
    ? {
        lateCount: statsAgg?.get(previewRow.key)?.tardies ?? 0,
        unexcusedAbsences: statsAgg?.get(previewRow.key)?.absences ?? 0,
        atRisk: previewRow.student.atRiskCourses.includes(previewRow.course),
      }
    : null;
  const previewSubject = template ? renderSubject(template.subject, previewValues) : '';
  // Drop the blocks this recipient would not receive, then substitute placeholders.
  const previewBody =
    template && previewCtx
      ? renderBody(applyConditions(template.bodyHtml, previewCtx), previewValues)
      : '';

  const canSend =
    template !== null && sendable.length > 0 && !overCap && copyValid && (remaining === null || remaining > 0);

  async function doSend() {
    if (!template) return;
    setSending(true);
    setSendError(null);
    const copy = copyAddress.trim();
    try {
      const res = await sendEmail({
        templateId: template.id,
        recipients,
        ...(copy ? { copyAddress: copy, copyMode } : {}),
      });
      setResult(res);
      setConfirmOpen(false);
      setSelected(new Map());
      onSent();
    } catch (e) {
      setSendError(isApiError(e) ? e.message : 'The send failed. Please try again.');
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  if (loading && students === null) {
    return <LoadingState label="Loading roster…" />;
  }
  if (rosterError && students === null) {
    return (
      <ErrorState
        message={rosterError}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (roster.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-secondary">
        Add students on the Students page before sending email.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      {result && (
        <div role="status" className="rounded-md bg-success-bg px-4 py-3 text-sm text-primary">
          <span className="font-semibold text-success">Sent {result.sent} email(s).</span>{' '}
          {result.skipped.length > 0 && `${result.skipped.length} skipped (no email address). `}
          {result.failed.length > 0 && `${result.failed.length} failed.`}
        </div>
      )}
      {sendError && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {sendError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="ttk-template" className="text-sm text-secondary">
              Template
            </label>
            <Select
              id="ttk-template"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                clearResult();
              }}
            >
              <option value="">Choose a template…</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="ttk-copy" className="text-sm text-secondary">
              Copy every email to (optional)
            </label>
            <div className="flex gap-2">
              <input
                id="ttk-copy"
                type="email"
                className={`${INPUT_CLASS} flex-1`}
                value={copyAddress}
                onChange={(e) => setCopyAddress(e.target.value)}
                placeholder="principal@school.org"
                maxLength={254}
              />
              <Select
                value={copyMode}
                onChange={(e) => setCopyMode(e.target.value as CopyMode)}
                aria-label="Copy mode"
              >
                <option value="bcc">BCC</option>
                <option value="cc">CC</option>
              </Select>
            </div>
            {!copyValid && (
              <p className="text-xs text-danger">Enter a valid email address, or leave this blank.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-secondary">
              Class
              <Select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                aria-label="Filter recipients by class"
              >
                <option value="">All classes</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-secondary">Select</span>
              <div role="group" aria-label="Quick-select recipients" className={SEG_GROUP}>
                <button type="button" className={SEG_BTN} onClick={selectAllStudents} aria-label="Select all students">
                  Students
                </button>
                <button type="button" className={SEG_BTN} onClick={selectAllGuardians} aria-label="Select all guardians">
                  Guardians
                </button>
                <button
                  type="button"
                  className={SEG_BTN}
                  onClick={selectHighAbsences}
                  disabled={statsAgg === null}
                >
                  High absences
                </button>
                <button type="button" className={SEG_BTN} onClick={selectAtRisk}>
                  At risk
                </button>
              </div>
              <button
                type="button"
                className={`${QUICK_BTN} ml-auto`}
                onClick={clearSelection}
                disabled={selected.size === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <RecipientTable
            rows={rows}
            selected={selected}
            onToggle={toggleField}
            onSelectStudent={(id) => navigate(`/students/${id}`)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-secondary">Preview</p>
            <label className="flex items-center gap-2 text-sm text-secondary">
              Preview for
              <Select
                value={effectivePreviewKey}
                disabled={sendable.length === 0}
                onChange={(e) => setPreviewKey(e.target.value)}
                aria-label="Preview for"
              >
                {sendable.length === 0 ? (
                  <option value="">Select a recipient to preview</option>
                ) : (
                  sendable.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.student.firstName} {r.student.lastName} — {r.course}
                    </option>
                  ))
                )}
              </Select>
            </label>
          </div>
          {!template ? (
            <div className="grid h-64 place-items-center rounded-md border border-dashed border-subtle text-sm text-secondary">
              Choose a template to preview it.
            </div>
          ) : previewRow ? (
            <EmailPreview subject={previewSubject} bodyHtml={previewBody} />
          ) : (
            <div className="grid h-64 place-items-center rounded-md border border-dashed border-subtle text-sm text-secondary">
              Select a recipient to preview it with their details.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4">
        <p className="text-sm text-secondary">
          {messageCount} email(s) to send
          {overCap && <span className="text-danger"> — {overCapMessage}</span>}
        </p>
        <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={!canSend}>
          Send
        </Button>
      </div>

      {confirmOpen && template && (
        <Modal
          title="Send email"
          size="confirm"
          onClose={() => (sending ? undefined : setConfirmOpen(false))}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void doSend()} loading={sending}>
                Send {messageCount} email(s)
              </Button>
            </>
          }
        >
          <p className="text-base text-primary">
            Send &ldquo;{template.name}&rdquo; to {messageCount} email address
            {messageCount === 1 ? '' : 'es'}
            {copyAddress.trim() && `, ${copyMode.toUpperCase()} to ${copyAddress.trim()}`}? This
            cannot be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}

interface RecipientTableProps {
  rows: RecipientRow[];
  selected: Map<string, RowSelection>;
  onToggle: (key: string, field: keyof RowSelection) => void;
  onSelectStudent: (studentId: string) => void;
}

function RecipientTable({ rows, selected, onToggle, onSelectStudent }: RecipientTableProps) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-subtle px-3 py-6 text-center text-sm text-secondary">
        No students in this class.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-subtle">
      <div className={`${GRID} border-b border-subtle bg-elevated px-3 py-2 text-xs text-secondary`}>
        <span>Student</span>
        <span>Student email</span>
        <span>Guardian email(s)</span>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {rows.map((r) => {
          const sel = selected.get(r.key) ?? { student: false, guardian: false };
          const { student: s, course } = r;
          const who = `${s.firstName} ${s.lastName} in ${course}`;
          return (
            <li
              key={r.key}
              className={`${GRID} items-start border-b border-subtle bg-surface px-3 py-2 last:border-b-0`}
            >
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectStudent(s.id)}
                  className="block truncate text-left text-base text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {s.firstName} {s.lastName}
                </button>
                <p className="truncate text-xs text-secondary">{course}</p>
              </div>
              <div className="min-w-0">
                {s.studentEmail ? (
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={sel.student}
                      onChange={() => onToggle(r.key, 'student')}
                      aria-label={`Student email for ${who}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-primary" title={s.studentEmail}>
                      {s.studentEmail}
                    </span>
                  </label>
                ) : null}
              </div>
              <div className="min-w-0">
                {s.parentEmails.length > 0 ? (
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={sel.guardian}
                      onChange={() => onToggle(r.key, 'guardian')}
                      aria-label={`Guardian emails for ${who}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      {s.parentEmails.map((email) => (
                        <span key={email} className="truncate text-primary" title={email}>
                          {email}
                        </span>
                      ))}
                    </span>
                  </label>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
