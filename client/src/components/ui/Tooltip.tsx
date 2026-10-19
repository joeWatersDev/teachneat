import type { ReactNode } from 'react';

interface TooltipProps {
  /** The tooltip text shown on hover/focus of the wrapped trigger. */
  label: string;
  children: ReactNode;
  /**
   * Which side of the trigger the bubble sits on. Use `bottom` wherever an
   * upward bubble would be covered — anything in a page header sits directly
   * under the fixed top bar, which clips one entirely.
   */
  side?: 'top' | 'bottom';
  /**
   * How the bubble is anchored horizontally. `center` is the default and is
   * right for a trigger with room on both sides; `start` (left edges aligned)
   * is for a trigger near the left of the viewport, where a centred bubble
   * wider than the trigger runs off the screen — the sidebar's collapsed star,
   * 32px from the left edge, is the case this exists for. `end` mirrors it.
   */
  align?: 'center' | 'start' | 'end';
  /**
   * Forces the tooltip visible regardless of hover or focus. For triggers that
   * must also work by tap: a touch device has no hover, so the only way to
   * reveal a hover-only tooltip is to make showing it an explicit action the
   * trigger controls.
   */
  open?: boolean;
}

/** Horizontal placement of the bubble, and of the caret within it. */
const ALIGNMENT: Record<NonNullable<TooltipProps['align']>, { box: string; caret: string }> = {
  // Centred on the trigger, caret in the middle.
  center: { box: 'left-1/2 -translate-x-1/2', caret: 'left-1/2 -translate-x-1/2' },
  // Left edges flush; the caret stays over the trigger, near the bubble's left.
  start: { box: 'left-0', caret: 'left-2' },
  end: { box: 'right-0', caret: 'right-2' },
};

/**
 * Hover/focus tooltip per DESIGN_SYSTEM.md: dark `#484848` surface, xs text,
 * appears after a 500ms hover delay (immediate on keyboard focus), with a small
 * caret pointing at the trigger. Visual only — the trigger keeps its own
 * accessible name. White text is used for contrast on the dark surface in both
 * themes.
 *
 * Placement is declared by the caller rather than measured. The app has few
 * tooltips and each sits in a known spot, so `side` and `align` cover every
 * case; viewport-aware auto-flipping would need measurement on every open and
 * is not worth it until a tooltip appears somewhere genuinely unpredictable.
 *
 * **`z-[29]`, and the number is load-bearing.** A tooltip is the topmost thing
 * on the page while it is open, and at `z-20` it was not: the Attendance
 * History grid and the Statistics table both have sticky header cells at
 * `z-[25]`, and those tables are not their own stacking context, so their
 * headers and this bubble compete directly. Hovering the disabled Statistics
 * segment on a free account while History was open drew the explanation *under*
 * the grid, which is the one moment it needed to be readable. 29 clears both
 * and still sits under the mobile drawer overlay at `z-30`, which must cover
 * the page when it is open. A tooltip inside a fixed, stacked ancestor (the
 * sidebar at `z-40`) is unaffected either way, since its z-index is resolved
 * within that ancestor.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
  open = false,
}: TooltipProps) {
  const vertical = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
  const caretSide = side === 'top' ? 'top-full -mt-1' : 'bottom-full -mb-1';
  const { box, caret } = ALIGNMENT[align];

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={
          `pointer-events-none absolute z-[29] ${vertical} ${box} ` +
          'w-max max-w-56 rounded bg-tooltip px-2 py-1 text-xs leading-snug text-white shadow-md ' +
          'transition-opacity delay-0 duration-100 ' +
          'group-hover:opacity-100 group-hover:delay-500 group-focus-within:opacity-100 ' +
          (open ? 'opacity-100' : 'opacity-0')
        }
      >
        {label}
        <span
          aria-hidden="true"
          className={`absolute ${caretSide} ${caret} h-2 w-2 rotate-45 bg-tooltip`}
        />
      </span>
    </span>
  );
}
