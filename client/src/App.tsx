import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import { AuthGate, AuthProvider } from './hooks/useAuth';
import { AccountEntitlementsProvider } from './hooks/useEntitlements';
import { UpgradeProvider } from './hooks/useUpgrade';
import { AppShell } from './layouts/AppShell';
import { MarketingLayout } from './layouts/MarketingLayout';
import { LoadingState } from './components/ui/LoadingState';
import { AuthError } from './pages/AuthError';
import { LandingPage } from './pages/LandingPage';
import { PricingPage } from './pages/PricingPage';
import { PUBLIC_BILLING_VISIBLE } from './config/publicBilling';
import { FaqPage } from './pages/FaqPage';
import { ContactPage } from './pages/ContactPage';
import { PrivacyPage, TermsPage } from './pages/LegalPage';
import { ForAdminsPage } from './pages/ForAdminsPage';
import { YourDataPage } from './pages/YourDataPage';
import { WelcomePage } from './features/onboarding/WelcomePage';
import { RequireOnboarding } from './features/onboarding/RequireOnboarding';
import { ConsentGate } from './features/consent/ConsentGate';
import { StudentsPage } from './features/students/StudentsPage';
import { AttendancePage } from './features/attendance/AttendancePage';
import { GroupingPage } from './features/grouping/GroupingPage';
import { NamePickerPage } from './features/name-picker/NamePickerPage';
import { SupportPage } from './features/support/SupportPage';
import { HelpPage } from './features/help/HelpPage';
import { AccountSettingsPage } from './features/account/AccountSettingsPage';

// Operator-only, reached from the account menu and never linked otherwise. Code-split
// so the triage view costs nothing to the teachers who will never open it.
const SupportAdminPage = lazy(() =>
  import('./features/support/SupportAdminPage').then((m) => ({ default: m.SupportAdminPage })),
);
const MetricsAdminPage = lazy(() =>
  import('./features/support/MetricsAdminPage').then((m) => ({ default: m.MetricsAdminPage })),
);

// The email tool pulls in the rich-text editor (TipTap/ProseMirror). It is not
// the landing page, so it is code-split to keep the common path lean.
const EmailPage = lazy(() =>
  import('./features/email/EmailPage').then((m) => ({ default: m.EmailPage })),
);

/**
 * The app's landing path is the Students page. A redirect rather than the page
 * itself, so the page has one address per tab, and the query string is carried
 * so an instruction like `?add=bulk` still arrives.
 */
function ToStudents() {
  const { search } = useLocation();
  return <Navigate to={`/students${search}`} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/error" element={<AuthError />} />

          {/* The public surface (Phase 2 Step 5). Outside AuthProvider on
              purpose: a visitor deciding whether to sign up should not pay for
              an /auth/me round trip before the page renders, and a teacher
              whose board has blocked the app has no session to look up. */}
          {/* Gated since the launch went free (`PUBLIC_BILLING_VISIBLE`). The
              route stays mounted as a redirect rather than being dropped, so a
              link someone already has, or a search result, lands on the landing
              page instead of falling through to the app shell and being sent
              through Google's account chooser. */}
          {PUBLIC_BILLING_VISIBLE ? (
            <Route path="/pricing" element={<MarketingLayout><PricingPage /></MarketingLayout>} />
          ) : (
            <Route path="/pricing" element={<Navigate to="/" replace />} />
          )}
          {/* `probeSession` on exactly the pages the Help hub links to (Step
              6f). A signed-in teacher reaches these from inside the app, so the
              header asks whether there is a session and offers a way back
              instead of a "Sign in" button that would send them through Google's
              account chooser. The landing and pricing pages below do not ask,
              which keeps Step 5's property where it was aimed: a visitor
              deciding whether to sign up pays for no round trip. */}
          <Route path="/faq" element={<MarketingLayout probeSession><FaqPage /></MarketingLayout>} />
          <Route path="/contact" element={<MarketingLayout probeSession><ContactPage /></MarketingLayout>} />
          <Route path="/privacy" element={<MarketingLayout probeSession><PrivacyPage /></MarketingLayout>} />
          <Route path="/terms" element={<MarketingLayout probeSession><TermsPage /></MarketingLayout>} />
          {/* Public for a reason particular to it (Step 5a): its reader is the
              Workspace admin of a teacher who could not sign in, so a page about
              being blocked from signing in must not require signing in. */}
          <Route path="/for-admins" element={<MarketingLayout><ForAdminsPage /></MarketingLayout>} />
          {/* Public for the same reason as /for-admins, and one of its own: the
              readers who most need instructions for removing this app's access
              and deleting their account are the ones who cannot sign in to read
              them — a teacher whose board has blocked the app, and one who has
              already revoked access. Google's reviewer is a third. */}
          <Route path="/help/your-data" element={<MarketingLayout probeSession><YourDataPage /></MarketingLayout>} />

          <Route
            path="/*"
            element={
              <AuthProvider>
                {/* Signed out, the app's own routes render the landing page
                    rather than bouncing to Google. A deep link into a tool
                    therefore lands somewhere readable with a way in, instead of
                    on a consent screen the visitor did not ask for. */}
                <AuthGate
                  signedOut={
                    <MarketingLayout>
                      <LandingPage />
                    </MarketingLayout>
                  }
                >
                  {/* In front of everything, unlike the first-run guide below
                      (Step 5c). The server refuses every tool router until the
                      terms and the data-responsibility acknowledgement are
                      accepted, so there is no version of the shell worth
                      rendering here — including the entitlements provider it
                      wraps, whose own fetch is one of the refused calls. */}
                  <ConsentGate>
                    <AccountEntitlementsProvider>
                      <UpgradeProvider>
                        {/* Inside the shell, not in front of it: the first-run
                            guide is a page of the app rather than a wall before
                            it, so the sidebar and account menu stay usable while
                            it is open. */}
                        <RequireOnboarding>
                          <AppShell />
                        </RequireOnboarding>
                      </UpgradeProvider>
                    </AccountEntitlementsProvider>
                  </ConsentGate>
                </AuthGate>
              </AuthProvider>
            }
          >
            <Route index element={<ToStudents />} />
            <Route path="welcome" element={<WelcomePage />} />
            {/* The two tabs are static routes, so they outrank the student id
                beside them. The bare path redirects to the last tab used. */}
            <Route path="students" element={<StudentsPage />} />
            <Route path="students/roster" element={<StudentsPage />} />
            <Route path="students/classes" element={<StudentsPage />} />
            <Route path="students/:studentId" element={<StudentsPage />} />
            {/* Where Manage Classes lived before it became a tab. */}
            <Route path="classes" element={<Navigate to="/students/classes" replace />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="attendance/:tab" element={<AttendancePage />} />
            <Route path="grouping" element={<GroupingPage />} />
            <Route path="name-picker" element={<NamePickerPage />} />
            <Route
              path="email"
              element={
                <Suspense fallback={<LoadingState label="Loading email…" />}>
                  <EmailPage />
                </Suspense>
              }
            />
            <Route
              path="email/:tab"
              element={
                <Suspense fallback={<LoadingState label="Loading email…" />}>
                  <EmailPage />
                </Suspense>
              }
            />
            <Route path="help" element={<HelpPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="account" element={<AccountSettingsPage />} />
            <Route
              path="admin/support"
              element={
                <Suspense fallback={<LoadingState label="Loading support…" />}>
                  <SupportAdminPage />
                </Suspense>
              }
            />
            <Route
              path="admin/metrics"
              element={
                <Suspense fallback={<LoadingState label="Loading metrics…" />}>
                  <MetricsAdminPage />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
