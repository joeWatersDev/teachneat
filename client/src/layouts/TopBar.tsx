import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Compass,
  FlaskConical,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  Star,
  Sun,
  UserCog,
  Wrench,
  ChartNoAxesColumn,
} from 'lucide-react';
import { Lockup } from '../components/ui/Wordmark';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { cyclePlan, runLifecycleSweep, setTrialEnd, type Plan } from '../api/auth';
import { useUpgrade } from '../hooks/useUpgrade';

interface TopBarProps {
  onToggleSidebar: () => void;
}

/**
 * The override cycle the development-only toggle walks, mirrored from the
 * server's `routes/internal.ts` so the menu item can say what the next press
 * does. `null` is "no override — use the account's real plan".
 *
 * It steps on the *stored override*, not on the resolved plan: with a real
 * subscription behind it, a forced `trial` and a cleared override can resolve to
 * the same plan, so a label derived from the plan would be wrong half the time.
 */
const OVERRIDE_CYCLE: (Plan | null)[] = [null, 'free', 'trial', 'paid'];

function describeOverride(value: Plan | null): string {
  return value === null ? 'real plan' : value;
}

function nextOverride(current: Plan | null): Plan | null {
  const i = OVERRIDE_CYCLE.indexOf(current ?? null);
  return OVERRIDE_CYCLE[(i + 1) % OVERRIDE_CYCLE.length] ?? null;
}

/**
 * The three trial positions the development-only control walks (Step 6h), in the
 * order the trial-to-free moment is actually tested: inside the warning window,
 * past the end, then back to a fresh trial.
 *
 * A cycle rather than a date picker, matching the plan toggle beside it: these
 * are the only three dates that mean anything, and the point of both controls is
 * to reach a state without leaving the page.
 *
 * `TRIAL_ENDING_LEAD_DAYS` on the server is 5, so 4 sits inside the window and
 * queues the warning on the next sweep. -1 puts the end in the past, which
 * queues the ended notice and drops the account to `free`.
 */
const TRIAL_CYCLE: { days: number; label: string }[] = [
  { days: 4, label: 'ending in 4 days' },
  { days: -1, label: 'ended yesterday' },
  { days: 30, label: 'a fresh 30 days' },
];

