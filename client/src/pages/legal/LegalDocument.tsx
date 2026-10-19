import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DOCUMENT_VERSION, EFFECTIVE_DATE, PRIVACY_CONTACT_EMAIL } from './legalMeta';
import { sectionNumber } from './sectionNumber';

/**
 * The shared shell both legal documents render into (Phase 2 Step 6c).
 *
 * One renderer rather than two, because the parts a reader uses to navigate a
 * legal document — numbered sections, stable anchors, a contents list, the
 * effective date and version — are the parts most likely to drift apart if each
 * document builds its own. Section numbering is derived from position rather
 * than written into the text, so inserting a clause cannot leave the document
 * with two section sevens.
 *
 * The anchors matter more than they look. A board's privacy review, a support
 * reply, or a Google verification reviewer will all want to cite a specific
 * clause by URL.
 */

export interface LegalSection {
  /** Stable anchor. Never change one after publication; a citation will rot. */
  id: string;
  heading: string;
  body: ReactNode;
}

interface LegalDocumentProps {
  title: string;
  /** One paragraph, above the contents, saying what the document is for. */
  intro: ReactNode;
  /**
   * The plain-language summary. Not a substitute for the text below it, and
   * says so, but it is what most readers will actually read.
   */
  summary: ReactNode;
  sections: LegalSection[];
}

export function LegalDocument({ title, intro, summary, sections }: LegalDocumentProps) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-semibold text-primary">{title}</h1>

      <p className="mt-2 text-sm text-secondary">
        Effective {EFFECTIVE_DATE}. Version {DOCUMENT_VERSION}.
      </p>

      <div className="mt-6 text-md text-secondary">{intro}</div>

      <div className="mt-8 rounded-lg border border-subtle bg-elevated p-4">
        <h2 className="text-md font-semibold text-primary">In short</h2>
        <div className="mt-3 flex flex-col gap-2 text-sm text-secondary">{summary}</div>
        <p className="mt-3 text-sm text-disabled">
          This summary is for orientation only. The numbered sections below are the agreement.
        </p>
      </div>

      <nav aria-label={`${title} contents`} className="mt-8">
        <h2 className="text-md font-semibold text-primary">Contents</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-sm text-secondary">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="underline hover:no-underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 flex flex-col gap-10">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-lg font-semibold text-primary">
              {index + 1}. {section.heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-sm text-secondary">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The contact route, in one place because both documents end with it and the
 * address does not exist until the domain is bought. Falls back to the contact
 * form, which is a channel that already works.
 */
export function ContactRoute() {
  if (PRIVACY_CONTACT_EMAIL) {
    return (
      <>
        <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="underline hover:no-underline">
          {PRIVACY_CONTACT_EMAIL}
        </a>{' '}
        or the{' '}
        <Link to="/contact" className="underline hover:no-underline">
          contact form
        </Link>
      </>
    );
  }
  return (
    <Link to="/contact" className="underline hover:no-underline">
      contact form
    </Link>
  );
}

interface SectionRefProps {
  /**
   * A thunk rather than the array itself, and it has to be. A document's
   * sections reference each other, so the elements holding these props are
   * built while the array they point at is still being constructed. Passing the
   * array would read it before its own declaration completes; passing a function
   * defers the read to render, by which time it exists.
   */
  sections: () => LegalSection[];
  id: string;
  /** "section" by default; pass "Section" where the sentence starts with it. */
  label?: string;
}

export function SectionRef({ sections, id, label = 'section' }: SectionRefProps) {
  const number = sectionNumber(sections(), id);
  // Built as one string rather than two children: an empty label — used in the
  // survival list, where one "Sections" introduces several numbers — would
  // otherwise leave a stray leading space before the number.
  return <>{label ? `${label} ${number}` : String(number)}</>;
}

/** A defined term on first use. Kept visually quiet; this is not marketing copy. */
export function Term({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-primary">{children}</strong>;
}
