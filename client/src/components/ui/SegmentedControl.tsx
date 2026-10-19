import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Rendered after the label — the premium star on a gated segment. */
  suffix?: ReactNode;
  /** Id of an element describing why the segment is disabled. */
  describedBy?: string;
  /**
   * Hover/focus explanation for this segment — the same affordance a gated
   * button gets from `PremiumControl`, which cannot wrap a segment from outside
   * because the group renders its own buttons.
   */
  tooltip?: string;
  /**
   * Which side the tooltip sits on. Defaults to `bottom`, because a segmented
   * control is a toolbar control and this app's toolbars sit directly under the
   * fixed top bar, which clips an upward bubble.
   */
  tooltipSide?: 'top' | 'bottom';
  /**
   * How the tooltip is anchored horizontally. Defaults to `center`. Use `end` on
   * the last segment of a right-aligned header: a bubble up to 224px wide centred
   * on a segment at the right edge of the content area extends past it, and an
   * absolutely positioned element widens the document's scrollable area even at
   * `opacity-0`.
   */
  tooltipAlign?: 'center' | 'start' | 'end';
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the button group (e.g. "Attendance view"). */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A segmented button group (the app's inline tab/mode switcher): the active
 * segment takes the accent fill, the rest are elevated. Replaces the per-feature
 * `ViewTab` / `ModeTab` copies so every switcher looks and behaves identically.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-subtle">
      {options.map((opt, i) => {
        const active = opt.value === value;
        // Rounding is applied by index rather than with `first:` / `last:`,
        // because a tooltipped segment sits inside a wrapper element and would
        // otherwise be both the first and the last child of it, rounding every
        // corner of a middle segment.
        const rounding = [
          i === 0 ? 'rounded-l-md' : '',
          i === options.length - 1 ? 'rounded-r-md' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const segment = (
          <button
            type="button"
            aria-pressed={active}
            // aria-disabled as well as disabled, so assistive technology
            // announces the state rather than skipping the control entirely.
            aria-disabled={opt.disabled || undefined}
            aria-describedby={opt.describedBy}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={
              `inline-flex h-9 items-center gap-2 px-4 text-sm font-semibold ${rounding} ` +
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
              'disabled:cursor-not-allowed disabled:text-disabled disabled:opacity-60 ' +
              (active ? 'bg-accent text-on-accent' : 'bg-elevated text-secondary hover:bg-hover')
            }
          >
            {opt.label}
            {opt.suffix}
          </button>
        );

        return opt.tooltip ? (
          <Tooltip
            key={opt.value}
            label={opt.tooltip}
            side={opt.tooltipSide ?? 'bottom'}
            align={opt.tooltipAlign}
          >
            {segment}
          </Tooltip>
        ) : (
          // `contents` keeps the button a direct flex child of the group, so an
          // untooltipped segment lays out exactly as it did before.
          <span key={opt.value} className="contents">
            {segment}
          </span>
        );
      })}
    </div>
  );
}
