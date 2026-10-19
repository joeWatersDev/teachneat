import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import type { Mailer } from './mailer.js';

/**
 * Operator alerting for unhandled server errors (Phase 2 Step 6d).
 *
 * **Why this and not Sentry.** An error tracker's value is that it captures
 * context automatically — request bodies, headers, local variables. For this
 * app that is precisely the hazard: a stack frame in a roster handler has
 * student names in scope, and the product's central claim is that student
 * information never leaves the teacher's own Google account. Making Sentry safe
 * would mean a scrubbing configuration that has to be right, and stay right,
 * forever, with a silent breach of the one promise that matters as the failure
 * mode. This sends a fixed, hand-built payload instead: nothing is captured
 * automatically, so nothing can leak by default.
 *
 * **What is deliberately absent: the error message.** It is the most useful
 * field and the most dangerous one, because messages routinely interpolate the
 * thing that failed ("no student 01J…", an email address, a sheet range). The
 * top stack frame goes instead — a file and a line is where to look, and it is
 * code rather than data. The full message is still in the server log, which
 * stays inside the PII boundary and is already redacted.
 */

/** One alert per distinct problem per window, however many times it fires. */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/** Ceiling on alerts sent per window, so an outage is not an inbox flood. */
const MAX_ALERTS_PER_WINDOW = 10;

/**
 * Ceiling on tracked problem keys. Keys are method × route × status × error
 * class, so the real population is small; this only bounds a pathological case.
 */
const MAX_TRACKED_KEYS = 500;

interface Tracked {
  /** Occurrences since the last alert for this key, reported in the next one. */
  suppressed: number;
  lastSentAt: number;
}

const tracked = new Map<string, Tracked>();
let sentInWindow = 0;
let windowStartedAt = 0;
let mailer: Mailer | null = null;
let recipient = '';

export interface ServerErrorReport {
  method: string;
  /**
   * A route **label**, never a raw path. The caller is responsible for passing
   * something that cannot contain an identifier; see routeLabel below.
   */
  route: string;
  status: number;
  errorClass: string;
  /** `file:line` of the top frame, or null when there is no usable stack. */
  origin: string | null;
}

/**
 * Reduces a request to a label safe to put in an email.
 *
 * Uses the router's mount path (`/api/students`), not `req.path`, because the
 * path carries record ids — `/api/students/01J…/at-risk` — and a student id is not
 * something to mail off the server. Where there is no mount path, the first two
 * segments are used, which is shallower than any id in this API.
 */
export function routeLabel(baseUrl: string, path: string): string {
  if (baseUrl && baseUrl.length > 0) return baseUrl;
  return '/' + path.split('/').filter(Boolean).slice(0, 2).join('/');
}

/**
 * The top stack frame as `file:line`, with absolute paths stripped. Returns
 * null rather than guessing when the stack is missing or unrecognisable.
 */
export function topFrame(err: unknown): string | null {
  const stack = (err as Error)?.stack;
  if (typeof stack !== 'string') return null;
  for (const line of stack.split('\n').slice(1)) {
    const match = /([^\s()\/]+\.[jt]s):(\d+):\d+/.exec(line);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return null;
}

function render(report: ServerErrorReport, suppressed: number): { subject: string; text: string } {
  const subject = `[Teachneat] ${report.status} ${report.method} ${report.route} (${report.errorClass})`;
  const lines = [
    'An unhandled server error occurred.',
    '',
    `Route:       ${report.method} ${report.route}`,
    `Status:      ${report.status}`,
    `Error:       ${report.errorClass}`,
    `Origin:      ${report.origin ?? 'unknown'}`,
    `Environment: ${env.nodeEnv}`,
    `Time:        ${new Date().toISOString()}`,
  ];
  if (suppressed > 0) {
    lines.push('', `Plus ${suppressed} further occurrence(s) since the last alert for this error.`);
  }
  lines.push(
    '',
    'The full error message and stack are in the server log, which is not mailed',
    'because messages can contain the data that caused them.',
  );
  return { subject, text: lines.join('\n') };
}

/**
 * Wires the sender and the address. Both are passed rather than read from
 * config here, so the boot path owns the decision and a test can drive it
 * without touching the environment. Either one missing means reports are
 * recorded and none are mailed, which is the correct state before the domain
 * exists rather than a misconfiguration.
 */
export function initOperatorAlerts(next: Mailer | null, to: string = env.operatorAlertEmail): void {
  mailer = next;
  recipient = to;
}

/** Test hook: forget every window, counter and tracked key. */
export function resetOperatorAlerts(): void {
  tracked.clear();
  sentInWindow = 0;
  windowStartedAt = 0;
  mailer = null;
  recipient = '';
}

/**
 * Records an unhandled error and mails the operator if the dedupe window and
 * the per-window cap both allow it.
 *
 * **Never throws and never awaits.** It is called from the Express error
 * handler, where a rejection would replace a handled 500 with an unhandled one,
 * and where waiting on an SMTP round trip would hold the response open.
 */
export function reportServerError(report: ServerErrorReport): void {
  try {
    const now = Date.now();
    const key = `${report.method} ${report.route} ${report.status} ${report.errorClass}`;

    if (now - windowStartedAt >= DEDUPE_WINDOW_MS) {
      windowStartedAt = now;
      sentInWindow = 0;
    }
    if (tracked.size >= MAX_TRACKED_KEYS && !tracked.has(key)) tracked.clear();

    const entry = tracked.get(key) ?? { suppressed: 0, lastSentAt: 0 };
    tracked.set(key, entry);

    const withinDedupe = now - entry.lastSentAt < DEDUPE_WINDOW_MS;
    if (withinDedupe || sentInWindow >= MAX_ALERTS_PER_WINDOW) {
      entry.suppressed += 1;
      return;
    }

    if (!recipient || !mailer) {
      // Not a misconfiguration before the domain exists; the log already has it.
      entry.lastSentAt = now;
      entry.suppressed = 0;
      return;
    }

    const { subject, text } = render(report, entry.suppressed);
    entry.lastSentAt = now;
    entry.suppressed = 0;
    sentInWindow += 1;

    void mailer
      .send({ to: recipient, subject, text, html: `<pre>${text}</pre>` })
      // Caught here and never re-reported: an alert that fails to send must not
      // become an error that triggers another alert.
      .catch((err: unknown) =>
        logger.warn({ err: (err as Error).message }, 'Operator alert failed to send'),
      );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Operator alert reporting failed');
  }
}
