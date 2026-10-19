import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  /** Tool-relevant icon, rendered at 48px in `text-disabled` (DESIGN_SYSTEM). */
  icon: LucideIcon;
  heading: string;
  description?: string;
  /** Optional primary action, e.g. "Add Your First Student". */
  action?: ReactNode;
}

/**
 * Centered empty state (DESIGN_SYSTEM Empty States): a tool-relevant icon, a
 * short heading, a one-line description, and an optional primary action button.
 */
export function EmptyState({ icon: Icon, heading, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Icon size={48} strokeWidth={1.5} className="text-disabled" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-primary">{heading}</h1>
      {description && <p className="max-w-sm text-sm text-secondary">{description}</p>}
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  );
}
