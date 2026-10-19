import { Link } from 'react-router-dom';
import { OPERATOR_BUSINESS_NAME } from './legal/legalMeta';
import { PUBLIC_BILLING_VISIBLE } from '../config/publicBilling';

/**
 * "Managing your data" (Phase 2 Step 6f) — the help documentation Google's
 * Workspace API user data and developer policy requires: developers "must
 * provide user help documentation that explains how users can manage and delete
 * their data from your app or service".
 *
 * It is not the privacy policy and must not turn into it. The policy is a
 * disclosure document, written to be read once by a teacher deciding whether to
 * trust the product and by a board's privacy review; this is an instruction
 * sheet for someone who has already decided and wants to *do* something. Where
 * they overlap the policy is authoritative on what we hold, and this page is
 * authoritative on which button to press.
 *
 * **Public, and deliberately.** The requirement is documentation a user can
 * find, and the readers who most need it are the ones least able to sign in: a
 * teacher whose board has blocked the app, one who has already revoked access,
 * and the Google reviewer checking that the page exists. Putting it behind the
 * sign-in it explains how to undo would be the same mistake `/for-admins`
 * exists to avoid.
 *
 * The organising idea is the one the whole product is built on: there are two
 * separate stores of information, they are deleted in two different places, and
 * a teacher who does not know that will delete the wrong one or neither. So the
 * page is in two halves, and the half a teacher usually means comes first.
 */

function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold text-primary">{heading}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-secondary">
        {children}
      </div>
    </section>
  );
}

const LINK = 'underline hover:no-underline';

export function YourDataPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-semibold text-primary">Managing your data</h1>
      <p className="mt-4 text-md leading-relaxed text-secondary">
        How to see, export, correct or delete anything {OPERATOR_BUSINESS_NAME} holds or touches.
        Nothing on this page needs our help to carry out, and most of it does not involve us at all.
      </p>

      <div className="mt-8 rounded-lg border border-subtle bg-elevated p-4 text-sm leading-relaxed text-secondary">
        <p>
          <strong className="font-semibold text-primary">The one thing worth knowing first.</strong>{' '}
          Your students’ information is not stored on our servers. It is in a Google Sheet on your
          own Google Drive, in your own Google account, which is why you can do nearly everything
          below without us. Your account with us is a separate, much smaller thing: who you are and
          which spreadsheet is yours.
        </p>
        <p className="mt-3">
          Deleting one does not delete the other, and that catches people out in both directions.
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <Section id="student-data" heading="Your students’ information">
          <p>
            Everything you enter about students — names, preferred names, pronouns, contact
            addresses, attendance, notes, groupings and the record of emails you
            have sent — lives in one Google Sheet that this app created on your Drive. You own that
            file.
          </p>
          <p className="text-primary">To see or export all of it</p>
          <p>
            Open Google Drive and look for the spreadsheet named for this app, or open it from your
            recent files. From there, <em>File → Download</em> gives you Excel, CSV, PDF or
            OpenDocument. No export feature in this app could give you anything the spreadsheet does
            not already give you directly.
          </p>
          <p className="text-primary">To correct something</p>
          <p>
            Change it in the app, which is what the app is for. You can also edit the spreadsheet
            directly, but it has a structure the app depends on: change a tab name or a heading and
            the app may stop reading it correctly.
          </p>
          <p className="text-primary">To delete some of it</p>
          <p>
            Delete a student from the Students page, or archive a whole class when the semester ends
            from its Manage Classes tab. Archiving moves a class out of sight while keeping it
            recoverable; deleting a student removes them from the list.
          </p>
          <p className="text-primary">To delete all of it</p>
          <p>
            Delete the spreadsheet in Google Drive, then empty your Drive trash. That is the real
            deletion, because we keep no copy. Check the same folder for any spreadsheet whose name
            begins “Teachneat Data — backup”: the app saves one of these before an update that
            changes the spreadsheet’s structure, and each holds your data as it was at that point.
            Delete those too. Doing this while your account is still open will leave the app with
            nothing to read.
          </p>
        </Section>

        <Section id="access" heading="Taking away this app’s access">
          <p>
            You can withdraw our permission to touch your Google account at any time, without
            deleting anything and without involving us. Go to your Google Account, then{' '}
            <em>Security → Your connections to third-party apps &amp; services</em>, choose{' '}
            {OPERATOR_BUSINESS_NAME}, and remove its access.
          </p>
          <p>
            The app stops working immediately. Your spreadsheet is untouched and stays on your
            Drive. Your account with us continues to exist, so if you are leaving for good, delete
            the account as well.
          </p>
        </Section>

        <Section id="account-data" heading="Your account with us">
          <p>
            What we store is listed in full in the{' '}
            <Link to="/privacy" className={LINK}>
              privacy policy
            </Link>
            . In short: your Google sign-in identity, which spreadsheet is yours, two settings, counts
            of emails sent, and an encrypted token that lets the app act on your
            behalf. No student information.
          </p>
          <p className="text-primary">To delete it</p>
          <p>
            Sign in, open the account menu at the top right, then <em>Account settings</em> →{' '}
            <em>Delete account</em>. It takes effect immediately and cannot be undone. Deleting the
            account revokes this app’s access to your Google account and signs you out everywhere.
          </p>
          <p>
            <strong className="font-semibold text-primary">
              It does not delete your spreadsheet.
            </strong>{' '}
            That file is yours and stays on your Drive with everything in it. If you want it gone
            too, delete it in Drive as described above.
          </p>
          <p className="text-primary">If you cannot sign in</p>
          <p>
            Ask us through the{' '}
            <Link to="/contact" className={LINK}>
              contact form
            </Link>{' '}
            and we will delete the account for you. This is the route for a teacher whose school
            board has blocked the app, or who has already revoked its access, since both leave you
            unable to reach the button.
          </p>
          <p className="text-primary">To see or correct it, instead of deleting it</p>
          <p>
            Ask through the contact form. We will tell you what we hold about you, correct anything
            inaccurate, or send you a copy, within 30 days.
          </p>
        </Section>

        <Section id="sessions" heading="Signing out of a device you no longer have">
          <p>
            <em>Account settings → Log out of all sessions</em> ends every signed-in session on your
            account, on every browser and device, including the one you are using. Use it if you
            have left yourself signed in on a classroom or library computer.
          </p>
          <p>
            This is separate from removing the app’s Google access, and it is worth knowing why: our
            sign-in sessions are ours, so Google cannot end them for you, and revoking Google access
            does not clear them.
          </p>
        </Section>

        <Section id="what-we-keep" heading="What is kept, and for how long">
          <p>
            Account information is deleted within 30 days of the account being closed. Support
            messages are kept for up to 24 months after they are resolved, and go sooner if you
            delete your account. Technical logs are kept for no longer than 30 days.
            {/* There are no billing records to keep while nothing is charged, so
                the sentence naming their retention is gated with the rest of the
                cost copy (`PUBLIC_BILLING_VISIBLE`). The privacy policy, which
                is authoritative on retention, still states it. */}
            {PUBLIC_BILLING_VISIBLE && ' Billing records are kept as long as tax law requires.'}
          </p>
          <p>
            Your students’ information is kept for exactly as long as you keep it in your own Google
            account. We impose no retention period on it and cannot delete it for you.
          </p>
          <p>
            The{' '}
            <Link to="/privacy" className={LINK}>
              privacy policy
            </Link>{' '}
            is the authoritative statement of all of this.
          </p>
        </Section>
      </div>
    </div>
  );
}
