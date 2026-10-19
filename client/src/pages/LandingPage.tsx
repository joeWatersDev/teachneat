import { Check, EyeOff, FileSpreadsheet, Timer, type LucideIcon } from 'lucide-react';
import { Logo } from '../components/ui/Logo';
import { SignInButton } from '../layouts/MarketingLayout';
import { FeatureShowcase } from './landing/FeatureShowcase';
import { HeroShot } from './landing/ProductShots';

/**
 * The public landing page (Phase 2 Step 5). The approved design is
 * `design/landing-page-mockup.html`; this is that design in the app. **The
 * mockup is no longer maintained in parallel** (Step 6g): it was the reference
 * for the initial draft and copy changes since do not round-trip through it.
 *
 * Four bands. A hero that names the benefit and shows the product immediately;
 * the feature showcase; a compact statement of what signing up takes and where a
 * teacher's data lives; and a closing call to action.
 *
 * The third band is short on purpose but is not decoration. It is the claim that
 * separates this product from every other classroom tool, it is what a school
 * board's privacy review looks for, and it answers the objection a teacher forms
 * while reading the feature list. Its three points are deliberately three
 * different claims — what setup costs, where the data lives, and what we hold —
 * rather than one claim stated three ways, which is what they were before.
 */
export function LandingPage() {
  return (
    <>
      <section className="overflow-hidden border-b border-subtle bg-canvas pt-16">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 text-center sm:px-6">
          {/* Grows with the viewport: 56px on a phone, where it sits above a
              headline that has itself shrunk, up to 112px at full width, where
              56px reads as an icon rather than as a mark. */}
          <Logo size={56} className="h-14 w-14 sm:h-20 sm:w-20 lg:h-28 lg:w-28" />
          <h1 className="text-display-lg font-semibold text-balance text-primary">
            Less admin.
            <br />
            More teaching.
          </h1>
          {/* The jobs first, then the two things that hold them together. The
              previous version opened on "One class list", which is the
              mechanism, and asked the reader to hold an abstraction before they
              knew what it was for; the order is now reversed, so the class list
              and the Drive arrive as the answer to work already named.

              Both breaks are forced rather than left to the wrapper. The first
              splits the feature list at its midpoint, keeping the two halves
              near enough in length to read as a pair; the second gives the
              ownership claim its own line so it is never read as a continuation
              of that list. Three lines, one paragraph: an earlier revision made
              the claim a second `<p>`, which the section's `gap-5` then opened
              into a blank line and pushed it away from what it qualifies.
              Neither break constrains how narrow the viewport may get, since
              each fragment still wraps normally within itself. That is why
              `whitespace-nowrap`, which the older subhead used for the same
              purpose, is not used here: this sentence does not fit a 320px
              viewport and pinning it would push the document wider than the
              screen. */}
          <p className="max-w-[54ch] text-md leading-relaxed text-secondary">
            Easily track attendance and communications,
            <br />
            make groups, send mass emails, and more.
            <br />
            All from one class list, stored on your Google Drive.
          </p>
          <div className="mt-1">
            <SignInButton size="lg">Create your account</SignInButton>
          </div>
        </div>

        {/* The shot runs off the bottom edge of the band rather than sitting
            inside it, so the product is visible immediately and there is a
            reason to scroll without an arrow. The height is what clips it. */}
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mx-auto -mb-px mt-12 max-h-[27.5rem] max-w-[61rem] overflow-hidden rounded-t-xl border border-b-0 border-subtle bg-base">
            <HeroShot />
          </div>
        </div>
      </section>

      <FeatureShowcase />

      <section className="border-y border-subtle bg-surface px-4 py-14 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          {/* The icons follow the headings rather than the section: a timer for
              elapsed time, the literal object the second card names, and a
              struck-through eye for "we do not see this". A shield here would
              read as "we guard your data", which presumes we hold it — the
              opposite of the third card's claim. */}
          <TrustPoint icon={Timer} title="Set up in about a minute">
            Sign in with your Google account and the spreadsheet is created for you. Nothing to
            install or configure, and you can disconnect the app whenever you want.
          </TrustPoint>
          <TrustPoint icon={FileSpreadsheet} title="Your class list stays on your Drive">
            It is an ordinary Google Sheet that you own. Open it, share it with a colleague, or take
            it with you if you change schools.
          </TrustPoint>
          <TrustPoint icon={EyeOff} title="We keep no lasting copy of student information">
            Our servers store your account, not your students. Their data is written only to your
            spreadsheet and stays in your hands.
          </TrustPoint>
        </div>
      </section>

      <section className="bg-canvas px-4 py-20 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 text-center">
          <h2 className="text-display-md font-semibold text-balance text-primary">
            Start with your first class
          </h2>
          <p className="max-w-[52ch] text-md leading-relaxed text-secondary">
            Registration and setup is quick and easy.
          </p>
          {/* Kept when the rest of the cost copy was gated, at the user's
              instruction. These three are the objections a teacher forms at the
              moment of committing — what it will charge me, what it costs, and
              whether I can get out — and answering them at the button is worth
              more than the tidiness of saying nothing about price. The pricing
              page they used to lead to is gone; these stand on their own. */}
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {[
              'No credit card',
              'Free while in early access',
              'Leave any time and keep your data',
            ].map((point) => (
              <li key={point} className="flex items-center gap-2 text-base text-primary">
                <Check size={15} strokeWidth={2.5} className="shrink-0 text-success" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-1">
            <SignInButton size="lg">Create your account</SignInButton>
          </div>
        </div>
      </section>
    </>
  );
}

function TrustPoint({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Icon size={22} strokeWidth={1.6} className="text-secondary" aria-hidden="true" />
      <h3 className="font-semibold text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-secondary">{children}</p>
    </div>
  );
}
