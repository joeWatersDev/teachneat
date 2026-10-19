import { escapeHtml } from '../utils/htmlEscape.js';
import { env } from '../config/env.js';
import { formatAdvertisedPrice, type BillingInterval } from '../config/billing.js';
import {
  LIFECYCLE_MESSAGE_TYPES,
  OPERATOR_POSTAL_ADDRESS,
  TRIAL_ENDING_LEAD_DAYS,
  type LifecycleMessageType,
} from '../config/lifecycleEmail.js';

/**
 * The six lifecycle emails, in full (Phase 2 Step 6h).
 *
 * **Nothing here interpolates anything from the teacher's spreadsheet.** These
 * messages address a teacher about their own account, and no student name,
 * class, attendance figure or note has any business in one. The only variable
 * that is even about a person is the teacher's own first name, which is account
 * data we already hold. That is the rule the templates are built to make
 * obvious: the context type below simply has nowhere to put student data.
 *
 * Plain text and HTML are written side by side rather than one generated from
 * the other. They are short enough that the duplication is cheaper than a
 * converter, and the plain-text part is what a spam filter reads.
 *
 * Tone follows the product's writing rules: no exclamation, no "excited", and
 * no sentence that exists only to sound warm. A teacher gets these on a working
 * day and should be able to read one in ten seconds.
 */

export interface LifecycleContext {
  /** The teacher's own name, as Google reports it. May be empty. */
  name: string;
  /**
   * The relevant date for the message, already formatted for reading. Null for
   * the messages that have no date in them.
   */
  date?: string | null;
  /**
   * Which price the subscription is on, for the one message that names a figure.
   * Null means unknown — an account whose interval predates the column, or a
   * price this deployment does not recognise — and the copy then names no figure
   * rather than guessing one.
   */
  interval?: BillingInterval | null;
}

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

/** The teacher's first name, or a neutral greeting when we have no usable name. */
function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length > 0 ? `Hi ${first},` : 'Hello,';
}

/**
 * How the promo-ending reminder names the charge that is coming.
 *
 * This is the one lifecycle message that states a figure at all — the others
 * deliberately do not, since a price in an uneditable email goes stale the
 * moment one changes — and it does so because its entire purpose is that the
 * first real charge is not a surprise. The figure comes from ADVERTISED_PRICES,
 * which the startup check compares against Stripe, so a price change reaches
 * this sentence without anyone remembering that it exists.
 *
 * A null interval names no figure rather than guessing. Naming the wrong one
 * would be worse than naming none: an annual subscriber told to expect $6.99
 * before a $69.90 charge has been actively misled by the message that exists to
 * prevent exactly that. The account page states the current price and is one
 * click away.
 */
function billsAt(interval: BillingInterval | null | undefined): string {
  return interval
    ? `at the normal ${interval} price of ${formatAdvertisedPrice(interval)}`
    : 'at its normal price, which your account page shows';
}

/** A date a teacher can read, in the app's own plain style. */
export function formatMessageDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The shell's palette, as literals.
 *
 * Every other surface takes these from Tailwind tokens and an email cannot:
 * there is no stylesheet, no class and no theme to follow. They are the
 * light-mode values from DESIGN_SYSTEM.md, in one constant rather than spelled
 * out at each of the dozen places the shell needs one.
 *
 * The message declares itself light rather than leaving the question open. A
 * dark rendering that Apple Mail honours and Gmail strips is two designs
 * maintained to produce one inconsistent inbox; a light message that a forcing
 * client inverts is one design with one failure mode.
 */
const PALETTE = {
  /** Outside the card. */
  ground: '#f1f3f4',
  card: '#ffffff',
  /** The masthead band: the app's own canvas, so it matches the page its links open. */
  canvas: '#fffdf7',
  /** The footer band. */
  sunk: '#f8f9fa',
  rule: '#dadce0',
  ink: '#202124',
  muted: '#5f6368',
  accent: '#ffab00',
  /**
   * Links are not the accent. `#ffab00` fails WCAG AA as text against both
   * grounds, which is a standing rule in DESIGN_SYSTEM and does not stop being
   * true in an inbox.
   */
  link: '#1a5fb4',
} as const;

