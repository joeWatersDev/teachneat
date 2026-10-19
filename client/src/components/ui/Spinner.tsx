import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  /** Diameter in px. Defaults to 20 (inline size). */
  size?: number;
  className?: string;
}

/**
 * A simple rotating ring in `text-secondary` (DESIGN_SYSTEM Loading States).
 * Purely decorative — wrap it in a `role="status"` container with a label when
 * it conveys a loading state to assistive tech (see LoadingState).
 */
export function Spinner({ size = 20, className = '' }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      className={`animate-spin text-secondary ${className}`}
    />
  );
}
