import { describe, it, expect, vi } from 'vitest';
import {
  LIFECYCLE_MESSAGE_TYPES,
  LIFECYCLE_MAX_ATTEMPTS,
  LIFECYCLE_RETRY_DELAY_MS,
  type LifecycleMessageType,
} from '../config/lifecycleEmail.js';
import {
  createMemoryLifecycleEmailStore,
  dispatchLifecycleEmails,
  enqueueQuietly,
  type LifecycleEmailStore,
} from './lifecycleEmail.js';
import { renderLifecycleMessage, templatedMessageTypes } from './lifecycleTemplates.js';
import { createConsoleMailer, type Mailer } from './mailer.js';
import { formatAdvertisedPrice } from '../config/billing.js';
import { withBillingEnabled } from '../test/billing.js';

/** A mailer that records what it was given, and can be told to fail. */
function recordingMailer(fail = false): Mailer & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  return {
    name: 'test',
    sent,
    async send(message) {
      if (fail) throw new Error('provider unavailable');
      sent.push({ to: message.to, subject: message.subject });
    },
  };
}

function queueOne(store: LifecycleEmailStore, overrides: Record<string, unknown> = {}) {
  return store.enqueue({
    accountId: 'acct-1',
    messageType: 'welcome',
    recipientEmail: 'teacher@example.com',
    recipientName: 'Dana Chen',
    ...overrides,
  });
}

describe('the message catalogue', () => {
  /**
   * The criterion in TESTING_PLAN, and the one assertion in this file that is
   * about the law rather than about the code. Six transactional messages sit
   * outside CASL's consent requirement because each is tied to the account
   * relationship and to something the teacher did. A seventh — a product
   * update, an offer, anything promoting the paid plan to a free account — is a
   * commercial electronic message needing express consent, an unsubscribe path
   * and a consent record, none of which is built. This test is what makes
   * adding one a deliberate act rather than a one-line change.
   */
  it('is closed at exactly the six transactional messages', () => {
    expect([...LIFECYCLE_MESSAGE_TYPES]).toEqual([
      'welcome',
      'trial_ending',
      'trial_ended',
      'promo_ending',
      'pause_resuming',
      'account_deleted',
    ]);
  });

  it('has a template for every message type and no others', () => {
    expect(templatedMessageTypes()).toEqual([...LIFECYCLE_MESSAGE_TYPES]);
  });

  it('has no payment-failure message, because Stripe dunning covers it', () => {
    const types: readonly string[] = LIFECYCLE_MESSAGE_TYPES;
    expect(types.some((t) => t.includes('payment') || t.includes('dunning'))).toBe(false);
  });
});

