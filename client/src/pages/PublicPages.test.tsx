import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../hooks/useTheme';
import { MarketingLayout } from '../layouts/MarketingLayout';
import { LandingPage } from './LandingPage';
import { PricingPage } from './PricingPage';
import { FaqPage } from './FaqPage';
import { PrivacyPage, TermsPage } from './LegalPage';
import { YourDataPage } from './YourDataPage';
import { DOCUMENT_VERSION, EFFECTIVE_DATE, SUBPROCESSORS } from './legal/legalMeta';

function renderPublic(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <MarketingLayout>{ui}</MarketingLayout>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('the public surface', () => {
  it('renders without an auth provider at all', () => {
    // The point of the whole arrangement: these pages must not depend on a
    // session, because the visitor who most needs them cannot get one.
    expect(() => renderPublic(<LandingPage />)).not.toThrow();
  });

  it('sends every sign-in control to the server OAuth route', () => {
    renderPublic(<LandingPage />);
    const links = screen
      .getAllByRole('link')
      .filter((a) => /sign in|create your account/i.test(a.textContent ?? ''));
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link).toHaveAttribute('href', expect.stringContaining('/auth/google'));
    }
  });

  it('leads with "Create your account", not "Sign in", in the page body', () => {
    // Sign in is demoted to the header; the page itself asks for a signup.
    // "free account" until the cost copy was gated: the word named a tier.
    renderPublic(<LandingPage />);
    expect(screen.getAllByRole('link', { name: /create your account/i })).toHaveLength(2);
  });

  it('links FAQ, privacy and terms from the footer, and not pricing', () => {
    renderPublic(<LandingPage />);
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(within(footer).getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(footer).queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
  });

  it('answers the three objections at the button, without implying a countdown', () => {
    renderPublic(<LandingPage />);
    // The points beside the closing call to action survived the gating of the
    // rest of the cost copy: what it will charge me, what it costs, and whether
    // I can get out. They are the objections formed at the moment of committing.
    expect(screen.getByText('No credit card')).toBeInTheDocument();
    expect(screen.getByText('Free while in early access')).toBeInTheDocument();
    expect(screen.getByText('Leave any time and keep your data')).toBeInTheDocument();
    // Step 8a: no trial, so nothing on the page may suggest one is running out.
    expect(document.body.textContent).not.toMatch(/30 days|trial|premium/i);
  });

  it('claims no fixed number of tools, so the copy survives a sixth', () => {
    // The headline and section heading both used to count to five.
    renderPublic(<LandingPage />);
    expect(document.body.textContent).not.toMatch(/five tools/i);
  });

  it('keeps the trust section, on its three separate claims', () => {
    // The three points are what setup costs, where the data lives, and what we
    // hold. They were once one claim worded three ways; each is asserted here so
    // a copy pass cannot quietly collapse them back into each other.
    renderPublic(<LandingPage />);
    expect(screen.getByText(/set up in about a minute/i)).toBeInTheDocument();
    expect(screen.getByText(/stays on your drive/i)).toBeInTheDocument();
    expect(screen.getByText(/keep no lasting copy of student information/i)).toBeInTheDocument();
  });
});

