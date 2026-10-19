import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  /** Human-readable, already-sanitized error message (never raw internals). */
  message: string;
  /** Optional recovery control, e.g. a Retry or Back button. */
  action?: ReactNode;
}

/**
 * Centered full-page / full-section error state: a muted warning icon, the
 * message, and an optional recovery action. Shares the empty-state anatomy so a
 * failed load reads consistently with an empty one. `role="alert"` announces it.
 */
export function ErrorState({ message, action }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <AlertTriangle size={48} strokeWidth={1.5} className="text-disabled" aria-hidden="true" />
      <p className="max-w-sm text-sm text-danger">{message}</p>
      {action}
    </div>
  );
}
