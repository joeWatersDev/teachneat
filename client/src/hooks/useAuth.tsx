import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getMe, logout as logoutApi, SIGNIN_URL, type AuthProfile } from '../api/auth';
import { isApiError, onAuthLost, setCsrfToken } from '../api/client';
import { ErrorState } from '../components/ui/ErrorState';
import { Button } from '../components/ui/Button';

/**
 * `unauthenticated` is "never got in". Until Step 5 this meant an immediate
 * redirect to Google, because the app had no page of its own to show a visitor.
 * It now has one: an unauthenticated visitor gets the landing page, which is
 * both the right answer for someone deciding whether to sign up and the only
 * possible answer for a teacher whose school board has blocked the OAuth app,
 * for whom bouncing to Google produces an error screen and nothing else.
 *
 * `sessionEnded` is "was in, no longer" (signed out here or in another tab,
 * expired, revoked), which is a different situation: they were mid-task, so it
 * keeps its explicit screen with a way back in rather than dropping them onto
 * marketing copy.
 */
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'sessionEnded';

interface AuthContextValue {
  status: AuthStatus;
  profile: AuthProfile | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  /** Re-reads the profile, so a plan change takes effect without a reload. */
  refresh: () => Promise<void>;
  /**
   * Clears `needsOnboarding` locally once the teacher has finished the first-run
   * guide, without waiting on — or depending on — the server write that records
   * it (Phase 2 Step 5a).
   *
   * It exists so that leaving the guide is decided by what the teacher did
   * rather than by whether a bookkeeping call succeeded. Without it, a failed
   * write leaves the profile still saying the guide is outstanding, and the
   * redirect that acts on that flag would drag them back to the page they just
   * finished. The cost of the write failing is then only that the guide is
   * offered again on the next load, which is the right price.
   */
  markOnboarded: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Override the redirect mechanism in tests. */
  redirectTo?: (url: string) => void;
  /** Override the /auth/me call in tests. */
  fetchProfile?: () => Promise<AuthProfile>;
}