describe('templates', () => {
  const context = { name: 'Dana Chen', date: 'October 3, 2026' };

  it('renders every message with a subject and both bodies', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const rendered = renderLifecycleMessage(type, context);
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.html).toContain('<p');
    }
  });

  /**
   * The PII boundary, asserted at the only point where it could be crossed. A
   * template's context carries the teacher's own name and a date and has
   * nowhere to put anything from the Sheet — so this checks the other half:
   * that no template hardcodes a placeholder inviting one to be added.
   */
  it('interpolates nothing from the teacher’s spreadsheet', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const { text } = renderLifecycleMessage(type, context);
      expect(text).not.toMatch(/\{\{/);
      expect(text.toLowerCase()).not.toContain('student name');
    }
  });

  it('escapes the teacher’s name in the HTML body', () => {
    const { html } = renderLifecycleMessage('welcome', { name: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('greets neutrally when the account has no name', () => {
    expect(renderLifecycleMessage('welcome', { name: '' }).text).toContain('Hello,');
    expect(renderLifecycleMessage('welcome', { name: 'Dana Chen' }).text).toContain('Hi Dana,');
  });

  /**
   * The distinction the whole trial-to-free moment turns on: a teacher who has
   * been using Statistics for a month is being told what happened to their
   * account, and the first thing they need to know is that nothing was
   * destroyed.
   */
  it('tells a lapsing teacher their data is intact', () => {
    for (const type of ['trial_ending', 'trial_ended'] as LifecycleMessageType[]) {
      const { text } = renderLifecycleMessage(type, context);
      expect(text).toMatch(/spreadsheet/i);
      expect(text).toMatch(/nothing is deleted|has not been touched|still there/i);
    }
  });

  /**
   * A price in an email goes stale the moment one changes, in a message nobody
   * can edit after it is sent. The account page states the current figure and
   * is the only place that has to be right. The promo reminder is the single
   * exception, since its purpose is that a first charge is not a surprise.
   */
  it('sends the lapsing teacher to the account page rather than quoting a price', () => {
    for (const type of ['trial_ending', 'trial_ended'] as LifecycleMessageType[]) {
      const { text } = renderLifecycleMessage(type, context);
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).toContain('/account');
    }
  });

  /**
   * The promo reminder is the one message that names a figure, so it is the one
   * message that can name the wrong one. It quoted the monthly price
   * unconditionally while the promo was monthly-only; the promo now applies to
   * both prices, and an annual subscriber told to expect $6.99 before a $69.90
   * charge would be misled by the very message that exists to prevent that.
   */
  it('quotes the price for the interval the subscription is actually on', () => {
    const monthly = renderLifecycleMessage('promo_ending', { ...context, interval: 'monthly' }).text;
    expect(monthly).toContain(formatAdvertisedPrice('monthly'));
    expect(monthly).not.toContain(formatAdvertisedPrice('annual'));

    const annual = renderLifecycleMessage('promo_ending', { ...context, interval: 'annual' }).text;
    expect(annual).toContain(formatAdvertisedPrice('annual'));
    expect(annual).not.toContain(formatAdvertisedPrice('monthly'));
  });

  /**
   * Naming no figure is the correct fallback, and naming a guessed one is not:
   * an unknown interval means either an account that predates the column or a
   * price this deployment does not recognise, and in both cases the account page
   * is right where this email would be wrong.
   */
  it('names no figure at all when the interval is unknown', () => {
    for (const interval of [null, undefined]) {
      const { text } = renderLifecycleMessage('promo_ending', { ...context, interval });
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).toContain('/account');
    }
  });

  /**
   * The subject has to hold for a monthly redeemer taking twelve free months and
   * an annual one taking a free year. "Your free months" describes only the
   * first.
   */
  it('keeps the promo subject free of an interval-specific noun', () => {
    const { subject } = renderLifecycleMessage('promo_ending', context);
    expect(subject).not.toMatch(/month|year/i);
  });

  it('reads the date it was given rather than inventing one', () => {
    expect(renderLifecycleMessage('trial_ending', context).text).toContain('October 3, 2026');
    // With no date the sentence still has to be grammatical, not "ends on null".
    const undated = renderLifecycleMessage('trial_ending', { name: 'Dana', date: null }).text;
    expect(undated).not.toContain('null');
    expect(undated).toMatch(/ending shortly/);
  });
});