/** DESIGN_SYSTEM's system stack, with the fallbacks Outlook needs appended. */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The wordmark, as close as email gets to `Wordmark.tsx`: the same weight split
 * across the join, 650 on "Teach" against 400 on "neat", at the same negative
 * tracking. A client that cannot resolve 650 rounds it to bold, which keeps the
 * split rather than losing it; Outlook, which has only bold and normal, lands
 * there too.
 *
 * No image, so nothing here makes a network request. That is the point: a
 * remote logo is an open beacon whether or not anyone ever reads the log, and
 * the privacy policy states that the product uses no tracking pixel.
 */
const WORDMARK =
  `<span style="font-family:${FONT};font-size:18px;letter-spacing:-0.02em;color:${PALETTE.ink};">` +
  '<span style="font-weight:650;">Teach</span><span style="font-weight:400;">neat</span>' +
  '</span>';

/**
 * Why this message arrived, which is the only part of the footer that varies.
 *
 * A total record for the same reason `RENDERERS` is one: a seventh message type
 * is a compile error rather than a message that reaches a teacher with no
 * explanation of why they are being written to.
 */
const FOOTER_REASON: Record<LifecycleMessageType, string> = {
  welcome: 'you created a Teachneat account.',
  trial_ending: 'your Teachneat trial is ending.',
  trial_ended: 'your Teachneat trial has ended.',
  promo_ending: 'the founding-user offer on your subscription is ending.',
  pause_resuming: 'your paused Teachneat subscription is about to resume.',
  account_deleted:
    'your Teachneat account was deleted. This is the last message we will send to this address.',
};

/**
 * The footer's links. The deleted account has no account page to send anyone
 * to, and the contact form is the thing that message already points at.
 */
function footerLinks(type: LifecycleMessageType): { label: string; href: string }[] {
  const links = [
    { label: 'Contact', href: `${env.clientOrigin}/contact` },
    { label: 'Privacy policy', href: `${env.clientOrigin}/privacy` },
  ];
  return type === 'account_deleted'
    ? links
    : [{ label: 'Account settings', href: `${env.clientOrigin}/account` }, ...links];
}

/**
 * The bare URLs the templates write, turned into anchors for the HTML part.
 *
 * Five of the six messages end on a call to action written as a sentence with
 * the address spelled out — "Manage your subscription: https://…" — because
 * both bodies are generated from the one list of paragraphs and the plain-text
 * part needs the address readable. Escaping that paragraph and stopping there
 * left the most important line in those messages as dead text in HTML: some
 * clients auto-link a bare URL, plenty do not, and a branded shell wrapped
 * around an unclickable call to action is the impression the shell exists to
 * avoid.
 *
 * Escaping is per segment rather than over the whole paragraph, so the URL is
 * escaped once for the attribute and once for the visible text while the prose
 * around it still cannot introduce markup. The link colour is the footer's, for
 * the WCAG reason recorded on `PALETTE.link`, and it is stated rather than
 * inherited because a client's own default anchor colour is not ours to trust.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** Trailing sentence punctuation belongs to the sentence, not to the address. */
function splitTrailingPunctuation(url: string): [string, string] {
  const match = /[.,;:!?]+$/.exec(url);
  return match ? [url.slice(0, match.index), match[0]] : [url, ''];
}

function paragraphHtml(text: string): string {
  let out = '';
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const [url, trailing] = splitTrailingPunctuation(match[0]);
    out += escapeHtml(text.slice(cursor, start));
    const href = escapeHtml(url);
    out += `<a href="${href}" style="color:${PALETTE.link};">${href}</a>${escapeHtml(trailing)}`;
    cursor = start + match[0].length;
  }
  return out + escapeHtml(text.slice(cursor));
}

/** Longest preview line worth writing; past this every client truncates anyway. */
const PREHEADER_MAX = 140;

/**
 * The line the inbox shows beside the subject, taken from the message's own
 * first real paragraph rather than written separately.
 *
 * Derived, so it cannot drift from the body and so the dated and undated
 * branches each get the sentence they actually sent. Without it every one of
 * the six previews as "Hi Sarah,", which spends the most-read line in the
 * message on the one word that carries nothing.
 */
