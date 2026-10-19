import { Spinner } from './Spinner';

interface LoadingStateProps {
  /** Caption shown under the spinner and announced to screen readers. */
  label?: string;
}

/**
 * Centered full-page / full-section loading indicator: a rotating ring with an
 * optional caption (DESIGN_SYSTEM Loading States, "full page load"). The
 * `role="status"` wrapper announces the label politely. For small in-panel
 * fetches prefer a skeleton placeholder over this.
 */
export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <Spinner size={28} />
      <span className="text-sm text-secondary">{label}</span>
    </div>
  );
}