export function AuthProvider({
  children,
  redirectTo = (url) => {
    window.location.assign(url);
  },
  fetchProfile = getMe,
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  /**
   * The current status, readable from the `onAuthLost` listener, which is
   * registered once and would otherwise close over the first render's value.
   */
  const statusRef = useRef<AuthStatus>(status);
  statusRef.current = status;

  /**
   * Guards the cleanup below against running twice: parallel requests can each
   * 401 and notify, and the logout it fires could itself notify again. Cleared
   * when a session is next established.
   */
  const clearingStaleSession = useRef(false);

  // Any 401 from any tool ends the session here, once, so every tool shows the
  // same thing instead of each rendering its own "Not signed in" error.
  useEffect(
    () =>
      onAuthLost(() => {
        setCsrfToken(null);
        setProfile(null);
        if (statusRef.current !== 'authenticated') return;
        setStatus('sessionEnded');
        /**
         * **End the session on the server too, best effort.** Without this the
         * cookie survives the screen below, and one specific failure loops
         * forever: `/auth/me` reads only our own session row, so an account
         * whose Google refresh token has died — revoked, or a local build
         * pointing at a different OAuth client — gets 200 there and
         * `REAUTH_REQUIRED` from the first tool request. Every reload then
         * repeats the sequence and lands back here, and the only exits were
         * signing in again or clearing cookies by hand. Destroying the session
         * makes the next `/auth/me` a 401, which is `unauthenticated`, which is
         * the landing page.
         *
         * It ends this session only, not the account's others, which is what
         * `POST /auth/logout` does and why it rather than `DELETE
         * /auth/sessions` is the call here: a dead Google token is not a reason
         * to sign a teacher out of their other devices.
         *
         * The CSRF token is already gone — `api/client` clears it before it
         * notifies — so this POST is rejected once and replayed by the client's
         * own stale-token retry. Two round trips on a path taken once per dead
         * session is cheaper than holding the token somewhere to avoid them.
         */
        if (clearingStaleSession.current) return;
        clearingStaleSession.current = true;
        void logoutApi().catch(() => undefined);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (cancelled) return;
        // Arm the API client before anything can issue a mutation.
        setCsrfToken(p.csrfToken ?? null);
        setProfile(p);
        clearingStaleSession.current = false;
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCsrfToken(null);
        // 401 / REAUTH_REQUIRED → unauthenticated.
        // Any other error: still flag as unauthenticated so the auth gate can decide.
        if (isApiError(err) && (err.status === 401 || err.code === 'REAUTH_REQUIRED')) {
          setStatus('unauthenticated');
          return;
        }
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  // A page restored from the back/forward cache never re-runs the load above,
  // so a session that ended while the page was away would otherwise still look
  // signed in. Re-check on restore, and when the tab is brought back to the
  // front, which is also when a sign-out in another tab surfaces.
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return;
      fetchProfile()
        .then((p) => {
          setCsrfToken(p.csrfToken ?? null);
          setProfile(p);
          setStatus('authenticated');
        })
        .catch(() => {
          // The 401 path already ends the session via onAuthLost; anything else
          // (offline, server down) leaves the current state alone.
        });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) revalidate();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [fetchProfile]);

  const signIn = useCallback(() => {
    redirectTo(SIGNIN_URL);
  }, [redirectTo]);

  const signOut = useCallback(async () => {
    try {
      await logoutApi();
    } finally {
      setCsrfToken(null);
      setProfile(null);
      // 'unauthenticated', not 'sessionEnded': signing out on purpose is not the
      // same as losing a session mid-task, and the right landing spot for it is
      // the home page, not an error screen. This was 'sessionEnded' only because
      // before Step 5 'unauthenticated' meant an immediate bounce to Google,
      // which — with consent already granted — would have signed the teacher
      // straight back in. With a landing page supplied there is no such bounce.
      setStatus('unauthenticated');
    }
  }, []);

  const refresh = useCallback(async () => {
    const p = await fetchProfile();
    setCsrfToken(p.csrfToken ?? null);
    setProfile(p);
    setStatus('authenticated');
  }, [fetchProfile]);

  const markOnboarded = useCallback(() => {
    setProfile((current) => (current ? { ...current, needsOnboarding: false } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, profile, signIn, signOut, refresh, markOnboarded }),
    [status, profile, signIn, signOut, refresh, markOnboarded],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/**
 * Renders children only when authenticated. A first visit with no session gets
 * `signedOut` (the landing page, supplied by the caller); a session that ends
 * mid-use gets an explicit screen instead. Either way the app shell is not
 * rendered without a session, so no stale account menu or half-working tool is
 * reachable.
 *
 * `signedOut` is a prop rather than an import so this hook file does not depend
 * on a page, and so tests can gate on something trivial.
 */
export function AuthGate({
  children,
  signedOut,
}: {
  children: ReactNode;
  signedOut?: ReactNode;
}) {
  const { status, signIn } = useAuth();

  // Only when there is nothing to show instead. With a landing page supplied,
  // redirecting would replace a page the visitor can read and act on with a
  // consent screen they did not ask for, and would strand anyone whose domain
  // blocks the app on a Google error.
  useEffect(() => {
    if (status === 'unauthenticated' && !signedOut) {
      signIn();
    }
  }, [status, signIn, signedOut]);

  if (status === 'sessionEnded') {
    return (
      <div className="grid min-h-screen place-items-center bg-surface px-6">
        <ErrorState
          message="You are not signed in. Your session ended, either here or in another tab."
          action={
            <div className="flex flex-col items-center gap-3">
              <Button variant="primary" onClick={signIn}>
                Sign in with Google
              </Button>
              {/* The second way out, and the reason this screen is not a dead
                  end. It was one button on a page with no header, no footer and
                  no route to the FAQ, the contact form or `/for-admins`, all of
                  which `/auth/error` offers — a teacher whose board has since
                  blocked the app has nothing to do here but press a button that
                  will fail.

                  A plain anchor rather than a `Link`, deliberately. This
                  component is what renders at `/`, so a client-side navigation
                  there re-renders this same screen and looks broken; a full load
                  re-runs `/auth/me`, which is now a 401 because the session was
                  destroyed above, which is the landing page. An anchor also
                  keeps this file free of a router dependency, as the `signedOut`
                  prop does. */}
              <a href="/" className="text-sm text-primary underline hover:no-underline">
                Back to the home page
              </a>
            </div>
          }
        />
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <span className="text-secondary">Loading…</span>
      </div>
    );
  }
  if (status === 'unauthenticated') {
    if (signedOut) return <>{signedOut}</>;
    // No landing page supplied, so the effect above is mid-redirect.
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <span className="text-secondary">Redirecting to sign in…</span>
      </div>
    );
  }
  return <>{children}</>;
}
