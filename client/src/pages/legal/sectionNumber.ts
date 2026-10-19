import type { LegalSection } from './LegalDocument';

/**
 * Resolves a legal section's number from its anchor.
 *
 * Cross-references are the thing most likely to be silently wrong in a document
 * whose numbering is positional: insert a clause and every "see section 12"
 * after it starts pointing one clause short, which no compiler catches and no
 * reader trusts once they notice. Numbers are therefore never written into the
 * prose — the prose names an anchor and this resolves it at render time.
 *
 * It throws rather than degrading, so a reference to a section that has been
 * renamed or removed fails the moment the page renders in a test, rather than
 * shipping as a wrong number in a document a teacher is agreeing to.
 *
 * Its own file because the documents are one of the two places in this codebase
 * where a plain function living beside components is worth avoiding: the content
 * modules are large and rarely touched, and the fast-refresh boundary is easier
 * to keep than to remember.
 */
export function sectionNumber(sections: LegalSection[], id: string): number {
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) {
    throw new Error(`Legal document cross-reference points at an unknown section: "${id}"`);
  }
  return index + 1;
}
