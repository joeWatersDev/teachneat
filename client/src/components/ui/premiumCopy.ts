import type { LapsedFrom } from '../../api/auth';

/**
 * The one sentence every gated surface uses, so a teacher meets identical
 * wording wherever they reach a paid feature — "Attendance statistics are a
 * premium feature." It names the feature and stops; anything longer starts
 * arguing for the upgrade, which is the upgrade prompt's job.
 *
 * Its own module rather than a second export from Premium.tsx, which holds only
 * components.
 */
export function premiumSentence(feature: string, plural = false): string {
  return `${feature} ${plural ? 'are' : 'is'} a premium feature.`;
}

/**
 * The same sentence for a teacher who *had* this feature and no longer does
 * (Phase 2 Step 6h).
 *
 * The distinction is the whole point of the trial-to-free moment: an account
 * that never had premium is meeting a boundary, and an account that has been
 * reading Statistics for a month has had something taken away. Told the same
 * thing, the second teacher reads it as a product that broke. So this variant
 * says what happened and the reassurance below carries the fact they actually
 * need.
 *
 * **It names the actual cause, because the original wording named the wrong one.**
 * This said "Your trial has ended" for every lapsed account, so a teacher who
 * paid for a year and then cancelled was told about a trial that finished
 * thirteen months earlier, and so was one whose subscription is paused for the
 * summer — while their own account page said, correctly, that it was paused.
 *
 * The paused variant is the one that is not a loss at all, so it is the one that
 * does not say "now part of Premium": nothing has been taken away and nothing
 * needs buying, the feature is simply asleep until billing resumes.
 */
export function lapsedSentence(feature: string, plural = false, from: LapsedFrom = 'trial'): string {
  const name = lowerFirst(feature);
  const verb = plural ? 'are' : 'is';
  if (from === 'paused') {
    return `Your subscription is paused, so ${name} ${verb} unavailable until it resumes.`;
  }
  const cause = from === 'subscription' ? 'Your subscription has ended' : 'Your trial has ended';
  return `${cause}, so ${name} ${verb} now part of Premium.`;
}

/**
 * The reassurance that goes with it, and the reason this variant exists at all.
 * A teacher who has entered a month of attendance and finds the statistics gone
 * will assume the records went with them. They did not, and nothing in the
 * app says so unless it is said here.
 */
export const LAPSED_REASSURANCE =
  'Your records are all still here, and your spreadsheet has not been touched.';

/** "Attendance statistics" → "attendance statistics", mid-sentence. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
