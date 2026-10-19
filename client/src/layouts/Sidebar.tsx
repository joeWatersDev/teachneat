import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Star } from 'lucide-react';
import { PremiumMark } from '../components/ui/PremiumMark';
import { NAV_ITEMS } from './navConfig';
import { Tooltip } from '../components/ui/Tooltip';
import { useUpgrade } from '../hooks/useUpgrade';
import { useEntitlements } from '../hooks/useEntitlements';
import type { Plan } from '../api/auth';

interface SidebarProps {
  /** Mobile drawer open state. */
  open: boolean;
  /** Called when the user closes the drawer by clicking outside or selecting an item. */
  onDismiss: () => void;
}

/**
 * The sidebar renders as two completely separate trees so resizing
 * across the mobile/tablet breakpoint does not produce an "expand then
 * slide" animation. The mobile drawer is only mounted at mobile widths
 * (CSS-hidden at md+); the desktop sidebar is only visible at md+.
 */
export function Sidebar({ open, onDismiss }: SidebarProps) {
  return (
    <>
      <DesktopSidebar />
      <MobileDrawer open={open} onDismiss={onDismiss} />
    </>
  );
}

function DesktopSidebar() {
  return (
    <aside
      role="navigation"
      aria-label="Primary"
      className="fixed top-16 bottom-0 left-0 z-40 hidden flex-col bg-sidebar md:flex md:w-16 lg:w-[220px]"
    >
      <NavList showLabels />
      <SidebarFooter variant="desktop" />
    </aside>
  );
}

function MobileDrawer({ open, onDismiss }: SidebarProps) {
  return (
    <div className="md:hidden">
      <div
        className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onDismiss}
        aria-hidden="true"
      />
      <aside
        role="navigation"
        aria-label="Primary (mobile)"
        className={[
          'fixed top-16 bottom-0 left-0 z-40 flex w-[220px] flex-col bg-sidebar',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <NavList showLabels onNavigate={onDismiss} />
        <SidebarFooter variant="drawer" />
      </aside>
    </div>
  );
}

interface NavListProps {
  showLabels: boolean;
  onNavigate?: () => void;
}

function NavList({ showLabels, onNavigate }: NavListProps) {
  return (
    <ul className="flex-1 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.path}>
            <NavLink
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  'group relative flex h-10 items-center gap-3 rounded-lg px-4',
                  'transition-colors duration-100',
                  isActive
                    ? 'bg-accent-muted text-primary'
                    : 'text-secondary hover:bg-hover hover:text-primary',
                ].join(' ')
              }
              aria-label={item.label}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-accent"
                    />
                  )}
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                  <span className={showLabels ? 'md:hidden lg:inline' : 'sr-only'}>
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Length of the trial, mirrored from the server's `config/plan.ts` (TRIAL_DAYS).
 * Used only to size the countdown bar; the server decides when a trial actually
 * ends. Keep in sync.
 */
const TRIAL_DAYS = 30;

const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free account',
  trial: 'Free trial',
  paid: 'Premium',
};

/** Whole days from now until an ISO timestamp, floored at zero. */
function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

/**
 * The plan card shown on `free` and `trial`: the plan, the countdown when there
 * is one, what the star means, and the way to change it — grouped into one block
 * rather than three loose lines, so the footer reads as a single statement about
 * the account.
 */
function PlanCard({
  plan,
  legend,
  daysLeft,
  onUpgrade,
}: {
  plan: Plan;
  legend: string;
  daysLeft: number | null;
  onUpgrade: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-subtle bg-elevated p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-primary">{PLAN_LABEL[plan]}</span>
        {daysLeft !== null && (
          <span className="shrink-0 text-xs text-secondary">
            {daysLeft === 1 ? '1 day left' : daysLeft + ' days left'}
          </span>
        )}
      </div>

      {/* A bar says "running out" faster than a number does. Decorative only —
          the figure beside it carries the same information to a screen reader. */}
      {daysLeft !== null && (
        <span aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-hover">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: Math.min(100, (daysLeft / TRIAL_DAYS) * 100) + '%' }}
          />
        </span>
      )}

      <span className="flex items-center gap-1.5 text-xs text-secondary">
        <Star
          size={12}
          strokeWidth={2}
          className="shrink-0 fill-accent text-accent"
          aria-hidden="true"
        />
        {legend}
      </span>

      {/* The second deliberate entry point, beside the plan it refers to.
          Offered on `trial` too — this is somewhere a teacher looks on purpose,
          unlike a gated control, where a prompt would interrupt someone who
          still has access. */}
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-0.5 h-8 w-full rounded-md bg-accent px-3 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        Upgrade to Premium
      </button>
    </div>
  );
}

