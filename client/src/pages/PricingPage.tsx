import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignInButton } from '../layouts/MarketingLayout';

/**
 * The public pricing page (Phase 2 Step 5, rewritten by Step 8a).
 *
 * It listed two tiers, a comparison table and two prices until the first school
 * year was scoped to a free Ontario launch. None of that will happen, so none of
 * it is described here: no figures, no tiers, no table, and no "starts at" that
 * would make the free period read as a trial with a bill behind it.
 *
 * **The route is kept rather than removed**, deliberately. The nav item, the
 * terms' cross-reference, the FAQ and the in-app welcome page all point here,
 * and a site that answers "what does this cost" with a 404 reads worse to the
 * two audiences that matter right now — a Google OAuth reviewer and a board
 * administrator — than one that answers it plainly.
 *
 * What it must not do is promise the price will stay nothing. It says the
 * service is free during early access and that a paid plan, if one arrives,
 * would be announced first, which is both true and the thing a teacher deciding
 * whether to move a year of attendance data into it actually wants to know.
 *
 * Questions live on `/faq`, not here.
 */

const INCLUDED: string[] = [
  'The full roster: add, edit, contact details, notes',
  'Daily attendance entry for every class, and the history grid',
  'Attendance statistics and each student’s attendance summary',
  'Random grouping, with keep-together and keep-apart rules',
  'The name picker, in card deck and wheel modes',
  'Mass email, personalized for each student and family',
  'Light and dark themes, fullscreen, and every display option',
];

export function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <h1 className="text-display-md font-semibold text-balance text-primary">Pricing</h1>
      <p className="mt-4 max-w-[62ch] text-md leading-relaxed text-secondary">
        Teachneat is free while it is in early access. There is no paid plan, no payment card, and
        no trial that runs out — every account has every feature, for as long as early access lasts.
      </p>
      <p className="mt-4 max-w-[62ch] text-md leading-relaxed text-secondary">
        If a paid plan is introduced later, it will be announced well in advance and no account will
        be charged without agreeing to it first. Your class data lives in a Google Sheet on your own
        Drive throughout, so it stays yours and stays readable whatever happens to the app.
      </p>

      <section className="mt-10 flex max-w-2xl flex-col gap-4 rounded-lg border border-subtle bg-elevated p-6">
        <div>
          <h2 className="text-lg font-semibold text-primary">What an account includes</h2>
          <p className="mt-1 text-sm text-secondary">All of it, at no cost</p>
        </div>
        <ul className="flex flex-col gap-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-secondary">
              <Check
                size={14}
                strokeWidth={2.5}
                className="mt-1 shrink-0 text-accent"
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-2">
          <SignInButton>Create your account</SignInButton>
          <p className="mt-3 text-xs text-secondary">
            Signing in with Google is all that is needed. No payment details are collected.
          </p>
        </div>
      </section>

      <p className="mt-10 text-sm text-secondary">
        Still deciding?{' '}
        <Link to="/faq" className="text-primary underline hover:no-underline">
          Read the common questions
        </Link>{' '}
        or{' '}
        <Link to="/contact" className="text-primary underline hover:no-underline">
          get in touch
        </Link>
        .
      </p>
    </div>
  );
}