describe('the feature showcase', () => {
  it('opens on the first tool with the others hidden', () => {
    renderPublic(<LandingPage />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // Only the selected panel is exposed.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('shows a tool when its tab is clicked', async () => {
    const user = userEvent.setup();
    renderPublic(<LandingPage />);
    await user.click(screen.getByRole('tab', { name: /name picker/i }));

    expect(screen.getByRole('tab', { name: /name picker/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('img', { name: /name picker wheel/i })).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderPublic(<LandingPage />);
    const first = screen.getAllByRole('tab')[0];
    first.focus();
    await user.keyboard('{ArrowDown}');

    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();
    // Roving tabindex: only the selected tab is reachable by Tab.
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
  });

  it('marks no tool as premium, because none of them is', () => {
    renderPublic(<LandingPage />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('svg.fill-accent')).toBeNull();
    }
    // Step 8a replaced the premium note with a statement that everything is
    // included; gating the cost copy removed that statement too, on the
    // reasoning that saying nothing is withheld invites looking for what is.
    // Neither the star nor the word survives anywhere here.
    expect(document.body.textContent).not.toMatch(/premium/i);
    expect(document.body.textContent).not.toMatch(/included with every account/i);
  });

  it('uses only reserved example domains in the product shots', () => {
    // A marketing asset for this product must never carry a real address.
    // Scoped to elements that hold nothing but an address, because scraping
    // textContent would run each one into the cell beside it.
    renderPublic(<LandingPage />);
    const addresses = [...document.querySelectorAll('span, td, li, p')]
      .map((el) => el.textContent?.trim() ?? '')
      .filter((text) => /^[^\s@]+@[^\s@]+$/.test(text));

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(address).toMatch(/@(school\.example|example\.com)$/);
    }
  });
});

describe('PricingPage', () => {
  // **The page is no longer routed.** `PUBLIC_BILLING_VISIBLE` is false, so
  // `/pricing` redirects to the landing page and nothing links here. The
  // component and these assertions are kept deliberately: the copy is what the
  // gate is holding back, and it has to stay coherent to be worth restoring.
  // Whoever flips the flag rewrites this page first, because what it currently
  // says is that there is no paid plan.
  //
  // Step 8a rewrote this page. It described two tiers, two prices and a
  // comparison table; the launch is free to every account, so it describes none
  // of that. These assertions are the guard against any of it coming back by
  // accident, which matters because the copy reads plausibly either way.
  it('names no price, no tier and no countdown', () => {
    renderPublic(<PricingPage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/premium/i);
    expect(text).not.toMatch(/subscri/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The page does say "trial" once, to deny there is one. Forbidding the word
    // outright would forbid the clearest way to say so, so what is asserted is
    // that no countdown is offered.
    expect(text).toMatch(/no trial that runs out/i);
    expect(text).not.toMatch(/30 days/i);
  });

  it('says the service is free during early access', () => {
    renderPublic(<PricingPage />);
    expect(screen.getByText(/free while it is in early access/i)).toBeInTheDocument();
  });

  // The one promise this page must not make. "Free" without a qualifier reads
  // as "free forever" to a teacher deciding whether to move a year of data in,
  // and the plan is for a paid tier to return.
  it('does not promise it will stay free, and says a paid plan would be announced first', () => {
    renderPublic(<PricingPage />);
    expect(screen.getByText(/announced well in advance/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/free forever|always be free/i);
  });

  it('lists the whole feature set as included, statistics and grouping rules among it', () => {
    renderPublic(<PricingPage />);
    const included = screen
      .getByRole('heading', { name: /what an account includes/i })
      .closest('section');
    expect(included?.textContent).toMatch(/Daily attendance entry/i);
    expect(included?.textContent).toMatch(/Attendance statistics/i);
    expect(included?.textContent).toMatch(/keep-together and keep-apart/i);
  });

  it('sends questions to the FAQ rather than answering them here', () => {
    renderPublic(<PricingPage />);
    expect(screen.getByRole('link', { name: /read the common questions/i })).toHaveAttribute(
      'href',
      '/faq',
    );
  });
});

describe('FaqPage', () => {
  it('opens by answering why a Google account is required', () => {
    // The first objection a privacy-minded teacher forms, so it leads.
    renderPublic(<FaqPage />);
    const questions = screen.getAllByRole('term');
    expect(questions[0]).toHaveTextContent(/why do i need to sign up with google/i);
    expect(screen.getByText(/creates a Google Sheet on your own Drive/i)).toBeInTheDocument();
  });

  it('answers leaving in one place, without inventing a subscription to lose', () => {
    renderPublic(<FaqPage />);
    const heading = screen.getByText(/what happens to my data if i want to leave/i);
    const answer = heading.nextElementSibling;
    expect(answer?.textContent).toMatch(/download it as a spreadsheet/i);
    expect(screen.queryByText(/^can i get my data out\?$/i)).not.toBeInTheDocument();
  });

  it('answers the blocked-board question and points at the public contact form', () => {
    // The one question a teacher cannot ask from inside the app, because a
    // blocked board is exactly what stops them signing in.
    renderPublic(<FaqPage />);
    expect(screen.getByText(/my school board blocks new apps/i)).toBeInTheDocument();
    const contact = screen.getAllByRole('link', { name: /contact form|send it to us/i });
    expect(contact.length).toBeGreaterThan(0);
    expect(contact[0]).toHaveAttribute('href', '/contact');
  });

  it('answers what it costs, mentions no card and no plan, and links no pricing page', () => {
    // The question stayed when the pricing page was gated: with nowhere to send
    // a teacher who asks, this is the only place the product answers it.
    renderPublic(<FaqPage />);
    const heading = screen.getByText(/what does it cost/i);
    expect(heading.nextElementSibling?.textContent).toMatch(/nothing while teachneat is in early access/i);
    expect(document.body.textContent).not.toMatch(/premium|billing portal/i);
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('href', '/pricing');
    }
  });
});

describe('the "Managing your data" documentation', () => {
  it('names no billing retention, there being no billing', () => {
    renderPublic(<YourDataPage />);
    expect(document.body.textContent).not.toMatch(/billing records/i);
  });

  // Google's Workspace API user data and developer policy requires help
  // documentation explaining how users can manage and delete their data. These
  // assert the four things such a reader came for, so a rewrite cannot quietly
  // drop one.
  it('explains how to export, delete data, delete the account, and revoke access', () => {
    renderPublic(<YourDataPage />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/File → Download/);
    expect(text).toMatch(/Delete the spreadsheet in Google Drive/i);
    expect(text).toMatch(/Account settings/);
    expect(text).toMatch(/third-party apps/i);
  });

  // The half of the split a teacher gets wrong in both directions.
  it('states that deleting the account leaves the spreadsheet alone', () => {
    renderPublic(<YourDataPage />);
    expect(screen.getByText(/It does not delete your spreadsheet\./i)).toBeInTheDocument();
  });

  // Its readers include a teacher whose board blocked the app and one who has
  // already revoked access. Both are signed out, and a route requiring the
  // sign-in it explains how to undo would be useless to them.
  it('gives a route for someone who cannot sign in', () => {
    renderPublic(<YourDataPage />);
    expect(screen.getByText(/If you cannot sign in/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /contact form/i }).length).toBeGreaterThan(0);
  });
});

describe('the legal documents', () => {
  it('render the privacy policy with its version and effective date', () => {
    renderPublic(<PrivacyPage />);
    expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
    // Asserted against the constants rather than a literal: the pair is what a
    // consent row is recorded against, and the test exists to prove they reach
    // the page, not to freeze a particular date.
    expect(
      screen.getByText(`Effective ${EFFECTIVE_DATE}. Version ${DOCUMENT_VERSION}.`),
    ).toBeInTheDocument();
  });

  // The scope list is the one part of the policy a Google OAuth reviewer checks
  // against the app's actual authorization request. The first draft described
  // three permissions and omitted the three identity scopes sign-in also asks
  // for, which is exactly the discrepancy that review looks for.
  it('disclose every OAuth scope the app actually requests', () => {
    renderPublic(<PrivacyPage />);
    for (const scope of ['drive.file','gmail.send', 'openid', 'email', 'profile']) {
      expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    }
  });

  it('disclose the technical logs and their retention', () => {
    renderPublic(<PrivacyPage />);
    expect(screen.getByText(/our servers keep ordinary technical logs/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no longer than 30 days/i).length).toBeGreaterThan(0);
  });

  it('lead the privacy policy with where student data actually lives', () => {
    renderPublic(<PrivacyPage />);
    expect(
      screen.getAllByText(/on your own Google Drive/i).length,
    ).toBeGreaterThan(0);
  });

  // The claim a technical reviewer tests first. "Holds no student records" was
  // defensible only on a reading of "holds" as durable custody, and it is false
  // on any other: every read and write transits the server, which is what calls
  // the Google APIs. What is true, and is the stronger claim anyway, is that no
  // durable copy survives the request. The pair is asserted together because
  // the durable-copy sentence is only honest beside the in-memory one.
  it('claim no durable copy rather than no contact with student data', () => {
    renderPublic(<PrivacyPage />);
    expect(
      screen.getByText(/keeps no durable copy of student information/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/holds no student records/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/a short-lived copy sits in our server’s memory/i),
    ).toBeInTheDocument();
  });

  // Google's OAuth verification checks for this by name. Losing the sentence
  // would not break the app, it would fail the Step 9 review months later.
  it('carry the Google API Services User Data Policy limited use statement', () => {
    renderPublic(<PrivacyPage />);
    expect(screen.getByText(/Limited Use requirements/)).toBeInTheDocument();
  });

  it('name every subprocessor and say the data is in Canada', () => {
    renderPublic(<PrivacyPage />);
    for (const sub of SUBPROCESSORS) {
      expect(screen.getByText(sub.name)).toBeInTheDocument();
    }
    expect(screen.getByText(/located in Toronto, Canada/i)).toBeInTheDocument();
  });

  it('render the terms with the responsibility clause and the liability cap', () => {
    renderPublic(<TermsPage />);
    expect(screen.getByRole('heading', { name: /terms of service/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Student information: your responsibility/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/one hundred Canadian dollars/i)).toBeInTheDocument();
  });

  // Ontario's Consumer Protection Act voids both of these against a consumer
  // here, so the arbitration section is US-only and the carve-out has to stay.
  it('scope the arbitration clause to the United States and preserve consumer rights', () => {
    renderPublic(<TermsPage />);
    expect(
      screen.getByText(/This section applies only if you are resident in the United States\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Consumer Protection Act, 2002/)).toBeInTheDocument();
  });

  // Numbering is positional, so a cross-reference is a lookup that throws on a
  // stale anchor. Rendering both documents is what makes that a caught failure.
  it('resolve every cross-reference to a section that exists', () => {
    expect(() => renderPublic(<PrivacyPage />)).not.toThrow();
    expect(() => renderPublic(<TermsPage />)).not.toThrow();
  });
});

/**
 * The Step 8a scrub, asserted across every public page at once.
 *
 * This is the one test that stops the scrub regressing. The IEP surface is gone
 * from the product permanently, and the copy describing it reads perfectly
 * plausibly — "accommodations" sits unremarkably in a list of what a roster
 * holds — so nothing about a stray mention would look wrong on review. Only a
 * sweep catches it.
 */
describe('the Step 8a scrub of the public surface', () => {
  const PAGES: [string, React.ReactNode][] = [
    ['landing', <LandingPage />],
    ['pricing', <PricingPage />],
    ['FAQ', <FaqPage />],
    ['your data', <YourDataPage />],
    ['privacy policy', <PrivacyPage />],
  ];

  for (const [name, page] of PAGES) {
    it(`the ${name} page names no IEP and no accommodations`, () => {
      renderPublic(page);
      expect(document.body.textContent).not.toMatch(/\bIEP\b/);
      expect(document.body.textContent).not.toMatch(/accommodation/i);
    });
  }

  /**
   * The terms are held to the same rule, and for a reason beyond tidiness.
   *
   * An earlier draft kept one mention: the consent warranty cautioned about
   * "accommodation and health-related information" in particular. That was
   * defensible as a caution and wrong as a signal — naming a category in the
   * one clause about what a teacher may record reads as confirmation that the
   * Service is a place to record it, which is precisely what removing the IEP
   * surface was meant to stop implying. The warranty is now general: consent
   * for whatever is entered, and an acknowledgement that the Service is a
   * general classroom tool represented as suitable for no particular category
   * of information.
   */
  it('the terms name no category of information a teacher might enter', () => {
    renderPublic(<TermsPage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/accommodation/i);
    expect(text).not.toMatch(/health/i);
    expect(text).not.toMatch(/\bIEP\b/);
    // The general warranty that replaced it, which must survive the sweep.
    expect(text).toMatch(/in respect of any information you enter/i);
    expect(text).toMatch(/neither designed nor represented as suitable/i);
  });

  it('no page names a price, a subscription or a payment processor', () => {
    for (const [, page] of PAGES) {
      const { unmount } = renderPublic(page);
      expect(document.body.textContent).not.toMatch(/\$\d/);
      expect(document.body.textContent).not.toMatch(/Stripe/);
      unmount();
    }
  });

  it('Stripe is no longer named as a subprocessor', () => {
    expect(SUBPROCESSORS.map((s) => s.name).join(' ')).not.toMatch(/Stripe/);
  });
});
