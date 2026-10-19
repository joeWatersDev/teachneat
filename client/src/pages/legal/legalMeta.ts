/**
 * The facts both legal documents depend on, in one place (Phase 2 Step 6c).
 *
 * These are deliberately constants rather than prose repeated across two files.
 * The operating entity, the effective date and the version appear in a dozen
 * places between the privacy policy and the terms, and a document that
 * contradicts itself about who the operator is or which version it is is worse
 * than one that is merely out of date.
 *
 * `DOCUMENT_VERSION` must equal `CURRENT_TERMS_VERSION` in
 * server/src/config/legal.ts. That server constant is what the consent gate
 * compares against, so the two moving apart would either re-prompt everybody for
 * no reason or record consent against a version string nobody can map back to
 * the text below. Change them together, always.
 */

/**
 * The operator, as it must appear on a consumer contract: the natural person
 * who carries the obligations, and the registered business name they trade
 * under. A sole proprietorship is not a separate legal person, so naming only
 * the business name would leave the counterparty unidentified.
 */
export const OPERATOR_LEGAL_NAME = 'Joseph Waters';
export const OPERATOR_BUSINESS_NAME = 'Teachneat';
export const OPERATOR_DESCRIPTION = `${OPERATOR_LEGAL_NAME}, carrying on business as ${OPERATOR_BUSINESS_NAME}`;

/** Province and country of the operator. Fixes governing law and the forum. */
export const OPERATOR_JURISDICTION = 'Ontario, Canada';

/**
 * The operator's mailing address, or empty while there is none (Step 8c).
 *
 * Both documents' contact sections print it when it is set and omit the line
 * entirely when it is not, the same way the lifecycle email footer does, because
 * a wrong address is worse than an absent one. It must equal
 * `OPERATOR_POSTAL_ADDRESS` in server/src/config/lifecycleEmail.ts, and
 * server/src/config/legal.test.ts fails when the two differ: the documents and
 * the email footer naming different addresses for one operator would hand a
 * reviewer the inconsistency to find.
 *
 * Filling it in does NOT bump the version constants, by the test applied to the
 * contact email below: it adds a way to reach the operator and changes nothing
 * about what is collected, why, where it goes, or who touches it.
 *
 * One line, comma-separated, as it should read after "carrying on business as
 * Teachneat, ".
 */
export const OPERATOR_POSTAL_ADDRESS = '';

/**
 * The privacy contact. PIPEDA requires an accessible route to the individual
 * accountable for personal information, and Google's OAuth verification expects
 * a contact on the policy itself.
 *
 * A role address at the operating domain rather than a personal mailbox,
 * deliberately. This line is read by a school board's privacy officer and by
 * Google's OAuth verification reviewer, which is the same audience `/for-admins`
 * exists for, and a consumer address undercuts it. It also survives a change of
 * mail provider, which a personal address does not, and it keeps a permanently
 * public document from carrying someone's personal inbox.
 *
 * Delivery is Cloudflare Email Routing, forwarding to the operator's own inbox.
 * That is inbound correspondence only — mail a person chose to send us, relayed
 * by a conduit — so Cloudflare is deliberately NOT added to `SUBPROCESSORS` for
 * it. The distinction from Resend, which is listed, is that Resend sends on our
 * behalf to our users; this receives what someone sent to us. It is a judgment
 * rather than a settled rule, and it is recorded in NEXT_STEPS so that a later
 * reader can disagree with the reasoning rather than guess at it.
 *
 * Filling this in did NOT bump the version constants. It adds a channel and
 * changes nothing about what is collected, why, where it goes, or who touches
 * it, and the route to the contact form that stood while this was empty is
 * still there. A consent re-prompt for a new mailto link would spend every
 * account's attention on nothing.
 */
export const PRIVACY_CONTACT_EMAIL = 'privacy@teachneat.com';

