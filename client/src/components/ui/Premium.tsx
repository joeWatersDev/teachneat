import { useId, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { LAPSED_REASSURANCE, lapsedSentence, premiumSentence } from './premiumCopy';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useUpgradeIfAvailable } from '../../hooks/useUpgrade';

/**
 * How a premium feature presents itself (DESIGN_SYSTEM "Premium feature
 * affordance"). Premium features are always visible, never hidden — a teacher
 * cannot want what they cannot see, and surfacing the boundary continuously
 * means nobody meets it as a surprise.
 *
 *   paid  — no marker at all. A paying user never sees the word "premium".
 *   trial — fully usable, and marked, so trial expiry is an expected transition.
 *   free  — marked and disabled, with the explanation reachable by tooltip and
 *           by `aria-describedby` for screen-reader users.
 *
 * None of this is a security boundary; the server gates every premium endpoint.
 */

/** The accessible name every marker carries, whatever it looks like. */
const MARKER_LABEL = 'Premium feature';

/**
 * The premium marker: an accent star, explained once by the sidebar legend
 * rather than by a word repeated on every control. It is icon-only to the eye
 * but never to a screen reader — the label is what a screen-reader user gets
 * instead of the legend, so it stays explicit here.
 *
 * Renders nothing on `paid`, where no marker belongs.
 */
export function PremiumBadge() {
  const { billingEnabled, plan } = useEntitlements();
  // Step 8a: with no paid tier there is no boundary to mark, and a star
  // explained by a legend that is also gone would be a symbol with no meaning.
  if (!billingEnabled || plan === 'paid') return null;
  return (
    <Star
      size={14}
      strokeWidth={2}
      className="shrink-0 fill-accent text-accent"
      role="img"
      aria-label={MARKER_LABEL}
    />
  );
}

interface PremiumControlProps {
  /**
   * What the feature does, phrased plainly — "Keep-together and keep-apart rules
   * are part of Premium," not "Upgrade now to unlock." One sentence.
   */
  explanation: string;
  /** Receives the lock state and the id of the description to point at. */
  children: (state: { locked: boolean; describedBy: string | undefined }) => ReactNode;
}

/**
 * Wraps a single premium control. On `free` it supplies the tooltip and a
 * visually hidden description with a stable id, so the control can carry
 * `aria-disabled` and `aria-describedby` and screen-reader users get the same
 * information sighted users get from hovering.
 */
export function PremiumControl({ explanation, children }: PremiumControlProps) {
  const { isPremium } = useEntitlements();
  const id = useId();
  if (isPremium) return <>{children({ locked: false, describedBy: undefined })}</>;
  return (
    <>
      <Tooltip label={explanation}>{children({ locked: true, describedBy: id })}</Tooltip>
      <span id={id} className="sr-only">
        {explanation}
      </span>
    </>
  );
}

/**
 * Stands in for a premium view or panel on `free`. `compact` suits a panel
 * sharing a card with free content; the default fills a view.
 *
 * This is the gated-control upgrade entry point that DESIGN_SYSTEM described as
 * arriving with Step 5. The rule it follows is `promptFromGatedControls`, which
 * is true on `free` only: on `trial` a premium view is live and merely badged,
 * so it never renders this notice at all, and offering an upgrade from a
 * feature someone is currently using would interrupt them to sell them what
 * they have. The button is absent rather than disabled outside a provider,
 * because a notice that cannot start checkout should not imply that it can.
 */
export function PremiumNotice({
  feature,
  plural = false,
  compact = false,
}: {
  /** The feature's name, as the teacher would say it ("Attendance statistics"). */
  feature: string;
  /** Whether the name takes "are" rather than "is". */
  plural?: boolean;
  compact?: boolean;
}) {
  const upgrade = useUpgradeIfAvailable();
  const { lapsedFrom } = useEntitlements();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center ${
        compact ? 'py-6' : 'py-16'
      }`}
    >
      <Star
        size={compact ? 24 : 48}
        strokeWidth={1.5}
        className="text-disabled"
        aria-hidden="true"
      />
      <p className="max-w-sm text-sm text-secondary">
        {lapsedFrom
          ? lapsedSentence(feature, plural, lapsedFrom)
          : premiumSentence(feature, plural)}
      </p>
      {/* Second only for a lapsed account, because only they can believe
          something was lost. An account that never had premium is not
          reassured by being told nothing was deleted; it is confused by it. */}
      {lapsedFrom && <p className="max-w-sm text-sm text-secondary">{LAPSED_REASSURANCE}</p>}
      {upgrade?.promptFromGatedControls && (
        <button
          type="button"
          onClick={upgrade.openUpgrade}
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-hover"
        >
          {lapsedFrom ? 'Get Premium back' : 'Upgrade to Premium'}
        </button>
      )}
    </div>
  );
}
