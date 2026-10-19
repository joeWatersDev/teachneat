import { Link } from 'react-router-dom';
import { ContactRoute, type LegalSection, SectionRef, Term } from './LegalDocument';
import {
  OPERATOR_BUSINESS_NAME,
  OPERATOR_DESCRIPTION,
  OPERATOR_JURISDICTION,
  OPERATOR_POSTAL_ADDRESS,
} from './legalMeta';

/**
 * The terms of service (Phase 2 Step 6c).
 *
 * Drafted to allocate risk as far toward the account holder as the law actually
 * permits, which is the instruction this step was given. Three things bound how
 * far that is, and each is handled explicitly rather than by writing an
 * unenforceable clause and hoping:
 *
 * - **The customer is a consumer.** A teacher buying personally with their own
 *   money is a consumer under Ontario's Consumer Protection Act, 2002. That Act
 *   voids attempts to contract out of it, and it specifically preserves the
 *   right to sue in court and to participate in a class proceeding, which is why
 *   the arbitration clause is expressly disapplied for Canadian
 *   consumers rather than written as though it binds everyone.
 * - **Some liability cannot be excluded.** Fraud, wilful misconduct, personal
 *   injury and non-excludable statutory rights are carved out of the liability cap,
 *   and the section after it says so in terms. A cap that purported to cover them would put
 *   the whole clause at risk of being read down.
 * - **The strongest protection is factual, not contractual.** The reason the
 *   "student-information" section can put the compliance burden on the teacher
 *   is that it is true: the student records are in their Google account, entered
 *   by them, under their professional obligations. A clause that matches reality
 *   survives review; one that reallocates a burden the operator actually carries
 *   does not.
 *
 * "student-information" is the substantive core. It is also the clause that the
 * data-responsibility checkbox at registration exists to evidence separately, so
 * that acceptance of it is provable independently of acceptance-by-reference to
 * this document.
 *
 * The arbitration and class-action-waiver section is deliberately scoped to US
 * residents and carries an opt-out. In Ontario it would be void, so applying it
 * to everyone would invite a court to read down the surrounding clauses too.
 */

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    heading: 'This agreement',
    body: (
      <>
        <p>
          These Terms of Service (the <Term>Terms</Term>) are a contract between you and{' '}
          {OPERATOR_DESCRIPTION}, a sole proprietorship in {OPERATOR_JURISDICTION} (
          <Term>we</Term>, <Term>us</Term>, <Term>our</Term>). They govern your use of the{' '}
          {OPERATOR_BUSINESS_NAME} website and web application (the <Term>Service</Term>).
        </p>
        <p>
          You accept these Terms by ticking the box presented when you create your account, and by
          using the Service. Your acceptance is recorded against the version shown at the top of
          this page, together with the date you gave it. If you do not accept them, do not use the
          Service. The{' '}
          <Link to="/privacy" className="underline hover:no-underline">
            Privacy Policy
          </Link>{' '}
          forms part of these Terms.
        </p>
        <p>
          Some words are given a defined meaning in bold on first use, and carry that meaning
          throughout.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    heading: 'Who may use the Service',
    body: (
      <>
        <p>To hold an account you must:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            be at least the age of majority where you live, and able to enter into a binding
            contract;
          </li>
          <li>
            be a teacher, or another individual with a professional role that involves the students
            whose information you enter;
          </li>
          <li>
            have a Google account you are entitled to use for this purpose, and comply with any
            rules your employer places on it; and
          </li>
          <li>register in your own name, and use the account yourself.</li>
        </ul>
        <p>
          <Term>Where the Service is offered.</Term> The Service is currently offered to teachers in
          Ontario, Canada. We do not undertake to make it available elsewhere, and it is not
          designed or operated for the requirements of other jurisdictions.
        </p>
        <p>
          Accounts are personal. Do not share your account or your sign-in with anyone else,
          including a colleague or a supply teacher. You are responsible for everything done through
          your account.
        </p>
        <p>
          <Term>We contract with you, not with your school.</Term> Holding an account creates no
          relationship between us and your school, school board, district or employer, gives you no
          authority to bind them, and does not make us a service provider, contractor or
          “school official” of theirs. If your institution requires an agreement with a vendor before
          its data may be handled by that vendor, obtaining it is your responsibility, and we will
          cooperate with a reasonable request through the <ContactRoute />.
        </p>
      </>
    ),
  },
  {
    id: 'the-service',
    heading: 'What the Service does',
    body: (
      <>
        <p>
          The Service provides classroom tools, currently a roster, attendance, class archiving,
          grouping, a name picker, and email to students and parents, which read from and write to
          a Google Sheet created in your own Google Drive. That list
          describes the Service as it is today rather than fixing what it must always contain.
        </p>
        <p>
          The Service is an interface to your own data. It is not a system of record, not a student
          information system, and not a substitute for the records your employer requires you to
          keep in whatever system it designates. Attendance recorded here is not an official
          attendance return unless you separately make it one.
        </p>
        <p>
          We may add, change, suspend or remove features. Where a change materially reduces the
          functionality of the Service, we will give you reasonable notice, and you may close your
          account at any time under{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="termination" />.
        </p>
      </>
    ),
  },
  {
    id: 'your-google-account',
    heading: 'Your Google account and your data',
    body: (
      <>
        <p>
          When you first sign in, the Service creates a folder and one Google Sheet in your Google
          Drive and stores everything you enter in that sheet. Before an update that changes the
          sheet’s structure, the Service may also save a copy of it in your Drive. Those files are
          yours. They remain in your account, under your control and under your own agreement with
          Google, at all times.
        </p>
        <p>
          You grant us permission to access that file, and to send email as you, only to operate the
          Service on your instruction. We claim no ownership of your data.
        </p>
        <p>
          <Term>Keep your own copies.</Term> We do not back up your data, because we do not hold it.
          A copy saved before a structural update is a precaution, not a backup service. Backup,
          retention and recovery of the spreadsheet are matters between you and Google, and
          you are responsible for exporting or copying anything you cannot afford to lose. We are
          not liable for loss, corruption or deletion of data in your Google account, whatever the
          cause, including where it results from your own use of the Service.
        </p>
        <p>
          You may edit the spreadsheet directly, but the Service expects a particular structure. If
          you change its layout, rename its tabs or alter its identifiers, the Service may stop
          working or may misread your data, and repairing that is not something we undertake to do.
        </p>
        <p>
          If you revoke the Service’s access in your Google account, or delete the spreadsheet, the
          Service will stop functioning. Your data is unaffected by anything that happens to your
          account with us.
        </p>
      </>
    ),
  },
  {
    id: 'student-information',
    heading: 'Student information: your responsibility',
    body: (
      <>
        <p>
          This section is the most important one in these Terms, and you accepted it separately when
          you registered.
        </p>
        <p>
          Student information you enter is stored in your own Google account, not ours. As between
          you and us, <Term>you are the party responsible for it</Term> in every sense: for
          deciding what is recorded, for its accuracy, for its security within your account, for how
          long it is kept, and for its lawful handling. We act only on your instruction and keep no
          lasting copy.
        </p>
        <p>You represent and warrant, each time you use the Service, that:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            you are authorised by your employer and by the students’ school to record and process
            the information you enter, using a tool of your own choosing;
          </li>
          <li>
            your use complies with every law, regulation, policy and professional obligation that
            applies to you, which may include the Education Act and the Municipal Freedom of
            Information and Protection of Privacy Act or their equivalents in your province, the
            Family Educational Rights and Privacy Act and the Protection of Pupil Rights Amendment
            and state student-privacy legislation if you are in the United States, and your school
            board or district’s own privacy, records and acceptable-use policies;
          </li>
          <li>
            you have given every notice and obtained every consent, authorisation or approval that
            those laws and policies require in respect of any information you enter, before you
            enter it, and that each remains in effect for as long as the information is recorded;
          </li>
          <li>
            you have satisfied yourself that the information is of a kind that may lawfully and
            properly be recorded in a tool of this nature, the Service being a general classroom
            tool and neither designed nor represented as suitable for any particular category of
            information or for any regulated purpose;
          </li>
          <li>
            you record no more information about a student than you need, and nothing you are not
            entitled to record;
          </li>
          <li>
            you comply with anti-spam law when you use the email feature, including Canada’s
            Anti-Spam Legislation and the CAN-SPAM Act, and you have the necessary consent or
            existing relationship to email each recipient; and
          </li>
          <li>
            you will not use the Service to record information about anyone other than students you
            are professionally responsible for.
          </li>
        </ul>
        <p>
          We do not review, approve or monitor what you enter, and we give no advice on whether your
          use of the Service satisfies your legal or professional obligations. Nothing in the Service
          or on our website is legal advice. If you are unsure whether you may use a tool like this
          one for a particular purpose, ask your board or your privacy office before you do.
        </p>
        <p>
          Email you send through the Service is sent from your own address, by you. You are its
          sender for all purposes, including under anti-spam law, and you are responsible for its
          content and for who receives it.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable use',
    body: (
      <>
        <p>You must not:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>use the Service for any unlawful purpose, or to harass, defame or endanger anyone;</li>
          <li>
            send bulk, commercial, political or unsolicited email through it, or use it as a general
            mailing tool;
          </li>
          <li>
            attempt to circumvent sending limits, entitlement checks or authentication;
          </li>
          <li>
            probe, scan, overload or attempt to gain unauthorised access to the Service or its
            infrastructure, or use it in a way that degrades it for others;
          </li>
          <li>
            access the Service by automated means, scrape it, or reverse engineer, decompile or
            attempt to derive its source code, except to the extent the law permits despite this
            restriction;
          </li>
          <li>resell, sublicense or provide the Service to third parties; or</li>
          <li>
            upload malicious code, or use the Service to store material unrelated to your teaching.
          </li>
        </ul>
        <p>
          The Service enforces a hard limit of 120 emails per account per day. That limit is a
          condition of use, not a technical inconvenience to be worked around.
        </p>
      </>
    ),
  },
  {
    id: 'accounts-security',
    heading: 'Account security',
    body: (
      <>
        <p>
          Access to your account is through your Google sign-in, so your account is only as secure as
          your Google account. Protect it accordingly, use whatever multi-factor authentication your
          institution provides, and sign out on shared or classroom computers.
        </p>
        <p>
          Signing out ends the session on that device immediately. If you believe your account has
          been accessed by someone else, tell us promptly through the <ContactRoute /> and we will
          end every session on it; you can also revoke the Service’s access to your Google account
          from Google’s own security settings at any time, which stops the Service working without
          our involvement.
        </p>
      </>
    ),
  },
  {
    id: 'plans-and-payment',
    heading: 'Price and payment',
    body: (
      <>
        <p>
          <Term>The Service is provided at no charge during early access.</Term> There is no paid
          plan, no subscription and no payment card. We do not collect payment details, and no
          payment processor is involved in providing the Service to you.
        </p>
        <p>
          Providing it free of charge is not a promise to do so indefinitely. We may introduce a
          paid plan in future. If we do, we will give you at least 30 days’ notice by email before
          any charge could apply to your account, we will publish the price and what it covers, and{' '}
          <Term>no charge will be made unless you agree to it</Term>. You may decline, in which case
          your account continues on whatever we offer at no charge, or ends under{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="termination" /> with your data intact in
          your own Google Drive either way.
        </p>
        <p>
          <Term>Until a paid plan is offered and you accept it</Term>, the renewal, cancellation,
          refund, price-change and failed-payment provisions that would ordinarily belong in this
          section are inoperative, because there is nothing to renew, cancel or refund.
        </p>
        <p>
          Any taxes on a future purchase would be dealt with when that plan is introduced. Nothing
          in this section limits your rights under{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="consumer-rights" />.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    heading: 'Availability',
    body: (
      <>
        <p>
          We aim to keep the Service running and to fix problems promptly, but we do not promise any
          particular level of availability, and we offer no service level agreement, uptime
          commitment or credit for downtime.
        </p>
        <p>
          The Service may be unavailable for maintenance, for reasons outside our control, or
          because a service it depends on is unavailable. Because it is a small operation, support is
          provided on a reasonable-efforts basis through the <ContactRoute /> and we do not commit to
          a response time.
        </p>
      </>
    ),
  },
  {
    id: 'third-parties',
    heading: 'Services we depend on',
    body: (
      <>
        <p>
          The Service depends on Google, for sign-in, Sheets, Drive and Gmail. Your use of Google’s
          services is governed by your own agreement with Google. If a paid plan is introduced, a
          payment processor will be added here and named in the privacy policy before any charge
          could apply.
        </p>
        <p>
          We do not control those services. We are not responsible for their availability,
          performance, changes, pricing, terms, security or actions, including any decision by
          Google or by your institution’s Google administrator to restrict or withdraw access, or
          any change to Google’s interfaces that reduces what the Service can do. Any of these may
          make the Service partly or wholly unusable through no fault of ours, and does not entitle
          you to a refund, there being no charge to refund.
        </p>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    heading: 'Intellectual property',
    body: (
      <>
        <p>
          The Service, its software, design, text and name are ours and are protected by copyright
          and other laws. You are granted a personal, non-exclusive, non-transferable, revocable
          licence to use the Service for your own teaching, for as long as these Terms are in force.
          No other rights are granted.
        </p>
        <p>
          Your data remains yours. If you send us feedback or a suggestion, you allow us to use it
          without obligation, payment or confidentiality.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    heading: 'Suspension and termination',
    body: (
      <>
        <p>
          You may stop using the Service at any time, close your account from the account settings page, and ask
          us to delete your account through the <ContactRoute />.
        </p>
        <p>
          We may suspend or terminate your account if you breach these Terms, if your use threatens
          the security, integrity or lawful operation of the Service, or if we are
          required to by law. Where the circumstances allow it, we will warn you first and give you a
          chance to put it right. For a serious breach, particularly one involving unlawful use or
          the security of others, we may act immediately.
        </p>
        <p>
          We may also discontinue the Service entirely. If we do, we will give you at least 60 days’
          notice by email, so that you have time to export anything you want from your spreadsheet
          before the app stops reading it. If a paid plan exists by then, we will refund the unused
          portion of any period you have prepaid.
        </p>
        <p>
          <Term>What termination does not do</Term> is touch your data. It is in your Google account.
          Closing your account with us, for any reason and by either of us, leaves your spreadsheet
          exactly where it is. We delete our account information about you as described in the
          Privacy Policy.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    heading: 'Disclaimers',
    body: (
      <>
        <p>
          To the fullest extent the law allows, the Service is provided{' '}
          <Term>“as is” and “as available”</Term>, and we disclaim all representations, warranties
          and conditions of any kind, whether express, implied or statutory, including any implied
          warranty or condition of merchantability, merchantable quality, fitness for a particular
          purpose, durability, title, non-infringement, or arising from a course of dealing or usage
          of trade.
        </p>
        <p>We do not warrant that:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>the Service will be uninterrupted, timely, secure or error-free;</li>
          <li>any defect will be corrected;</li>
          <li>
            the results the Service produces, including attendance calculations, absence flags,
            risk indicators, groupings and random selections, will be accurate, complete or suitable
            for any decision you take; or
          </li>
          <li>
            the Service satisfies any legal, professional, records-management or accreditation
            requirement that applies to you.
          </li>
        </ul>
        <p>
          Anything the Service reports about a student is derived from what you entered, and is a
          convenience rather than a finding. Decisions about a student are yours, and should rest on
          your own professional judgment and your institution’s own records.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    heading: 'Limitation of liability',
    body: (
      <>
        <p>
          To the fullest extent the law allows, and except as stated in <SectionRef sections={() => TERMS_SECTIONS} id="consumer-rights" />, we are not liable
          for any indirect, incidental, special, consequential, exemplary or punitive damages, or for
          loss of profits, revenue, goodwill, opportunity, or for loss, corruption or unavailability
          of data, whether the claim is in contract, tort (including negligence), statute or
          otherwise, and whether or not we were told such damages were possible.
        </p>
        <p>
          To the fullest extent the law allows, and except as stated in <SectionRef sections={() => TERMS_SECTIONS} id="consumer-rights" />, our total
          aggregate liability arising out of or relating to the Service and these Terms is limited to
          the greater of the amount you actually paid us in the twelve months before the event giving
          rise to the claim, and one hundred Canadian dollars (CAD $100). This limit applies in
          aggregate across all claims, not per claim.
        </p>
        <p>
          These limits reflect a deliberate allocation of risk. The Service is provided free of
          charge, keeps no lasting copy of your student records, and leaves your data in your own
          hands throughout. We could not offer it on these terms while accepting liability for
          consequences that arise from decisions you make and from data we do not hold.
        </p>
        <p>
          Each of us is responsible for our own obligations. You are responsible for claims arising
          from information you chose to record, from email you chose to send, and from your use of the
          Service in breach of <SectionRef sections={() => TERMS_SECTIONS} id="student-information" /> or <SectionRef sections={() => TERMS_SECTIONS} id="acceptable-use" />, to the extent the law permits us to say so.
        </p>
      </>
    ),
  },
  {
    id: 'consumer-rights',
    heading: 'Rights that cannot be limited',
    body: (
      <>
        <p>
          Nothing in these Terms excludes or limits liability for fraud, fraudulent
          misrepresentation, wilful misconduct, gross negligence, or death or personal injury caused
          by negligence, and nothing excludes or limits any liability that cannot be excluded or
          limited by law.
        </p>
        <p>
          If you are a consumer, you have rights under consumer protection law that these Terms
          cannot take away, vary or waive. In Ontario, the Consumer Protection Act, 2002 provides
          such rights, and any part of these Terms that purports to remove them has no effect to that
          extent. Where a limitation in <SectionRef sections={() => TERMS_SECTIONS} id="liability" /> is not permitted against you, it applies only so
          far as it is permitted, and the rest of these Terms continues to apply.
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    heading: 'Governing law and where disputes are heard',
    body: (
      <>
        <p>
          These Terms are governed by the laws of the Province of Ontario and the laws of Canada that
          apply there, without regard to conflict of laws rules. The United Nations Convention on
          Contracts for the International Sale of Goods does not apply.
        </p>
        <p>
          Subject to <SectionRef sections={() => TERMS_SECTIONS} id="arbitration" />, which applies
          only to residents of the United States, the courts of Ontario have jurisdiction over any
          dispute, and you and we submit to them. If you are a consumer resident elsewhere, this does
          not deprive you of the protection of any mandatory rule of the place you live, including
          any right to bring proceedings there.
        </p>
        <p>
          Before starting a proceeding, please raise the problem with us through the{' '}
          <ContactRoute />. Most disputes about a tool of this size can be resolved that way in a
          few days.
        </p>
      </>
    ),
  },
  {
    id: 'arbitration',
    heading: 'Arbitration and class action waiver (United States residents only)',
    body: (
      <>
        <p>
          <Term>This section applies only if you are resident in the United States.</Term> It does
          not apply to residents of Canada or anywhere else, and nothing in it limits a right that
          the law of your province or country does not permit to be limited. If you are a consumer
          in Ontario, this section does not apply to you at all, and{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="governing-law" /> governs instead.
        </p>
        <p>
          If you are resident in the United States, you and we agree that any dispute arising out of
          or relating to these Terms or the Service, which we have not been able to resolve
          informally within 60 days of one of us raising it, will be resolved by final and binding
          individual arbitration administered by the American Arbitration Association under its
          Consumer Arbitration Rules, rather than in court. The arbitration will be conducted by a
          single arbitrator, by documents or by telephone or video unless the arbitrator decides a
          hearing is necessary, and in the English language.
        </p>
        <p>
          <Term>Individually, not as a class.</Term> You and we each agree to bring claims only in an
          individual capacity, and not as a plaintiff or class member in any purported class,
          collective, consolidated or representative proceeding. The arbitrator may not consolidate
          more than one person’s claims, and may not preside over any form of representative
          proceeding.
        </p>
        <p>
          <Term>What is excluded.</Term> Either of us may bring an individual claim in a small
          claims court with jurisdiction, and either of us may seek injunctive relief in court to
          protect intellectual property or to stop unauthorised access to the Service.
        </p>
        <p>
          <Term>Opting out.</Term> You may opt out of this section by telling us so through the{' '}
          <ContactRoute /> within 30 days of first accepting these Terms. Opting out costs you
          nothing and does not affect any other part of these Terms or your use of the Service.
        </p>
        <p>
          If the class action waiver in this section is found unenforceable as to a particular claim,
          that claim is severed from the arbitration and heard in court, and the rest of this section
          continues to apply.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to these Terms',
    body: (
      <>
        <p>
          We may revise these Terms. The version and effective date at the top of this page always
          identify the text in force.
        </p>
        <p>
          When a revision is substantive, you will be asked to review and accept the new version the
          next time you use the Service, and we record which version you accepted and when. If you do
          not accept it, you can stop using the Service and close your account. If a paid plan exists,
          a revision does not take effect for a period you have already paid for if it materially
          reduces what you bought. Minor
          corrections that do not change either party’s rights may be made without a new acceptance.
        </p>
        <p>
          Superseded versions are kept, and you may ask us through the <ContactRoute /> for the text
          of the version you accepted.
        </p>
      </>
    ),
  },
  {
    id: 'general',
    heading: 'General',
    body: (
      <>
        <p>
          <Term>Entire agreement.</Term> These Terms, the Privacy Policy, and the separate
          acknowledgement about student information that you accepted when you registered are the
          whole agreement between you and us about the Service, and replace anything said or written
          before. That acknowledgement stands on its own terms and is not narrowed by anything here.
        </p>
        <p>
          <Term>Severability.</Term> If any part of these Terms is held unenforceable, it is
          modified only so far as necessary to make it enforceable, or removed if it cannot be, and
          the rest continues in force.
        </p>
        <p>
          <Term>No waiver.</Term> If we do not enforce a provision on one occasion, we do not give up
          the right to enforce it later.
        </p>
        <p>
          <Term>Assignment.</Term> You may not transfer your account or your rights under these
          Terms. We may assign these Terms to a successor of the business, including on
          incorporation of the operator or a sale of the business, and will tell you if we do.
        </p>
        <p>
          <Term>Force majeure.</Term> Neither of us is liable for failing to perform because of
          something outside our reasonable control, including failure of a service the Service
          depends on.
        </p>
        <p>
          <Term>Notices.</Term> We give notice by email to the address on your account, or by a
          notice inside the Service. You give notice through the <ContactRoute />. It is your
          responsibility to keep a working email address on your account.
        </p>
        <p>
          <Term>Independent parties.</Term> Nothing here creates a partnership, joint venture,
          employment or agency relationship between us.
        </p>
        <p>
          <Term>Survival.</Term> <SectionRef sections={() => TERMS_SECTIONS} id="student-information" label="Sections" />, <SectionRef sections={() => TERMS_SECTIONS} id="intellectual-property" label="" />,{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="disclaimers" label="" />, <SectionRef sections={() => TERMS_SECTIONS} id="liability" label="" />,{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="consumer-rights" label="" />, <SectionRef sections={() => TERMS_SECTIONS} id="governing-law" label="" />,{' '}
          <SectionRef sections={() => TERMS_SECTIONS} id="arbitration" label="" /> and this section survive termination.
        </p>
        <p>
          <Term>Language.</Term> These Terms are provided in English. Les parties ont demandé que ce
          document soit rédigé en anglais.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    heading: 'How to reach us',
    body: (
      <p>
        {OPERATOR_DESCRIPTION}, {OPERATOR_POSTAL_ADDRESS || OPERATOR_JURISDICTION}. For any question
        about these Terms or your account, use the <ContactRoute />.
      </p>
    ),
  },
];

export const TERMS_SUMMARY = (
  <>
    <p>
      This is a tool that works on a spreadsheet in your own Google account. Your data stays yours,
      and stays there, whatever happens to your account with us.
    </p>
    <p>
      Because the student records are in your account and entered by you, you are the person
      responsible for handling them lawfully: your board’s policies, your privacy obligations, and
      consent for the email you send are yours to satisfy, not ours.
    </p>
    <p>
      The Service is free during early access, and is currently offered to teachers in Ontario. If a
      paid plan is introduced you will be told in advance and nothing will be charged unless you
      agree to it.
    </p>
    <p>
      The Service is provided as is, with no uptime promise, and our liability is capped. Consumer
      rights that the law does not let us limit are unaffected.
    </p>
  </>
);
