import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Tool name, rendered as the page's `lg` title on the left. */
  title: string;
  /** Right-aligned toolbar controls (class dropdown, view switcher, actions). */
  children?: ReactNode;
}

/**
 * The shared page header row used by every top-level tool page: the title on the
 * left, a right-aligned control cluster on the right, wrapping on narrow
 * viewports. Centralizes the header layout so the tools stay visually aligned.
 *
 * `min-h-9` holds the row at the height of the controls it usually carries (a
 * 36px select or button). A header with none, like Email's, otherwise shrinks to
 * the title's line height and puts its title and everything below it 8px higher
 * than the tools beside it, and a page whose header gains and loses a control
 * between tabs would jump by the same amount.
 */
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
      <h1 className="text-lg font-semibold text-primary">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
