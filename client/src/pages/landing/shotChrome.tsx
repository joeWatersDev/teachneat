import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { NAV_ITEMS } from '../../layouts/navConfig';

/**
 * Shared pieces for the landing page's product shots.
 *
 * **These are pictures of the app, not the app.** Every shot on the landing page
 * is rendered in the DOM from the same design tokens rather than being a
 * captured image, which was forced by one fact and turns out to be the better
 * option anyway: a real screenshot of a roster would contain real student names,
 * which is indefensible for a product whose whole claim is that it never holds
 * student data. Since any shot has to use invented data regardless, rendering it
 * here costs nothing extra and buys two things a PNG cannot have — it follows
 * the light and dark theme, and it cannot drift when a colour token moves.
 *
 * The trade, stated plainly so nobody is surprised by it later: these are a
 * *representation* of each tool, maintained separately from the real component.
 * They are close, not pixel-exact, and they will need a look whenever a tool's
 * layout changes materially. Everything below was built by reading the real
 * components, so no control appears here that does not exist in the product.
 *
 * See `design/landing-page-mockup.html` for the approved design.
 */

/** The window each shot sits in. `rail` draws the sidebar; only the hero uses it. */
export function AppFrame({
  children,
  rail = false,
  bar,
}: {
  children: ReactNode;
  rail?: boolean;
  bar?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {bar}
      {/* Collapsed to icons below `sm`, as the real sidebar collapses below
          `lg`. The breakpoint differs because the shot is not the app: at phone
          widths a 200px rail left the content beside it too narrow to read. */}
      <div className={rail ? 'grid grid-cols-[3.25rem_1fr] sm:grid-cols-[200px_1fr]' : ''}>
        {rail && <ShotRail />}
        <div className="flex min-w-0 flex-col gap-3 bg-surface p-3 sm:gap-4 sm:p-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * The tools, taken from the real sidebar's config rather than restated, so the
 * shot cannot list a tool the product does not have or miss one it gains. The
 * icons come with them. Students is always the active item.
 */
function ShotRail() {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-subtle bg-sidebar p-2 sm:p-3">
      {NAV_ITEMS.map((item, i) => {
        const Icon = item.icon;
        return (
          <span
            key={item.path}
            className={
              'flex h-10 items-center gap-3 rounded-md px-2.5 text-base sm:px-3 ' +
              (i === 0 ? 'bg-accent-muted font-semibold text-primary' : 'text-secondary')
            }
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            <span className="hidden sm:inline">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A page title plus optional trailing controls, mirroring `PageHeader`. */
export function ShotHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-lg font-semibold text-primary">{title}</span>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Non-interactive stand-in for `Button`. Same height, radius and weight. */
export function ShotButton({
  children,
  variant = 'secondary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <span
      className={
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-base font-semibold ' +
        (variant === 'primary'
          ? 'bg-accent text-on-accent'
          : 'border border-subtle bg-elevated text-primary')
      }
    >
      {children}
    </span>
  );
}

/** Non-interactive stand-in for `Select`, chevron included. */
export function ShotSelect({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex h-9 items-center justify-between gap-2 rounded-md border border-subtle bg-base pl-2 pr-2 text-base text-primary ${className}`}
    >
      {children}
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="text-secondary">
        <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

/** A labelled filter, as the roster and the scoped tools draw them. */
export function ShotFilter({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 text-base text-secondary">
      {label}
      <ShotSelect>{value}</ShotSelect>
    </span>
  );
}

/** Stand-in for `TabNav`: the page's sub-pages as underlined tabs. */
export function ShotTabs({ options, active }: { options: string[]; active: string }) {
  return (
    <span className="flex gap-4 overflow-hidden">
      {options.map((opt) => (
        <span
          key={opt}
          className={
            'relative inline-flex h-10 items-center whitespace-nowrap px-1 text-sm font-semibold ' +
            (opt === active ? 'text-primary' : 'text-secondary')
          }
        >
          {opt}
          <span
            aria-hidden="true"
            className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full ${opt === active ? 'bg-accent' : 'bg-subtle'}`}
          />
        </span>
      ))}
    </span>
  );
}

/** Stand-in for `SegmentedControl`: active segment takes the accent fill. */
export function ShotSegments({ options, active }: { options: string[]; active: string }) {
  return (
    <span className="flex self-start overflow-hidden rounded-md border border-subtle">
      {options.map((opt) => (
        <span
          key={opt}
          className={
            'inline-flex h-9 items-center px-4 text-sm font-semibold ' +
            (opt === active ? 'bg-accent text-on-accent' : 'bg-elevated text-primary')
          }
        >
          {opt}
        </span>
      ))}
    </span>
  );
}

/** The bordered list every row-based tool sits in. Also the query container. */
export function ShotList({ children }: { children: ReactNode }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-subtle">{children}</div>
  );
}

/** Stand-in for the student detail page's `Card`: same border, fill and heading. */
export function ShotCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-elevated p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-md font-medium text-primary">{title}</span>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** A label-over-value pair, as the detail page's `Field` draws it. */
export function ShotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-secondary">{label}</span>
      <span className="text-base text-primary">{value}</span>
    </div>
  );
}

/** The roster's avatar: an outline icon in a circle, not initials. */
export function ShotAvatar() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-hover text-secondary">
      <Users size={16} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
