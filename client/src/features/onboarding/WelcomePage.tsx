import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, FileSpreadsheet, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { NAV_ITEMS } from '../../layouts/navConfig';
import { useAuth } from '../../hooks/useAuth';
import { completeOnboarding } from '../../api/auth';

/**
 * One line per tool, keyed by the `navConfig` path so the two lists cannot
 * drift apart silently: a tool added to the sidebar with no entry here shows an
 * empty synopsis rather than another tool's.
 *
 * These are the descriptions an earlier revision deleted, brought back under
 * the condition that made them worth cutting. The objection was never that they
 * were wrong; it was that five static blurbs sat on the page permanently,
 * duplicating the landing page and going stale in silence. On hover they cost
 * nothing until asked for, and the strip stops being a legend you cannot
 * interrogate. Each says what the tool does and nothing about why it is good.
 */
const TOOL_SYNOPSES: Record<string, string> = {
  '/students': 'The class list itself: names, contact details, notes and alerts.',
  '/attendance': 'Take the daily attendance, then review the history and per-student statistics.',
  '/grouping': 'Split a class into groups, with rules for who to keep together or apart.',
  '/name-picker': 'Fun ways to pick a student at random.',
  '/email': 'Customize and send mass emails to multiple students and families.',
};

/**
 * Which tool the strip starts on. Students, because it is the first tool in the
 * sidebar and the one the two buttons above this send the teacher to, so the
 * line opens describing where they are already going.
 *
 * A default rather than a resting hint. An empty line asking to be hovered
 * spends the same vertical space on an instruction as on an answer, and on a
 * touch device the instruction is one that cannot be followed.
 */
const DEFAULT_TOOL = '/students';

/**
 * The first-run guide (Phase 2 Step 5a).
 *
 * Rewritten after review. The first version was the marketing site again —
 * a tool-by-tool feature list, the value proposition restated, and everything
 * in paragraphs — which is the wrong thing to show someone who has already
 * bought the argument and signed in. Three rules came out of that review and
 * they are what this layout is:
 *
 * 1. **The action is the page, and it is at the top.** Onboarding succeeds by
 *    ending, not by informing: every tool here is empty until the student list
 *    exists, so the only thing this screen owes the teacher is the shortest
 *    path into adding it. Both buttons land inside the real form rather than on
 *    the roster with the form to find.
 * 2. **No explanation occupies the page permanently.** The rule started as
 *    "explain only what cannot be discovered by clicking", which cut five
 *    static tool descriptions: the names say most of it, the landing page said
 *    the rest, and a blurb per tool is the same maintenance liability as a
 *    static screenshot, going stale in silence when the tool changes. The
 *    descriptions are back, but on hover, in one shared line — the cost the
 *    rule was protecting against was the standing page real estate, not the
 *    sentences.
 * 3. **Short enough to read.** Scannable blocks and no paragraph longer than
 *    two lines. There is no longer a skip link: completion is recorded on
 *    arrival, so every route off the page skips the guide, and an affordance
 *    whose only message was "you may leave" sat next to a sidebar that already
 *    said so.
 *
 * The sidebar strip does what prose cannot: it maps this page onto the chrome
 * the teacher is looking at, in the same icons and the same order as
 * `navConfig`, which is also what keeps it from drifting.
 */

