import type { LucideIcon } from 'lucide-react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * A page whose whole content is a short list of things you can go and do
 * (Phase 2 Step 6f).
 *
 * Two pages use it — Account settings and Help and support — and it exists as
 * one component because they are the same page with different rows. Both are
 * hubs reached from the account menu, and the menu got out of hand precisely
 * because every step added one more item to it; the fix only holds if the
 * places those items moved to keep looking like each other.
 *
 * Each row carries a label and a line saying what it does. The line is not
 * decoration: these are destinations rather than buttons in a form, and the
 * difference between "Log out of all sessions" and "Delete account" is a
 * consequence a teacher should be able to read before clicking, not after.
 *
 * A row is a link or a button, never both. Links carry `to`, buttons carry
 * `onClick`, and rendering follows: a destination inside the app is an anchor
 * so middle-click and open-in-new-tab work, while an action that changes
 * something is a button so it is not one.
 */

export interface ActionRow {
  key: string;
  icon: LucideIcon;
  label: string;
  description: string;
  /** In-app destination. Mutually exclusive with `onClick`. */
  to?: string;
  /** External destination, opened in a new tab. Mutually exclusive with `onClick`. */
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * `danger` tints the label and the icon. `accent` tints **the icon only**,
   * because the accent is not a text colour: it fails WCAG AA on both surfaces
   * at body size, and a 14px semibold label does not reach the size at which
   * WCAG exempts large text (DESIGN_SYSTEM, "Accent Color Usage Rules"). Accent
   * on an icon is an allowed non-text use, so the row still reads as gold
   * without the label being the thing that carries it.
   */
  tone?: 'default' | 'danger' | 'accent';
}

const ROW =
  'flex w-full items-center gap-4 rounded-lg border border-subtle bg-elevated p-4 text-left ' +
  'transition-colors duration-100 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

function RowBody({ row }: { row: ActionRow }) {
  const Icon = row.icon;
  const labelTone = row.tone === 'danger' ? 'text-danger' : 'text-primary';
  // Filled rather than outlined, which is what makes it the same star a teacher
  // already meets in the upgrade modal's feature list rather than a gold
  // version of the outline icons in the rows above and below it.
  const iconTone = row.tone === 'accent' ? 'text-accent' : labelTone;
  // The fill belongs to the row's own icon, not to the spinner that replaces it:
  // Loader2 is an open arc, and filling it closes the shape into a disc.
  const iconFill = row.tone === 'accent' ? ' fill-accent' : '';
  return (
    <>
      {row.loading ? (
        <Loader2
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className={`shrink-0 animate-spin ${iconTone}`}
        />
      ) : (
        <Icon
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`shrink-0 ${iconTone}${iconFill}`}
        />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-sm font-semibold ${labelTone}`}>{row.label}</span>
        <span className="text-sm leading-relaxed text-secondary">{row.description}</span>
      </span>
      <ChevronRight
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className="ml-auto shrink-0 text-secondary"
      />
    </>
  );
}

export function ActionList({ rows }: { rows: ActionRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) =>
        row.to ? (
          <Link key={row.key} to={row.to} className={ROW}>
            <RowBody row={row} />
          </Link>
        ) : row.href ? (
          <a
            key={row.key}
            href={row.href}
            target="_blank"
            rel="noreferrer noopener"
            className={ROW}
          >
            <RowBody row={row} />
          </a>
        ) : (
          <button
            key={row.key}
            type="button"
            onClick={row.onClick}
            disabled={row.disabled || row.loading}
            className={ROW}
          >
            <RowBody row={row} />
          </button>
        ),
      )}
    </div>
  );
}
