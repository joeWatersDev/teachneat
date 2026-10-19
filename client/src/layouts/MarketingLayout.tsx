import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Lockup, Wordmark } from '../components/ui/Wordmark';
import { getMe, SIGNIN_URL } from '../api/auth';
import { PUBLIC_BILLING_VISIBLE } from '../config/publicBilling';

/**
 * The frame around every page a signed-out visitor sees (Phase 2 Step 5).
 *
 * Deliberately not the app shell. `AppShell` is a fixed top bar plus a sidebar
 * of the five tools, which is the right frame for someone working and the wrong
 * one for someone deciding: there is no roster to navigate and no account to
 * show. This is an ordinary scrolling document with a header and a footer, and
 * it never renders inside `AuthProvider`, so a public page costs no `/auth/me`
 * call and renders without waiting on one.
 *
 * The theme toggle is here as well as in the app because the theme is app-wide
 * and stored in localStorage: a visitor who prefers dark and then signs in
 * should not watch the product change appearance at the moment they commit.
 *
 * **`probeSession` is the exception to "no /auth/me on a public page", and it is
 * scoped rather than global (Phase 2 Step 6f).** Several of these pages are now
 * linked from inside the app — the Help hub points at the FAQ, the privacy
 * policy, the terms and the data documentation — so a signed-in teacher lands
 * here regularly and is shown a "Sign in" button, which sends someone who is
 * already signed in back through Google's account chooser. The header cannot
 * know better on its own, because this layout deliberately renders outside
 * `AuthProvider`.
 *
 * So the pages a teacher reaches from inside the app ask, and the pages a
 * stranger reaches first do not. The landing page keeps the original property
 * exactly: a visitor deciding whether to sign up pays for no round trip.
 * The probe never blocks rendering — the header shows "Sign in" until it
 * resolves, which is the right answer for the majority of readers and for every
 * reader if the call fails.
 */

/**
 * Pricing is dropped from the nav and the footer while the launch is free
 * (`PUBLIC_BILLING_VISIBLE`). A nav entry is a promise that the page answers a
 * question the reader has, and a "Pricing" link that opens a page saying there
 * is no price raises the subject rather than settling it.
 */
const NAV = [
  ...(PUBLIC_BILLING_VISIBLE ? [{ to: '/pricing', label: 'Pricing' }] : []),
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact' },
];

/**
 * `/for-admins` is in the footer but not the header. Its reader is a school IT
 * administrator, who is neither the visitor the header is designed for nor
 * someone who browses to it — they arrive from a link a blocked teacher sent
 * them. A footer entry gives it a permanent, findable home without spending a
 * slot in the main nav on an audience of one per school.
 */
const FOOTER_LINKS = [
  ...NAV,
  { to: '/for-admins', label: 'For school administrators' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
];

export function MarketingLayout({
  children,
  probeSession = false,
}: {
  children: ReactNode;
  /** Ask whether the reader is signed in, and offer them a way back if so. */
  probeSession?: boolean;
}) {
  const { mode, toggle } = useTheme();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!probeSession) return;
    let cancelled = false;
    // Only ever sets `true`. A failure — no session, offline, server down —
    // leaves the header on "Sign in", which is the safe default: offering a way
    // back into an app the reader cannot enter would be the worse error.
    getMe()
      .then(() => {
        if (!cancelled) setSignedIn(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [probeSession]);

  return (
    <div className="flex min-h-screen flex-col bg-base">
      {/* `px-4` at every width, not `px-4 sm:px-6` like the bands below it.
          The app's top bar is `px-4` flat, so a marketing header that stepped
          out to 24px put the lockup in a different place from where the same
          lockup sits once you sign in, and the shift was visible on the
          transition. The header matches the app; the page content keeps its own
          wider gutter. */}
      <header
        role="banner"
        className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-subtle px-4"
      >
        <Link to="/" className="flex items-center">
          <Lockup />
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'hidden rounded-md px-3 py-2 text-base transition-colors duration-100 hover:bg-hover sm:block ' +
                (isActive ? 'text-primary' : 'text-secondary hover:text-primary')
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={mode === 'dark'}
            onClick={toggle}
            className="grid h-9 w-9 place-items-center rounded-full text-secondary transition-colors duration-100 hover:bg-hover hover:text-primary"
          >
            {mode === 'dark' ? (
              <Sun size={20} strokeWidth={1.75} />
            ) : (
              <Moon size={20} strokeWidth={1.75} />
            )}
          </button>
          {signedIn ? (
            // A plain in-app route, not a full navigation: the app is a
            // single-page app and this is a link back into it.
            <Link
              to="/"
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-subtle bg-elevated px-4 text-base font-semibold text-primary transition-colors duration-100 hover:bg-hover"
            >
              Back to the app
            </Link>
          ) : (
            <SignInButton variant="secondary">Sign in</SignInButton>
          )}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-subtle px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* The wordmark rather than the mark: a mark down here would be
              decoration beside a line of body copy. `plain` for the same
              reason — inside a sentence at 12px the weight split reads as
              emphasis rather than as a mark. */}
          <p className="text-xs text-secondary">
            <Wordmark className="text-xs" plain />. Made by a fellow teacher :)
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="text-xs text-secondary hover:text-primary">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * An anchor, not a button with an onClick. Sign-in is a full navigation to the
 * server's OAuth route, so an anchor gets middle-click, open-in-new-tab and a
 * visible target for free.
 *
 * `variant` and `size` rather than a className passthrough: appending
 * `bg-transparent` to a string that already holds `bg-accent` would leave which
 * one wins to CSS source order rather than to the caller. `lg` is the 48px
 * marketing size, which is deliberately larger than the app's 36px button
 * (DESIGN_SYSTEM, "The Public Shell") — at hero scale a 36px control reads as
 * part of a form rather than as an invitation.
 */
export function SignInButton({
  children,
  variant = 'primary',
  size = 'md',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'lg';
}) {
  return (
    <a
      href={SIGNIN_URL}
      className={
        'inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors duration-100 ' +
        (size === 'lg' ? 'h-12 rounded-lg px-7 text-md ' : 'h-9 rounded-md px-4 text-base ') +
        (variant === 'primary'
          ? 'bg-accent text-on-accent hover:bg-accent-hover'
          : 'border border-subtle bg-elevated text-primary hover:bg-hover')
      }
    >
      {children}
    </a>
  );
}