describe('the shell', () => {
  const context = { name: 'Dana Chen', date: 'October 3, 2026' };

  /**
   * The footer is what identifies the sender, and CASL's identification
   * requirements are not lifted by the exemption that lets these six send
   * without consent. Both bodies carry it, since a plain-text reader is still a
   * recipient.
   */
  it('tells every recipient why they are receiving the message, in both bodies', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const { html, text } = renderLifecycleMessage(type, context);
      expect(html).toContain('You are receiving this because');
      expect(text).toContain('You are receiving this because');
    }
  });

  /**
   * The meta tags that stop Apple Mail and Outlook.com auto-inverting need a
   * head, and the ghost table is the only construction Outlook for Windows
   * honours for a fixed width. A fragment would silently lose both.
   */
  it('sends a full light-declared document with the Outlook width', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const { html } = renderLifecycleMessage(type, context);
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain('name="color-scheme" content="light"');
      expect(html).toContain('<!--[if mso]>');
    }
  });

  /**
   * The branding is typographic on purpose. A remote image is an open beacon
   * whether or not anyone reads the log, and the privacy policy states that the
   * product uses no tracking pixel — so the shell may not acquire one by way of
   * a logo.
   */
  it('loads nothing from the network', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const { html } = renderLifecycleMessage(type, context);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/background-image|url\(/i);
      expect(html).not.toMatch(/<link|<script/i);
    }
  });

  /**
   * Five of the six messages end on a call to action written as a sentence with
   * the address spelled out, because the plain-text part needs it readable. The
   * HTML part escaped that and stopped, which left the most important line in
   * those messages as text a reader cannot click.
   */
  it('anchor the calls to action in the body, not only the footer links', () => {
    for (const type of LIFECYCLE_MESSAGE_TYPES) {
      const { html, text } = renderLifecycleMessage(type, context);
      const body = text.split('You are receiving this because')[0];
      for (const url of body.match(/https?:\/\/\S+/g) ?? []) {
        expect(html).toContain(`<a href="${url}"`);
      }
    }
  });

  /**
   * The name comes from Google and is the one thing in these messages this
   * project does not author, so linkifying a paragraph must not become a way
   * for it to reach the document as markup.
   */
  it('escape the prose around a link, including a name that looks like one', () => {
    const { html } = renderLifecycleMessage('welcome', {
      ...context,
      name: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /** Sentence punctuation belongs to the sentence, not inside the href. */
  it('keep trailing punctuation out of the link', () => {
    const { html } = renderLifecycleMessage('welcome', {
      ...context,
      name: 'https://example.com/x.',
    });
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).not.toContain('href="https://example.com/x."');
  });

  /** The account page is gone by the time this one sends. */
  it('offers the deleted account no account-page link', () => {
    const { html, text } = renderLifecycleMessage('account_deleted', context);
    expect(html).not.toContain('/account"');
    expect(text).not.toMatch(/Account settings/);
    expect(text).toMatch(/last message we will send/);
  });

  /**
   * Without a preheader every one of the six previews in the inbox as the
   * greeting, which spends the most-read line on the one word carrying nothing.
   */
  it('previews the first real sentence rather than the greeting', () => {
    const { html } = renderLifecycleMessage('trial_ending', context);
    const preheader = html.match(/opacity:0;">([^<]*)</)?.[1] ?? '';
    expect(preheader).not.toMatch(/^Hi Dana/);
    expect(preheader).toContain('October 3, 2026');
  });
});

describe('the queue', () => {
  /**
   * The criterion the whole design turns on. A duplicate welcome is
   * embarrassing; a duplicate "your trial is ending" is worse.
   */
  it('accepts one message per account and type, and refuses the second', async () => {
    const store = createMemoryLifecycleEmailStore();
    expect(await queueOne(store)).toBe(true);
    expect(await queueOne(store)).toBe(false);
    expect(store.all()).toHaveLength(1);
  });

  it('treats the same message to a different account as a different message', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store);
    expect(await queueOne(store, { accountId: 'acct-2' })).toBe(true);
  });

  it('treats a different message to the same account as a different message', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store);
    expect(await queueOne(store, { messageType: 'trial_ending' })).toBe(true);
  });

  /**
   * The trigger sites are inside requests a teacher cares about far more than
   * the email — creating their account, deleting it. TESTING_PLAN asks for this
   * on the signup path specifically; asserting it at the helper covers every
   * caller at once, and `auth.test.ts` covers the route.
   */
  it('swallows a queue failure rather than failing the caller', async () => {
    const broken: LifecycleEmailStore = {
      enqueue: () => Promise.reject(new Error('database down')),
      claimDue: async () => [],
      markSent: async () => undefined,
      markFailed: async () => undefined,
      queueTrialMessages: async () => 0,
    };
    await expect(
      enqueueQuietly(broken, {
        accountId: 'acct-1',
        messageType: 'welcome',
        recipientEmail: 'teacher@example.com',
        recipientName: 'Dana',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('the dispatch sweep', () => {
  it('sends what is queued and marks it sent', async () => {
    const store = createMemoryLifecycleEmailStore();
    const mailer = recordingMailer();
    await queueOne(store);

    const result = await dispatchLifecycleEmails(mailer, store);

    expect(result.sent).toBe(1);
    expect(mailer.sent[0]?.to).toBe('teacher@example.com');
    expect(mailer.sent[0]?.subject).toBe('Welcome to Teachneat');
    expect(store.all()[0]?.sentAt).not.toBeNull();
  });

  it('does not send a message twice across two passes', async () => {
    const store = createMemoryLifecycleEmailStore();
    const mailer = recordingMailer();
    await queueOne(store);
    await dispatchLifecycleEmails(mailer, store);
    await dispatchLifecycleEmails(mailer, store);
    expect(mailer.sent).toHaveLength(1);
  });

  it('keeps a failed message queued and records the error', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store);

    const result = await dispatchLifecycleEmails(recordingMailer(true), store);

    expect(result.failed).toBe(1);
    expect(store.all()[0]?.sentAt).toBeNull();
    expect(store.all()[0]?.abandonedAt).toBeNull();
  });

  it('waits the retry delay before trying a failed message again', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store);
    const now = new Date();
    await dispatchLifecycleEmails(recordingMailer(true), store, now);

    // Immediately after: nothing is due, so a fast sweep loop cannot hammer the
    // provider with the same failing address.
    const soon = await dispatchLifecycleEmails(recordingMailer(true), store, now);
    expect(soon.failed).toBe(0);

    const later = new Date(now.getTime() + LIFECYCLE_RETRY_DELAY_MS + 1000);
    const retried = await dispatchLifecycleEmails(recordingMailer(true), store, later);
    expect(retried.failed).toBe(1);
  });

  /**
   * A "your trial ends in five days" that finally sends a fortnight late is
   * worse than one that never sends, so the retries are bounded.
   */
  it('abandons a message after its attempts are used up', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store);
    let at = Date.now();
    for (let i = 0; i < LIFECYCLE_MAX_ATTEMPTS; i += 1) {
      await dispatchLifecycleEmails(recordingMailer(true), store, new Date(at));
      at += LIFECYCLE_RETRY_DELAY_MS + 1000;
    }
    expect(store.all()[0]?.abandonedAt).not.toBeNull();

    // And stays abandoned rather than being picked up again forever.
    const after = await dispatchLifecycleEmails(recordingMailer(true), store, new Date(at));
    expect(after.failed).toBe(0);
  });

  it('carries on past one bad address rather than stopping the pass', async () => {
    const store = createMemoryLifecycleEmailStore();
    await queueOne(store, { accountId: 'bad', recipientEmail: 'nope@example.com' });
    await queueOne(store, { accountId: 'good', recipientEmail: 'fine@example.com' });
    const mailer: Mailer = {
      name: 'test',
      async send(message) {
        if (message.to === 'nope@example.com') throw new Error('bounced');
      },
    };

    const result = await dispatchLifecycleEmails(mailer, store);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });
});

