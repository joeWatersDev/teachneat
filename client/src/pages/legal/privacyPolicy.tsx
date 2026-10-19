import { Link } from 'react-router-dom';
import { ContactRoute, type LegalSection, SectionRef, Term } from './LegalDocument';
import { TERMS_SECTIONS } from './termsOfService';
import {
  OPERATOR_BUSINESS_NAME,
  OPERATOR_DESCRIPTION,
  OPERATOR_JURISDICTION,
  OPERATOR_POSTAL_ADDRESS,
  SUBPROCESSORS,
} from './legalMeta';

/**
 * The privacy policy (Phase 2 Step 6c).
 *
 * Written against the shipped architecture rather than against a template, and
 * the distinction it is built on is the one the product is built on: there are
 * two kinds of information, held in two places, with two different people
 * accountable for them. Account information is ours and we answer for it.
 * Student information lives in the teacher's own Google account, and they do.
 * Every section below either states which of the two it is talking about or
 * applies to both on purpose.
 *
 * Three constraints shaped it beyond ordinary practice:
 *
 * - **PIPEDA** applies, because the operator carries on commercial activity in
 *   Canada and Ontario has no general private-sector privacy statute. That is
 *   what fixes the accountability, consent, retention, access and breach
 *   sections, and the reference to the federal Commissioner.
 * - **Google's API Services User Data Policy, including its Limited Use
 *   requirements**, has to be satisfied verbatim enough to survive OAuth
 *   verification in Step 9. The "google-access" section is written for that
 *   reviewer as much as for a teacher, which is why it enumerates the scopes and
 *   states the Limited Use commitments explicitly.
 * - **A school board's privacy review** is a real reader with a checklist:
 *   where is the data, who are the subprocessors, what is the retention, what
 *   happens on breach. Those get their own numbered sections so they can be
 *   cited by URL.
 *
 * The one place a teacher can put student information into our database despite
 * the design is the support form's free-text field, and the "student-information"
 * section says so rather than claiming an absolute the code cannot guarantee.
 */

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: 'who-we-are',
    heading: 'Who is responsible for your information',
    body: (
      <>
        <p>
          {OPERATOR_BUSINESS_NAME} is operated by {OPERATOR_DESCRIPTION}, a sole proprietorship
          based in {OPERATOR_JURISDICTION}. In this policy, “we”, “us” and “our” mean that operator,
          and “you” means the teacher or other individual who holds an account or contacts us.
        </p>
        <p>
          We are accountable for the personal information described in <SectionRef sections={() => PRIVACY_SECTIONS} id="what-we-collect" /> as{' '}
          <Term>account information</Term>. Questions, access requests and complaints about it can
          be sent through the <ContactRoute />, and are handled by the operator personally.
        </p>
        <p>
          This policy applies to the {OPERATOR_BUSINESS_NAME} website and web application. It does
          not apply to Google, to your school or school board, or to any other service you reach
          from our site.
        </p>
      </>
    ),
  },
  {
    id: 'two-kinds-of-information',
    heading: 'The two kinds of information, and who holds each',
    body: (
      <>
        <p>
          This is the most important section in the policy, and everything below depends on it.
        </p>
        <p>
          <Term>Account information</Term> is information about you as our customer: who you are,
          which spreadsheet belongs to you, what your account is entitled to. We store it in our
          database, we decide how it is handled, and we are accountable for it.
        </p>
        <p>
          <Term>Student information</Term> is what you enter about the students you teach: names,
          preferred names, pronouns, contact addresses, attendance, notes, groupings and the record
          of emails you send. It is
          stored in a Google Sheet on your own Google Drive, inside your own Google account. We
          store no copy of it in our database. We read from and write to that sheet on your
          instruction, in order to show you the app, and nothing more; while you are working, a
          short-lived copy sits in our server’s memory, which{' '}
          <SectionRef sections={() => PRIVACY_SECTIONS} id="student-information" /> describes in
          full.
        </p>
        <p>
          The practical consequences are worth stating plainly. You can open, export, edit or delete
          that spreadsheet at any time without involving us. You can withdraw our access from your
          Google account settings, and the app then stops working while your data stays exactly
          where it is. If this business shut down tomorrow, your student records would be
          unaffected. And because that information sits in your own account, under whatever
          agreement your school or board has with Google, you are the person accountable for it
          under the privacy, education and records laws that apply to you.{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="student-information" label="Section" /> of the{' '}
          <Link to="/terms" className="underline hover:no-underline">
            Terms of Service
          </Link>{' '}
          sets out what that means in practice.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    heading: 'Account information we collect and store',
    body: (
      <>
        <p>
          We collect only what the service needs to function. The complete list of what is stored
          in our database is:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <Term>Your Google account identity</Term>: the account identifier Google gives us, your
            email address, your display name, and the URL of your Google profile picture.
          </li>
          <li>
            <Term>Your organisation’s domain</Term>, if you sign in with a managed Google Workspace
            account (for example a school board domain). We record this because the ability to use
            the app at all is granted or blocked by an administrator for a whole domain at once, so
            it lets us recognise when several people are blocked for the same reason. It is your
            employer’s domain, not information about any student.
          </li>
          <li>
            <Term>The identifier of the Google Sheet</Term> that holds your data, so we can find it
            again. Not its contents.
          </li>
          <li>
            <Term>An encrypted Google authorisation token</Term>, which is what lets the app act on
            your behalf between sign-ins. See <SectionRef sections={() => PRIVACY_SECTIONS} id="google-access" />.
          </li>
          <li>
            <Term>Plan and billing fields</Term>: your plan, a trial end date, subscription status,
            and identifiers that would be issued by a payment processor. The Service is free during
            early access, so no payment is taken, no payment processor is involved, and these fields
            hold no billing information. We have never received or stored a card number, and we do
            not collect one.
          </li>
          <li>
            <Term>Two settings and two counters</Term>: your chosen high-absence threshold, whether
            you have completed the first-run guide, the number of emails you have sent today, which
            is how the daily sending limit is enforced, and a monthly count of emails sent that
            applies only to a plan with a monthly allowance. The counters are numbers, not a record
            of who you wrote to.
          </li>
          <li>
            <Term>A record of your agreement</Term> to these documents: the version you accepted and
            when you accepted it.
          </li>
          <li>
            <Term>Session records</Term>: for each device you are signed in on, a one-way hash of
            the session identifier held in your browser cookie, and the times the session was
            created, last used, and expires. The hash means a copy of our database yields no usable
            sign-in credentials.
          </li>
          <li>
            <Term>Support requests</Term> you send us: the category, subject and message you write,
            our internal status and notes, and, if you were not signed in, the name and email
            address you supplied. See <SectionRef sections={() => PRIVACY_SECTIONS} id="student-information" />.
          </li>
        </ul>
        <p>
          <Term>Separately from that database, our servers keep ordinary technical logs.</Term> A
          log entry records the time of a request, what was asked for, how the server answered, how
          long it took, and the network address the request came from. We use them to keep the
          service running, to diagnose faults, and to detect and limit abuse — including the
          per-connection limit on the public contact form, which counts recent submissions from a
          network address in memory and stores nothing. Names, email addresses and authorisation
          tokens are removed from log output automatically, student information is not written to
          it, and logs are kept for no longer than 30 days. See{' '}
          <SectionRef sections={() => PRIVACY_SECTIONS} id="retention" />.
        </p>
        <p>
          We do not operate any analytics, advertising, tracking or profiling technology, we load no
          third-party script on any page, and we do not buy or receive personal information about you
          from anyone else. Nothing about your use of the app is sent anywhere outside the systems
          listed in{' '}
          <SectionRef sections={() => PRIVACY_SECTIONS} id="disclosure" />.
        </p>
        <p>
          We do keep two simple measurements of how the app is used, both stored against your
          account and neither shared with anyone. The first is the date you first did each of a
          short list of things: finished the setup guide, added your first student, saved attendance,
          created groups, opened the name picker, and sent your first email. Each of these is recorded once, the first time it happens, and
          is never updated afterwards. The second is a count, per calendar month, of how many times
          you used each tool. It is a count and nothing else: we do not store the time of day, the
          class, the students involved, or anything you typed, so it cannot be used to reconstruct
          what you did or when you were working.
        </p>
        <p>
          We use these to understand which parts of the product teachers actually adopt and where
          new users get stuck. They are never used to make a decision about you individually, and
          they are never combined with student information, which we do not hold.
        </p>
      </>
    ),
  },
  {
    id: 'student-information',
    heading: 'What we do, and do not do, with student information',
    body: (
      <>
        <p>
          No student names, contact addresses, attendance records, notes, group assignments or
          email history are stored in our database. They are written directly
          to your Google Sheet.
        </p>
        <p>
          Student information does pass through our servers, because our server is what talks to
          Google on your behalf. While you are actively using the app, a copy is held in the
          server’s memory so that the app does not have to re-read your spreadsheet on every click,
          which is a technical necessity given the limits Google places on how often we may read it.
          That copy is held in memory only, is never written to disk, and is discarded shortly after
          you stop working, and in any event within a few minutes of being loaded.
        </p>
        <p>
          Student information is not written to our application logs. Names and email addresses are
          filtered out of log output automatically, and the content of the emails you send is not
          logged at all.
        </p>
        <p>
          <Term>One exception, stated honestly.</Term> The support form has a free-text message
          field, and anything you type into it is stored in our database. The form asks you not to
          include student names or student details, and we do not log its contents, but we cannot
          prevent you from typing them. Please describe problems without identifying students. If
          you have already sent us a message containing student information, tell us and we will
          delete it.
        </p>
      </>
    ),
  },
  {
    id: 'google-access',
    heading: 'The Google permissions we ask for, and how we use them',
    body: (
      <>
        <p>
          Signing in with Google is how the app reaches your spreadsheet and sends your email. We
          request the permissions listed here and no others. Two of them give the app access to
          your data:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <Term>See, edit, create and delete only the specific Google Drive files you use with
            this app</Term> (<code className="text-xs">drive.file</code>). This permission cannot
            reach anything else in your Drive. It is what lets the app create your spreadsheet,
            find it again, and read and write it. We do not request Google’s broader spreadsheets
            permission, which would reach every spreadsheet you have.
          </li>
          <li>
            <Term>Send email on your behalf</Term> (<code className="text-xs">gmail.send</code>).
            Used only to send the messages you compose and choose to send, from your own address.
            This permission does not allow reading, searching or deleting anything in your mailbox,
            and we do not have any such access.
          </li>
        </ul>
        <p>
          Signing in itself uses Google’s three standard identity permissions (
          <code className="text-xs">openid</code>, <code className="text-xs">email</code> and{' '}
          <code className="text-xs">profile</code>). They are what tell us who you are: the account
          identifier, your email address, your name, your profile picture, and your organisation’s
          domain if you sign in with a managed Workspace account. They give no access to your Drive,
          your mail, or any other Google service.
        </p>
        <p>
          None of the five is one of Google’s restricted scopes. We do not request access to the rest
          of your Google Drive, to your mailbox contents, to your contacts, or to your calendar. The{' '}
          <Link to="/for-admins" className="underline hover:no-underline">
            administrator page
          </Link>{' '}
          lists the same scopes in the exact form the sign-in request uses, taken from the
          application’s own configuration.
        </p>
        <p>
          {OPERATOR_BUSINESS_NAME}’s use and transfer of information received from Google APIs
          adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:no-underline"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. Specifically, data obtained through Google APIs
          is used only to provide and improve the features of this application that you use; it is
          not transferred or sold to third parties for advertising, marketing or any other purpose;
          it is not used for advertising of any kind; and it is not read by any person, except with
          your explicit permission for a specific purpose such as investigating a problem you have
          reported, where necessary for security purposes, or where required by law. Data obtained
          through Google APIs is not used to develop, improve or train generalised artificial
          intelligence or machine learning models.
        </p>
        <p>
          You can review and withdraw these permissions at any time from your Google account’s
          security settings, independently of anything you do in this app.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    heading: 'How we use account information',
    body: (
      <>
        <p>We use account information only for the following purposes:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>To sign you in, to keep you signed in, and to sign you out.</li>
          <li>To find and open the spreadsheet that holds your data.</li>
          <li>
            To determine what your account is entitled to and to apply the email sending limits.
          </li>
          <li>To answer support requests you send us.</li>
          <li>
            To send you messages about your own account when necessary: a welcome message when you
            register, confirmation that your account has been deleted, changes to these documents,
            security notices, and service interruptions. We do not send marketing email, product announcements or newsletters, and
            there is no mechanism in the service for sending them.
          </li>
          <li>
            To protect the service from abuse, to enforce sending limits, and to investigate
            suspected misuse.
          </li>
          <li>
            To understand which parts of the product are used and where new users get stuck, using
            the first-use dates and monthly counts described in{' '}
            <SectionRef sections={() => PRIVACY_SECTIONS} id="what-we-collect" />. We look at these
            as totals across all accounts; an individual account’s figures are visible to us only
            when we open a support request you have sent.
          </li>
          <li>To comply with our own legal obligations.</li>
        </ul>
        <p>
          We do not use account information to build profiles, to make automated decisions with
          legal or similarly significant effects, or to train machine learning models.
        </p>
      </>
    ),
  },
  {
    id: 'consent',
    heading: 'Your consent, and how to withdraw it',
    body: (
      <>
        <p>
          We rely on your consent to collect, use and disclose your personal information for the
          purposes described in <SectionRef sections={() => PRIVACY_SECTIONS} id="how-we-use" />. You give that consent when you create an account and
          agree to these documents, and you confirm it each time we publish a substantively revised
          version.
        </p>
        <p>
          You may withdraw your consent at any time, subject to legal and contractual restrictions
          and reasonable notice. Withdrawing consent means we can no longer provide the service, so
          in practice it is the same as closing your account. Withdraw it by revoking the app’s
          access in your Google account, by asking us to delete your account through the{' '}
          <ContactRoute />, or both. Your student data remains in your own Google account either
          way.
        </p>
      </>
    ),
  },
  {
    id: 'disclosure',
    heading: 'Who else receives information, and where it is processed',
    body: (
      <>
        <p>
          We do not sell personal information, and we do not disclose it for anyone else’s marketing
          purposes. We share it only with the service providers listed below, each of which is bound
          to use it only to provide their service to us:
        </p>
        <ul className="flex list-disc flex-col gap-3 pl-5">
          {SUBPROCESSORS.map((sub) => (
            <li key={sub.name}>
              <Term>{sub.name}</Term> — {sub.purpose}. Processed in {sub.location}.
            </li>
          ))}
        </ul>
        <p>
          <Term>Our servers and database are located in Toronto, Canada.</Term> Account information
          is stored there and nowhere else.
        </p>
        <p>
          Two qualifications on that. The service that sends messages about your account receives
          your name, your email address and the text of those messages, and processes them in the
          United States. And student information is held in your own Google account,
          which is processed wherever Google processes data for you or your institution, under your
          or your institution’s own agreement with Google, and not under this policy.
        </p>
        <p>
          Information processed outside Canada is subject to the laws of the country it is in, and
          may be accessible to the courts, law enforcement and national security authorities of that
          country. We use contractual and technical means to require comparable protection, but we
          cannot exempt information from those laws.
        </p>
        <p>
          We may also disclose personal information where we are required or permitted to by law:
          to comply with a subpoena, warrant, court order or other lawful demand; to investigate a
          suspected breach of an agreement or unlawful activity; to protect the security of the
          service; or in connection with a sale or reorganisation of the business, in which case the
          recipient would be bound by this policy or by notice to you.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep it',
    body: (
      <>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <Term>Account information</Term> is kept for as long as your account is open, and
            deleted within 30 days of your account being closed, except as noted below.
          </li>
          <li>
            <Term>Session records</Term> expire automatically no later than 30 days after sign-in,
            and sooner if the session is idle for 14 days or you sign out.
          </li>
          <li>
            <Term>Support requests</Term> are kept for up to 24 months after they are resolved, so
            that we can recognise a recurring problem, and are then deleted. A request you sent from
            inside the app is deleted with your account if that happens sooner.
          </li>
          <li>
            <Term>Technical logs</Term> are kept for no longer than 30 days.
          </li>
          <li>
            <Term>The usage measurements</Term> described in{' '}
            <SectionRef sections={() => PRIVACY_SECTIONS} id="what-we-collect" /> are kept for 24
            months and then deleted. The first-use dates are deleted with your account; the monthly
            counts are deleted with it as well.
          </li>
          <li>
            <Term>The in-memory copy of student information</Term> described in <SectionRef sections={() => PRIVACY_SECTIONS} id="student-information" /> is
            discarded within minutes and is not retained.
          </li>
        </ul>
        <p>
          Student information is retained for exactly as long as you keep it in your own Google
          account. We neither impose nor enforce a retention period on it, and deleting your account
          with us does not delete it. If your board or your own obligations require records to be
          destroyed on a schedule, that is done in your Google account, by you.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'How we protect it',
    body: (
      <>
        <p>
          The strongest protection is architectural: the great majority of the sensitive information
          involved in this product is never in our custody at all. Beyond that:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>All traffic between your browser and our servers is encrypted in transit.</li>
          <li>
            Google authorisation tokens are encrypted before they are stored, using a key held in a
            separate key management service rather than alongside the data it protects.
          </li>
          <li>
            Session identifiers are stored only as one-way hashes, so a copy of the database yields
            no usable credentials, and every session can be revoked server-side immediately.
          </li>
          <li>
            The app requests the narrowest Google permissions that will do the job, and in
            particular cannot read your Drive beyond the file it created or read your mailbox at
            all.
          </li>
          <li>
            Names, email addresses and authorisation tokens are stripped from log output
            automatically.
          </li>
          <li>
            Our database is managed by our hosting provider, with encryption at rest and automated
            backups.
          </li>
        </ul>
        <p>
          No method of transmission or storage is completely secure, and we do not represent that
          the service is immune from compromise. If a breach of security safeguards involving your
          personal information creates a real risk of significant harm to you, we will notify you
          and the Office of the Privacy Commissioner of Canada as required by law, and will keep a
          record of the breach.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    heading: 'Your rights, and how to exercise them',
    body: (
      <>
        <p>You may ask us to:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Tell you what account information we hold about you, how we have used it, and who we
            have disclosed it to.
          </li>
          <li>Correct account information that is inaccurate or incomplete.</li>
          <li>Give you a copy of it in a commonly used electronic format.</li>
          <li>Delete your account and the account information associated with it.</li>
          <li>
            End every signed-in session on your account, if you think someone else has used it.
          </li>
          <li>
            Withdraw your consent, as described in <SectionRef sections={() => PRIVACY_SECTIONS} id="consent" />.
          </li>
        </ul>
        <p>
          Make any of these requests through the <ContactRoute />. We will respond within 30 days.
          We may need to verify that the request comes from you, and there are narrow circumstances
          in which the law allows or requires us to refuse an access request, in which case we will
          tell you why.
        </p>
        <p>
          There is no charge for a reasonable request. We may decline requests that are repetitive
          or excessive.
        </p>
        <p>
          You do not need us for the equivalent rights over student information, and that is the
          point of the design: it is in your own Google account, where you can read, correct, export
          and delete it directly.
        </p>
        <p>
          If you are not satisfied with how we have handled your personal information, please raise
          it with us first. You may also complain to the Office of the Privacy Commissioner of
          Canada, or, if you are outside Canada, to the privacy regulator with jurisdiction where
          you live.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: 'Children and students',
    body: (
      <>
        <p>
          This service is provided to teachers and other education professionals. It is not directed
          to children, students are not users of it, and we do not knowingly collect personal
          information directly from a child. Students do not have accounts, do not sign in, and are
          never contacted by us.
        </p>
        <p>
          Information about students reaches this product only because a teacher enters it, and it
          is stored in that teacher’s own Google account. Deciding whether it is appropriate to
          record a particular piece of information about a student, and obtaining any notice or
          consent that the law or their school requires, is the teacher’s responsibility. See
          <SectionRef sections={() => TERMS_SECTIONS} id="student-information" /> of the{' '}
          <Link to="/terms" className="underline hover:no-underline">
            Terms of Service
          </Link>
          .
        </p>
        <p>
          If you believe a child’s personal information has reached us in a way this policy does not
          describe, contact us through the <ContactRoute /> and we will investigate and delete it.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies',
    body: (
      <>
        <p>
          We use two cookies, and both are strictly necessary. The first holds an opaque identifier
          for your signed-in session so that the app knows who you are between page loads, and
          expires no later than 30 days after sign-in. The second holds a random value for the few
          minutes a sign-in takes, so that the response from Google can be matched to the sign-in
          you started, and is removed when sign-in completes or after ten minutes. Neither contains
          personal information, both are marked so that scripts on the page cannot read them, and
          both are sent only over an encrypted connection.
        </p>
        <p>
          We do not use analytics cookies, advertising cookies, tracking pixels, or any third-party
          cookie. There is nothing to opt out of, which is why you are not asked to dismiss a cookie
          banner. Blocking these cookies will prevent you from signing in.
        </p>
      </>
    ),
  },
  {
    id: 'administrators',
    heading: 'Information for school and board administrators',
    body: (
      <>
        <p>
          If you are reviewing this product on behalf of an institution, the material points are:
          the vendor keeps no durable copy of student information, and none is written to our
          database, our logs or our backups; student data remains in the teacher’s
          institution-managed Google account and is therefore already inside the institution’s
          existing agreement with Google; the app requests two narrow data permissions plus the
          standard sign-in identity permissions, and no restricted scopes; the vendor’s servers,
          database and key management are in Canada, with the service that sends account messages
          to the teacher the one exception; and the account belongs to the teacher, so no
          institutional procurement, payment or
          data-sharing arrangement is required for a teacher to use it.
        </p>
        <p>
          The{' '}
          <Link to="/for-admins" className="underline hover:no-underline">
            administrator page
          </Link>{' '}
          sets out what is needed to allow the app on a managed domain, including the OAuth client
          identifier and the exact scopes requested. If your review needs something in writing that
          is not on that page, including a data processing agreement, ask through the{' '}
          <ContactRoute /> and we will provide it.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <>
        <p>
          We may revise this policy. The version and effective date at the top of the page always
          identify the text in force.
        </p>
        <p>
          When a revision is substantive, you will be asked to review and accept the new version the
          next time you use the app, and we record which version you accepted and when. Minor
          corrections that do not change what we do with your information may be made without a new
          acceptance. We will not apply a materially different use of information you have already
          given us without asking you first.
        </p>
        <p>
          Superseded versions are kept. Because your agreement is recorded as a version, you can ask
          us through the <ContactRoute /> for the text of the version you accepted, and we will
          provide it.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    heading: 'How to reach us',
    body: (
      <>
        <p>
          For any question, access request, correction, deletion request or complaint about privacy,
          use the <ContactRoute />. Requests are read by {OPERATOR_DESCRIPTION}, who is accountable
          for personal information held by this business, and answered within 30 days.
        </p>
        {OPERATOR_POSTAL_ADDRESS && (
          <p>
            Requests may also be made in writing to {OPERATOR_DESCRIPTION},{' '}
            {OPERATOR_POSTAL_ADDRESS}.
          </p>
        )}
      </>
    ),
  },
];

export const PRIVACY_SUMMARY = (
  <>
    <p>
      Everything you record about students lives in a Google Sheet on your own Google Drive. We
      keep no lasting copy of it, and we see it only while serving your own requests.
    </p>
    <p>
      What we store is your account: who you are, which spreadsheet is yours, your plan, and
      an encrypted token that lets the app work on your behalf. It is held in Canada.
    </p>
    <p>
      We do not sell anything, run no third-party analytics or advertising, load no tracking script,
      and use one strictly necessary cookie. We do count how often each tool is used, per month and
      per account, and record the date you first used each one, so we can see which parts of the
      product are working. Those counts hold no student information and no times of day.
    </p>
    <p>
      Because your student data is in your own Google account, you can export or delete it at any
      time without us, and you remain the person accountable for it under the laws and board
      policies that apply to you.
    </p>
  </>
);
