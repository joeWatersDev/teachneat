/**
 * The agreements a teacher must accept before the app will serve them anything
 * (Phase 2 Step 5c).
 *
 * Google's consent screen covers Google's scopes. It says nothing about our
 * terms, and nothing at all about the obligation that actually matters for this
 * product: student data living on the teacher's own Drive does not make the
 * teacher's legal position someone else's problem. Before this, an account was
 * created straight out of the OAuth callback having agreed to nothing.
 *
 * The version below is what makes this maintainable. Consent is recorded as a
 * version, not just a timestamp, so revising the terms re-prompts every existing
 * account automatically instead of leaving a population that agreed to text
 * nobody can reconstruct. Bump it whenever the terms, the privacy policy, or the
 * acknowledgement wording below change in substance.
 *
 * The placeholder version this replaced (`1970-01-01-placeholder`) marked consent
 * given against text that had not been written. Step 6c wrote it, so `2026-08-04`
 * was the first real version, and `.2` was the consistency pass over it — a
 * correction to the Google permissions section, a disclosure of technical logs,
 * and the removal of two claims about controls that do not exist. `2026-08-13`
 * is the rename to Teachneat (Step 6g), which changes the name of the service
 * and of the business the operator trades under throughout both documents, and
 * the acknowledgement sentence below with them. Both substantive, so both
 * re-prompt.
 *
 * `2026-08-19` covers two changes batched into one re-prompt, as the Step 6h ordering
 * note asked for. Step 6h added Resend as a subprocessor and did not bump,
 * leaving the repository's policy naming a processor no account had consented
 * to; Step 6j added the activation milestones and the monthly usage counters,
 * which made the previous sentence "we do not record what you do inside the
 * app" untrue. Both are substantive and both re-prompt.
 *
 * `2026-08-31` is Step 8a: the IEP surface removed from both documents, the
 * payment section rewritten for a Service provided at no charge during early
 * access, the Ontario scope stated in eligibility, and Stripe removed as a
 * subprocessor. Each of the four is substantive on its own. The full reasoning
 * is in legalMeta.ts beside the text it describes.
 *
 * `2026-09-12` is an accuracy sweep. It re-prompts because the terms stated a
 * daily sending limit of 200 after the cap had become 120; the other
 * corrections (the dropped `spreadsheets` scope, billing wording 8a missed, the
 * second cookie) ride along. The list is in legalMeta.ts.
 *
 * It must equal `DOCUMENT_VERSION` in client/src/pages/legal/legalMeta.ts, which
 * is what the published documents display. The two drifting apart would either
 * re-prompt everybody for nothing or record consent against a version string that
 * cannot be mapped back to any text.
 */
export const CURRENT_TERMS_VERSION = '2026-09-12';

/**
 * The data-responsibility acknowledgement, in full.
 *
 * It lives here rather than only in the client because it is the one agreement
 * that is self-contained — a teacher accepts it by reading the sentence in front
 * of them, not by following a link to a document. That makes it a materially
 * stronger record than acceptance of a linked document, and it makes this string
 * the authoritative record of what was agreed. Change it and bump the version
 * above; the two are one edit, never one without the other.
 */
export const DATA_RESPONSIBILITY_ACKNOWLEDGEMENT =
  'I understand that student information I enter is stored in my own Google ' +
  'account, that I remain responsible for it, and that complying with the ' +
  'privacy laws, records regulations, and school board or district policies ' +
  'that apply to me is my responsibility, not Teachneat’s.';

/**
 * Whether an account's recorded consent satisfies the version in force.
 *
 * Both timestamps are checked even though `recordConsent` always writes them
 * together. They are two agreements, and a future change that lets them be
 * accepted separately should break this function rather than silently pass an
 * account that only gave one of them.
 */
export function consentIsCurrent(account: {
  termsAcceptedAt: string | null;
  termsVersion: string;
  dataResponsibilityAcceptedAt: string | null;
}): boolean {
  return (
    account.termsAcceptedAt !== null &&
    account.dataResponsibilityAcceptedAt !== null &&
    account.termsVersion === CURRENT_TERMS_VERSION
  );
}