/**
 * The launch scope reduction (Phase 2 Step 8a). All four scheduled scans are
 * about money, so with billing off the sweep must not run them — a trial
 * warning sent when no trial is ending is the failure this guards — while the
 * drain of what is already queued goes on, because the welcome and the deletion
 * confirmation have nothing to do with a plan.
 */
describe('the scheduled scan under the launch flag', () => {
  /** A store that records whether the sweep asked it to scan. */
  function countingStore() {
    const store = createMemoryLifecycleEmailStore();
    let scans = 0;
    return {
      store: { ...store, queueScheduledMessages: async () => {
        scans += 1;
        return 0;
      } } as LifecycleEmailStore & { all: typeof store.all },
      scanned: () => scans,
    };
  }

  it('does not scan with billing switched off', async () => {
    const { store, scanned } = countingStore();
    const result = await dispatchLifecycleEmails(recordingMailer(), store);
    expect(scanned()).toBe(0);
    expect(result.queued).toBe(0);
  });

  it('still sends what is already queued', async () => {
    const { store } = countingStore();
    const mailer = recordingMailer();
    await queueOne(store);
    const result = await dispatchLifecycleEmails(mailer, store);
    expect(result.sent).toBe(1);
    expect(mailer.sent[0]?.subject).toBe('Welcome to Teachneat');
  });

  describe('with billing switched on', () => {
    withBillingEnabled();
    it('scans again', async () => {
      const { store, scanned } = countingStore();
      await dispatchLifecycleEmails(recordingMailer(), store);
      expect(scanned()).toBe(1);
    });
  });
});