function preheaderFrom(paragraphs: string[]): string {
  const source = paragraphs[1] ?? '';
  if (source.length <= PREHEADER_MAX) return source;
  const cut = source.slice(0, PREHEADER_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : PREHEADER_MAX).trimEnd()}…`;
}

/**
 * The branded shell: an accent edge, a masthead, the body, and the footer that
 * identifies the sender.
 *
 * Tables rather than a styled `<div>`, because Outlook for Windows renders with
 * Word's engine and ignores `max-width` — which is why the un-shelled version of
 * these messages ran the full width of the window there. The `mso` ghost table
 * is the only construction that pins a width for it.
 *
 * A full document rather than a fragment, because the `color-scheme` meta tags
 * are what stop Apple Mail and Outlook.com auto-inverting the palette, and a
 * meta tag needs a head to sit in.
 *
 * Still no image, no external stylesheet and no tracking pixel.
 */
function toHtml(
  type: LifecycleMessageType,
  subject: string,
  paragraphs: string[],
  preheader: string,
): string {
  const body = paragraphs
    .map((p, i) => {
      const margin = i === paragraphs.length - 1 ? '0' : '0 0 16px';
      return `<p style="margin:${margin};">${paragraphHtml(p)}</p>`;
    })
    .join('\n            ');

  const links = footerLinks(type)
    .map(
      (l) =>
        `<a href="${escapeHtml(l.href)}" style="color:${PALETTE.muted};">${escapeHtml(l.label)}</a>`,
    )
    .join('&nbsp;&middot;&nbsp;');

  const address = OPERATOR_POSTAL_ADDRESS
    ? `\n            <p style="margin:0;">Teachneat, ${escapeHtml(OPERATOR_POSTAL_ADDRESS)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.ground};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.ground};border-collapse:collapse;">
  <tr><td align="center" style="padding:24px 12px;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${PALETTE.card};border:1px solid ${PALETTE.rule};border-collapse:separate;">
      <tr>
        <td style="height:3px;line-height:3px;font-size:0;background:${PALETTE.accent};">&nbsp;</td>
      </tr>
      <tr>
        <td style="background:${PALETTE.canvas};padding:18px 24px;border-bottom:1px solid ${PALETTE.rule};">${WORDMARK}</td>
      </tr>
      <tr>
        <td style="padding:26px 24px 24px;font-family:${FONT};font-size:15px;line-height:1.5;color:${PALETTE.ink};">
            ${body}
        </td>
      </tr>
      <tr>
        <td style="background:${PALETTE.sunk};border-top:1px solid ${PALETTE.rule};padding:16px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};">
            <p style="margin:0 0 6px;">You are receiving this because ${escapeHtml(FOOTER_REASON[type])}</p>
            <p style="margin:0;">${links}</p>${address}
        </td>
      </tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}

/** The same footer, as the lines a plain-text reader gets. */
function toTextFooter(type: LifecycleMessageType): string[] {
  const lines = [
    `You are receiving this because ${FOOTER_REASON[type]}`,
    ...footerLinks(type).map((l) => `${l.label}: ${l.href}`),
  ];
  if (OPERATOR_POSTAL_ADDRESS) lines.push(`Teachneat, ${OPERATOR_POSTAL_ADDRESS}`);
  return lines;
}

/**
 * What a template produces: a subject and its paragraphs. The shell is composed
 * around it in {@link renderLifecycleMessage}, which is where the message type
 * is known, so the six templates below stay lists of sentences and never touch
 * markup.
 */
interface Draft {
  subject: string;
  paragraphs: string[];
}

function message(subject: string, paragraphs: string[]): Draft {
  return { subject, paragraphs };
}

type Renderer = (ctx: LifecycleContext) => Draft;

/**
 * The catalogue, keyed by message type. Typed as a total record, so adding a
 * message type without writing its template is a compile error rather than a
 * runtime hole — and, with the closed list in `config/lifecycleEmail.ts`, so is
 * adding a template for a message the catalogue does not admit.
 */
