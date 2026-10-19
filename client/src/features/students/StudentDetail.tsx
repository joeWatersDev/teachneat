import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mail, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Select } from '../../components/ui/Select';
import { PremiumBadge } from '../../components/ui/Premium';
import { isApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useEntitlements } from '../../hooks/useEntitlements';
import { getStudentDetail, deleteStudent, setAtRisk } from '../../api/students';
import type { Student } from './types';
import { StudentFormModal } from './StudentFormModal';
import { AttendanceSummary } from './AttendanceSummary';
import { AttendanceHeatmap } from './AttendanceHeatmap';

interface StudentDetailProps {
  studentId: string;
  onBack: () => void;
  onChanged: () => void;
  /** Reports the student's at-risk courses, to sync the roster warning indicator. */
  onAtRiskChanged: (atRiskCourses: string[]) => void;
}

export function StudentDetail({
  studentId,
  onBack,
  onChanged,
  onAtRiskChanged,
}: StudentDetailProps) {
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Which class the attendance panel is scoped to (multi-course students only).
  const [attendanceCourse, setAttendanceCourse] = useState<string | null>(null);
  // The course whose academic-risk toggle is mid-flight, and any toggle error.
  const [atRiskBusy, setAtRiskBusy] = useState<string | null>(null);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);
  const { profile } = useAuth();
  const { isPremium } = useEntitlements();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { student: s } = await getStudentDetail(studentId);
      setStudent(s);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not load this student.');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAtRisk(course: string, next: boolean) {
    if (!student) return;
    const previous = student.atRiskCourses;
    const optimistic = next
      ? Array.from(new Set([...previous, course]))
      : previous.filter((c) => c !== course);
    setAtRiskBusy(course);
    setAtRiskError(null);
    // Optimistic: flip immediately and sync the roster indicator.
    setStudent((s) => (s ? { ...s, atRiskCourses: optimistic } : s));
    onAtRiskChanged(optimistic);
    try {
      await setAtRisk(studentId, course, next);
    } catch (e) {
      setStudent((s) => (s ? { ...s, atRiskCourses: previous } : s));
      onAtRiskChanged(previous);
      setAtRiskError(isApiError(e) ? e.message : 'Could not update the risk flag.');
    } finally {
      setAtRiskBusy(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteStudent(studentId);
      onChanged();
      onBack();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not delete this student.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading student…" />;
  }
  if (error || !student) {
    return (
      <ErrorState
        message={error ?? 'Student not found.'}
        action={
          <Button variant="secondary" onClick={onBack}>
            Back to roster
          </Button>
        }
      />
    );
  }

  const contactAddresses = student.studentEmail
    ? [student.studentEmail, ...student.parentEmails]
    : student.parentEmails;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Back to roster"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
        >
          <ArrowLeft size={20} strokeWidth={1.75} />
        </button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} strokeWidth={2} />
            Edit
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} strokeWidth={2} />
            Delete
          </Button>
        </div>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-primary">
          {student.firstName} {student.lastName}
          {student.goesBy ? <span className="text-secondary"> ({student.goesBy})</span> : null}
        </h1>
        <p className="mt-1 text-sm text-secondary">
          {[student.pronouns, student.courses.join(', ') || null].filter(Boolean).join(' · ')}
        </p>
      </header>

      <Card title="Contact">
        <Field label="Student email" value={student.studentEmail} />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Parent / guardian emails</span>
          {student.parentEmails.length === 0 ? (
            <span className="text-base text-disabled">None</span>
          ) : (
            student.parentEmails.map((e) => (
              <span key={e} className="text-base text-primary">
                {e}
              </span>
            ))
          )}
        </div>
        {contactAddresses.length > 0 && profile && (
          <a
            href={gmailHistoryUrl(profile.email, contactAddresses)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Mail size={14} strokeWidth={2} />
            View communication history
          </a>
        )}
      </Card>

      <Card title="Notes">
        {student.notes ? (
          <p className="whitespace-pre-wrap text-base text-primary">{student.notes}</p>
        ) : (
          <p className="text-base text-disabled">No notes yet.</p>
        )}
      </Card>

      {(() => {
        const sortedCourses = [...student.courses].sort((a, b) => a.localeCompare(b));
        const selectedCourse =
          attendanceCourse && sortedCourses.includes(attendanceCourse)
            ? attendanceCourse
            : sortedCourses[0];
        const coursePicker =
          sortedCourses.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-secondary">
              Class
              <Select
                value={selectedCourse}
                onChange={(e) => setAttendanceCourse(e.target.value)}
                aria-label="Attendance class"
              >
                {sortedCourses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
          ) : undefined;
        return (
          <Card title="Attendance" action={coursePicker}>
            {/* History first: it is the record of what happened, and the totals
                are read off it. Side by side where there is room, since the two
                are read together; stacked below xl, where a column would squeeze
                the heatmap into too few weeks to be worth showing. */}
            <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="flex min-w-0 flex-col gap-3">
                <h3 className="text-sm font-semibold text-secondary">History</h3>
                <AttendanceHeatmap studentId={studentId} course={selectedCourse} />
              </section>
              <section className="flex min-w-0 flex-col gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-secondary">
                  Statistics
                  <PremiumBadge />
                </h3>
                <AttendanceSummary
                  studentId={studentId}
                  course={selectedCourse}
                  locked={!isPremium}
                />
              </section>
            </div>
          </Card>
        );
      })()}

      <Card title="Academic Risk">
        {atRiskError && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {atRiskError}
          </p>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {student.courses.map((course) => (
            <label key={course} className="flex items-center gap-2 text-base text-primary">
              <input
                type="checkbox"
                checked={student.atRiskCourses.includes(course)}
                disabled={atRiskBusy === course}
                onChange={(e) => void toggleAtRisk(course, e.target.checked)}
                aria-label={`Academic risk for ${course}`}
              />
              {course}
            </label>
          ))}
        </div>
      </Card>

      {editing && (
        <StudentFormModal
          student={student}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setStudent(updated);
            setEditing(false);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Delete Student"
          size="confirm"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} loading={deleting}>
                Delete Student
              </Button>
            </>
          }
        >
          <p className="text-base text-primary">
            This will remove {student.firstName} {student.lastName} from the roster along with
            their attendance records.
          </p>
        </Modal>
      )}
    </section>
  );
}

/**
 * Gmail search deep link for every message to/from any of the given addresses,
 * scoped to the teacher's own mailbox. Built client-side from addresses already
 * on the page; the query lives in the URL fragment, which the browser never
 * sends to a server.
 *
 * The account is selected with the `authuser=<email>` query parameter, which
 * Gmail resolves to the matching signed-in account (so it opens the right one
 * when several Google accounts are signed in). Gmail's `/mail/u/<n>/` path
 * segment only accepts a numeric index, not an email, so the email cannot go
 * there. The email is left literal here (verified working): a Google account
 * address contains no query-delimiter characters (`&`, `=`, `#`).
 */
function gmailHistoryUrl(teacherEmail: string, addresses: string[]): string {
  const query = addresses
    .map((addr) => `(from:${addr} OR to:${addr} OR cc:${addr})`)
    .join(' OR ');
  return `https://mail.google.com/mail/?authuser=${teacherEmail}#search/${encodeURIComponent(query)}`;
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-elevated p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-md font-medium text-primary">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-secondary">{label}</span>
      <span className={value ? 'text-base text-primary' : 'text-base text-disabled'}>
        {value ?? 'None'}
      </span>
    </div>
  );
}