describe('the console driver', () => {
  it('writes the whole message where a developer can read it', async () => {
    const written: string[] = [];
    const mailer = createConsoleMailer((s) => written.push(s));
    await mailer.send({
      to: 'teacher@example.com',
      subject: 'Welcome to Teachneat',
      text: 'Hi Dana,',
      html: '<p>Hi Dana,</p>',
    });
    expect(written.join('\n')).toContain('Welcome to Teachneat');
    expect(written.join('\n')).toContain('teacher@example.com');
  });

  it('never claims to have sent anything', async () => {
    const written: string[] = [];
    await createConsoleMailer((s) => written.push(s)).send({
      to: 'a@b.c',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });
    expect(written.join('\n')).toContain('not sent');
  });
});

describe('the Resend driver', () => {
  it('throws on a provider error, so the sweep records it rather than losing it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('domain not verified', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { createResendMailer } = await import('./mailer.js');

    await expect(
      createResendMailer('key', 'a@b.c').send({
        to: 'x@y.z',
        subject: 's',
        text: 't',
        html: '<p>t</p>',
      }),
    ).rejects.toThrow(/403/);
    vi.unstubAllGlobals();
  });

  /**
   * The from address is chosen for deliverability and the reply address for
   * reaching a person, and they are not always the same string. A teacher
   * answering a trial notice is the likeliest first contact anyone makes with
   * this product, so whether that arrives should not depend on the sender
   * having happened to be a mailbox that receives.
   */
  it('send reply_to when one is configured, and omit the field when not', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { createResendMailer } = await import('./mailer.js');
    const message = { to: 'x@y.z', subject: 's', text: 't', html: '<p>t</p>' };

    await createResendMailer('key', 'a@b.c', 'support@teachneat.com').send(message);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reply_to).toBe('support@teachneat.com');

    await createResendMailer('key', 'a@b.c').send(message);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reply_to');
    vi.unstubAllGlobals();
  });
});

/**
 * Retention of a published promise: the privacy policy says account information
 * is deleted within 30 days of closure, and every row here holds a name and an
 * email address.
 */
describe('pruning rows of deleted accounts', () => {
  const input = (accountId: string, messageType: LifecycleMessageType) => ({
    accountId,
    messageType,
    recipientEmail: 'teacher@example.com',
    recipientName: 'Teacher',
  });

  it('deletes finished rows whose account is gone and keeps the rest', async () => {
    const live = new Set(['kept']);
    const store = createMemoryLifecycleEmailStore((id) => live.has(id));
    await store.enqueue(input('kept', 'welcome'));
    await store.enqueue(input('gone', 'welcome'));
    await store.enqueue(input('gone', 'account_deleted'));

    const claimed = await store.claimDue(10);
    for (const row of claimed.filter((r) => r.messageType === 'welcome')) {
      await store.markSent(row.id);
    }

    expect(await store.pruneOrphaned()).toBe(1);
    const left = store.all().map((r) => `${r.accountId}:${r.messageType}`).sort();
    // The deleted account's confirmation is still unsent, so it keeps its retries.
    expect(left).toEqual(['gone:account_deleted', 'kept:welcome']);
  });

  it('deletes an abandoned row of a deleted account', async () => {
    const store = createMemoryLifecycleEmailStore(() => false);
    await store.enqueue(input('gone', 'account_deleted'));
    const [row] = await store.claimDue(1);
    for (let i = row.attempts; i < LIFECYCLE_MAX_ATTEMPTS; i += 1) {
      await store.claimDue(1, new Date(Date.now() + (i + 1) * 2 * LIFECYCLE_RETRY_DELAY_MS));
    }
    await store.markFailed(row.id, 'provider refused');
    expect(await store.pruneOrphaned()).toBe(1);
    expect(store.all()).toEqual([]);
  });
});
