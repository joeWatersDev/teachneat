import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { isApiError } from '../api/client';
import { sendPublicContact, type SupportCategory } from '../api/support';
import { CATEGORY_OPTIONS } from '../features/support/statusCopy';

const SUBJECT_MAX = 120;
const MESSAGE_MAX = 4000;
const NAME_MAX = 120;
const EMAIL_MAX = 254;

/**
 * The signed-out contact form (Phase 2 Step 5).
 *
 * Step 4's form is signed-in only, and this is the deliberate other half rather
 * than a duplicate of it. The person it exists for is specific: a teacher whose
 * school board has blocked the OAuth app cannot sign in at all, so every route
 * to us behind a sign-in wall is closed to exactly the person with the most
 * urgent reason to write. It also serves anyone deciding whether to sign up.
 *
 * It asks for a name and address because, unlike the in-app form, there is no
 * account to take them from. There is no list of past requests here for the
 * same reason: with no session there is nobody to show them to, and building a
 * way to look them up would mean handing out a readable identifier for an
 * anonymous write, which is the thing the endpoint deliberately does not do.
 *
 * A signed-in teacher who lands here is pointed at the in-app form instead,
 * where their message arrives attached to their account.
 */
export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<SupportCategory>('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  /** The honeypot. Never shown to a person, so anything in it came from a bot. */
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    subject.trim().length > 0 &&
    message.trim().length > 0 &&
    !submitting;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    sendPublicContact({
      name: name.trim(),
      email: email.trim(),
      category,
      subject: subject.trim(),
      message: message.trim(),
      website,
    })
      .then(() => {
        setSent(true);
        setSubject('');
        setMessage('');
        setCategory('question');
      })
      .catch((e: unknown) =>
        setError(
          isApiError(e) && e.code === 'RATE_LIMITED'
            ? e.message
            : 'Could not send your message. Please try again.',
        ),
      )
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-semibold text-primary">Contact us</h1>
      <p className="mt-4 text-md text-secondary">
        If you already have an account, use the help and support page inside the app, because your
        message arrives with your account attached.
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Input
          label="Your name"
          required
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Your email address"
          type="email"
          required
          maxLength={EMAIL_MAX}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Where we should reply"
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="contact-category" className="text-sm text-secondary">
            What is this about?
          </label>
          <Select
            id="contact-category"
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
            label="Message"
            required
            rows={8}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {/* The same instruction the in-app form carries, for the same reason:
              a free-text field is the one place a teacher could put student
              information into our database despite the app never doing so. */}
          <p className="text-sm text-secondary">
            Please do not include student names or other student information.
          </p>
          <p className="text-xs text-secondary">
            {message.length} of {MESSAGE_MAX} characters
          </p>
        </div>

        {/* The honeypot: positioned off-screen rather than display:none, since
            some fillers skip fields they can tell are not rendered. It is
            aria-hidden and tabIndex={-1} together, so a screen reader never
            announces it and a keyboard user never lands in it — an aria-hidden
            container with a focusable field inside is the a11y trap this
            pattern usually walks into. A person therefore leaves it empty; an
            automated filler completes every field it finds, and the server
            discards anything that arrives with it set. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="contact-website">Leave this field empty</label>
          <input
            id="contact-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {sent && !error && (
          <p role="status" className="text-sm text-success">
            Your message has been sent. We will reply to the address you gave.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit}>
            Send message
          </Button>
        </div>
      </form>
    </div>
  );
}
