import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  /** Inline style for exact sizing where a utility class won't do (e.g. grid cells). */
  style?: CSSProperties;
}

/**
 * A pulsing placeholder block for inline data fetches (DESIGN_SYSTEM Loading
 * States, "inline data fetch"): `bg-hover` with a subtle pulse, shaped to match
 * the content it stands in for. Decorative — wrap a group in a `role="status"`
 * container with an sr-only label so the load is still announced. Under
 * `prefers-reduced-motion` the pulse settles after one cycle (global CSS rule).
 */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`block animate-pulse rounded bg-hover ${className}`}
    />
  );
}
