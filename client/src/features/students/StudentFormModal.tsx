import { useState, useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { isApiError } from '../../api/client';
import { updateStudent, type StudentInput } from '../../api/students';
import { PronounsSelect } from './PronounsSelect';
import { getCachedCourses } from './rosterCache';
import type { Student } from './types';

interface StudentFormModalProps {
  student: Student;
  onClose: () => void;
  onSaved: (student: Student) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  goesBy: string;
  pronouns: string;
  courses: string[];
  studentEmail: string;
  parentEmails: string;
  notes: string;
}

function toForm(s: Student): FormState {
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    goesBy: s.goesBy ?? '',
    pronouns: s.pronouns ?? '',
    courses: s.courses,
    studentEmail: s.studentEmail ?? '',
    parentEmails: s.parentEmails.join('\n'),
    notes: s.notes ?? '',
  };
}

/** Empty string in a nullable field means "cleared" -> send null. */
function nullable(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Edits an existing student. Students are added through the grid in
 * `BulkAddStudents`, which serves one student as well as a class list.
 */
export function StudentFormModal({ student, onClose, onSaved }: StudentFormModalProps) {
  const [form, setForm] = useState<FormState>(() => toForm(student));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pronounsId = useId();
  const courses = getCachedCourses();

  const canSubmit =
    form.firstName.trim() !== '' && form.lastName.trim() !== '' && form.courses.length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addCourse(raw: string) {
    const name = raw.trim();
    if (name === '') return;
    setForm((f) => (f.courses.includes(name) ? f : { ...f, courses: [...f.courses, name] }));
  }

  function removeCourse(name: string) {
    setForm((f) => ({ ...f, courses: f.courses.filter((c) => c !== name) }));
  }

  async function handleSave() {
    setError(null);
    const parentEmails = form.parentEmails
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: StudentInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      goesBy: nullable(form.goesBy),
      pronouns: nullable(form.pronouns),
      courses: form.courses,
      studentEmail: nullable(form.studentEmail),
      parentEmails,
      notes: nullable(form.notes),
    };

    setSaving(true);
    try {
      const saved = await updateStudent(student.id, payload);
      onSaved(saved);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save the student. Please try again.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Edit Student"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!canSubmit}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            maxLength={80}
            required
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            maxLength={80}
            required
          />
          <Input
            label="Goes by"
            value={form.goesBy}
            onChange={(e) => set('goesBy', e.target.value)}
            maxLength={80}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={pronounsId} className="text-sm text-secondary">
              Pronouns
            </label>
            <PronounsSelect
              id={pronounsId}
              value={form.pronouns}
              onChange={(v) => set('pronouns', v)}
            />
          </div>
        </div>
        <CoursesEditor
          courses={form.courses}
          suggestions={courses}
          onAdd={addCourse}
          onRemove={removeCourse}
        />
        <Input
          label="Student email"
          type="email"
          value={form.studentEmail}
          onChange={(e) => set('studentEmail', e.target.value)}
          maxLength={254}
        />
        <Textarea
          label="Parent / guardian emails (one per line, up to 5)"
          value={form.parentEmails}
          onChange={(e) => set('parentEmails', e.target.value)}
          rows={3}
        />
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          maxLength={2000}
          rows={3}
        />
        <p className="text-sm text-secondary">* indicates a required field</p>
      </div>
    </Modal>
  );
}

interface CoursesEditorProps {
  courses: string[];
  suggestions: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}

/** Chip list of the student's courses plus a datalist-backed field to add more. */
function CoursesEditor({ courses, suggestions, onAdd, onRemove }: CoursesEditorProps) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  function commit() {
    onAdd(draft);
    setDraft('');
  }

  const available = suggestions.filter((s) => !courses.includes(s));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-secondary">
        Classes
        <span className="text-danger"> *</span>
      </span>
      {courses.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <li
              key={c}
              className="flex items-center gap-1 rounded-full bg-accent-muted px-3 py-1 text-sm text-primary"
            >
              {c}
              <button
                type="button"
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c}`}
                className="grid h-4 w-4 place-items-center rounded-full text-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X size={12} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          list={listId}
          placeholder="Add a class"
          aria-label="Add a class"
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className="h-9 flex-1 rounded-md border border-subtle bg-base px-2 text-base text-primary placeholder:text-secondary focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <datalist id={listId}>
          {available.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Button variant="secondary" onClick={commit} disabled={draft.trim() === ''}>
          Add
        </Button>
      </div>
    </div>
  );
}
