import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Tooltip } from './Tooltip';

export interface TabNavItem {
  to: string;
  label: string;
  /** Rendered after the label — the premium star on a gated tab. */
  suffix?: ReactNode;
  /** Renders the tab as unavailable text rather than a link. */
  disabled?: boolean;
  /** Id of an element describing why the tab is disabled. */
  describedBy?: string;
  /** Hover/focus explanation, for a disabled tab. */
  tooltip?: string;
  /**
   * How the tooltip is anchored. `end` for a tab far enough right that a centred
   * bubble would run past the content column on a phone, which widens the
   * document (Phase 2 Step 3a).
   */
  tooltipAlign?: 'center' | 'start' | 'end';
}

const TAB =
  'group relative inline-flex h-10 items-center gap-2 whitespace-nowrap px-1 text-sm font-semibold ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** The bar under a tab. Grey darkens on hover so the whole tab reads as the target. */
function Bar({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full ${
        active ? 'bg-accent' : 'bg-subtle group-hover:bg-strong'
      }`}
    />
  );
}

/**
 * A page's sub-pages, as a row of underlined tabs below its header.
 *
 * Links rather than an ARIA tablist, because each tab is its own route: the
 * address bar, the back button and open-in-new-tab all work, and the active one
 * is announced as the current page. Navigation sits in this row and controls
 * (class pickers, counters) stay in the header, so the two no longer look alike.
 *
 * Every tab sits on its own 3px bar, with no rule running the width of the
 * page: accent under the active tab (the sidebar's active marker turned on its
 * side) and a grey one under the rest. A full-width rule, together with the top
 * border of the list that usually follows the toolbar, boxed each page's
 * controls between two lines that looked like an empty table row.
 *
 * **No overflow on the row, and it wraps rather than scrolls.** A scrolling row
 * is a clipping container, and a disabled tab's tooltip opens below the tab, so
 * `overflow-x-auto` here hid the explanation it exists to show. Every page's
 * tabs fit a 375px screen on one line, so the wrap is a fallback, not a layout.
 */
export function TabNav({ label, items }: { label: string; items: TabNavItem[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-4">
        {items.map((item) => (
          <li key={item.to} className="flex">
            {item.disabled ? (
              <DisabledTab item={item} />
            ) : (
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `${TAB} ${isActive ? 'text-primary' : 'text-secondary hover:text-primary'}`
                }
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    {item.suffix}
                    <Bar active={isActive} />
                  </>
                )}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DisabledTab({ item }: { item: TabNavItem }) {
  const tab = (
    // Focusable, so a keyboard user can reach the explanation the tooltip and
    // the description carry; announced as disabled rather than skipped.
    <span
      tabIndex={0}
      aria-disabled="true"
      aria-describedby={item.describedBy}
      className={`${TAB} cursor-not-allowed text-disabled`}
    >
      {item.label}
      {item.suffix}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-subtle" />
    </span>
  );
  return item.tooltip ? (
    <Tooltip label={item.tooltip} side="bottom" align={item.tooltipAlign}>
      {tab}
    </Tooltip>
  ) : (
    tab
  );
}
