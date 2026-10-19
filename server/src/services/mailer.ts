import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * The app-owned transactional sender (Phase 2 Step 6h).
 *
 * A seam rather than a direct call, in the same shape as `TokenCipher`, for two
 * reasons that are not hypothetical. The sending domain cannot be verified
 * until the production domain exists (Step 8c, done 2026-08-28), so every
 * environment before that had no provider at all and local ones still do; the
 * driver has to let the queue, the templates and the sweep be exercised end to
 * end. And the provider is a
 * subprocessor named in the privacy policy, so replacing it is a decision with
 * paperwork attached; it should be one file, not a hundred call sites.
 *
 * **Deliberately no SDK.** The provider's HTTP API is one POST with a bearer
 * token, which is a few lines here against a dependency that would need review
 * under DEPENDENCIES.md and would pin us to one provider's types throughout.
 */

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /**
   * Sends, or throws. The caller (the dispatch sweep) treats a throw as a
   * retryable failure, so a driver must not swallow provider errors.
   */
  send(message: OutboundMessage): Promise<void>;
  /** Names the driver in logs, so which one is live is never a guess. */
  readonly name: string;
}

/**
 * The driver used whenever no provider is configured, which is every
 * environment before the domain exists.
 *
 * It logs the subject and recipient and writes the body to stdout, so the
 * templates can be read and reviewed exactly as a teacher would receive them
 * without an account anywhere. **The body goes to the console and nowhere
 * durable**: the "no message body logged" rule in Step 6h is about the
 * structured log, and this driver exists to be read by a developer sitting in
 * front of it. It is refused in production by `createMailer` below rather than
 * being trusted not to be reached.
 */
export function createConsoleMailer(write: (s: string) => void = console.log): Mailer {
  return {
    name: 'console',
    async send(message) {
      write(
        [
          '',
          '--- lifecycle email (not sent; no provider configured) ---',
          `To:      ${message.to}`,
          `Subject: ${message.subject}`,
          '',
          message.text,
          '--- end ---',
          '',
        ].join('\n'),
      );
    },
  };
}

/** Resend's send endpoint. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend, over its HTTP API.
 *
 * Chosen on deliverability reputation and the free tier that covers development
 * and early launch. Before the sending domain was verified in DNS (Step 8c,
 * done 2026-08-28), Resend accepted `onboarding@resend.dev` as the from address
 * and delivered only to the address owning the Resend account — the shape needed
 * to test real delivery against the operator's own inbox before a domain
 * existed. That is still what a fresh environment without a verified domain
 * gets.
 *
 * The error path deliberately carries the provider's status and message into
 * the thrown error, because the sweep records it against the queued row and
 * that record is the only diagnosis available for a message a teacher says they
 * never got. It never reaches a teacher: errorHandler is not involved, since
 * nothing here runs inside a request.
 */
export function createResendMailer(apiKey: string, from: string, replyTo = ''): Mailer {
  return {
    name: 'resend',
    async send(message) {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // `reply_to` is omitted rather than sent empty when unset: the provider
        // treats an empty header as a header, and a message advertising a reply
        // address of nothing is worse than one that quietly replies to `from`.
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });
      if (!res.ok) {
        // Truncated: a provider error body is short, but nothing unbounded
        // should reach a log line from a remote server.
        const detail = (await res.text().catch(() => '')).slice(0, 500);
        throw new Error(`Resend responded ${res.status}: ${detail}`);
      }
    },
  };
}

/**
 * The mailer this deployment uses.
 *
 * Falling back to the console driver is right in development and wrong in
 * production, where it would mean a teacher's trial quietly expiring with the
 * warning printed to a log file nobody reads. So production without a key is a
 * refusal to construct rather than a silent downgrade; the caller logs it and
 * carries on without a sweep, which leaves the messages queued rather than
 * marked sent, and a later deploy with a key delivers them.
 */
export function createMailer(): Mailer | null {
  const { apiKey, from, replyTo } = env.lifecycleEmail;
  if (apiKey && from) return createResendMailer(apiKey, from, replyTo);
  if (env.nodeEnv === 'production') {
    logger.error('No transactional email provider configured; lifecycle email is disabled.');
    return null;
  }
  logger.warn('No email provider configured; lifecycle email will print to the console.');
  return createConsoleMailer();
}
