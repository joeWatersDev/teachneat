import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PUBLIC_BILLING_VISIBLE } from '../config/publicBilling';

/**
 * The public FAQ (Phase 2 Step 5), split out of the pricing page.
 *
 * These are the questions support will predictably receive, answered before
 * they have to be asked. Two of them exist because of how this product reaches
 * teachers rather than because of what it does: a school board can block the
 * app before a teacher ever sees it, and a teacher who cannot sign in has no
 * way to ask us about it from inside the product. Both point at the public
 * contact form.
 */

interface Question {
  q: string;
  a: ReactNode;
}

const QUESTIONS: Question[] = [
  {
    q: 'Why do I need to sign up with Google?',
    a: (
      <>
        Because that is what lets your class list stay yours. When you sign up, Teachneat
        creates a Google Sheet on your own Drive and keeps everything there: your students, their
        contact details, attendance and notes. We keep your account details and no lasting copy
        of anything about your students. Signing in with Google is how the app reaches
        that sheet on your behalf, and you can withdraw its access from your Google account whenever
        you like.
      </>
    ),
  },
  {
    q: 'What happens to my data if I want to leave?',
    a: (
      <>
        Nothing is lost. Your students, attendance and notes are in an ordinary Google Sheet on your
        own Drive, and closing your account here does not touch it. Open the sheet, download it as a
        spreadsheet, or share it with a colleague, without involving us at all.
      </>
    ),
  },
  {
    q: 'My school board blocks new apps. Can I still use it?',
    a: (
      <>
        Your board’s administrator has to allow the app before you can sign in, which is a decision
        they make rather than one we can make for you. Use the{' '}
        <Link to="/contact" className="text-primary underline hover:no-underline">
          contact form
        </Link>{' '}
        and we can send what a board privacy review usually asks for.
      </>
    ),
  },
  {
    // Kept when the pricing page was gated, at the user's instruction. It is the
    // question every teacher arrives with, and with no pricing page left to send
    // them to this is the only place the product answers it.
    q: 'What does it cost?',
    a: (
      <>
        Nothing while Teachneat is in early access. There is no paid plan and no payment card, and
        every account has every feature. If a paid plan is introduced later it will be announced
        well in advance, and no account will be charged without agreeing to it first.
      </>
    ),
  },
  {
    q: 'I teach several classes. Does that work?',
    a: (
      <>
        Yes, and a student can be in more than one of them. Attendance, grouping, the name picker
        and email are all scoped to one class at a time, while a student keeps a single record for
        their contact details and notes.
      </>
    ),
  },
  {
    q: 'Can I close my account?',
    a: (
      <>
        Yes, from the account settings page inside the app. Closing it removes your account with us
        and revokes the app’s access to your Google account. The spreadsheet stays on your Drive,
        untouched, and remains yours to keep or delete.
      </>
    ),
  },
  {
    q: 'Who sees the emails I send?',
    a: (
      <>
        Only the people you choose. Messages are sent from your own address through Gmail, so
        replies come back to you, and a record of what was sent stays in your spreadsheet.
      </>
    ),
  },
];

export function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-display-md font-semibold text-balance text-primary">Common questions</h1>
      <p className="mt-4 text-md leading-relaxed text-secondary">
        If your question is not answered here,{' '}
        <Link to="/contact" className="text-primary underline hover:no-underline">
          reach out to us
        </Link>
        .
      </p>

      <dl className="mt-10 flex flex-col">
        {QUESTIONS.map((item) => (
          <div key={item.q} className="flex flex-col gap-2 border-t border-subtle py-5">
            <dt className="font-semibold text-primary">{item.q}</dt>
            <dd className="m-0 text-sm leading-relaxed text-secondary">{item.a}</dd>
          </div>
        ))}
      </dl>

      {PUBLIC_BILLING_VISIBLE && (
        <p className="mt-8 text-sm text-secondary">
          Looking for what an account includes?{' '}
          <Link to="/pricing" className="text-primary underline hover:no-underline">
            See pricing
          </Link>
          .
        </p>
      )}
    </div>
  );
}