const RENDERERS: Record<LifecycleMessageType, Renderer> = {
  welcome: (ctx) =>
    message('Welcome to Teachneat', [
      greeting(ctx.name),
      'Your Teachneat account is ready. Your class data is stored in a spreadsheet on your own Google Drive, which means it stays under your control and you can open it directly whenever you want to.',
      'A good first step is adding a class list, which everything else in the app builds on. You can paste a whole list at once rather than adding students one at a time.',
      `Open the app: ${env.clientOrigin}`,
      'If something does not work the way you expect, reply through the contact form in the app and it reaches a person.',
    ]),

  // The two trial messages are dormant under Step 8a — with billing off, no
  // scan queues either of them — and that is exactly why the wording below was
  // corrected rather than left. Copy nobody reads while it is dormant is copy
  // that goes out to everybody, unread, on the day the flag flips back.
  //
  // Three things were wrong. Both said "free plan" where the standing
  // user-facing term is "free account"; `trial_ending` never named Premium, so
  // a teacher reading the warning had no word for the thing they would be
  // buying; and both listed IEP information among what survives the trial,
  // which the same step removed from the product permanently.
  trial_ending: (ctx) =>
    message(`Your Teachneat trial ends in ${TRIAL_ENDING_LEAD_DAYS} days`, [
      greeting(ctx.name),
      ctx.date
        ? `Your 30-day trial ends on ${ctx.date}. After that your account moves to a free account.`
        : 'Your 30-day trial is ending shortly. After that your account moves to a free account.',
      'Nothing is deleted and nothing stops working on a free account: your class lists, attendance records, notes, grouping and the name picker all stay exactly as they are, and your spreadsheet is untouched.',
      'What a free account does not include is attendance statistics, the attendance summary on a student record, grouping constraints, and email above 30 messages a month. Those are part of Premium.',
      `If you want to keep them, you can subscribe from the account menu: ${env.clientOrigin}/account`,
    ]),

  trial_ended: (ctx) =>
    message('Your Teachneat trial has ended', [
      greeting(ctx.name),
      'Your trial has ended and you now have a free account.',
      'Your data is exactly where you left it. Class lists, attendance records, notes and groupings are all still there, and the spreadsheet on your Google Drive has not been touched.',
      'Attendance statistics, the attendance summary on a student record, grouping constraints, and email above 30 messages a month are part of Premium. Everything else works as it did.',
      // No figures here, deliberately. A price in an email is a price that goes
      // stale the moment one changes, in a message nobody can edit after it is
      // sent; the account page states the current one and is the only place that
      // has to be right. The promo reminder is the one message that still names
      // an amount, because its whole purpose is that a first charge is not a
      // surprise.
      `You can subscribe from your account page whenever you want it back: ${env.clientOrigin}/account`,
    ]),

  promo_ending: (ctx) =>
    // Subject is interval-neutral. The offer was six months on the monthly price
    // when it was written; it is now twelve months on either price, which is one
    // free year to an annual subscriber and twelve free months to a monthly one,
    // and "your free months" reads oddly to the first of those.
    message('Your founding-user offer is ending', [
      greeting(ctx.name),
      ctx.date
        ? `Your founding-user offer covers you until ${ctx.date}. After that your subscription bills ${billsAt(ctx.interval)}.`
        : `Your founding-user offer is ending shortly, and your subscription will bill ${billsAt(ctx.interval)}.`,
      'This message exists so the first charge is not a surprise. If you would rather not continue, you can cancel from the account menu before then and nothing is charged.',
      `Manage your subscription: ${env.clientOrigin}/account`,
    ]),

  pause_resuming: (ctx) =>
    message('Your Teachneat subscription resumes soon', [
      greeting(ctx.name),
      ctx.date
        ? `Your paused subscription resumes on ${ctx.date}, and billing starts again from that date.`
        : 'Your paused subscription resumes shortly, and billing starts again from that date.',
      'Premium features come back on automatically. There is nothing you need to do.',
      `If your plans have changed, you can cancel before then: ${env.clientOrigin}/account`,
    ]),

  account_deleted: (ctx) =>
    message('Your Teachneat account has been deleted', [
      greeting(ctx.name),
      'Your Teachneat account has been deleted, along with your sessions and any support requests you sent us. If you had a subscription, it was cancelled before the account was removed.',
      'Your spreadsheet has not been touched. It is still on your Google Drive with all of your class data in it, and it is yours to keep, export or delete.',
      'Teachneat no longer has access to your Google account. You can confirm that at myaccount.google.com under the list of apps with account access.',
      'If this was not you, contact us through the form on the site.',
    ]),
};

/**
 * Renders one lifecycle message: the template's own sentences, then the shell
 * and the footer composed around them. Both bodies come from the one list of
 * paragraphs, so the plain-text and HTML parts still cannot say different
 * things.
 */
export function renderLifecycleMessage(
  type: LifecycleMessageType,
  ctx: LifecycleContext,
): RenderedMessage {
  const { subject, paragraphs } = RENDERERS[type](ctx);
  return {
    subject,
    text: [paragraphs.join('\n\n'), toTextFooter(type).join('\n')].join('\n\n'),
    html: toHtml(type, subject, paragraphs, preheaderFrom(paragraphs)),
  };
}

/** The message types that actually have a template, for the catalogue test. */
export function templatedMessageTypes(): readonly string[] {
  return LIFECYCLE_MESSAGE_TYPES.filter((t) => t in RENDERERS);
}