export function TopBar({ onToggleSidebar }: TopBarProps) {
  const { mode, toggle } = useTheme();
  const { profile, signOut, refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cycling, setCycling] = useState(false);
  // Which trial position the next press moves to, and the last sweep's counts.
  // Local rather than server state: the position is only a label, and the counts
  // are a one-off report on a pass that has already happened.
  const [trialStep, setTrialStep] = useState(0);
  const [trialBusy, setTrialBusy] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const { openUpgrade } = useUpgrade();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header
      role="banner"
      className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between border-b border-subtle bg-base px-4"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onToggleSidebar}
          className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary md:hidden"
        >
          <Menu size={20} strokeWidth={1.75} />
        </button>
        <Lockup />
      </div>

      <div className="flex items-center gap-1">
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
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-elevated text-secondary transition-colors duration-100 hover:bg-hover hover:text-primary"
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden="true">·</span>
            )}
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-50 w-60 rounded-lg border border-subtle bg-elevated p-2 shadow-none"
            >
              <div className="px-3 py-2">
                <div className="truncate text-sm text-primary">{profile?.name}</div>
                <div className="truncate text-xs text-secondary">{profile?.email}</div>
              </div>
              <div className="my-1 h-px bg-subtle" aria-hidden="true" />
              {/* Upgrade is offered on `trial` as well as `free`: the account
                  menu is somewhere a teacher goes deliberately, so it is not the
                  interruption that an upgrade prompt on a live gated control
                  would be. "Manage billing" replaces it once a Stripe customer
                  exists — which a lapsed `free` account still has, along with
                  invoices and a card worth managing. */}
              {profile?.billingEnabled && profile.plan !== 'paid' && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openUpgrade();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
                >
                  <Star size={14} strokeWidth={2} className="fill-accent text-accent" aria-hidden="true" />
                  Upgrade to Premium
                </button>
              )}
              {/* Billing moved to Account settings in Step 6f. It belongs with
                  the other things you do to an account rather than to a class,
                  and the menu had reached the size where every item was one
                  more thing to read past. */}
              <Link
                to="/account"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
              >
                <UserCog size={14} strokeWidth={2} aria-hidden="true" />
                Account settings
              </Link>
              {/* The first-run guide, offered until the teacher has a student
                  and not after (Step 6f). It used to be permanent, on the
                  reasoning that someone who skipped it on day one wants it in
                  week two — true, but it kept a beginner's affordance in front
                  of every teacher forever. `hasStudents` rather than
                  `needsOnboarding` is the condition, because skipping the guide
                  completes onboarding without adding anyone, and that teacher is
                  exactly the one who should still be offered it. */}
              {profile?.hasStudents === false && (
                <Link
                  to="/welcome"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
                >
                  <Compass size={14} strokeWidth={2} aria-hidden="true" />
                  Getting started
                </Link>
              )}
              {/* Help lives in the account menu rather than the sidebar: the
                  sidebar is the five tools, and adding an item that is not a
                  tool would blur what that list means. It now leads to a page
                  with the documentation and the contact form on it rather than
                  straight to the form, because not every question needs to
                  become a support ticket. */}
              <Link
                to="/help"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
              >
                <LifeBuoy size={14} strokeWidth={2} aria-hidden="true" />
                Help and support
              </Link>
              {/* Operator only. The triage endpoints answer 404 for everyone
                  else, so this link leads nowhere useful if the flag is forged. */}
              {profile?.supportAdmin && (
                <Link
                  to="/admin/support"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
                >
                  <Wrench size={14} strokeWidth={2} aria-hidden="true" />
                  Support triage
                </Link>
              )}
              {profile?.supportAdmin && (
                <Link
                  to="/admin/metrics"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
                >
                  <ChartNoAxesColumn size={14} strokeWidth={2} aria-hidden="true" />
                  Metrics
                </Link>
              )}
              {/* Development only, and only for an allowlisted account. Styled as
                  an ordinary menu item, with no accent or badge, so it is never
                  mistaken for product UI. The endpoint re-checks both guards.

                  Also gated on billing (Step 8a): with no plans there is
                  nothing to toggle between, and the endpoint answers 404 on the
                  same terms as the allowlist refusal. The lifecycle sweep
                  below is not gated, because the welcome and deletion messages
                  it drains have nothing to do with a plan. */}
              {profile?.devTools && profile.billingEnabled && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={cycling}
                  onClick={() => {
                    setCycling(true);
                    cyclePlan()
                      .then(refresh)
                      .finally(() => setCycling(false));
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {/* A flask, not a plan or star glyph: with every other item
                      now carrying an icon, having none is what would make this
                      one conspicuous, but the icon must still read as
                      "development tool" rather than as product UI. */}
                  <FlaskConical size={14} strokeWidth={2} aria-hidden="true" />
                  Plan: {profile.plan}
                  {profile.planOverride == null ? ' (real)' : ' (forced)'} — switch to{' '}
                  {describeOverride(nextOverride(profile.planOverride ?? null))}
                </button>
              )}
              {/* The two lifecycle-email controls (Step 6h), beside the plan
                  toggle because they are the same kind of thing: state a
                  developer needs to reach that the product has no reason to
                  offer. Same flask icon, same guards, same 404 in production.

                  They are two buttons rather than one because they are two
                  independent operations — the date can be moved without
                  sweeping, and the sweep is worth running on its own after a
                  template edit. */}
              {profile?.devTools && profile.billingEnabled && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={trialBusy}
                  onClick={() => {
                    setTrialBusy(true);
                    setTrialEnd(TRIAL_CYCLE[trialStep]!.days)
                      .then(refresh)
                      .then(() => setTrialStep((s) => (s + 1) % TRIAL_CYCLE.length))
                      .finally(() => setTrialBusy(false));
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FlaskConical size={14} strokeWidth={2} aria-hidden="true" />
                  Trial: set to {TRIAL_CYCLE[trialStep]!.label}
                </button>
              )}
              {profile?.devTools && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={sweeping}
                  onClick={() => {
                    setSweeping(true);
                    setSweepResult(null);
                    runLifecycleSweep()
                      .then((r) => setSweepResult(`${r.queued} queued, ${r.sent} sent`))
                      // The counts are the whole report; a failure is a failure
                      // of the control, not of the sweep's contents.
                      .catch(() => setSweepResult('failed'))
                      .finally(() => setSweeping(false));
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FlaskConical size={14} strokeWidth={2} aria-hidden="true" />
                  {/* The result stays on the label rather than becoming a toast:
                      the messages themselves are in the server's terminal, and
                      this is only the confirmation that a pass ran. */}
                  Run email sweep
                  {sweeping ? '…' : sweepResult ? ` — ${sweepResult}` : ''}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  // Back to the home page, so the address bar does not keep a
                  // tool URL the visitor no longer has access to.
                  void signOut().then(() => navigate('/', { replace: true }));
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-hover"
              >
                <LogOut size={14} strokeWidth={2} aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
