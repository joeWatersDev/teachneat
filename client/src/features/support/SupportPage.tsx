import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { isApiError } from '../../api/client';
import {
  createSupportRequest,
  listMySupportRequests,
  type SupportCategory,
  type SupportRequest,
} from '../../api/support';
import { CATEGORY_OPTIONS, formatSubmitted, STATUS_CLASSES, STATUS_LABELS } from './statusCopy';

const SUBJECT_MAX = 120;
const MESSAGE_MAX = 4000;

/**
 * Contact / support (Phase 2 Step 4). The form is signed-in only, so it asks for
 * nothing the account already knows — no name, no email address, no plan. What
 * is left is the three things only the teacher can supply.
 *
 * Below it, the teacher's own past requests with their current status, because a
 * form that swallows a message and says "thanks" is indistinguishable from one
 * that dropped it.
 */
export function SupportPage() {
  const [category, setCategory] = useState<SupportCategory>('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Nothing is set synchronously here: the state writes all happen once the
  // request settles, so calling this from an effect does not cascade a render.
  const load = useCallback(() => {
    listMySupportRequests()
      .then((page) => {
        setRequests(page.requests);
        setTruncated(page.truncated);
        setListError(null);
      })
      .catch((e: unknown) =>
        setListError(isApiError(e) ? e.message : 'Could not load your past requests.'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !submitting;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    createSupportRequest({ category, subject: subject.trim(), message: message.trim() })
      .then(() => {
        setSent(true);
        setSubject('');
        setMessage('');
        setCategory('question');
        load();
      })
      .catch((e: unknown) =>
        setSubmitError(isApiError(e) ? e.message : 'Could not send your request. Please try again.'),
      )
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Help and support" />

      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="support-category" className="text-sm text-secondary">
            What is this about?
          </label>
          <Select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportCategory)}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="Subject"
          required
          maxLength={SUBJECT_MAX}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A one-line summary"
        />

        <div className="flex flex-col gap-1">
          <Textarea
            label="Details"
            required
            rows={8}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What happened, and what you expected instead."
          />
          {/* The one place in the app where a teacher could type student
              information into our database. The app is built so student data
              never leaves their own Google Sheet, so the form says so rather
              than relying on the teacher to infer it. */}
          <p className="text-sm text-secondary">
            Please do not include student names or other student information. Describe the class or
            the situation instead.
          </p>
          <p className="text-xs text-secondary">
            {message.length} of {MESSAGE_MAX} characters
          </p>
        </div>

        {submitError && <p className="text-sm text-danger">{submitError}</p>}
        {sent && !submitError && (
          <p role="status" className="text-sm text-success">
            Your request has been sent. It will appear below, and we will reply to your account
            email.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit}>
            Send request
          </Button>
        </div>
      </form>

      <section className="flex max-w-2xl flex-col gap-3">
        <h2 className="text-md font-semibold text-primary">Your past requests</h2>
        {listError && <ErrorState message={listError} action={<Button onClick={load}>Retry</Button>} />}
        {!listError && requests === null && <LoadingState label="Loading your requests…" />}
        {!listError && requests !== null && requests.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-secondary">
            <LifeBuoy size={16} strokeWidth={1.75} aria-hidden="true" />
            You have not sent any support requests yet.
          </p>
        )}
        {!listError &&
          requests?.map((r) => (
            <article
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border border-subtle bg-elevated p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-primary">{r.subject}</h3>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASSES[r.status]}`}
                >
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-xs text-secondary">Sent {formatSubmitted(r.createdAt)}</p>
              <p className="whitespace-pre-wrap text-sm text-secondary">{r.message}</p>
            </article>
          ))}
        {truncated && (
          <p className="text-xs text-secondary">
            Showing your most recent requests only. Older ones are not listed here.
          </p>
        )}
      </section>
    </div>
  );
}