/**
 * The date this version of the documents takes effect, and the version string
 * recorded against every teacher's consent. Dated rather than numbered so the
 * record says *when* as well as *which*, with a revision suffix for a second
 * substantive change on the same day.
 *
 * `2026-08-04.2` was the consistency pass over the first draft: the Google
 * permissions section had omitted the three sign-in identity scopes, technical
 * logs were not disclosed at all, the forum clause did not yield to the
 * arbitration clause, and both documents claimed a sign-out-everywhere control
 * that does not exist.
 *
 * `2026-08-13` is the rename to Teachneat (Step 6g). Both documents name the
 * service and the business name the operator trades under, so every clause that
 * identifies the counterparty changed. That is substantive by any reading, and
 * it re-prompts.
 *
 * **Superseded versions must remain recoverable.** Consent is recorded as a
 * version string and nothing else, so a version whose text cannot be produced is
 * a consent record that proves nothing. Git history is that archive today, and
 * the "changes" section of each document promises the accepted text on request;
 * if the documents ever stop living in this repository, an explicit archive has
 * to replace it.
 */
// `2026-08-19` covers two changes batched into one re-prompt, as the Step 6h ordering
// note asked for. Step 6h added Resend as a subprocessor and did not bump,
// leaving the repository's policy naming a processor no account had consented
// to; Step 6j added the activation milestones and the monthly usage counters,
// which made the previous sentence "we do not record what you do inside the
// app" untrue. Both are substantive and both re-prompt.
// Step 8d did NOT bump. It replaced the administrators section's "the vendor
// holds no student records" with the durable-copy formulation, which is a
// summary line made consistent with the body it summarises: the leading section
// already disclosed the short-lived copy in server memory, and the practice
// being described did not change. By the same test the contact address was
// judged against above — nothing changed about what is collected, why, where it
// goes, or who touches it — a re-prompt would spend every account's attention on
// a correction that grants the reader nothing new. Step 8a is the substantive
// change to these documents and is the one that re-prompts.
//
// `2026-08-31` is Step 8a, and it re-prompts on four counts, any one of which
// would have been enough:
//
//   - The IEP surface is removed from the product permanently, so both
//     documents stop listing accommodation records among what the Service holds
//     and what is written to the teacher's sheet. The terms name no category of
//     student information at all now: the consent warranty used to caution about
//     accommodation and health-related information in particular, which read as
//     confirmation that the Service is a place to record it. It is general
//     instead — consent for whatever is entered, plus an acknowledgement that
//     the Service is a general classroom tool represented as suitable for no
//     particular category of information and for no regulated purpose.
//   - The Service is free during early access. The terms' payment section
//     described automatic renewal, cancellation, refunds, price changes and
//     failed payments, none of which can happen; it now states that the Service
//     is provided at no charge, that those provisions are inoperative until a
//     paid plan is offered and accepted, and that no charge will be made
//     without 30 days' notice and the account holder's agreement.
//   - The Service is offered to teachers in Ontario. Stated in eligibility and
//     enforced nowhere — no check at signup, no country field, no geolocation.
//     It is a term of the contract and an answer for a lawyer and an
//     underwriter, not a control, and Step 8a commits to no enforcement.
//   - Stripe is removed from SUBPROCESSORS below, and from the terms' list of
//     services the Service depends on.
//
// `2026-09-12` is an accuracy sweep against the deployed product, and it
// re-prompts because the terms stated a sending limit that was no longer the
// limit: 200 a day "and lower limits on some plans", when 8a had lowered the
// cap to 120 and removed the plans without correcting the sentence. A stated
// term of use changed, so by the documents' own rule it is substantive. The
// rest rides the same re-prompt, and most of it would not have justified one:
//
//   - The `spreadsheets` scope is gone. The privacy policy lists two data
//     permissions and says `drive.file` covers reading and writing the sheet.
//   - Billing wording 8a missed is removed from the privacy policy: the
//     billing-only purposes and messages (trials, renewals, discounts ending,
//     billing failures), the payment processor's cross-border qualification,
//     the billing-records retention line, and the administrators summary's
//     "payment processing the one exception" and "the teacher is the
//     purchaser". The Canada exception now names Resend, which it should have
//     since 6h. The terms lose "if payment fails" and "offered in part free of
//     charge". **Restoring billing restores those purposes, the trial and
//     billing messages, the processor qualification and the retention line**,
//     alongside the Stripe entry below.
//   - The cookies section said one cookie; there are two, the session cookie
//     and the ten-minute OAuth state cookie.
//   - The counters line described only the monthly email count as enforcing a
//     limit; the daily count does that while billing is dormant.
//   - The milestone "reached a Premium feature on a free account" is removed
//     from the list, since it cannot occur while every account has every
//     feature. Restore it with billing.
//   - The terms say the Service creates a folder and may save a pre-migration
//     copy of the sheet, and "hold no copy" becomes "keep no lasting copy", the
//     durable-copy formulation 8d applied to the policy.
export const EFFECTIVE_DATE = '2026-09-12';
export const DOCUMENT_VERSION = '2026-09-12';

