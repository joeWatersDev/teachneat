import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Lockup } from '../../components/ui/Wordmark';
import { useAuth } from '../../hooks/useAuth';
import { acceptConsent } from '../../api/auth';
import { DOCUMENT_VERSION, EFFECTIVE_DATE } from '../../pages/legal/legalMeta';

/**
 * The agreements a teacher must accept before the app will do anything for them
 * (Phase 2 Step 5c).
 *
 * A gate, not a redirect, and that is the difference from `RequireOnboarding`.
 * The first-run guide may be skipped because nothing turns on having read it;
 * this may not, because the server refuses every tool router until consent is on
 * file. Rendering the shell here would produce an app where every panel loads
 * into an error, so the shell is not rendered at all.
 *
 * It sits above the entitlements provider in the tree for the same reason: that
 * provider's own fetch is one of the requests the server refuses.
 *
 * Nothing here is the security boundary. `requireConsent` on the server is, and
 * it re-reads the account on every request — this screen exists so that a
 * teacher meets the agreements rather than a wall of `CONSENT_REQUIRED`.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.needsConsent) return <ConsentScreen />;
  return <>{children}</>;
}

function ConsentScreen() {
  const { profile, refresh, signOut } = useAuth();
  const [terms, setTerms] = useState(false);
  const [responsibility, setResponsibility] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bothChecked = terms && responsibility;

  /**
   * Deliberately does *not* clear the flag locally on failure, which is the
   * opposite of how the first-run guide handles its write. There the question
   * was whether the teacher had read a page, and the local answer was the true
   * one. Here the server is the only thing that can decide, and it will keep
   * refusing: pretending the write landed would drop the teacher into an app
   * where every request fails, with no way back to this screen.
   */
  async function submit() {
    if (!bothChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptConsent(profile?.termsVersion ?? '');
      await refresh();
    } catch {
      setError('That could not be saved. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface px-6 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        {/* The consent screen renders outside the app shell, so nothing else on
            it carries the product name — the lockup rather than the mark. */}
        <Lockup className="self-start" />

        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-primary">Before you start</h1>
          <p className="text-sm leading-relaxed text-secondary">
            Two things to agree to. They apply to every class you set up here, and you only need to
            do this once.
          </p>
        </div>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* The linked agreement. Both documents open in a new tab rather than
              navigating, because leaving this screen would lose the boxes
              already ticked. */}
          <label className="flex cursor-pointer gap-3 rounded-lg border border-subtle p-4 hover:bg-hover">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-1 shrink-0 accent-accent"
            />
            <span className="text-sm leading-relaxed text-primary">
              I have read and agree to the{' '}
              <Link
                to="/terms"
                target="_blank"
                rel="noreferrer"
                className="underline hover:no-underline"
              >
                Terms of Service
              </Link>{' '}
              and the{' '}
              <Link
                to="/privacy"
                target="_blank"
                rel="noreferrer"
                className="underline hover:no-underline"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          {/* The one that matters most for this product, and the reason it is a
              separate box rather than a clause inside the one above: a teacher
              should have to tick this specifically, and the record should show
              that they did. Its full text is here rather than behind a link,
              so it is agreed by reading rather than by reference, which is a
              materially stronger record than acceptance of a linked document.
              The wording matches
              DATA_RESPONSIBILITY_ACKNOWLEDGEMENT on the server, which is the
              authoritative copy; change one and you must change both, and bump
              the terms version. */}
          <label className="flex cursor-pointer gap-3 rounded-lg border border-subtle p-4 hover:bg-hover">
            <input
              type="checkbox"
              checked={responsibility}
              onChange={(e) => setResponsibility(e.target.checked)}
              className="mt-1 shrink-0 accent-accent"
            />
            <span className="text-sm leading-relaxed text-primary">
              I understand that student information I enter is stored in my own Google account, that
              I remain responsible for it, and that complying with the privacy laws, records
              regulations, and school board or district policies that apply to me is my
              responsibility, not Teachneat’s.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button type="submit" variant="primary" disabled={!bothChecked} loading={submitting}>
              Agree and continue
            </Button>
            {/* Declining has to lead somewhere. Signing out is the honest exit:
                the account and the spreadsheet are left exactly as they are, and
                nothing is deleted on the way past. */}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void signOut()}
              className="text-sm text-primary underline hover:no-underline disabled:opacity-60"
            >
              Sign out instead
            </button>
          </div>
        </form>

        {/* The version is on screen because it is what gets recorded. A consent
            row naming a version the teacher was never shown is a weaker record
            than one they could read at the time they agreed. */}
        <p className="border-t border-subtle pt-5 text-xs leading-relaxed text-secondary">
          You are agreeing to version {DOCUMENT_VERSION} of these documents, effective{' '}
          {EFFECTIVE_DATE}. Questions about any of this? Ask through the{' '}
          <Link to="/contact" target="_blank" rel="noreferrer" className="underline hover:no-underline">
            contact form
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
