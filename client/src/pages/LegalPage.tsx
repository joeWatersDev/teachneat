import { LegalDocument } from './legal/LegalDocument';
import { PRIVACY_SECTIONS, PRIVACY_SUMMARY } from './legal/privacyPolicy';
import { TERMS_SECTIONS, TERMS_SUMMARY } from './legal/termsOfService';
import { OPERATOR_BUSINESS_NAME } from './legal/legalMeta';

/**
 * The privacy policy and terms of service routes (Phase 2 Step 6c).
 *
 * These replaced placeholders that said, correctly, that they were not policies.
 * The routes and their paths are unchanged, because three things already link
 * them: the marketing footer, the consent gate a teacher ticks at registration,
 * and Google's OAuth verification, which requires both to be reachable on the
 * verified production domain.
 *
 * The text lives in privacyPolicy.tsx and termsOfService.tsx rather than here.
 * They are documents, not components: they change on their own schedule, they
 * are read as a whole, and a diff of one of them should show a change of
 * substance rather than a change of layout mixed in with it.
 *
 * **These are not a substitute for review by a lawyer**, and the version
 * constant exists partly so that a reviewed revision is a one-line bump that
 * re-prompts every existing account.
 */

export function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy policy"
      intro={
        <p>
          This policy explains what personal information {OPERATOR_BUSINESS_NAME} collects, why, where
          it is held, how long it is kept, who else sees it, and how to have it corrected or deleted.
          It also explains the division that the whole product is built around: what we hold, and what
          stays in your own Google account.
        </p>
      }
      summary={PRIVACY_SUMMARY}
      sections={PRIVACY_SECTIONS}
    />
  );
}

export function TermsPage() {
  return (
    <LegalDocument
      title="Terms of service"
      intro={
        <p>
          These terms are the agreement between you and the operator of {OPERATOR_BUSINESS_NAME}. They
          cover what the service does, what is expected of you as the account holder, how the
          account ends, and the limits of our responsibility. Please read them before you accept
          them.
        </p>
      }
      summary={TERMS_SUMMARY}
      sections={TERMS_SECTIONS}
    />
  );
}
