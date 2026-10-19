import { Logo } from './Logo';

/**
 * The Teachneat wordmark and the mark-plus-wordmark lockup.
 * `design/brand/README.md` is authoritative for both.
 *
 * The wordmark is **type set live, not an outline**. This project ships no
 * custom font by design, so the wordmark has no fixed shape: it is the system
 * stack with a weight split across the join — 650 on "Teach", 400 on "neat" —
 * and it resolves differently per machine on purpose. The SVG files in
 * `design/brand/` exist for contexts that cannot run CSS; this component is the
 * canonical rendering.
 *
 * 650 is not a Tailwind weight step, so it is set inline rather than
 * approximated with `font-semibold`. The split is the whole design, and 600
 * against 400 is a visibly weaker one.
 *
 * "neat" is deliberately not coloured in the accent: that gold is
 * mode-invariant and fails WCAG AA as text at body sizes against both
 * backgrounds.
 */
export function Wordmark({
  className = '',
  plain = false,
}: {
  className?: string;
  /**
   * Drop the weight split and set the whole name at the surrounding weight.
   *
   * For the one place the wordmark is not acting as a mark: the footer line,
   * where it is 12px, in secondary grey, and inside an ordinary sentence. At
   * that size and in that position the heavier "Teach" stops reading as the
   * join in a wordmark and starts reading as emphasis on the first syllable of
   * a word, which is worse than no split at all. Everywhere the wordmark is
   * presented as a mark — the lockup in both headers, the hero — keeps it.
   */
  plain?: boolean;
}) {
  return (
    // No colour of its own: it inherits, so a footer line can keep the wordmark
    // in the same secondary grey as the sentence around it. Two competing
    // Tailwind colour classes on one element would resolve by CSS source order
    // rather than by the caller.
    <span className={`whitespace-nowrap tracking-[-0.02em] ${className}`}>
      <span style={plain ? undefined : { fontWeight: 650 }}>Teach</span>
      <span style={plain ? undefined : { fontWeight: 400 }}>neat</span>
    </span>
  );
}

/**
 * Mark and wordmark, horizontally, vertically centred. One rule rather than
 * three numbers: at a mark of size M, the type is 0.625 M and the gap is
 * 0.25 M. At the 32px both headers use, that is 20px type (`text-lg`) and an
 * 8px gap (`gap-2`).
 *
 * The gap is measured box to box rather than ink to ink. The mark's box is 32
 * wide while its ink starts at x4.5, so the visible whitespace runs a little
 * wider than the number — that is the convention the lockup was chosen under.
 *
 * The mark inside a lockup is decorative: the name is right beside it in real
 * text, so it carries no accessible name of its own.
 */
export function Lockup({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo size={32} />
      <Wordmark className="text-lg text-primary" />
    </span>
  );
}
