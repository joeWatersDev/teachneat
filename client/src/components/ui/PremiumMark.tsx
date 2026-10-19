import { Sparkles } from 'lucide-react';

/**
 * The Premium mark: a statement of account state, not an advertisement.
 *
 * A paid teacher sees this every day and can neither click it nor buy anything
 * from it, so it is deliberately quiet. Earlier drafts filled it with a gold
 * gradient, which read as a primary button in an app where every other accent
 * fill is one, and competed with the navigation beside it daily. The gold now
 * lives in a muted tint, a hairline border, and the icon; the label takes
 * ordinary text colour.
 *
 * This also puts the mark inside the accent rule (DESIGN_SYSTEM: accent is never
 * a text colour at body size, and never carries light text), so it is not an
 * exception to anything.
 *
 * Shared rather than local because two places now state the same fact about an
 * account — the sidebar plan footer and the account settings page — and a badge
 * that means "this account is Premium" must not be able to look like two
 * different things depending on where a teacher is standing.
 */
export function PremiumMark({ collapsed = false }: { collapsed?: boolean }) {
  const surface = 'border border-accent/60 bg-accent-muted';
  if (collapsed) {
    return (
      <span
        role="img"
        aria-label="Premium account"
        className={'grid h-9 w-9 place-items-center rounded-lg ' + surface}
      >
        <Sparkles size={16} strokeWidth={2} className="text-accent" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={
        'inline-flex items-center gap-2 rounded-full py-1 pl-2.5 pr-3 text-sm font-semibold text-primary ' +
        surface
      }
    >
      <Sparkles size={14} strokeWidth={2} className="shrink-0 text-accent" aria-hidden="true" />
      Premium
    </span>
  );
}
