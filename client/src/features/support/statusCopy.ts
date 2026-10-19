import type { SupportCategory, SupportStatus } from '../../api/support';

/** The five categories, in the order the form offers them. */
export const CATEGORY_OPTIONS: { value: SupportCategory; label: string }[] = [
  { value: 'question', label: 'Question' },
  { value: 'bug', label: 'Something is broken' },
  { value: 'billing', label: 'Billing or subscription' },
  { value: 'feature', label: 'Feature suggestion' },
  { value: 'other', label: 'Something else' },
];

export const STATUS_LABELS: Record<SupportStatus, string> = {
  new: 'New',
  open: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * Status colours, from the semantic tokens rather than hex values. `new` and
 * `open` are deliberately not the accent colour: the accent means premium
 * throughout the app, and a support status is unrelated to plan.
 */
export const STATUS_CLASSES: Record<SupportStatus, string> = {
  new: 'border-strong text-primary',
  open: 'border-subtle text-secondary',
  resolved: 'border-subtle text-success',
  closed: 'border-subtle text-secondary',
};

export function formatSubmitted(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