/**
 * Everyone outside this business who processes data on its behalf, with where
 * they do it. This list is a substantive commitment, not decoration: the privacy
 * policy names it, a board's privacy review reads it, and adding a service
 * without adding it here makes the policy false. Error monitoring and log
 * aggregation are deliberately absent because neither is deployed yet (Step 6d);
 * when they are added, they go here and the version is bumped.
 *
 * **Two entries below describe Step 6d's end state, not today's deployment**:
 * the database is on a local Postgres and the token key is in an environment
 * variable until the hosting move happens. The policy states both as present
 * fact, which is why the domain must not become publicly reachable until the
 * deployment matches it. Recorded as an ordering constraint in NEXT_STEPS.md.
 */
export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
}

/**
 * **Stripe was removed from this list by Step 8a, and returns with billing.**
 * The entry to restore, verbatim:
 *
 *     {
 *       name: 'Stripe, Inc. and Stripe Payments Canada, Ltd.',
 *       purpose: 'Subscription billing and payment processing',
 *       location: 'United States and Canada',
 *     }
 *
 * It was removed rather than annotated because this list is read by a board's
 * privacy officer and a Google reviewer asking who touches the data, and while
 * the Service is free Stripe touches none of it: no checkout is offered, no
 * payment details are collected, and nothing is sent. Naming a party that
 * receives nothing overstates the data flow to exactly the readers the list
 * exists for.
 *
 * Removing it costs no approval either way, which is the reason it was safe to
 * do. Google's OAuth verification keys on the scopes, the branding and the
 * policy's URL rather than on its contents, and a board's allowlisting keys on
 * the OAuth client id and its scopes; neither is invalidated by a subprocessor
 * change, so adding Stripe back does not re-enter either queue. That is
 * process knowledge with a shelf life, and it is on the list for the Step 8c
 * legal review to confirm rather than something settled here.
 *
 * Restoring the entry is a substantive change and bumps the version with it.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'DigitalOcean, LLC',
    purpose: 'Application hosting and the managed database holding account information',
    location: 'Toronto, Canada',
  },
  {
    name: 'Google LLC',
    purpose:
      'Google Cloud Key Management Service, which holds the key used to encrypt stored Google authorisation tokens',
    location: 'Montréal, Canada',
  },
  {
    // Phase 2 Step 6h. It receives the teacher's own name and email address and
    // the text of the six service messages, which are written about the account
    // and interpolate nothing from the teacher's spreadsheet — so no student
    // information reaches it, by construction rather than by policy.
    name: 'Resend (Plus Five Five, Inc.)',
    purpose: 'Sending service messages about your account, such as confirmations and notices',
    location: 'United States',
  },
];