export function WelcomePage() {
  const { profile, markOnboarded } = useAuth();
  const navigate = useNavigate();
  /**
   * Which tool the line below the strip is describing, as a `navConfig` path.
   *
   * Sticky: hovering sets it and moving away leaves it. A line that emptied on
   * mouse-out would make reading a synopsis a race against the pointer, and the
   * teacher's next move after reading one is usually to look at the tool it
   * describes rather than back at the strip.
   */
  const [shownTool, setShownTool] = useState<string>(DEFAULT_TOOL);
  const recorded = useRef(false);
  const synopsisIds = useId();
  /** A stable, selector-safe id per tool; `useId` alone is one id for the set. */
  const synopsisId = (label: string) => `${synopsisIds}-${label.replace(/\s+/g, '-')}`;

  const firstName = profile?.name?.trim().split(/\s+/)[0];
  const trialEnds = profile?.trialEndsAt
    ? new Date(profile.trialEndsAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  /**
   * Completion is recorded on arrival, not on the way out.
   *
   * It used to be recorded by whichever exit the teacher took, which worked
   * only while every exit was a button on this page. The "Skip for now" link
   * was one of them, and removing it would otherwise have trapped the teacher:
   * `RequireOnboarding` redirects to `/welcome` for as long as the flag is set,
   * so clicking a sidebar tool would have bounced straight back here and the
   * only ways off the page would have been the two Add buttons.
   *
   * Recording on arrival is also the more honest reading of the flag, which
   * means "has not been shown the guide" rather than "has not finished it", and
   * it is safe because the guide is not lost by being marked seen: the account
   * menu keeps offering it until the first student is added.
   *
   * The flag clears locally whether or not the write lands, because whether
   * they have read this page is not a fact about our database being reachable —
   * a failed write should cost them seeing the guide again next time, not being
   * held on it now. The ref guards against a second pass, since `markOnboarded`
   * changes the profile this component reads.
   */
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    completeOnboarding().catch(() => undefined);
    markOnboarded();
  }, [markOnboarded]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {/* `xl` (24px), the top of the app's scale, rather than the `lg` every
          tool header uses: this is a greeting, not a page title, and at tool
          size it read as one more row of chrome. The display steps above it
          stay reserved for the public pages (DESIGN_SYSTEM, "The Public
          Shell") — this is inside the app shell. */}
      <h1 className="text-xl font-semibold text-primary">
        {firstName ? `Welcome, ${firstName}!` : 'Welcome!'}
      </h1>

      {/* The action, first and largest. It opens the real form on arrival
          rather than dropping the teacher on an empty roster. */}
      <section className="flex flex-col gap-4 rounded-lg border border-strong bg-elevated p-5">
        <h2 className="text-md font-semibold text-primary">Add your students</h2>
        {/* No loading state: the write it used to wait on now happens on
            arrival, so it is a plain navigation and a spinner would be showing
            the teacher nothing. */}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => navigate('/students/roster?add=bulk', { replace: true })}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add Students
          </Button>
        </div>
      </section>

      {/* The questions a teacher actually arrives with. Not a pitch: both are
          things they would otherwise have to go and find out.

          The second card is about what the trial is holding open, so it renders
          only where there is billing to hold anything open — with billing
          dormant it would announce a Premium tier that does not exist and link
          to a pricing page that is gated. One card, so one column: the pair
          template would leave the other half empty. */}
      <section className={'grid gap-4' + (profile?.billingEnabled ? ' sm:grid-cols-2' : '')}>
        <article className="flex gap-3 rounded-lg border border-subtle p-4">
          <FileSpreadsheet
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-secondary"
          />
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-primary">Your data is on your Drive</h2>
            {/* Names the folder rather than describing the arrangement. The
                previous copy listed what a teacher may do with the sheet, which
                is reassurance they have not asked for yet; what they actually
                need on day one is where to look, and the folder name is the
                only part of it they cannot guess. */}
            <p className="text-sm leading-relaxed text-secondary">
              All of your app data is stored in a Google Sheet on your drive in a folder named
              “TEACHNEAT DATA”.
            </p>
          </div>
        </article>

        {profile?.billingEnabled && (
          <article className="flex gap-3 rounded-lg border border-subtle p-4">
            <CalendarClock
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-secondary"
            />
            <div className="flex flex-col gap-1">
              {/* "Premium" rather than "Everything", because Premium is the word
                  the rest of the app uses for what the trial is holding open, and
                  a teacher who reads "everything is unlocked" here has no name for
                  what they lose later. */}
              <h2 className="text-sm font-semibold text-primary">
                {trialEnds ? `Premium is unlocked until ${trialEnds}` : 'Premium is unlocked'}
              </h2>
              <p className="text-sm leading-relaxed text-secondary">
                {trialEnds
                  ? 'Enjoy access to all premium features until then. '
                  : 'Enjoy access to all premium features. '}
                <Link to="/pricing" className="text-primary underline hover:no-underline">
                  Compare the plans
                </Link>
                .
              </p>
            </div>
          </article>
        )}
      </section>

      {/* The strip still maps this page onto the chrome the teacher is looking
          at, in the same icons and the same order as `navConfig`, and it still
          carries no permanent prose. What changed is that the descriptions are
          now reachable: hovering a tool writes its one-liner into the single
          line below, so five explanations occupy one line's worth of page and
          none is read by someone who did not ask for it.

          The chips select a description; they do not navigate. Sending a
          teacher into an empty tool from the page whose whole job is to get the
          roster in would be working against the two buttons above, so this is a
          picker rather than a menu — the selection is the effect, which is why
          buttons carrying `aria-pressed` are the honest markup for it and why
          clicking one does the same thing hovering it does, for anyone without
          a pointer.

          The shared line is `aria-hidden`, because a line that rewrites itself
          under the pointer is of no use to a screen reader; each button carries
          its own synopsis as a visually hidden description instead, which is
          the same shape `PremiumControl` uses. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-primary">Your tools, in the sidebar</h2>
        <ul className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => {
            const shown = item.path === shownTool;
            return (
              <li key={item.path}>
                <button
                  type="button"
                  aria-pressed={shown}
                  aria-describedby={synopsisId(item.label)}
                  onMouseEnter={() => setShownTool(item.path)}
                  onFocus={() => setShownTool(item.path)}
                  onClick={() => setShownTool(item.path)}
                  className={
                    'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors duration-100 ' +
                    (shown
                      ? 'border-accent bg-accent-muted text-primary'
                      : 'border-subtle text-secondary hover:border-strong hover:text-primary')
                  }
                >
                  <item.icon
                    size={16}
                    strokeWidth={shown ? 2.25 : 1.75}
                    aria-hidden="true"
                    className={shown ? 'text-accent' : undefined}
                  />
                  {/* The label is set bold when selected, over a permanently
                      bold invisible copy of itself in the same grid cell. The
                      chip is therefore always as wide as its bold state, so
                      moving along the strip does not reflow a row that wraps —
                      without this, every chip after the pointer would shuffle,
                      and on a narrow viewport one could jump to the next line. */}
                  <span className="grid">
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1 font-semibold"
                    >
                      {item.label}
                    </span>
                    <span className={`col-start-1 row-start-1 ${shown ? 'font-semibold' : ''}`}>
                      {item.label}
                    </span>
                  </span>
                </button>
                <span id={synopsisId(item.label)} className="sr-only">
                  {TOOL_SYNOPSES[item.path] ?? ''}
                </span>
              </li>
            );
          })}
        </ul>
        {/* `min-h` holds the line's height at both widths it can take, so the
            page does not shift under the pointer as the text changes. */}
        <p
          aria-hidden="true"
          className="min-h-[2.75rem] text-sm leading-relaxed text-secondary sm:min-h-[1.375rem]"
        >
          {TOOL_SYNOPSES[shownTool] ?? ''}
        </p>
      </section>

    </div>
  );
}
