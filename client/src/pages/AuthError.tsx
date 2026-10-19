import { Link, useSearchParams } from 'react-router-dom';
import { SIGNIN_URL } from '../api/auth';

/**
 * Where a sign-in that did not complete lands.
 *
 * Phase 2 Step 5a split the failures apart. Until then every one of them showed
 * "Try again", which is right for a transient fault and actively misleading for
 * the case this product hits most: a school board that blocks unconfigured
 * third-party apps. That teacher can press Try again all afternoon and be
 * blocked every time, because the thing that has to change is a setting in
 * someone else's Admin console. So a blocked sign-in gets its own explanation,
 * its own next step, and no retry button offering a fix that does not exist.
 */

interface FailureCopy {
  title: string;
  message: string;
  /** Whether retrying could plausibly work. False suppresses the retry button. */
  retryable: boolean;
}

const FAILURES: Record<string, FailureCopy> = {
  ADMIN_POLICY_BLOCKED: {
    title: 'Your school’s Google account settings are blocking this app',
    message:
      'Google would not let you grant access, because your school or board restricts which third-party apps staff can use. This is not something you can change from your account, and trying again will give the same result.',
    retryable: false,
  },
  CONSENT_DECLINED: {
    title: 'Sign-in was cancelled',
    message:
      'You did not grant the permissions the app asked for, so no account was created and nothing was changed. If you cancelled by accident, you can start again.',
    retryable: true,
  },
  SCOPES_MISSING: {
    title: 'Teachneat needs both permissions to work',
    message:
      'Teachneat needs access to the Google Drive files it creates, where your class data is kept, and permission to send email as you from the Email tool. When you try again, leave both boxes ticked on the Google screen.',
    retryable: true,
  },
  OAUTH_ERROR: {
    title: 'Google could not complete the sign-in',
    message:
      'Google returned an error instead of signing you in. This is usually temporary and clears up on a retry.',
    retryable: true,
  },
  VALIDATION_ERROR: {
    title: 'Sign-in failed',
    message:
      'Sign-in could not be completed because the request was missing or invalid information. This usually clears up on a retry.',
    retryable: true,
  },
  REAUTH_REQUIRED: {
    title: 'Sign-in failed',
    message: 'Your Google session has expired. Sign in again to continue.',
    retryable: true,
  },
  INTERNAL_ERROR: {
    title: 'Sign-in failed',
    message:
      'Sign-in failed unexpectedly. If this keeps happening, revoke the app in your Google Account settings and try again.',
    retryable: true,
  },
};

export function AuthError() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? 'INTERNAL_ERROR';
  // `hasOwn` rather than `FAILURES[code] ?? …`: the query string is caller
  // controlled, and `?code=__proto__` (or `constructor`, or `toString`) reaches
  // an inherited property, which is truthy, so the `??` never fires and the card
  // renders with no title and no message. Nothing escapes and nothing executes,
  // but the page a failed sign-in lands on should not have an input that blanks
  // it.
  const failure = Object.hasOwn(FAILURES, code) ? FAILURES[code] : FAILURES.INTERNAL_ERROR;
  const blocked = code === 'ADMIN_POLICY_BLOCKED';

  return (
    <div className="grid min-h-screen place-items-center bg-base px-6 py-10">
      <div
        className={
          'w-full rounded-lg border border-subtle bg-elevated p-6 ' +
          (blocked ? 'max-w-xl' : 'max-w-md')
        }
      >
        <h1 className="text-lg font-semibold text-primary">{failure.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">{failure.message}</p>

        {/* The blocked case is the only one with a real next step, and it is not
            a button — it is a conversation with the person who administers the
            domain. Naming that person, and handing over a page written for
            them, is the whole of what this screen can usefully do. */}
        {blocked && (
          <div className="mt-5 flex flex-col gap-3">
            <h2 className="text-base font-semibold text-primary">What to do next</h2>
            <p className="text-sm leading-relaxed text-secondary">
              Ask whoever manages Google Workspace for your school or board (usually IT services)
              to allow this app. It takes them a couple of minutes, and it does not install anything
              for anyone else — it only lets teachers who ask for it sign in.
            </p>
            <p className="text-sm leading-relaxed text-secondary">
              Send them this page. It has the data-handling summary, the permissions the app asks
              for and why, and the exact setting to change.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/for-admins"
                className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                Information for administrators
              </Link>
              <Link
                to="/contact"
                className="inline-flex h-9 items-center rounded-md border border-subtle bg-elevated px-4 text-sm font-semibold text-primary hover:bg-hover"
              >
                Ask us for help
              </Link>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-disabled">Error code: {code}</p>

        {failure.retryable && (
          <a
            href={SIGNIN_URL}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            Try again
          </a>
        )}
        {!failure.retryable && (
          <p className="mt-4 text-sm text-secondary">
            <Link to="/" className="text-primary underline hover:no-underline">
              Back to the home page
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
