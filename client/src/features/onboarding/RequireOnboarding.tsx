import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * Sends an account that has not finished the first-run guide to it (Phase 2
 * Step 5a).
 *
 * A redirect rather than a gate. `/welcome` stays reachable afterwards from the
 * account menu, so this may only ever move a teacher toward the page — it must
 * never be the thing that decides whether the page is allowed to render, or
 * re-opening it would bounce straight back out.
 *
 * `replace`, so the tool URL a teacher deep-linked to does not sit in history
 * waiting for the back button to return them to a redirect that fires again.
 *
 * It holds no state of its own, deliberately. The obvious hazard here is a
 * loop: leaving the guide records completion on the server, and if that write
 * fails the flag would still be set and this would drag the teacher back to the
 * page they just finished. That is solved at the source instead — the guide
 * clears the flag on the profile itself through `markOnboarded`, whether or not
 * the write lands — so there is nothing for this component to remember.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();

  if (profile?.needsOnboarding && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}