/**
 * The account's plan, and — on any plan that has premium features it does not
 * fully own — the legend explaining the star that marks them. The star is
 * unlabelled to the eye everywhere it appears, so this is where it is defined
 * once instead of a word repeated on every control.
 */
function SidebarFooter({ variant }: { variant: 'desktop' | 'drawer' }) {
  const { billingEnabled, plan, isPremium, trialEndsAt } = useEntitlements();
  const { openUpgrade } = useUpgrade();
  // Tap-to-reveal for the collapsed star (see below); hover and focus are CSS.
  const [legendOpen, setLegendOpen] = useState(false);
  const legend = isPremium ? 'Included until your trial ends' : 'Premium feature';
  const daysLeft = plan === 'trial' && trialEndsAt ? daysUntil(trialEndsAt) : null;

  // Step 8a. Everything this footer contains — the plan, the countdown, the
  // star's legend, the upgrade button — is a statement about a boundary that
  // does not exist while billing is off. The whole block goes, including its
  // top border, rather than emptying out and leaving a rule across the sidebar
  // with nothing under it.
  if (!billingEnabled) return null;

  // A paying teacher gets the mark and nothing else: no legend to explain,
  // because nothing they can see is gated, and no offer, because there is
  // nothing left to sell them.
  //
  // Centred at every width. The free/trial card below is full-width so its own
  // alignment never showed, but the mark is a small inline element, and the
  // `lg:items-start` it inherited left it hugging the edge on the expanded
  // sidebar while sitting centred at every other width.
  if (plan === 'paid') {
    return (
      <div className="flex flex-col items-center border-t border-subtle p-4">
        {variant === 'drawer' ? (
          <PremiumMark />
        ) : (
          <>
            <span className="hidden lg:inline">
              <PremiumMark />
            </span>
            {/* Collapsed to icons there is no room for the word, but the mark
                should not simply vanish at one width. */}
            <span className="hidden md:block lg:hidden">
              <PremiumMark collapsed />
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 border-t border-subtle p-4 lg:items-start">
      {/* The drawer is always 220px wide, so it always has room. The desktop
          sidebar only does once expanded, hence the `lg` gate. Keyed off which
          sidebar this is rather than rendering both and hiding one with CSS —
          that would put two copies of the card in every page's DOM. */}
      <div className={variant === 'drawer' ? 'w-full' : 'hidden w-full lg:block'}>
        <PlanCard plan={plan} legend={legend} daysLeft={daysLeft} onUpgrade={openUpgrade} />
      </div>

      {/* Collapsed to icons, there is no room for the card — but the star still
          marks controls elsewhere, so it would otherwise be the one width at
          which nothing explains it. The tooltip carries the legend instead.

          It is a button, not a bare icon: almost every device narrow enough to
          collapse the sidebar is a touch device, which has no hover, so
          revealing the legend has to be something the user can tap. Tapping
          toggles it; hover and keyboard focus still work as they do everywhere
          else. The account menu carries the upgrade action at every width, so
          nothing is lost by leaving it out here. */}
      {variant === 'desktop' && (
        <span className="hidden md:block lg:hidden">
          <Tooltip label={legend} open={legendOpen} align="start">
            <button
              type="button"
              aria-label={`Star marks: ${legend}`}
              aria-expanded={legendOpen}
              onClick={() => setLegendOpen((v) => !v)}
              onBlur={() => setLegendOpen(false)}
              className="flex items-center rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Star
                size={12}
                strokeWidth={2}
                className="shrink-0 fill-accent text-accent"
                aria-hidden="true"
              />
            </button>
          </Tooltip>
        </span>
      )}
    </div>
  );
}
